import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { getPage } from "../integrations/confluence.js";
import { createIssuesFromTicketsYaml, resolveStoryParent } from "../integrations/jira.js";
import { assertAtlassianRequestUrl, assertConfiguredBaseUrl } from "./atlassian-url.js";
import { main } from "./cli.js";
import { evaluateGateCondition, retryBlockReason } from "./gates.js";
import { validatePipelineDocument, loadPipeline } from "./pipeline.js";
import { assertUnderRuns, resolveArtifact } from "./paths.js";
import { assessRun } from "./run.js";
import { normalizeWorkerStatus, runNextStage, spawnWorkerProcess } from "./runner.js";
import { isSecretEnvName, leakedSecretNames, scrubWorkerEnv } from "./worker-env.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("npm test lists test files explicitly so sh does not need globstar", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { scripts: { test: string } };
  const script = pkg.scripts.test;
  assert.equal(script.includes("**"), false);
  assert.match(script, /^tsx --test /);
  const listed = script.replace(/^tsx --test\s+/, "");
  const probe = spawnSync("sh", ["-c", `ls -1 ${listed}`], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  const fromScript = probe.stdout
    .trim()
    .split("\n")
    .map((file) => path.basename(file))
    .sort();
  const onDisk = fs
    .readdirSync(path.join(repoRoot, "src"))
    .filter((name) => name.endsWith(".test.ts"))
    .sort();
  assert.deepEqual(fromScript, onDisk);
});

test("resolveArtifact rejects traversal, absolutes, and symlink escapes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-root-"));
  assert.throws(() => resolveArtifact(dir, "{run}/../../etc/passwd"), /must stay under/);
  assert.throws(() => resolveArtifact(dir, "/etc/passwd"), /must stay under/);
  assert.throws(() => resolveArtifact(dir, "{run}/foo/../../../etc/passwd"), /must stay under/);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-outside-"));
  fs.symlinkSync(outside, path.join(dir, "linked"));
  assert.throws(() => resolveArtifact(dir, "{run}/linked/page.md"), /escapes the allowed root/);
  const kept = resolveArtifact(dir, "{run}/01-brief/brief.md");
  assert.equal(kept, path.join(dir, "01-brief", "brief.md"));
});

test("pipeline validation rejects artifact paths that leave the run", () => {
  const document = parse(fs.readFileSync(path.join(repoRoot, "pipeline.yaml"), "utf8")) as {
    stages: Array<{ id: string; outputs: Array<{ path: string; template?: string }> }>;
  };
  const brief = document.stages.find((stage) => stage.id === "confluence-brief");
  assert.ok(brief);
  brief.outputs[0].path = "{run}/../../etc/passwd";
  const result = validatePipelineDocument(document, repoRoot);
  assert.ok(result.errors.some((error) => error.includes("stay under")));
});

test("runner refuses a template path that escapes the repo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "template-escape-"));
  fs.mkdirSync(path.join(dir, "00-source"), { recursive: true });
  fs.writeFileSync(path.join(dir, "00-source", "page.md"), "# Page\n\nIntent.\n");
  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  const stage = loaded.pipeline.stages.find((item) => item.id === "confluence-brief");
  assert.ok(stage);
  stage.outputs[0].template = "../../etc/passwd";
  const result = runNextStage(loaded.pipeline, dir, { dryRun: false, worker: "none" });
  assert.equal(result.code, 1);
  assert.match(result.report, /template/);
  assert.equal(fs.existsSync(path.join(dir, "01-brief", "brief.md")), false);
});

