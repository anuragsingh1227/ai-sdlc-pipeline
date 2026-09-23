import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { gateBlocks, isKnownGateCondition, retryBlockReason } from "./gates.js";
import { resolveArtifact } from "./paths.js";
import type {
  Artifact,
  BriefMeta,
  HumanGate,
  NextAction,
  Pipeline,
  RunManifest,
  RunStatus,
  Stage,
} from "./types.js";

export { resolveArtifact } from "./paths.js";

const GATE_STATES = new Set(["passed", "pending", "skipped"]);

/** Appended when `pipeline run` copies a template. Validate refuses the stage until a worker replaces the draft. */
export const DRAFT_LINE = "<!-- pipeline-draft: replace this scaffold before the stage can pass validate -->";

export function loadManifest(runDir: string): { manifest: RunManifest; errors: string[] } {
  const errors: string[] = [];
  return { manifest: readManifest(path.resolve(runDir), errors), errors };
}

export function assessRun(pipeline: Pipeline, runDir: string): RunStatus {
  const absoluteRun = path.resolve(runDir);
  const errors: string[] = [];
  const featureId = path.basename(absoluteRun);
  if (!fs.existsSync(absoluteRun) || !fs.statSync(absoluteRun).isDirectory()) {
    const message = `Run directory not found: ${absoluteRun}`;
    return {
      featureId,
      runDir: absoluteRun,
      completed: [],
      next: { kind: "blocked", message },
      errors: [message],
    };
  }

  const manifest = readManifest(absoluteRun, errors);
  const briefMeta = readBriefMeta(pipeline, absoluteRun, errors);
  const ticketsChecked = { done: false };

  const stages = [...pipeline.stages].sort((a, b) => a.order - b.order);
  const completed: string[] = [];
  let next: NextAction | null = null;

  for (const stage of stages) {
    if (stage.requiresGate) {
      const gate = pipeline.humanGates[stage.requiresGate];
      if (gate && blocks(gate, manifest, briefMeta, absoluteRun, pipeline)) {
        explainBlockedGate(gate, manifest, errors);
        flagArtifactsBeforeGate(absoluteRun, stages, stage.order, gate.id, errors);
        next = { kind: "gate", gate };
        break;
      }
    }

    const outputStates = stage.outputs.map((artifact) => ({
      artifact,
      state: inspectFile(absoluteRun, artifact),
    }));
    const incomplete = outputStates.some((item) => item.state !== "ok");
    if (incomplete) {
      const started = outputStates.some((item) => item.state !== "missing");
      const later = stages.some((item) => item.order > stage.order && stageHasAnyFile(absoluteRun, item));
      for (const item of outputStates) {
        const rel = runRelative(item.artifact);
        if (item.state === "empty") {
          errors.push(`${rel}: file is empty`);
        } else if (item.state === "missing" && (started || later)) {
          const why = later
            ? "later stage artifacts exist"
            : `other outputs for ${stage.id} are already present`;
          errors.push(`${rel}: missing output "${item.artifact.name}" for stage ${stage.id} (${why})`);
        }
      }
      for (const item of outputStates) {
        if (item.state === "ok") {
          checkArtifactContents(absoluteRun, item.artifact, errors, ticketsChecked);
        }
      }
      const earlyAttempt = retryBlockReason(stage, manifest.attempts[stage.id]);
      if (earlyAttempt) {
        errors.push(earlyAttempt);
      }
      next = stageAction(absoluteRun, stage);
      break;
    }

    const schemaErrors = errors.length;
    for (const artifact of stage.outputs) {
      checkArtifactContents(absoluteRun, artifact, errors, ticketsChecked);
    }
    if (stage.id === "confluence-brief") {
      checkOpenQuestions(absoluteRun, briefMeta, errors);
    }
    for (const artifact of stage.inputs) {
      if (artifact.required && inspectFile(absoluteRun, artifact) !== "ok") {
        errors.push(`${runRelative(artifact)}: missing input "${artifact.name}" required by completed stage ${stage.id}`);
      }
    }
    if (errors.length > schemaErrors) {
      next = stageAction(absoluteRun, stage, "output failed schema check");
      break;
    }

    const attemptError = retryBlockReason(stage, manifest.attempts[stage.id]);
    if (attemptError) {
      errors.push(attemptError);
    }
    checkSeparation(pipeline, stage, manifest, errors);

    let verdict: string | undefined;
    if (stage.verdictValues) {
      verdict = readVerdict(absoluteRun, stage);
      if (!stage.verdictValues.includes(verdict)) {
        const verdictFile = stage.outputs.find((item) => item.name === "verdict" || item.name === "review");
        const where = verdictFile ? runRelative(verdictFile) : stage.id;
        errors.push(`${where}: verdict must be one of ${stage.verdictValues.join(", ")}, found ${verdict || "nothing"}`);
        next = stageAction(absoluteRun, stage, "verdict is not readable");
        break;
      }
      if (verdict === "send-back") {
        const target = pipeline.stages.find((item) => item.id === stage.onSendBack);
        if (!target) {
          errors.push(`${stage.id} send-back target is missing`);
          break;
        }
        for (const later of stages) {
          if (later.order > stage.order && stageHasAnyFile(absoluteRun, later)) {
            for (const artifact of later.outputs) {
              if (fileExists(absoluteRun, artifact)) {
                errors.push(`${runRelative(artifact)}: present after ${stage.id} sent the work back to ${target.id}`);
              }
            }
          }
        }
        next = stageAction(absoluteRun, target, `${stage.id} verdict is send-back`);
        const keepBefore = target.order;
        completed.splice(0, completed.length, ...completed.filter((id) => orderOf(pipeline, id) < keepBefore));
        break;
      }
    }

    completed.push(stage.id);

    const gate = Object.values(pipeline.humanGates).find((item) => item.after === stage.id);
    const verdictForGate = stage.verdictValues ? verdict : undefined;
    if (gate && blocks(gate, manifest, briefMeta, absoluteRun, pipeline, verdictForGate)) {
      explainBlockedGate(gate, manifest, errors);
      flagArtifactsBeforeGate(absoluteRun, stages, stage.order + 1, gate.id, errors);
      next = { kind: "gate", gate };
      break;
    }
    if (gate && manifest.gates[gate.id] === "skipped" && gate.required === "true") {
      errors.push(`gate ${gate.id} cannot be skipped`);
    }
  }

  if (!next) {
    next = { kind: "done" };
  }

  checkGateVocabulary(pipeline, manifest, errors);
  if (
    briefMeta &&
    !briefMeta.malformed &&
    briefMeta.openQuestions.length === 0 &&
    manifest.gates["brief-questions"] === "pending"
  ) {
    errors.push("brief-questions is pending but openQuestions is empty; mark the gate skipped or passed");
  }

  return {
    featureId: manifest.featureId ?? featureId,
    title: manifest.title,
    runDir: absoluteRun,
    completed,
    next,
    errors,
  };
}

