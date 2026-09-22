import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Pipeline, Stage } from "./types.js";
import { DRAFT_LINE, assessRun, formatStatus, resolveArtifact } from "./run.js";

export type WorkerName = "none" | "grok" | "claude" | "codex";

export interface RunRequest {
  dryRun: boolean;
  worker: WorkerName;
  to?: string;
  commandExists?: (command: string) => boolean;
  spawnWorker?: (command: string, args: string[], cwd: string) => { status: number | null };
}

export function workerArgv(worker: Exclude<WorkerName, "none">, taskFile: string, prompt: string): { command: string; args: string[] } {
  switch (worker) {
    case "grok":
      return { command: "grok", args: ["-p", "--prompt-file", taskFile] };
    case "claude":
      return { command: "claude", args: ["-p", prompt] };
    case "codex":
      return { command: "codex", args: ["exec", prompt] };
  }
}

export function commandOnPath(command: string): boolean {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0;
}

/**
 * Prepare the next incomplete stage, or stop on a human gate.
 * Routing is the phase graph. This function does not call a model.
 * One invocation prepares at most one stage.
 */
export function runNextStage(pipeline: Pipeline, runDir: string, request: RunRequest): { code: number; report: string } {
  const status = assessRun(pipeline, runDir);
  const blocking = status.errors.filter((error) => !error.includes("still a draft scaffold"));
  if (status.next.kind === "blocked" || (blocking.length > 0 && status.next.kind !== "stage")) {
    return { code: 1, report: formatStatus(status) };
  }
  if (status.next.kind === "gate" || status.next.kind === "done") {
    return { code: blocking.length > 0 ? 1 : 0, report: formatStatus(status) };
  }
  if (blocking.length > 0) {
    return { code: 1, report: formatStatus(status) };
  }

  const stage = status.next.stage;
  if (request.to) {
    const ceiling = pipeline.stages.find((item) => item.id === request.to);
    if (!ceiling) {
      return { code: 1, report: `Unknown --to stage "${request.to}". Known stages: ${pipeline.stages.map((item) => item.id).join(", ")}` };
    }
    if (stage.order > ceiling.order) {
      return { code: 0, report: `Next stage ${stage.id} is past --to ${ceiling.id}. Nothing to prepare.` };
    }
  }

  const lines = [
    `Next stage: ${stage.id} (${stage.label})`,
    `Role: ${stage.role}`,
    `Skill: ${stage.skill}`,
    `Worker: ${request.worker}`,
    request.dryRun ? "Mode: dry-run (no files written, no worker launched)" : "Mode: prepare",
  ];

  for (const artifact of stage.outputs) {
    const destination = resolveArtifact(runDir, artifact.path);
    if (fs.existsSync(destination)) {
      lines.push(`Keep: ${display(destination)}`);
      continue;
    }
    if (!artifact.template) {
      lines.push(`Needs author: ${display(destination)} (no template)`);
      continue;
    }
    const templatePath = path.join(pipeline.rootDir, artifact.template);
    lines.push(`Template: ${artifact.template} -> ${display(destination)}`);
    if (!request.dryRun) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const body = fs.readFileSync(templatePath, "utf8").trimEnd();
      fs.writeFileSync(destination, `${body}\n\n${DRAFT_LINE}\n`);
    }
  }

  const taskFile = path.join(runDir, ".pipeline", "task.md");
  const prompt = buildTaskPrompt(pipeline, runDir, stage);
  if (request.worker === "none") {
    lines.push("Worker none: templates prepared where missing. Draft files fail validate until a worker replaces them.");
    lines.push("Coding still happens in the product repo. This process does not call a model.");
    return { code: 0, report: lines.join("\n") };
  }

  const argv = workerArgv(request.worker, taskFile, prompt);
  lines.push(`Command: ${argv.command} ${describeArgs(argv.args, taskFile, prompt)}`);
  if (request.dryRun) {
    lines.push(`Would write task: ${display(taskFile)}`);
    return { code: 0, report: lines.join("\n") };
  }

  const exists = request.commandExists ?? commandOnPath;
  if (!exists(argv.command)) {
    lines.push(`Error: worker "${argv.command}" was not found on PATH. Install it, or rerun with --worker none.`);
    return { code: 1, report: lines.join("\n") };
  }
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(taskFile, prompt);
  const spawnWorker = request.spawnWorker ?? defaultSpawn;
  const result = spawnWorker(argv.command, argv.args, pipeline.rootDir);
  if (result.status !== 0) {
    lines.push(`Error: ${argv.command} exited ${result.status ?? "with a launch error"}.`);
    return { code: 1, report: lines.join("\n") };
  }
  lines.push(`Worker ${argv.command} exited 0. Re-run pipeline validate --run before the next stage.`);
  return { code: 0, report: lines.join("\n") };
}

export function buildTaskPrompt(pipeline: Pipeline, runDir: string, stage: Stage): string {
  const roleDir = path.join(pipeline.rootDir, "agents", stage.role);
  const systemPath = path.join(roleDir, "SYSTEM.md");
  const skillPath = path.join(pipeline.rootDir, stage.skill);
  const system = fs.readFileSync(systemPath, "utf8").trim();
  const skill = fs.readFileSync(skillPath, "utf8").trim();
  const inputs = stage.inputs.map((artifact) => `- ${resolveArtifact(runDir, artifact.path)}`).join("\n");
  const outputs = stage.outputs.map((artifact) => `- ${resolveArtifact(runDir, artifact.path)}`).join("\n");
  return [
    `# Stage ${stage.id}`,
    "",
    "Do this stage only. Do not switch roles. Do not pass a human gate.",
    "",
    "## System",
    system,
    "",
    "## Skill",
    skill,
    "",
    "## Inputs",
    inputs,
    "",
    "## Write",
    outputs,
    "",
    "Remove the pipeline-draft marker from any file you finish.",
    "",
  ].join("\n");
}

function describeArgs(args: string[], taskFile: string, prompt: string): string {
  return args.map((arg) => (arg === prompt ? `@${taskFile}` : arg)).join(" ");
}

function defaultSpawn(command: string, args: string[], cwd: string): { status: number | null } {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  return { status: result.status };
}

function display(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  return relative.startsWith("..") ? filePath : relative || ".";
}