test("confluence fetch --out rejects absolutes and paths outside runs/", async () => {
  const previous = process.cwd();
  process.chdir(repoRoot);
  const errors: string[] = [];
  try {
    const absolute = await main(
      ["confluence", "fetch", "--page", "1042", "--out", "/tmp/outside", "--mock"],
      () => undefined,
      (line) => errors.push(line),
    );
    assert.equal(absolute, 1);
    assert.match(errors.join("\n"), /runs\//);
    errors.length = 0;
    const sibling = await main(
      ["confluence", "fetch", "--page", "1042", "--out", "examples/sample-run/00-source", "--mock"],
      () => undefined,
      (line) => errors.push(line),
    );
    assert.equal(sibling, 1);
    assert.match(errors.join("\n"), /runs\//);
    assert.throws(() => assertUnderRuns(repoRoot, "runs/../../tmp/out"), /\.\.|must not contain/);
  } finally {
    process.chdir(previous);
  }
});

test("worker spawn env drops Atlassian tokens and the cwd is the run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spawn-env-"));
  fs.mkdirSync(path.join(dir, "00-source"), { recursive: true });
  fs.writeFileSync(path.join(dir, "00-source", "page.md"), "# Page\n\nIntent.\n");
  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  const previousToken = process.env.CONFLUENCE_API_TOKEN;
  const previousJira = process.env.JIRA_API_TOKEN;
  const previousPassword = process.env.DATABASE_PASSWORD;
  const previousModel = process.env.ANTHROPIC_API_KEY;
  process.env.CONFLUENCE_API_TOKEN = "confluence-token-value";
  process.env.JIRA_API_TOKEN = "jira-token-value";
  process.env.DATABASE_PASSWORD = "db-password-value";
  process.env.ANTHROPIC_API_KEY = "model-key-value";
  try {
    let seen: { cwd: string; env: NodeJS.ProcessEnv; args: string[]; stdinFile?: string } | undefined;
    const result = runNextStage(loaded.pipeline, dir, {
      dryRun: false,
      worker: "claude",
      commandExists: () => true,
      spawnWorker: (request) => {
        seen = request;
        const prompt = fs.readFileSync(request.stdinFile ?? "", "utf8");
        assert.ok(prompt.length > 40);
        assert.ok(request.stdinFile);
        assert.ok(!request.args.includes(prompt));
        assert.ok(request.args.includes("--append-system-prompt-file"));
        assert.ok(request.args.includes(request.stdinFile));
        assert.equal(request.env.CONFLUENCE_API_TOKEN, undefined);
        assert.equal(request.env.JIRA_API_TOKEN, undefined);
        assert.equal(request.env.DATABASE_PASSWORD, undefined);
        return { status: 0 };
      },
    });
    assert.equal(result.code, 0, result.report);
    assert.ok(seen);
    assert.equal(seen.cwd, path.resolve(dir));
    assert.ok(seen.args.includes("--append-system-prompt-file"));
    assert.equal(seen.env.ANTHROPIC_API_KEY, "model-key-value");
    assert.equal(seen.env.PATH, process.env.PATH);
  } finally {
    restoreEnv("CONFLUENCE_API_TOKEN", previousToken);
    restoreEnv("JIRA_API_TOKEN", previousJira);
    restoreEnv("DATABASE_PASSWORD", previousPassword);
    restoreEnv("ANTHROPIC_API_KEY", previousModel);
  }
});

test("scrubWorkerEnv strips token, password, and secret names", () => {
  const env = scrubWorkerEnv({
    PATH: "/usr/bin",
    CONFLUENCE_API_TOKEN: "conf",
    JIRA_API_TOKEN: "jira",
    GITHUB_TOKEN: "ghp_example",
    DATABASE_PASSWORD: "pw",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
    ANTHROPIC_API_KEY: "keep-me",
  });
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.ANTHROPIC_API_KEY, "keep-me");
  assert.equal(env.CONFLUENCE_API_TOKEN, undefined);
  assert.equal(env.JIRA_API_TOKEN, undefined);
  assert.equal(env.GITHUB_TOKEN, undefined);
  assert.equal(env.DATABASE_PASSWORD, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.AWS_ACCESS_KEY_ID, undefined);
  assert.equal(isSecretEnvName("CONFLUENCE_API_TOKEN"), true);
  assert.equal(isSecretEnvName("PATH"), false);
  assert.deepEqual(leakedSecretNames("prefix jira-token-value suffix", { JIRA_API_TOKEN: "jira-token-value" }), [
    "JIRA_API_TOKEN",
  ]);
});

test("a killed or timed-out worker is a non-zero exit", () => {
  const result = spawnWorkerProcess({
    command: "sleep",
    args: ["5"],
    cwd: repoRoot,
    env: { PATH: process.env.PATH },
    timeoutMs: 200,
  });
  assert.equal(result.status, 1);
  assert.equal(result.timedOut, true);
  assert.equal(normalizeWorkerStatus({ status: null, signal: "SIGKILL", error: undefined }), 1);
});