export function formatStatus(status: RunStatus, cwd = process.cwd()): string {
  const lines: string[] = [];
  const run = displayPath(status.runDir, cwd);
  lines.push(`Feature: ${status.featureId}`);
  if (status.title) {
    lines.push(`Title: ${status.title}`);
  }
  lines.push(`Run: ${run}`);
  lines.push("");
  lines.push(status.completed.length > 0 ? `Completed: ${status.completed.join(", ")}` : "Completed: none");
  lines.push("");
  lines.push(formatNext(status.next, cwd));
  if (status.errors.length > 0) {
    lines.push("");
    lines.push("Errors:");
    for (const error of status.errors) {
      lines.push(`- ${error}`);
    }
  }
  return lines.join("\n");
}

function formatNext(next: NextAction, cwd: string): string {
  if (next.kind === "blocked") {
    return `Next: blocked\n  ${next.message}`;
  }
  if (next.kind === "done") {
    return "Next: done";
  }
  if (next.kind === "gate") {
    return [
      `Next: human gate "${next.gate.id}"`,
      `  Resume: ${next.gate.resume}`,
      `  Prompt: ${next.gate.prompt}`,
      "  Record the decision in manifest.yaml gates.",
    ].join("\n");
  }
  const stage = next.stage;
  const lines = [
    `Next stage: ${stage.id} (${stage.label})`,
    next.reason ? `  Reason: ${next.reason}` : "",
    `  Role: ${stage.role}`,
    `  System: agents/${stage.role}/SYSTEM.md`,
    `  Skill: ${stage.skill}`,
    `  Retry limit: ${stage.retryLimit}`,
    stage.separateSessionFrom ? `  Separate session from: ${stage.separateSessionFrom}` : "",
    "  Inputs:",
    ...next.inputs.map((input) => {
      const flag = input.present ? "present" : "MISSING";
      const contract = input.contract ? ", contract" : "";
      return `    - ${displayPath(input.path, cwd)} (${flag}${contract})`;
    }),
    "  Write:",
    ...next.outputs.map((output) => {
      const flag = output.present ? "present" : "missing";
      return `    - ${displayPath(output.path, cwd)} (${flag})`;
    }),
  ];
  return lines.filter((line) => line !== "").join("\n");
}

