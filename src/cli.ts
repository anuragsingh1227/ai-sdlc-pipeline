#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { loadPipeline } from "./pipeline.js";
import { assessRun, formatStatus } from "./run.js";

const HELP = `pipeline — sequence the AI SDLC control plane

The CLI reads pipeline.yaml and run files. It does not call a model.

Usage:
  pipeline validate [--file pipeline.yaml] [--run <dir>]
  pipeline status [<feature-id>] [--root runs] [--run <dir>] [--file pipeline.yaml]

validate checks the phase graph. With --run it also checks that feature's artifacts,
verdicts, human gates, and session separation.

status prints the next stage or human gate and the artifact paths a worker needs.
Feature ids are directories under --root (default: the artifactRoot in pipeline.yaml).
`;

interface Args {
  command: string | undefined;
  file: string;
  root?: string;
  run?: string;
  featureId?: string;
  help: boolean;
}

export function main(argv: string[], stdout: (line: string) => void = console.log, stderr: (line: string) => void = console.error): number {
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

  if (args.command !== "validate" && args.command !== "status") {
    stderr(`Unknown command: ${args.command}`);
    stderr(HELP);
    return 2;
  }

  const loaded = loadPipeline(args.file);
  if (!loaded.pipeline) {
    for (const error of loaded.errors) {
      stderr(`- ${error}`);
    }
    return 1;
  }

  if (args.command === "validate") {
    stdout(`${display(args.file)}: ok`);
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

function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  const args: Args = { command, file: "pipeline.yaml", help: false };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--file" || token === "--root" || token === "--run") {
      const value = rest[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${token} needs a value`);
      }
      index += 1;
      if (token === "--file") {
        args.file = value;
      } else if (token === "--root") {
        args.root = value;
      } else {
        args.run = value;
      }
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
  return args;
}

function display(filePath: string): string {
  const relative = path.relative(process.cwd(), path.resolve(filePath));
  return relative.startsWith("..") ? path.resolve(filePath) : relative || ".";
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectRun) {
  process.exit(main(process.argv.slice(2)));
}
