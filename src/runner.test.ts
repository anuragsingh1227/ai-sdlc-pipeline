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

test("worker argv reads a prompt file and never puts the prompt on argv", () => {
  const prompt = "x".repeat(400);
  assert.deepEqual(workerArgv("grok", "/tmp/task.md", "/tmp/manifest.yaml"), {
    command: "grok",
    args: [
      "--prompt-file",
      "/tmp/task.md",
      "--sandbox",
      "workspace",
      "--deny",
      "Read(/tmp/manifest.yaml)",
      "--deny",
      "Edit(/tmp/manifest.yaml)",
    ],
  });
  assert.equal(workerArgv("grok", "/tmp/task.md").args.includes("-p"), false);
  const claude = workerArgv("claude", "/tmp/task.md");
  assert.deepEqual(claude.args.slice(0, 3), ["-p", "--append-system-prompt-file", "/tmp/task.md"]);
  assert.equal(claude.stdinFile, "/tmp/task.md");
  assert.ok(!claude.args.includes(prompt));
  assert.ok(claude.args.every((arg) => arg.length < 120 || arg.endsWith("task.md")));
  const codex = workerArgv("codex", "/tmp/task.md");
  assert.deepEqual(codex, { command: "codex", args: ["exec", "-"], stdinFile: "/tmp/task.md" });
  assert.ok(!codex.args.includes(prompt));
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
  assert.match(fs.readFileSync(path.join(dir, ".pipeline", "task.md"), "utf8"), /Stage confluence-brief/);
  const manifest = fs.readFileSync(path.join(dir, "manifest.yaml"), "utf8");
  assert.match(manifest, /spec-writer:/);
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
  assert.match(result.report, /grok --prompt-file/);
  assert.doesNotMatch(result.report, /grok -p /);
});

test("run exits 1 when a required input is missing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-missing-input-"));
  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  const result = runNextStage(loaded.pipeline, dir, { dryRun: true, worker: "none" });
  assert.equal(result.code, 1);
  assert.match(result.report, /Missing required input/);
  assert.equal(fs.existsSync(path.join(dir, "01-brief", "brief.md")), false);
});

test("a worker that marks a gate passed is restored and fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runner-gate-"));
  fs.mkdirSync(path.join(dir, "00-source"), { recursive: true });
  fs.writeFileSync(path.join(dir, "00-source", "page.md"), "# Order explain\n\nIntent.\n");
  fs.writeFileSync(path.join(dir, "manifest.yaml"), "gates:\n  merge: pending\nsessions:\n  spec-writer: writer-session\n");
  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  const result = runNextStage(loaded.pipeline, dir, {
    dryRun: false,
    worker: "grok",
    commandExists: () => true,
    spawnWorker: () => {
      fs.writeFileSync(path.join(dir, "manifest.yaml"), "gates:\n  merge: passed\n");
      return { status: 0 };
    },
  });
  assert.equal(result.code, 1);
  assert.match(result.report, /Restored manifest.yaml gates/);
  const restored = fs.readFileSync(path.join(dir, "manifest.yaml"), "utf8");
  assert.match(restored, /merge: pending/);
  assert.doesNotMatch(restored, /merge: passed/);
});