function stageAction(runDir: string, stage: Stage, reason?: string): NextAction {
  return {
    kind: "stage",
    stage,
    reason,
    inputs: stage.inputs.map((artifact) => ({
      path: safeResolve(runDir, artifact.path) ?? artifact.path,
      present: filePresent(runDir, artifact),
      contract: artifact.contract,
    })),
    outputs: stage.outputs.map((artifact) => ({
      path: safeResolve(runDir, artifact.path) ?? artifact.path,
      present: filePresent(runDir, artifact),
    })),
  };
}

function blocks(
  gate: HumanGate,
  manifest: RunManifest,
  briefMeta: BriefMeta | null,
  runDir: string,
  pipeline: Pipeline,
  verdict?: string,
): boolean {
  const recorded = verdict ?? verdictFor(runDir, pipeline, gate);
  return gateBlocks(gate, manifest.gates[gate.id], briefMeta, recorded);
}

function verdictFor(runDir: string, pipeline: Pipeline, gate: HumanGate): string | undefined {
  if (!gate.whenVerdict) {
    return undefined;
  }
  const stage = pipeline.stages.find((item) => item.id === gate.after);
  if (!stage) {
    return undefined;
  }
  const verdict = readVerdict(runDir, stage);
  return verdict.length > 0 ? verdict : undefined;
}

function explainBlockedGate(gate: HumanGate, manifest: RunManifest, errors: string[]): void {
  if (gate.required === "conditional" && !isKnownGateCondition(gate.condition)) {
    errors.push(`gate ${gate.id} condition is not recognized (${gate.condition ?? "missing"}); failing closed`);
    return;
  }
  if (gate.required === "conditional" && manifest.gates[gate.id] === "skipped") {
    errors.push(`gate ${gate.id} cannot be skipped while open questions remain`);
  }
}

function checkSeparation(pipeline: Pipeline, stage: Stage, manifest: RunManifest, errors: string[]): void {
  if (!stage.separateSessionFrom) {
    return;
  }
  const author = manifest.sessions[stage.separateSessionFrom];
  const reviewer = manifest.sessions[stage.role];
  if (!author || !reviewer) {
    errors.push(`${stage.id} needs sessions.${stage.separateSessionFrom} and sessions.${stage.role}`);
    return;
  }
  if (author === reviewer) {
    errors.push(`${stage.role} session matches ${stage.separateSessionFrom}; critics cannot review their own work`);
  }
  if (stage.id === "spec-critic" && stage.separateSessionFrom !== pipeline.separation.specCriticMustDifferFrom) {
    errors.push("spec-critic separation does not match pipeline.separation");
  }
  if (stage.id === "code-critic" && stage.separateSessionFrom !== pipeline.separation.codeCriticMustDifferFrom) {
    errors.push("code-critic separation does not match pipeline.separation");
  }
}

function checkGateVocabulary(pipeline: Pipeline, manifest: RunManifest, errors: string[]): void {
  for (const [id, state] of Object.entries(manifest.gates)) {
    if (!pipeline.humanGates[id]) {
      errors.push(`unknown gate ${id} in manifest`);
    }
    if (!GATE_STATES.has(state)) {
      errors.push(`gate ${id} must be passed, pending, or skipped`);
    }
  }
}

function checkArtifactContents(
  runDir: string,
  artifact: Artifact,
  errors: string[],
  ticketsChecked: { done: boolean },
): void {
  const full = safeResolve(runDir, artifact.path);
  const rel = runRelative(artifact);
  if (!full) {
    errors.push(`${rel}: path must stay under the run directory`);
    return;
  }
  const text = fs.readFileSync(full, "utf8");
  if (text.trim().length === 0) {
    errors.push(`${rel}: file is empty`);
    return;
  }
  if (text.includes("pipeline-draft")) {
    errors.push(`${rel}: still a draft scaffold; replace it before this stage can pass`);
  }
  const lines = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  for (const heading of artifact.requiredHeadings) {
    if (!lines.has(heading)) {
      errors.push(`${rel}: missing heading ${heading}`);
    }
  }
  if (artifact.requiredFields.length > 0) {
    checkRequiredFields(full, rel, artifact.requiredFields, errors);
  }
  if (artifact.name === "acceptance-criteria" || artifact.path.endsWith("acceptance-criteria.md")) {
    for (const word of ["Given", "When", "Then"]) {
      if (!new RegExp(`\\b${word}\\b`).test(text)) {
        errors.push(`${rel}: must contain ${word}`);
      }
    }
  }
  if (artifact.name === "tickets" && !ticketsChecked.done) {
    ticketsChecked.done = true;
    checkTickets(full, rel, errors);
  }
}

