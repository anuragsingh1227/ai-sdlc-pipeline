import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import type { Artifact, HumanGate, Pipeline, Role, Stage } from "./types.js";

const REQUIRED_STAGE_IDS = [
  "confluence-brief",
  "spec-draft",
  "spec-critic",
  "jira-ac",
  "implement",
  "code-critic",
  "release",
] as const;

const ROLE_FILES = ["SYSTEM.md", "INPUT.md", "OUTPUT.md", "CHECKLIST.md"];
const SKILL_SECTIONS = [
  "## When to use",
  "## Steps",
  "## Required inputs",
  "## Required outputs",
  "## Stop and ask a human",
  "## Done when",
];

export function loadPipeline(filePath: string): { pipeline: Pipeline | null; errors: string[] } {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    return { pipeline: null, errors: [`Pipeline file not found: ${absolute}`] };
  }
  let document: unknown;
  try {
    document = parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { pipeline: null, errors: [`Could not parse ${absolute}: ${message}`] };
  }
  return validatePipelineDocument(document, path.dirname(absolute));
}

export function validatePipelineDocument(
  document: unknown,
  rootDir: string,
): { pipeline: Pipeline | null; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(document)) {
    return { pipeline: null, errors: ["pipeline.yaml must be a mapping"] };
  }

  if (document.version !== 1) {
    errors.push("version must be 1");
  }
  if (typeof document.name !== "string" || document.name.length === 0) {
    errors.push("name must be a non-empty string");
  }
  if (typeof document.artifactRoot !== "string" || document.artifactRoot.length === 0) {
    errors.push("artifactRoot must be a non-empty string");
  }

  const orchestrator = document.orchestrator;
  if (!isRecord(orchestrator)) {
    errors.push("orchestrator must be a mapping");
  } else {
    if (orchestrator.llm !== false) {
      errors.push("orchestrator.llm must be false");
    }
    if (typeof orchestrator.routesBy !== "string") {
      errors.push("orchestrator.routesBy must be a string");
    }
  }

  const separation = document.separation;
  if (!isRecord(separation)) {
    errors.push("separation must be a mapping");
  } else {
    if (separation.specCriticMustDifferFrom !== "spec-writer") {
      errors.push("separation.specCriticMustDifferFrom must be spec-writer");
    }
    if (separation.codeCriticMustDifferFrom !== "implementer") {
      errors.push("separation.codeCriticMustDifferFrom must be implementer");
    }
  }

  const roles = parseRoles(document.roles, errors);
  const humanGates = parseGates(document.humanGates, errors);
  const stages = parseStages(document.stages, errors);

  if (errors.length > 0 || !isRecord(orchestrator) || !isRecord(separation)) {
    return { pipeline: null, errors };
  }

  const pipeline: Pipeline = {
    version: 1,
    name: String(document.name),
    artifactRoot: String(document.artifactRoot),
    rootDir,
    orchestrator: {
      llm: false,
      routesBy: String(orchestrator.routesBy),
    },
    separation: {
      specCriticMustDifferFrom: "spec-writer",
      codeCriticMustDifferFrom: "implementer",
    },
    roles,
    humanGates,
    stages,
  };

  checkGraph(pipeline, errors);
  if (errors.length > 0) {
    return { pipeline: null, errors };
  }
  return { pipeline, errors };
}

function parseRoles(value: unknown, errors: string[]): Record<string, Role> {
  if (!isRecord(value)) {
    errors.push("roles must be a mapping");
    return {};
  }
  const roles: Record<string, Role> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!isRecord(raw) || typeof raw.title !== "string" || typeof raw.folder !== "string") {
      errors.push(`role ${id} needs title and folder`);
      continue;
    }
    if (!Array.isArray(raw.stages) || raw.stages.some((stage) => typeof stage !== "string")) {
      errors.push(`role ${id} stages must be a list of strings`);
      continue;
    }
    roles[id] = { title: raw.title, folder: raw.folder, stages: raw.stages };
  }
  for (const id of ["spec-writer", "spec-critic", "jira-ac", "implementer", "code-critic-release"]) {
    if (!roles[id]) {
      errors.push(`missing role ${id}`);
    }
  }
  return roles;
}

