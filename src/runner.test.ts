import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "./cli.js";
import { loadPipeline } from "./pipeline.js";
import { assessRun } from "./run.js";
import { runNextStage, workerArgv } from "./runner.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("worker argv matches the documented CLIs", () => {
  assert.deepEqual(workerArgv("grok", "/tmp/task.md", "prompt"), {
    command: "grok",
    args: ["-p", "--prompt-file", "/tmp/task.md"],
  });
  assert.deepEqual(workerArgv("claude", "/tmp/task.md", "prompt").args[0], "-p");
  assert.equal(workerArgv("codex", "/tmp/task.md", "prompt").command, "codex");
  assert.equal(workerArgv("codex", "/tmp/task.md", "prompt").args[0], "exec");
});

test("dry-run on the sample stops at the human merge gate", async () => {
  const lines: string[] = [];
  const previous = process.cwd();
  process.chdir(repoRoot);
  try {
    const code = await main(
      ["run", "--run", "examples/sample-run", "--dry-run", "--worker", "none"],
      (line) => lines.push(line),
      () => undefined,
    );
    assert.equal(code, 0, lines.join("\n"));
    assert.match(lines.join("\n"), /human gate "merge"/);
    assert.equal(fs.existsSync(path.join(repoRoot, "examples/sample-run/.pipeline")), false);
  } finally {
    process.chdir(previous);
  }
});

test("worker none copies the brief template and leaves a draft", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-none-"));
  fs.mkdirSync(path.join(dir, "00-source"), { recursive: true });
  fs.writeFileSync(path.join(dir, "00-source", "page.md"), "# Order explain\n\nIntent.\n");
  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  const prepared = runNextStage(loaded.pipeline, dir, { dryRun: false, worker: "none" });
  assert.equal(prepared.code, 0, prepared.report);
  assert.match(prepared.report, /Next stage: confluence-brief/);
  const brief = fs.readFileSync(path.join(dir, "01-brief", "brief.md"), "utf8");
  assert.match(brief, /## Goals/);
  assert.match(brief, /pipeline-draft/);
  const status = assessRun(loaded.pipeline, dir);
  assert.equal(status.next.kind, "stage");
  assert.ok(status.errors.some((error) => error.includes("still a draft scaffold")));
});

test("dry-run does not write the next template", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-dry-"));
  fs.mkdirSync(path.join(dir, "00-source"), { recursive: true });
  fs.writeFileSync(path.join(dir, "00-source", "page.md"), "# Order explain\n\nIntent.\n");
  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  const result = runNextStage(loaded.pipeline, dir, { dryRun: true, worker: "none", to: "spec-draft" });
  assert.equal(result.code, 0, result.report);
  assert.match(result.report, /dry-run/);
  assert.equal(fs.existsSync(path.join(dir, "01-brief", "brief.md")), false);
});

test("a missing worker binary is a clear error", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-missing-"));
  fs.mkdirSync(path.join(dir, "00-source"), { recursive: true });
  fs.writeFileSync(path.join(dir, "00-source", "page.md"), "# Order explain\n\nIntent.\n");
  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  const result = runNextStage(loaded.pipeline, dir, {
    dryRun: false,
    worker: "grok",
    commandExists: () => false,
  });
  assert.equal(result.code, 1);
  assert.match(result.report, /not found on PATH/);
  assert.match(result.report, /grok -p --prompt-file/);
});