function checkTickets(filePath: string, rel: string, errors: string[]): void {
  let document: unknown;
  try {
    document = parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${rel}: could not be parsed: ${message}`);
    return;
  }
  if (!isRecord(document) || typeof document.project !== "string") {
    errors.push(`${rel}: needs a project`);
    return;
  }
  if (!isRecord(document.epic) || document.epic.issueType !== "Epic" || typeof document.epic.summary !== "string") {
    errors.push(`${rel}: epic needs issueType Epic and a summary`);
  }
  if (!Array.isArray(document.stories) || document.stories.length === 0) {
    errors.push(`${rel}: needs at least one story`);
    return;
  }
  document.stories.forEach((story, index) => {
    if (!isRecord(story)) {
      errors.push(`${rel}: story ${index + 1} must be a mapping`);
      return;
    }
    for (const field of ["issueType", "summary", "description", "acceptanceCriteria", "parent"]) {
      if (typeof story[field] !== "string" || story[field].length === 0) {
        errors.push(`${rel}: story ${index + 1} needs ${field}`);
      }
    }
    const criteria = typeof story.acceptanceCriteria === "string" ? story.acceptanceCriteria : "";
    for (const word of ["Given", "When", "Then"]) {
      if (!criteria.includes(word)) {
        errors.push(`${rel}: story ${index + 1} acceptanceCriteria must contain ${word}`);
      }
    }
  });
}

function readManifest(runDir: string, errors: string[]): RunManifest {
  const manifestPath = path.join(runDir, "manifest.yaml");
  const empty: RunManifest = { sessions: {}, gates: {}, attempts: {} };
  if (!fs.existsSync(manifestPath)) {
    return empty;
  }
  let document: unknown;
  try {
    document = parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`manifest.yaml could not be parsed: ${message}`);
    return empty;
  }
  if (!isRecord(document)) {
    errors.push("manifest.yaml must be a mapping");
    return empty;
  }
  const sessions = readStringMap(document.sessions, "sessions", errors);
  const gates = readStringMap(document.gates, "gates", errors);
  const attempts: Record<string, number> = {};
  if (document.attempts !== undefined) {
    if (!isRecord(document.attempts)) {
      errors.push("manifest attempts must be a mapping");
    } else {
      for (const [key, value] of Object.entries(document.attempts)) {
        if (typeof value !== "number") {
          errors.push(`attempts.${key} must be a number`);
        } else {
          attempts[key] = value;
        }
      }
    }
  }
  return {
    featureId: typeof document.featureId === "string" ? document.featureId : undefined,
    title: typeof document.title === "string" ? document.title : undefined,
    sessions,
    gates,
    attempts,
  };
}

function readBriefMeta(pipeline: Pipeline, runDir: string, errors: string[]): BriefMeta | null {
  const stage = pipeline.stages.find((item) => item.id === "confluence-brief");
  const artifact = stage?.outputs.find((item) => item.name === "brief-meta");
  if (!artifact) {
    return null;
  }
  const full = safeResolve(runDir, artifact.path);
  if (!full) {
    errors.push("brief.meta.yaml: path must stay under the run directory");
    return { openQuestions: [], malformed: true };
  }
  if (!fs.existsSync(full)) {
    return null;
  }
  let document: unknown;
  try {
    document = parse(fs.readFileSync(full, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`brief.meta.yaml could not be parsed: ${message}`);
    return null;
  }
  if (!isRecord(document) || !Array.isArray(document.openQuestions) || document.openQuestions.some((item) => typeof item !== "string")) {
    errors.push("brief.meta.yaml: openQuestions must be a list of strings");
    return { openQuestions: [], malformed: true };
  }
  return { openQuestions: document.openQuestions };
}

function readVerdict(runDir: string, stage: Stage): string {
  const artifact = stage.outputs.find((item) => item.name === "verdict" || item.name === "review");
  if (!artifact) {
    return "";
  }
  const full = safeResolve(runDir, artifact.path);
  if (!full || !fs.existsSync(full)) {
    return "";
  }
  const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
  const heading = lines.findIndex((line) => line.trim() === "## Verdict");
  if (heading === -1) {
    return "";
  }
  for (const line of lines.slice(heading + 1)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const match = /^(approve|send-back)$/i.exec(trimmed);
    if (match) {
      return match[1].toLowerCase();
    }
    return trimmed;
  }
  return "";
}

function filePresent(runDir: string, artifact: Artifact): boolean {
  return inspectFile(runDir, artifact) === "ok";
}

function fileExists(runDir: string, artifact: Artifact): boolean {
  const full = safeResolve(runDir, artifact.path);
  return full !== null && fs.existsSync(full) && fs.statSync(full).isFile();
}

function inspectFile(runDir: string, artifact: Artifact): "missing" | "empty" | "ok" {
  const full = safeResolve(runDir, artifact.path);
  if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    return "missing";
  }
  return fs.readFileSync(full, "utf8").trim().length === 0 ? "empty" : "ok";
}

function safeResolve(runDir: string, artifactPath: string): string | null {
  try {
    return resolveArtifact(runDir, artifactPath);
  } catch {
    return null;
  }
}

function stageHasAnyFile(runDir: string, stage: Stage): boolean {
  return stage.outputs.some((artifact) => fileExists(runDir, artifact));
}

function runRelative(artifact: Artifact): string {
  return artifact.path.replace(/^\{run\}\/?/, "");
}

function flagArtifactsBeforeGate(
  runDir: string,
  stages: Stage[],
  minimumOrder: number,
  gateId: string,
  errors: string[],
): void {
  for (const later of stages) {
    if (later.order < minimumOrder) {
      continue;
    }
    for (const artifact of later.outputs) {
      if (fileExists(runDir, artifact)) {
        errors.push(`${runRelative(artifact)}: present before gate ${gateId} is passed`);
      }
    }
  }
}

function checkRequiredFields(filePath: string, rel: string, fields: string[], errors: string[]): void {
  let document: unknown;
  try {
    document = parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${rel}: could not be parsed: ${message}`);
    return;
  }
  for (const field of fields) {
    const value = valueAt(document, field);
    if (field === "openQuestions") {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        errors.push(`${rel}: field openQuestions must be a list of strings`);
      }
      continue;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      errors.push(`${rel}: missing field ${field}`);
    }
  }
}