test("https Atlassian URLs reject cleartext, metadata, and foreign redirects", async () => {
  assert.throws(() => assertConfiguredBaseUrl("http://example.atlassian.net"), /https/);
  assert.throws(() => assertConfiguredBaseUrl("https://169.254.169.254/latest"), /link-local|metadata|Refusing/);
  assert.throws(() => assertConfiguredBaseUrl("https://127.0.0.1/"), /link-local|metadata|Refusing/);
  assert.throws(() => assertConfiguredBaseUrl("https://metadata.google.internal/"), /metadata/);
  assert.equal(assertConfiguredBaseUrl("https://example.atlassian.net/wiki").hostname, "example.atlassian.net");
  const configured = assertConfiguredBaseUrl("https://jira.example.com");
  assert.equal(configured.hostname, "jira.example.com");
  assert.throws(
    () => assertAtlassianRequestUrl("https://evil.example/rest", "example.atlassian.net"),
    /evil\.example/,
  );
  assert.match(
    assertAtlassianRequestUrl("https://jira.example.com/rest/api/3/issue", "jira.example.com"),
    /jira\.example\.com/,
  );

  const env = {
    confluenceBaseUrl: "https://example.atlassian.net/wiki",
    confluenceEmail: "agent@example.com",
    confluenceToken: "token-value",
    mock: false,
  };
  const redirected: typeof fetch = async () =>
    new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
  await assert.rejects(getPage("1042", { env, fetchImpl: redirected }), /169\.254\.169\.254|https|Refusing/);
  await assert.rejects(
    getPage("1042", {
      env: { ...env, confluenceBaseUrl: "http://example.atlassian.net/wiki" },
      fetchImpl: async () => {
        throw new Error("fetch should not run");
      },
    }),
    /https/,
  );
});

test("unknown gate conditions and malformed openQuestions fail closed", () => {
  assert.equal(evaluateGateCondition("brief.meta.openQuestions is non-empty", { openQuestions: [] }), false);
  assert.equal(evaluateGateCondition("brief.meta.openQuestions is non-empty", { openQuestions: ["Who signs off?"] }), true);
  assert.equal(
    evaluateGateCondition("brief.meta.openQuestions is non-empty", { openQuestions: [], malformed: true }),
    true,
  );
  assert.equal(evaluateGateCondition("something else", { openQuestions: [] }), true);
  assert.equal(evaluateGateCondition(undefined, null), true);

  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  loaded.pipeline.humanGates["brief-questions"] = {
    ...loaded.pipeline.humanGates["brief-questions"],
    condition: "always",
  };
  const status = assessRun(loaded.pipeline, path.join(repoRoot, "examples/sample-run"));
  assert.equal(status.next.kind, "gate");
  if (status.next.kind === "gate") {
    assert.equal(status.next.gate.id, "brief-questions");
  }
  assert.ok(status.errors.some((error) => error.includes("failing closed")));
});

test("a malformed brief meta is not treated as an empty question list", () => {
  const dir = copySample();
  fs.writeFileSync(path.join(dir, "01-brief", "brief.meta.yaml"), "openQuestions: 12\n");
  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  const status = assessRun(loaded.pipeline, dir);
  assert.ok(status.errors.some((error) => error.includes("openQuestions must be a list of strings")));
  assert.equal(status.next.kind, "stage");
  if (status.next.kind === "stage") {
    assert.equal(status.next.stage.id, "confluence-brief");
  }
});

test("whenVerdict skips a gate only when the recorded verdict differs", () => {
  const dir = copySample();
  fs.writeFileSync(
    path.join(dir, "manifest.yaml"),
    fs.readFileSync(path.join(dir, "manifest.yaml"), "utf8").replace("spec-approved: passed", "spec-approved: pending"),
  );
  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  const blocking = assessRun(loaded.pipeline, dir);
  assert.equal(blocking.next.kind, "gate");
  if (blocking.next.kind === "gate") {
    assert.equal(blocking.next.gate.id, "spec-approved");
  }

  loaded.pipeline.humanGates["spec-approved"] = {
    ...loaded.pipeline.humanGates["spec-approved"],
    whenVerdict: "send-back",
  };
  const skipped = assessRun(loaded.pipeline, dir);
  assert.notEqual(skipped.next.kind === "gate" && skipped.next.gate.id === "spec-approved", true);
});

test("verdict lines are exactly approve or send-back, ignoring case", () => {
  const dir = copySample();
  const verdict = path.join(dir, "03-spec-critic", "verdict.md");
  const original = fs.readFileSync(verdict, "utf8");
  fs.writeFileSync(verdict, original.replace("\napprove\n", "\nApprove\n"));
  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  const approved = assessRun(loaded.pipeline, dir);
  assert.ok(!approved.errors.some((error) => error.includes("verdict must be one of")));

  fs.writeFileSync(verdict, original.replace("\napprove\n", "\napprove with notes\n"));
  const rejected = assessRun(loaded.pipeline, dir);
  assert.ok(rejected.errors.some((error) => error.includes("verdict must be one of")));
  assert.ok(rejected.errors.some((error) => error.includes("approve with notes")));
});