function parseGates(value: unknown, errors: string[]): Record<string, HumanGate> {
  if (!isRecord(value)) {
    errors.push("humanGates must be a mapping");
    return {};
  }
  const gates: Record<string, HumanGate> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!isRecord(raw)) {
      errors.push(`human gate ${id} must be a mapping`);
      continue;
    }
    const required = raw.required === "conditional" || raw.required === true ? raw.required : null;
    if (required === null) {
      errors.push(`human gate ${id} required must be true or conditional`);
    }
    if (typeof raw.after !== "string" || typeof raw.resume !== "string" || typeof raw.prompt !== "string") {
      errors.push(`human gate ${id} needs after, resume, and prompt`);
      continue;
    }
    if (required === null) {
      continue;
    }
    if (required === "conditional" && typeof raw.condition !== "string") {
      errors.push(`human gate ${id} is conditional and needs a condition`);
    }
    gates[id] = {
      id,
      after: raw.after,
      required: required === true ? "true" : "conditional",
      condition: typeof raw.condition === "string" ? raw.condition : undefined,
      whenVerdict: typeof raw.whenVerdict === "string" ? raw.whenVerdict : undefined,
      resume: raw.resume,
      prompt: raw.prompt,
    };
  }
  for (const id of ["brief-questions", "spec-approved", "merge"]) {
    if (!gates[id]) {
      errors.push(`missing human gate ${id}`);
    }
  }
  return gates;
}

function parseStages(value: unknown, errors: string[]): Stage[] {
  if (!Array.isArray(value)) {
    errors.push("stages must be a list");
    return [];
  }
  const stages: Stage[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== "string") {
      errors.push("each stage needs an id");
      continue;
    }
    const id = raw.id;
    if (raw.type !== "agent") {
      errors.push(`stage ${id} type must be agent`);
    }
    if (typeof raw.order !== "number" || !Number.isInteger(raw.order)) {
      errors.push(`stage ${id} order must be an integer`);
    }
    if (typeof raw.label !== "string" || typeof raw.role !== "string" || typeof raw.skill !== "string") {
      errors.push(`stage ${id} needs label, role, and skill`);
    }
    if (typeof raw.retryLimit !== "number" || !Number.isInteger(raw.retryLimit) || raw.retryLimit < 1) {
      errors.push(`stage ${id} retryLimit must be a positive integer`);
    }
    stages.push({
      id,
      order: typeof raw.order === "number" ? raw.order : 0,
      label: typeof raw.label === "string" ? raw.label : id,
      type: "agent",
      role: typeof raw.role === "string" ? raw.role : "",
      skill: typeof raw.skill === "string" ? raw.skill : "",
      retryLimit: typeof raw.retryLimit === "number" ? raw.retryLimit : 0,
      separateSessionFrom: typeof raw.separateSessionFrom === "string" ? raw.separateSessionFrom : undefined,
      requiresGate: typeof raw.requiresGate === "string" ? raw.requiresGate : undefined,
      escalateTo: typeof raw.escalateTo === "string" ? raw.escalateTo : undefined,
      inputs: parseArtifacts(raw.inputs, `${id} inputs`, errors),
      outputs: parseArtifacts(raw.outputs, `${id} outputs`, errors),
      onSuccess: typeof raw.onSuccess === "string" ? raw.onSuccess : undefined,
      onReject: typeof raw.onReject === "string" ? raw.onReject : undefined,
      onApprove: typeof raw.onApprove === "string" ? raw.onApprove : undefined,
      onSendBack: typeof raw.onSendBack === "string" ? raw.onSendBack : undefined,
      verdictValues: Array.isArray(raw.verdictValues)
        ? raw.verdictValues.filter((item): item is string => typeof item === "string")
        : undefined,
    });
  }
  return stages;
}