function checkOpenQuestions(runDir: string, briefMeta: BriefMeta | null, errors: string[]): void {
  const briefPath = path.join(runDir, "01-brief", "brief.md");
  if (!fs.existsSync(briefPath) || !briefMeta) {
    return;
  }
  const body = sectionBody(fs.readFileSync(briefPath, "utf8"), "## Open questions");
  const bullets = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => !/^none\b/i.test(line));
  if (briefMeta.openQuestions.length === 0 && bullets.length > 0) {
    errors.push("01-brief/brief.md: Open questions lists items but 01-brief/brief.meta.yaml openQuestions is empty");
  }
  if (briefMeta.openQuestions.length > 0 && bullets.length === 0) {
    errors.push("01-brief/brief.meta.yaml: openQuestions is non-empty but 01-brief/brief.md has no question bullets under \"## Open questions\"");
  }
  for (const question of briefMeta.openQuestions) {
    if (!body.includes(question)) {
      errors.push(`01-brief/brief.meta.yaml: open question is missing from 01-brief/brief.md: ${question}`);
    }
  }
}

function sectionBody(text: string, heading: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return "";
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

function valueAt(document: unknown, dotted: string): unknown {
  let current = document;
  for (const part of dotted.split(".")) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function orderOf(pipeline: Pipeline, stageId: string): number {
  return pipeline.stages.find((stage) => stage.id === stageId)?.order ?? 0;
}

function readStringMap(value: unknown, label: string, errors: string[]): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    errors.push(`manifest ${label} must be a mapping`);
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" || entry.length === 0) {
      errors.push(`manifest ${label}.${key} must be a non-empty string`);
    } else {
      result[key] = entry;
    }
  }
  return result;
}

function displayPath(filePath: string, cwd: string): string {
  const relative = path.relative(cwd, filePath);
  return relative.startsWith("..") ? filePath : relative || ".";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
