#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { getPage, writeConfluenceExport } from "../integrations/confluence.js";
import { createIssuesFromTicketsYaml } from "../integrations/jira.js";
import { loadLocalEnv, readAtlassianEnv } from "./env.js";
import { loadPipeline } from "./pipeline.js";
import { assessRun, formatStatus } from "./run.js";
import { runNextStage, type WorkerName } from "./runner.js";
import { checkScaffold } from "./scaffold.js";

const HELP = `pipeline — sequence the AI SDLC control plane

The CLI reads pipeline.yaml and run files. It does not call a model to choose the next stage.

Usage:
  pipeline check [--file pipeline.yaml]
  pipeline validate [--file pipeline.yaml] [--run <dir>]
  pipeline status [<feature-id>] [--root runs] [--run <dir>] [--file pipeline.yaml]
  pipeline run --run <dir> [--to <stage>] [--dry-run] [--worker grok|claude|codex|none]
  pipeline confluence fetch --page <id|url> --out <dir> [--mock]
  pipeline jira push --run <dir> [--dry-run] [--mock] [--apply]

check verifies the repo scaffold. validate also checks a run when --run is set.
status prints the next stage or human gate.

run prepares the next stage's missing templates and stops at a human gate.
--dry-run prints the actions and does not write or launch a worker.
--worker defaults to none (no model CLI). grok, claude, and codex are optional shells.

confluence fetch writes 00-source/page.md. jira push reads 04-jira/tickets.yaml.
Both stay offline with --mock or PIPELINE_MOCK_ATLASSIAN=1. jira push dry-runs unless --apply or --mock.
Live calls need the variables in .env.example. Do not commit tokens.
`;

interface Args {
  command: string | undefined;
  subcommand?: string;
  file: string;
  root?: string;
  run?: string;
  featureId?: string;
  help: boolean;
  page?: string;
  out?: string;
  to?: string;
  mock: boolean;
  dryRun: boolean;
  apply: boolean;
  worker: WorkerName;
}

export async function main(
  argv: string[],
  stdout: (line: string) => void = console.log,
  stderr: (line: string) => void = console.error,
): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    stderr(HELP);
    return 2;
  }

  if (args.help || args.command === undefined || args.command === "help") {
    stdout(HELP.trimEnd());
    return 0;
  }

  const pipelineFile = path.resolve(args.file);
  const rootDir = path.dirname(pipelineFile);
  loadLocalEnv(rootDir);

  if (args.command === "confluence") {
    return confluenceCommand(args, rootDir, stdout, stderr);
  }
  if (args.command === "jira") {
    return jiraCommand(args, rootDir, stdout, stderr);
  }
  if (args.command === "run") {
    return runCommand(args, rootDir, stdout, stderr);
  }

  if (args.command !== "validate" && args.command !== "status" && args.command !== "check") {
    stderr(`Unknown command: ${args.command}`);
    stderr(HELP);
    return 2;
  }

  if (args.command === "check" && args.run) {
    stderr("check does not take --run; use validate --run for a feature directory");
    return 2;
  }

  if (args.command === "check" || args.command === "validate") {
    const scaffoldErrors = checkScaffold(rootDir);
    if (scaffoldErrors.length > 0) {
      stderr(`${display(args.file)}: invalid`);
      for (const error of scaffoldErrors) {
        stderr(`- ${error}`);
      }
      return 1;
    }
    if (args.command === "check" || !args.run) {
      stdout(args.command === "check" ? `${display(args.file)}: scaffold ok` : `${display(args.file)}: ok`);
      return 0;
    }
  }

  const loaded = loadPipeline(args.file);
  if (!loaded.pipeline) {
    for (const error of loaded.errors) {
      stderr(`- ${error}`);
    }
    return 1;
  }

  if (args.command === "validate") {
    if (!args.run) {
      return 0;
    }
    const status = assessRun(loaded.pipeline, args.run);
    if (status.errors.length > 0) {
      stderr(`${display(args.run)}: invalid`);
      for (const error of status.errors) {
        stderr(`- ${error}`);
      }
      return 1;
    }
    stdout(`${display(args.file)}: ok`);
    stdout(`${display(args.run)}: ok`);
    return 0;
  }

  if (args.run) {
    return printOne(loaded.pipeline, args.run, stdout, stderr);
  }

  const root = path.resolve(args.root ?? loaded.pipeline.artifactRoot);
  if (args.featureId) {
    return printOne(loaded.pipeline, path.join(root, args.featureId), stdout, stderr);
  }

  if (!fs.existsSync(root)) {
    stdout(`No runs in ${display(root)}.`);
    stdout("Start from examples/sample-run or create runs/<feature-id>/00-source/page.md.");
    return 0;
  }
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (entries.length === 0) {
    stdout(`No runs in ${display(root)}.`);
    stdout("See examples/sample-run for a filled chain.");
    return 0;
  }
  let code = 0;
  for (const entry of entries) {
    const status = assessRun(loaded.pipeline, path.join(root, entry.name));
    stdout(formatStatus(status));
    stdout("");
    if (status.errors.length > 0) {
      code = 1;
    }
  }
  return code;
}