function parseArtifacts(value: unknown, label: string, errors: string[]): Artifact[] {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be a list`);
    return [];
  }
  const artifacts: Artifact[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.path !== "string") {
      errors.push(`${label} entries need name and path`);
      continue;
    }
    artifacts.push({
      name: raw.name,
      path: raw.path,
      required: raw.required !== false,
      source: typeof raw.source === "string" ? raw.source : undefined,
      template: typeof raw.template === "string" ? raw.template : undefined,
      requiredHeadings: Array.isArray(raw.requiredHeadings)
        ? raw.requiredHeadings.filter((item): item is string => typeof item === "string")
        : [],
      requiredFields: Array.isArray(raw.requiredFields)
        ? raw.requiredFields.filter((item): item is string => typeof item === "string")
        : [],
      contract: raw.contract === true,
      note: typeof raw.note === "string" ? raw.note : undefined,
    });
  }
  return artifacts;
}

function checkGraph(pipeline: Pipeline, errors: string[]): void {
  const stageIds = new Set<string>();
  const orders = new Set<number>();
  for (const stage of pipeline.stages) {
    if (stageIds.has(stage.id)) {
      errors.push(`duplicate stage id ${stage.id}`);
    }
    stageIds.add(stage.id);
    if (orders.has(stage.order)) {
      errors.push(`duplicate stage order ${stage.order}`);
    }
    orders.add(stage.order);
  }

  for (const id of REQUIRED_STAGE_IDS) {
    if (!stageIds.has(id)) {
      errors.push(`missing required stage ${id}`);
    }
  }

  for (const gateId of Object.keys(pipeline.humanGates)) {
    if (stageIds.has(gateId)) {
      errors.push(`id ${gateId} is both a stage and a human gate`);
    }
  }

  const known = new Set<string>([...stageIds, ...Object.keys(pipeline.humanGates), "done"]);

  for (const stage of pipeline.stages) {
    if (!pipeline.roles[stage.role]) {
      errors.push(`stage ${stage.id} references unknown role ${stage.role}`);
    }
    for (const target of [stage.onSuccess, stage.onReject, stage.onApprove, stage.onSendBack, stage.escalateTo, stage.requiresGate]) {
      if (target !== undefined && !known.has(target)) {
        errors.push(`stage ${stage.id} points at unknown target ${target}`);
      }
    }
    if (stage.verdictValues) {
      for (const value of ["approve", "send-back"]) {
        if (!stage.verdictValues.includes(value)) {
          errors.push(`stage ${stage.id} verdictValues must include ${value}`);
        }
      }
      if (!stage.onApprove || !stage.onSendBack) {
        errors.push(`stage ${stage.id} needs onApprove and onSendBack`);
      }
    }
    if (!stage.skill.startsWith("skills/") || !fs.existsSync(path.join(pipeline.rootDir, stage.skill))) {
      errors.push(`stage ${stage.id} skill not found: ${stage.skill}`);
    }
    for (const artifact of [...stage.inputs, ...stage.outputs]) {
      if (!artifact.path.includes("{run}/")) {
        errors.push(`stage ${stage.id} artifact ${artifact.name} path must start with {run}/`);
      }
      if (artifact.template) {
        const templatePath = path.join(pipeline.rootDir, artifact.template);
        if (!fs.existsSync(templatePath)) {
          errors.push(`stage ${stage.id} template not found: ${artifact.template}`);
        } else {
          const templateLines = new Set(
            fs.readFileSync(templatePath, "utf8").split(/\r?\n/).map((line) => line.trim()),
          );
          for (const heading of artifact.requiredHeadings) {
            if (!templateLines.has(heading)) {
              errors.push(`${artifact.template}: missing heading ${heading} required by stage ${stage.id}`);
            }
          }
        }
      }
    }
    if (stage.outputs.length === 0) {
      errors.push(`stage ${stage.id} needs outputs`);
    }
  }

  const specCritic = pipeline.stages.find((stage) => stage.id === "spec-critic");
  const codeCritic = pipeline.stages.find((stage) => stage.id === "code-critic");
  if (specCritic?.separateSessionFrom !== "spec-writer" || specCritic.role === "spec-writer") {
    errors.push("spec-critic must run as a different role and session from spec-writer");
  }
  if (codeCritic?.separateSessionFrom !== "implementer" || codeCritic.role === "implementer") {
    errors.push("code-critic must run as a different role and session from implementer");
  }
  const implement = pipeline.stages.find((stage) => stage.id === "implement");
  if (!implement?.inputs.some((input) => input.contract && input.name === "acceptance-criteria")) {
    errors.push("implement must take acceptance-criteria as a contract input");
  }

  for (const [roleId, role] of Object.entries(pipeline.roles)) {
    const actual = pipeline.stages.filter((stage) => stage.role === roleId).map((stage) => stage.id);
    const expected = [...role.stages].sort();
    const got = [...actual].sort();
    if (expected.join(",") !== got.join(",")) {
      errors.push(`role ${roleId} stages [${expected.join(", ")}] do not match graph [${got.join(", ")}]`);
    }
    if (role.folder !== `agents/${roleId}`) {
      errors.push(`role ${roleId} folder must be agents/${roleId}`);
    }
    for (const fileName of ROLE_FILES) {
      const full = path.join(pipeline.rootDir, role.folder, fileName);
      if (!fs.existsSync(full)) {
        errors.push(`role ${roleId} missing ${path.join(role.folder, fileName)}`);
      } else if (fs.readFileSync(full, "utf8").trim().length === 0) {
        errors.push(`role ${roleId} ${path.join(role.folder, fileName)} is empty`);
      }
    }
  }

  for (const gate of Object.values(pipeline.humanGates)) {
    if (!stageIds.has(gate.after)) {
      errors.push(`human gate ${gate.id} after is not a stage`);
    }
    if (!known.has(gate.resume)) {
      errors.push(`human gate ${gate.id} resume is not a stage or done`);
    }
  }

  if (pipeline.humanGates["spec-approved"]?.required !== "true") {
    errors.push("spec-approved must be a required human gate");
  }
  if (pipeline.humanGates.merge?.required !== "true") {
    errors.push("merge must be a required human gate");
  }
  if (pipeline.humanGates["brief-questions"]?.required !== "conditional") {
    errors.push("brief-questions must be a conditional human gate");
  }

  const ordered = [...pipeline.stages].sort((a, b) => a.order - b.order);
  ordered.forEach((stage, index) => {
    if (stage.order !== index + 1) {
      errors.push(`stage ${stage.id} order is ${stage.order}; orders must be contiguous from 1`);
    }
  });

  const outputOwners = new Map<string, string>();
  const skillOwners = new Map<string, string>();
  for (const stage of ordered) {
    const next = ordered.find((item) => item.order === stage.order + 1);
    if (stage.verdictValues) {
      if (stage.onSuccess) {
        errors.push(`stage ${stage.id} uses verdict transitions and must not set onSuccess`);
      }
      assertTransitionTarget(pipeline, stage, stage.onApprove, "onApprove", next?.id, errors);
      const sendBack = pipeline.stages.find((item) => item.id === stage.onSendBack);
      if (sendBack && sendBack.order >= stage.order) {
        errors.push(`stage ${stage.id} onSendBack must point at an earlier stage`);
      }
    } else if (!stage.onSuccess) {
      errors.push(`stage ${stage.id} needs onSuccess`);
    } else {
      assertTransitionTarget(pipeline, stage, stage.onSuccess, "onSuccess", next?.id, errors);
    }
    if (stage.separateSessionFrom && !pipeline.roles[stage.separateSessionFrom]) {
      errors.push(`stage ${stage.id} separateSessionFrom is not a role`);
    }
    if (skillOwners.has(stage.skill)) {
      errors.push(`skill ${stage.skill} is used by ${skillOwners.get(stage.skill)} and ${stage.id}`);
    }
    skillOwners.set(stage.skill, stage.id);
    for (const artifact of stage.outputs) {
      const owner = outputOwners.get(artifact.path);
      if (owner) {
        errors.push(`output path ${artifact.path} is produced by ${owner} and ${stage.id}`);
      }
      outputOwners.set(artifact.path, stage.id);
    }
    checkSkillFile(pipeline, stage, errors);
  }

  for (const gate of Object.values(pipeline.humanGates)) {
    if (gate.resume === "done") {
      continue;
    }
    const after = pipeline.stages.find((stage) => stage.id === gate.after);
    const resume = pipeline.stages.find((stage) => stage.id === gate.resume);
    if (after && resume && resume.order <= after.order) {
      errors.push(`human gate ${gate.id} resume must be a stage after ${gate.after}`);
    }
  }
}

function assertTransitionTarget(
  pipeline: Pipeline,
  stage: Stage,
  target: string | undefined,
  field: string,
  nextStageId: string | undefined,
  errors: string[],
): void {
  if (!target) {
    return;
  }
  const gate = pipeline.humanGates[target];
  if (gate) {
    if (gate.after !== stage.id) {
      errors.push(`stage ${stage.id} ${field} gate ${target} is not after this stage`);
    }
    return;
  }
  if (target !== nextStageId) {
    errors.push(`stage ${stage.id} ${field} must be the next stage${nextStageId ? ` (${nextStageId})` : ""} or a human gate after this stage`);
  }
}

function checkSkillFile(pipeline: Pipeline, stage: Stage, errors: string[]): void {
  const full = path.join(pipeline.rootDir, stage.skill);
  if (!fs.existsSync(full)) {
    return;
  }
  const text = fs.readFileSync(full, "utf8");
  const frontmatter = parseFrontmatter(text);
  if (!frontmatter) {
    errors.push(`${stage.skill}: missing YAML frontmatter (name, description, stage, role)`);
    return;
  }
  const folder = path.basename(path.dirname(stage.skill));
  if (frontmatter.name !== folder) {
    errors.push(`${stage.skill}: frontmatter name must be ${folder}`);
  }
  if (!frontmatter.description?.trim()) {
    errors.push(`${stage.skill}: frontmatter description is empty`);
  }
  if (frontmatter.stage !== stage.id) {
    errors.push(`${stage.skill}: frontmatter stage is "${frontmatter.stage ?? ""}"; expected ${stage.id}`);
  }
  if (frontmatter.role !== stage.role) {
    errors.push(`${stage.skill}: frontmatter role is "${frontmatter.role ?? ""}"; expected ${stage.role}`);
  }
  const lines = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  for (const section of SKILL_SECTIONS) {
    if (!lines.has(section)) {
      errors.push(`${stage.skill}: missing section ${section}`);
    }
  }
}

export function parseFrontmatter(text: string): Record<string, string> | null {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) {
    return null;
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) {
    return null;
  }
  const block = text.slice(text.indexOf("\n") + 1, end);
  let document: unknown;
  try {
    document = parse(block);
  } catch {
    return null;
  }
  if (!isRecord(document)) {
    return null;
  }
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(document)) {
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  return fields;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
