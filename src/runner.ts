import fs from "node:fs";
import path from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { retryBlockReason } from "./gates.js";
import { DRAFT_LINE, assessRun, formatStatus, loadManifest, resolveArtifact } from "./run.js";
import { resolveRepoPath } from "./paths.js";
import type { Pipeline, Stage } from "./types.js";
import { leakedSecretNames, scrubWorkerEnv } from "./worker-env.js";

export type WorkerName = "none" | "grok" | "claude" | "codex";

/** Hard stop so a hung coding CLI cannot hold the pipeline open. */
export const DEFAULT_WORKER_TIMEOUT_MS = 15 * 60 * 1000;

export interface WorkerCommand {
  command: string;
  args: string[];
  /** When set, the task file is the process stdin. The prompt text is never an argv entry. */
  stdinFile?: string;
}

export interface WorkerSpawnRequest {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  stdinFile?: string;
}

export interface SpawnResult {
  status: number | null;
  timedOut?: boolean;
  signal?: string;
}

export interface RunRequest {
  dryRun: boolean;
  worker: WorkerName;
  to?: string;
  workerTimeoutMs?: number;
  commandExists?: (command: string) => boolean;
  spawnWorker?: (request: WorkerSpawnRequest) => SpawnResult;
}

export function workerArgv(worker: Exclude<WorkerName, "none">, taskFile: string): WorkerCommand {
  switch (worker) {
    case "grok":
      return { command: "grok", args: ["-p", "--prompt-file", taskFile] };
    case "claude":
      // The task file is an argument. The positional line is a fixed instruction, not the task body.
      // Stdin carries the same file for Claude Code builds that read the print-mode prompt from stdin.
      return {
        command: "claude",
        args: [
          "-p",
          "--append-system-prompt-file",
          taskFile,
          "Follow the stage task in the appended prompt file. Write only the listed outputs.",
        ],
        stdinFile: taskFile,
      };
    case "codex":
      // `codex exec -` reads the full prompt from stdin.
      return { command: "codex", args: ["exec", "-"], stdinFile: taskFile };
  }
}

export function commandOnPath(command: string): boolean {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0;
}

/** A signal, launch error, or null status is a failed run. Timeout is non-zero. */
export function normalizeWorkerStatus(result: Pick<SpawnSyncReturns<string>, "status" | "signal" | "error">): number {
  if (result.signal || result.error || result.status === null) {
    return 1;
  }
  return result.status;
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

  const attempts = loadManifest(runDir).manifest.attempts[stage.id];
  const retryStop = retryBlockReason(stage, attempts);
  if (retryStop) {
    return { code: 1, report: retryStop };
  }

  const lines = [
    `Next stage: ${stage.id} (${stage.label})`,
    `Role: ${stage.role}`,
    `Skill: ${stage.skill}`,
    `Worker: ${request.worker}`,
    request.dryRun ? "Mode: dry-run (no files written, no worker launched)" : "Mode: prepare",
  ];

  for (const artifact of stage.outputs) {
    let destination: string;
    try {
      destination = resolveArtifact(runDir, artifact.path);
    } catch (error) {
      return { code: 1, report: error instanceof Error ? error.message : String(error) };
    }
    if (fs.existsSync(destination)) {
      lines.push(`Keep: ${display(destination)}`);
      continue;
    }
    if (!artifact.template) {
      lines.push(`Needs author: ${display(destination)} (no template)`);
      continue;
    }
    let templatePath: string;
    try {
      templatePath = resolveRepoPath(pipeline.rootDir, artifact.template, "template");
    } catch (error) {
      return { code: 1, report: error instanceof Error ? error.message : String(error) };
    }
    lines.push(`Template: ${artifact.template} -> ${display(destination)}`);
    if (!request.dryRun) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const body = fs.readFileSync(templatePath, "utf8").trimEnd();
      fs.writeFileSync(destination, `${body}\n\n${DRAFT_LINE}\n`);
    }
  }

  const runRoot = path.resolve(runDir);
  const taskFile = path.join(runRoot, ".pipeline", "task.md");
  let prompt: string;
  try {
    prompt = buildTaskPrompt(pipeline, runDir, stage);
  } catch (error) {
    return { code: 1, report: error instanceof Error ? error.message : String(error) };
  }
  const leaked = leakedSecretNames(prompt);
  if (leaked.length > 0) {
    return {
      code: 1,
      report: `Refusing to write the task prompt because it contains secret env values: ${leaked.join(", ")}`,
    };
  }
  if (request.worker === "none") {
    lines.push("Worker none: templates prepared where missing. Draft files fail validate until a worker replaces them.");
    lines.push("Coding still happens in the product repo. This process does not call a model.");
    return { code: 0, report: lines.join("\n") };
  }

  const argv = workerArgv(request.worker, taskFile);
  if (argv.args.some((arg) => arg === prompt)) {
    return { code: 1, report: "Refusing to pass the task prompt on the worker command line." };
  }
  lines.push(`Command: ${describeCommand(argv)}`);
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
  const timeoutMs = request.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
  const spawnWorker = request.spawnWorker ?? spawnWorkerProcess;
  const result = spawnWorker({
    command: argv.command,
    args: argv.args,
    cwd: runRoot,
    env: scrubWorkerEnv(process.env),
    timeoutMs,
    stdinFile: argv.stdinFile,
  });
  if (result.status !== 0) {
    const why = result.timedOut
      ? `timed out after ${timeoutMs}ms and was killed`
      : `exited ${result.status ?? "with a launch error"}${result.signal ? ` (${result.signal})` : ""}`;
    lines.push(`Error: ${argv.command} ${why}.`);
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

export function spawnWorkerProcess(request: WorkerSpawnRequest): SpawnResult {
  const input = request.stdinFile ? fs.readFileSync(request.stdinFile) : undefined;
  const result = spawnSync(request.command, request.args, {
    cwd: request.cwd,
    env: request.env,
    timeout: request.timeoutMs,
    killSignal: "SIGKILL",
    stdio: input ? ["pipe", "inherit", "inherit"] : "inherit",
    input,
  });
  const timedOut = Boolean(result.error && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT");
  return {
    status: normalizeWorkerStatus(result),
    timedOut,
    signal: result.signal ?? undefined,
  };
}

function describeCommand(argv: WorkerCommand): string {
  const rendered = [argv.command, ...argv.args].join(" ");
  return argv.stdinFile ? `${rendered} < ${argv.stdinFile}` : rendered;
}

function display(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  return relative.startsWith("..") ? filePath : relative || ".";
}