test("run refuses a stage that is past its retry limit and names escalateTo", () => {
  const loaded = loadPipeline(path.join(repoRoot, "pipeline.yaml"));
  assert.ok(loaded.pipeline);
  const specCritic = loaded.pipeline.stages.find((stage) => stage.id === "spec-critic");
  assert.ok(specCritic);
  assert.match(retryBlockReason(specCritic, 4) ?? "", /Escalate to spec-approved/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "retry-limit-"));
  fs.mkdirSync(path.join(dir, "00-source"), { recursive: true });
  fs.writeFileSync(path.join(dir, "00-source", "page.md"), "# Page\n\nIntent.\n");
  fs.writeFileSync(path.join(dir, "manifest.yaml"), "attempts:\n  confluence-brief: 3\n");
  const result = runNextStage(loaded.pipeline, dir, { dryRun: true, worker: "none" });
  assert.equal(result.code, 1);
  assert.match(result.report, /confluence-brief attempts 3 exceed retry limit 2/);
  assert.match(result.report, /Escalate to a human/);
  assert.equal(fs.existsSync(path.join(dir, "01-brief", "brief.md")), false);
});

test("jira requires the configured project key and honors parent", async () => {
  assert.equal(resolveStoryParent("epic", "OPS-10"), "OPS-10");
  assert.equal(resolveStoryParent("OPS-22", "OPS-10"), "OPS-22");
  assert.throws(() => resolveStoryParent("not-a-key", undefined), /parent/);

  const tickets = path.join(repoRoot, "examples/sample-run/04-jira/tickets.yaml");
  await assert.rejects(
    createIssuesFromTicketsYaml(tickets, {
      dryRun: true,
      repoRoot,
      env: { jiraProjectKey: "OTHER", mock: false },
    }),
    /JIRA_PROJECT_KEY/,
  );

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jira-parent-"));
  fs.mkdirSync(path.join(dir, "04-jira"), { recursive: true });
  fs.copyFileSync(tickets, path.join(dir, "04-jira", "tickets.yaml"));
  const bodies: Array<{ fields: { parent?: { key: string }; issuetype: { name: string } } }> = [];
  let calls = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    calls += 1;
    bodies.push(JSON.parse(String(init?.body)) as (typeof bodies)[number]);
    return new Response(JSON.stringify({ key: `OPS-${9 + calls}` }), { status: 201 });
  };
  await createIssuesFromTicketsYaml(path.join(dir, "04-jira", "tickets.yaml"), {
    apply: true,
    repoRoot,
    env: {
      jiraBaseUrl: "https://example.atlassian.net",
      jiraEmail: "agent@example.com",
      jiraToken: "token-value",
      jiraProjectKey: "OPS",
      mock: false,
    },
    fetchImpl,
    fixturePath: path.join(repoRoot, "examples/fixtures/jira-create-response.json"),
  });
  assert.equal(bodies[0]?.fields.issuetype.name, "Epic");
  assert.equal(bodies[0]?.fields.parent, undefined);
  assert.equal(bodies[1]?.fields.parent?.key, "OPS-10");
});

test("jira push does not modify examples unless --force", async () => {
  const ticketsPath = path.join(repoRoot, "examples/sample-run/04-jira/tickets.yaml");
  const before = fs.readFileSync(ticketsPath, "utf8");
  const previous = process.cwd();
  const previousProject = process.env.JIRA_PROJECT_KEY;
  delete process.env.JIRA_PROJECT_KEY;
  process.chdir(repoRoot);
  const errors: string[] = [];
  try {
    const code = await main(
      ["jira", "push", "--run", "examples/sample-run", "--mock"],
      () => undefined,
      (line) => errors.push(line),
    );
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /--force/);
    assert.equal(fs.readFileSync(ticketsPath, "utf8"), before);
    const dry = await main(["jira", "push", "--run", "examples/sample-run", "--dry-run"], () => undefined, () => undefined);
    assert.equal(dry, 0);
    assert.equal(fs.readFileSync(ticketsPath, "utf8"), before);
  } finally {
    restoreEnv("JIRA_PROJECT_KEY", previousProject);
    process.chdir(previous);
  }
});

test("pipeline run honors --file", async () => {
  const alt = path.join(repoRoot, "pipeline.alt.yaml");
  const text = fs.readFileSync(path.join(repoRoot, "pipeline.yaml"), "utf8").replace(/^version: 1$/m, "version: 99");
  fs.writeFileSync(alt, text);
  const previous = process.cwd();
  process.chdir(repoRoot);
  const errors: string[] = [];
  try {
    const code = await main(
      ["run", "--file", "pipeline.alt.yaml", "--run", "examples/sample-run", "--dry-run"],
      () => undefined,
      (line) => errors.push(line),
    );
    assert.equal(code, 1);
    assert.match(errors.join("\n"), /version must be 1/);
  } finally {
    fs.rmSync(alt, { force: true });
    process.chdir(previous);
  }
});

function copySample(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "security-sample-"));
  fs.cpSync(path.join(repoRoot, "examples", "sample-run"), dir, { recursive: true });
  return dir;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
