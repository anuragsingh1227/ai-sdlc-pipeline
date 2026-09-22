import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "./cli.js";
import { loadPipeline, validatePipelineDocument } from "./pipeline.js";
import { assessRun } from "./run.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function capture(argv: string[]): { code: number; stdout: string; stderr: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = main(argv, (line) => out.push(line), (line) => err.push(line));
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

test("validate accepts the phase graph", () => {
  const previous = process.cwd();
  process.chdir(repoRoot);
  try {
    const result = capture(["validate"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /pipeline\.yaml: ok/);
  } finally {
    process.chdir(previous);
  }
});

test("validate accepts the order-explain sample", () => {
  const previous = process.cwd();
  process.chdir(repoRoot);
  try {
    const result = capture(["validate", "--run", "examples/sample-run"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /examples\/sample-run: ok/);
  } finally {
    process.chdir(previous);
  }
});

test("status waits on the human merge gate", () => {
  const previous = process.cwd();
  process.chdir(repoRoot);
  try {
    const result = capture(["status", "--run", "examples/sample-run"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Feature: order-explain/);
    assert.match(result.stdout, /Next: human gate "merge"/);
    assert.match(result.stdout, /confluence-brief, spec-draft, spec-critic, jira-ac, implement, code-critic, release/);
  } finally {
    process.chdir(previous);
  }
});

test("an empty feature is waiting on the confluence brief", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-empty-"));
  fs.mkdirSync(path.join(dir, "00-source"), { recursive: true });
  fs.writeFileSync(path.join(dir, "00-source", "page.md"), "# A page\n\nSome intent.\n");
  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  const status = assessRun(loaded.pipeline, dir);
  assert.equal(status.next.kind, "stage");
  if (status.next.kind === "stage") {
    assert.equal(status.next.stage.id, "confluence-brief");
    assert.equal(status.next.inputs[0]?.present, true);
  }
  assert.equal(status.errors.length, 0);
});

test("matching critic and author sessions fail validation", () => {
  const dir = copySample();
  const manifestPath = path.join(dir, "manifest.yaml");
  const manifest = fs.readFileSync(manifestPath, "utf8").replace("critic-session-01", "writer-session-01");
  fs.writeFileSync(manifestPath, manifest);
  const previous = process.cwd();
  process.chdir(repoRoot);
  try {
    const result = capture(["validate", "--run", dir]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /spec-critic session matches spec-writer/);
  } finally {
    process.chdir(previous);
  }
});

test("a send-back returns status to spec draft and rejects later artifacts", () => {
  const dir = copySample();
  const verdict = path.join(dir, "03-spec-critic", "verdict.md");
  fs.writeFileSync(
    verdict,
    "# Spec critic verdict\n\n## Verdict\n\nsend-back\n\n## Gaps\n\n- Missing empty-event behavior.\n",
  );
  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  const status = assessRun(loaded.pipeline, dir);
  assert.equal(status.next.kind, "stage");
  if (status.next.kind === "stage") {
    assert.equal(status.next.stage.id, "spec-draft");
  }
  assert.ok(status.errors.some((error) => error.includes("sent the work back")));
});

test("the graph rejects an orchestrator that calls a model", () => {
  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  const broken = {
    version: 1,
    name: "broken",
    artifactRoot: "runs",
    orchestrator: { llm: true, routesBy: "pipeline.yaml" },
    separation: loaded.pipeline.separation,
    roles: {},
    humanGates: {},
    stages: [],
  };
  const result = validatePipelineDocument(broken, repoRoot);
  assert.ok(result.errors.some((error) => error.includes("orchestrator.llm must be false")));
});

test("cli entry validates the sample", () => {
  const result = spawnSync("npx", ["tsx", "src/cli.ts", "validate", "--run", "examples/sample-run"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /examples\/sample-run: ok/);
});

function copySample(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-sample-"));
  fs.cpSync(path.join(repoRoot, "examples", "sample-run"), dir, { recursive: true });
  return dir;
}
