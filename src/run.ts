import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
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

const GATE_STATES = new Set(["passed", "pending", "skipped"]);

export function resolveArtifact(runDir: string, artifactPath: string): string {
  const relative = artifactPath.replace(/^\{run\}\/?/, "");
  return path.join(runDir, relative);
}

export function assessRun(pipeline: Pipeline, runDir: string): RunStatus {
  const absoluteRun = path.resolve(runDir);
  const errors: string[] = [];
  const featureId = path.basename(absoluteRun);
  if (!fs.existsSync(absoluteRun) || !fs.statSync(absoluteRun).isDirectory()) {
    return {
      featureId,
      runDir: absoluteRun,
      completed: [],
      next: { kind: "done" },
      errors: [`Run directory not found: ${absoluteRun}`],
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
      if (gate && gateBlocks(gate, manifest, briefMeta)) {
        next = { kind: "gate", gate };
        break;
      }
    }

    const missingOutput = stage.outputs.some((artifact) => !filePresent(absoluteRun, artifact));
    if (missingOutput) {
      for (const later of stages) {
        if (later.order > stage.order && stageHasAnyOutput(absoluteRun, later)) {
          errors.push(`${later.id} has artifacts but ${stage.id} is incomplete`);
        }
      }
      next = stageAction(absoluteRun, stage);
      break;
    }

    for (const artifact of stage.outputs) {
      checkArtifactContents(pipeline, absoluteRun, artifact, errors, ticketsChecked);
    }
    for (const artifact of stage.inputs) {
      if (artifact.required && !filePresent(absoluteRun, artifact)) {
        errors.push(`${stage.id} is complete but input ${artifact.name} is missing`);
      }
    }

    checkAttempts(stage, manifest, errors);
    checkSeparation(pipeline, stage, manifest, errors);

    if (stage.verdictValues) {
      const verdict = readVerdict(absoluteRun, stage);
      if (!stage.verdictValues.includes(verdict)) {
        errors.push(`${stage.id} verdict must be one of ${stage.verdictValues.join(", ")}, found ${verdict || "nothing"}`);
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
          if (later.order > stage.order && stageHasAnyOutput(absoluteRun, later)) {
            errors.push(`${later.id} has artifacts after ${stage.id} sent the work back`);
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
    if (gate && gateBlocks(gate, manifest, briefMeta)) {
      if (gate.required === "conditional" && manifest.gates[gate.id] === "skipped") {
        errors.push(`gate ${gate.id} cannot be skipped while open questions remain`);
      }
      for (const later of stages) {
        if (later.order > stage.order && stageHasAnyOutput(absoluteRun, later)) {
          errors.push(`${later.id} has artifacts before gate ${gate.id} is passed`);
        }
      }
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
  if (briefMeta && briefMeta.openQuestions.length === 0 && manifest.gates["brief-questions"] === "pending") {
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
      path: resolveArtifact(runDir, artifact.path),
      present: filePresent(runDir, artifact),
      contract: artifact.contract,
    })),
    outputs: stage.outputs.map((artifact) => ({
      path: resolveArtifact(runDir, artifact.path),
      present: filePresent(runDir, artifact),
    })),
  };
}

function gateBlocks(gate: HumanGate, manifest: RunManifest, briefMeta: BriefMeta | null): boolean {
  if (manifest.gates[gate.id] === "passed") {
    return false;
  }
  if (gate.required === "conditional") {
    return (briefMeta?.openQuestions.length ?? 0) > 0;
  }
  return true;
}

function checkAttempts(stage: Stage, manifest: RunManifest, errors: string[]): void {
  const attempts = manifest.attempts[stage.id];
  if (attempts === undefined) {
    return;
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    errors.push(`attempts.${stage.id} must be a positive integer`);
    return;
  }
  if (attempts > stage.retryLimit) {
    const escalate = stage.escalateTo ? ` Escalate to ${stage.escalateTo}.` : "";
    errors.push(`${stage.id} attempts ${attempts} exceed retry limit ${stage.retryLimit}.${escalate}`);
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
  pipeline: Pipeline,
  runDir: string,
  artifact: Artifact,
  errors: string[],
  ticketsChecked: { done: boolean },
): void {
  const full = resolveArtifact(runDir, artifact.path);
  const text = fs.readFileSync(full, "utf8");
  if (text.trim().length === 0) {
    errors.push(`${full} is empty`);
    return;
  }
  const lines = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  for (const heading of artifact.requiredHeadings) {
    if (!lines.has(heading)) {
      errors.push(`${path.relative(pipeline.rootDir, full) || full} is missing heading ${heading}`);
    }
  }
  if (artifact.name === "acceptance-criteria" || artifact.path.endsWith("acceptance-criteria.md")) {
    for (const word of ["Given", "When", "Then"]) {
      if (!text.includes(word)) {
        errors.push(`${artifact.path} must contain ${word}`);
      }
    }
  }
  if (artifact.name === "tickets" && !ticketsChecked.done) {
    ticketsChecked.done = true;
    checkTickets(full, errors);
  }
}

function checkTickets(filePath: string, errors: string[]): void {
  let document: unknown;
  try {
    document = parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`tickets.yaml could not be parsed: ${message}`);
    return;
  }
  if (!isRecord(document) || typeof document.project !== "string") {
    errors.push("tickets.yaml needs a project");
    return;
  }
  if (!isRecord(document.epic) || document.epic.issueType !== "Epic" || typeof document.epic.summary !== "string") {
    errors.push("tickets.yaml epic needs issueType Epic and a summary");
  }
  if (!Array.isArray(document.stories) || document.stories.length === 0) {
    errors.push("tickets.yaml needs at least one story");
    return;
  }
  document.stories.forEach((story, index) => {
    if (!isRecord(story)) {
      errors.push(`tickets.yaml story ${index + 1} must be a mapping`);
      return;
    }
    for (const field of ["issueType", "summary", "description", "acceptanceCriteria", "parent"]) {
      if (typeof story[field] !== "string" || story[field].length === 0) {
        errors.push(`tickets.yaml story ${index + 1} needs ${field}`);
      }
    }
    const criteria = typeof story.acceptanceCriteria === "string" ? story.acceptanceCriteria : "";
    for (const word of ["Given", "When", "Then"]) {
      if (!criteria.includes(word)) {
        errors.push(`tickets.yaml story ${index + 1} acceptanceCriteria must contain ${word}`);
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
  const full = resolveArtifact(runDir, artifact.path);
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
  if (!isRecord(document)) {
    errors.push("brief.meta.yaml must be a mapping");
    return null;
  }
  if (!isRecord(document.source) || typeof document.source.url !== "string" || typeof document.source.pageId !== "string") {
    errors.push("brief.meta.yaml source needs url and pageId");
  }
  if (!Array.isArray(document.openQuestions) || document.openQuestions.some((item) => typeof item !== "string")) {
    errors.push("brief.meta.yaml openQuestions must be a list of strings");
    return { openQuestions: [] };
  }
  return { openQuestions: document.openQuestions };
}

function readVerdict(runDir: string, stage: Stage): string {
  const artifact = stage.outputs.find((item) => item.name === "verdict" || item.name === "review");
  if (!artifact) {
    return "";
  }
  const full = resolveArtifact(runDir, artifact.path);
  if (!fs.existsSync(full)) {
    return "";
  }
  const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
  const heading = lines.findIndex((line) => line.trim() === "## Verdict");
  if (heading === -1) {
    return "";
  }
  for (const line of lines.slice(heading + 1)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return "";
}

function filePresent(runDir: string, artifact: Artifact): boolean {
  const full = resolveArtifact(runDir, artifact.path);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    return false;
  }
  return fs.readFileSync(full, "utf8").trim().length > 0;
}

function stageHasAnyOutput(runDir: string, stage: Stage): boolean {
  return stage.outputs.some((artifact) => filePresent(runDir, artifact));
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