async function confluenceCommand(
  args: Args,
  rootDir: string,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): Promise<number> {
  if (args.subcommand !== "fetch") {
    stderr("Usage: pipeline confluence fetch --page <id|url> --out <dir> [--mock]");
    return 2;
  }
  if (!args.page || !args.out) {
    stderr("confluence fetch needs --page and --out");
    return 2;
  }
  const env = readAtlassianEnv();
  try {
    const page = await getPage(args.page, {
      mock: args.mock || env.mock,
      env,
      fixturePath: path.join(rootDir, "examples/fixtures/confluence-page.json"),
    });
    const written = await writeConfluenceExport(page, args.out);
    stdout(`Wrote ${display(written)} (${args.mock || env.mock ? "mock" : "live"}, page ${page.id})`);
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function jiraCommand(
  args: Args,
  rootDir: string,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): Promise<number> {
  if (args.subcommand !== "push") {
    stderr("Usage: pipeline jira push --run <dir> [--dry-run] [--mock] [--apply]");
    return 2;
  }
  if (!args.run) {
    stderr("jira push needs --run <dir>");
    return 2;
  }
  const env = readAtlassianEnv();
  const mock = args.mock || env.mock;
  const dryRun = args.dryRun || (!mock && !args.apply);
  const ticketsPath = path.join(args.run, "04-jira", "tickets.yaml");
  if (!fs.existsSync(ticketsPath)) {
    stderr(`${display(ticketsPath)}: missing tickets.yaml`);
    return 1;
  }
  try {
    const result = await createIssuesFromTicketsYaml(ticketsPath, {
      mock,
      dryRun,
      apply: args.apply,
      env,
      fixturePath: path.join(rootDir, "examples/fixtures/jira-create-response.json"),
    });
    stdout(`Jira push (${result.mode}) project ${result.project}`);
    if (result.epicKey) {
      stdout(`Epic: ${result.epicKey}`);
    }
    for (const issue of result.issues) {
      stdout(`- ${issue.action} ${issue.key ?? "(no key yet)"} ${issue.issueType}: ${issue.summary}`);
    }
    if (result.resultPath) {
      stdout(`Wrote ${display(result.resultPath)}`);
    }
    if (result.mode === "dry-run") {
      stdout("Dry-run only. Pass --mock to use fixtures, or --apply with Jira credentials to create issues.");
    }
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

function runCommand(
  args: Args,
  rootDir: string,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): number {
  if (!args.run) {
    stderr("pipeline run needs --run <dir>");
    return 2;
  }
  const loaded = loadPipeline(path.join(rootDir, "pipeline.yaml"));
  if (!loaded.pipeline) {
    for (const error of loaded.errors) {
      stderr(`- ${error}`);
    }
    return 1;
  }
  const result = runNextStage(loaded.pipeline, args.run, {
    dryRun: args.dryRun,
    worker: args.worker,
    to: args.to,
  });
  stdout(result.report);
  if (result.code !== 0) {
    stderr("pipeline run stopped");
  }
  return result.code;
}

function printOne(
  pipeline: NonNullable<ReturnType<typeof loadPipeline>["pipeline"]>,
  runDir: string,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): number {
  const status = assessRun(pipeline, runDir);
  stdout(formatStatus(status));
  if (status.errors.length > 0) {
    stderr("status: run is inconsistent");
    return 1;
  }
  return 0;
}

export function parseArgs(argv: string[]): Args {
  let [command, ...rest] = argv;
  let subcommand: string | undefined;
  if (command === "confluence" || command === "jira") {
    subcommand = rest[0];
    if (!subcommand || subcommand.startsWith("--")) {
      throw new Error(`${command} needs a subcommand (${command === "confluence" ? "fetch" : "push"})`);
    }
    rest = rest.slice(1);
  }
  const args: Args = {
    command,
    subcommand,
    file: "pipeline.yaml",
    help: false,
    mock: false,
    dryRun: false,
    apply: false,
    worker: "none",
  };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--mock") {
      args.mock = true;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--apply") {
      args.apply = true;
      continue;
    }
    if (token === "--file" || token === "--root" || token === "--run" || token === "--page" || token === "--out" || token === "--to" || token === "--worker") {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${token} needs a value`);
      }
      index += 1;
      if (token === "--file") args.file = value;
      else if (token === "--root") args.root = value;
      else if (token === "--run") args.run = value;
      else if (token === "--page") args.page = value;
      else if (token === "--out") args.out = value;
      else if (token === "--to") args.to = value;
      else args.worker = parseWorker(value);
      continue;
    }
    if (token.startsWith("-")) {
      throw new Error(`Unknown option: ${token}`);
    }
    if (args.featureId) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    args.featureId = token;
  }
  if (args.run && args.featureId) {
    throw new Error("Pass either a feature id or --run, not both");
  }
  if (args.apply && args.dryRun) {
    throw new Error("Pass only one of --apply or --dry-run");
  }
  return args;
}

function parseWorker(value: string): WorkerName {
  if (value === "none" || value === "grok" || value === "claude" || value === "codex") {
    return value;
  }
  throw new Error(`--worker must be grok, claude, codex, or none`);
}

function display(filePath: string): string {
  const relative = path.relative(process.cwd(), path.resolve(filePath));
  return relative.startsWith("..") ? path.resolve(filePath) : relative || ".";
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
