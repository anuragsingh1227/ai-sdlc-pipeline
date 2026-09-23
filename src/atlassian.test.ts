import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { getPage, parseConfluencePageRef, storageToMarkdown, writeConfluenceExport } from "../integrations/confluence.js";
import { buildCreatePayload, createIssuesFromTicketsYaml, plainTextToAdf } from "../integrations/jira.js";
import { main } from "./cli.js";
import { basicAuthHeader, type AtlassianEnv } from "./env.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const confluenceFixture = path.join(repoRoot, "examples/fixtures/confluence-page.json");
const jiraFixture = path.join(repoRoot, "examples/fixtures/jira-create-response.json");

test("storage HTML becomes markdown headings and list items", () => {
  const markdown = storageToMarkdown(
    "<h2>Intent</h2><p>Agents with <strong>ORDER_READ</strong>.</p><ul><li>No new ECS service</li></ul>",
  );
  assert.match(markdown, /## Intent/);
  assert.match(markdown, /\*\*ORDER_READ\*\*/);
  assert.match(markdown, /- No new ECS service/);
});

test("page ids and Confluence URLs parse", () => {
  assert.equal(parseConfluencePageRef("1042").pageId, "1042");
  const parsed = parseConfluencePageRef("https://example.atlassian.net/wiki/spaces/OPS/pages/1042/Order-explain");
  assert.equal(parsed.pageId, "1042");
  assert.equal(parsed.baseUrlFromUrl, "https://example.atlassian.net/wiki");
});

test("mock confluence fetch writes page.md under runs/ without network", async () => {
  const outRel = path.join("runs", `confluence-out-${process.pid}-${Date.now()}`);
  const out = path.join(repoRoot, outRel);
  const previous = process.cwd();
  process.chdir(repoRoot);
  try {
    const code = await main(
      ["confluence", "fetch", "--page", "1042", "--out", outRel, "--mock"],
      () => undefined,
      () => undefined,
    );
    assert.equal(code, 0);
    const page = fs.readFileSync(path.join(out, "page.md"), "utf8");
    assert.match(page, /Order explain/);
    assert.match(page, /ORDER_READ/);
    assert.match(page, /Page id: 1042/);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
    process.chdir(previous);
  }
});

test("confluence without credentials throws a clear error", async () => {
  await assert.rejects(
    getPage("1042", { mock: false, env: { mock: false } }),
    /CONFLUENCE_BASE_URL/,
  );
});

test("live confluence request keeps the token out of the URL", async () => {
  const env: AtlassianEnv = {
    confluenceBaseUrl: "https://example.atlassian.net/wiki",
    confluenceEmail: "agent@example.com",
    confluenceToken: "token-value",
    mock: false,
  };
  let requested = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    requested = String(input);
    const authorization = new Headers(init?.headers).get("authorization");
    assert.equal(authorization, basicAuthHeader("agent@example.com", "token-value"));
    const fixture = fs.readFileSync(confluenceFixture, "utf8");
    return new Response(fixture, { status: 200 });
  };
  const page = await getPage("https://example.atlassian.net/wiki/spaces/OPS/pages/1042/Order-explain", {
    env,
    fetchImpl,
  });
  assert.equal(page.id, "1042");
  assert.ok(!requested.includes("token-value"));
  assert.match(requested, /\/wiki\/rest\/api\/content\/1042/);
  const written = await writeConfluenceExport(page, fs.mkdtempSync(path.join(os.tmpdir(), "conf-live-")));
  assert.match(fs.readFileSync(written, "utf8"), /ORDER_READ/);
});

test("jira payload carries Given/When/Then as ADF", () => {
  const payload = buildCreatePayload({
    project: "OPS",
    issueType: "Story",
    summary: "Return a cited explanation",
    description: "Given an agent\nWhen they ask\nThen the response is HTTP 200",
    parentKey: "OPS-10",
  });
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /Given an agent/);
  assert.match(serialized, /"parent":\{"key":"OPS-10"\}/);
  assert.equal(plainTextToAdf("Given an agent").type, "doc");
});

test("mock jira push writes fixture keys and does not call the network", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jira-push-"));
  fs.cpSync(path.join(repoRoot, "examples/sample-run"), dir, { recursive: true });
  const previous = process.cwd();
  process.chdir(repoRoot);
  const lines: string[] = [];
  try {
    const code = await main(
      ["jira", "push", "--run", dir, "--mock"],
      (line) => lines.push(line),
      () => undefined,
    );
    assert.equal(code, 0, lines.join("\n"));
    const result = JSON.parse(fs.readFileSync(path.join(dir, "04-jira", "push-result.json"), "utf8")) as {
      mode: string;
      epicKey: string;
    };
    assert.equal(result.mode, "mock");
    assert.equal(result.epicKey, "OPS-10");
    const tickets = fs.readFileSync(path.join(dir, "04-jira", "tickets.yaml"), "utf8");
    assert.match(tickets, /OPS-10/);
    assert.match(tickets, /OPS-11/);
    assert.match(lines.join("\n"), /Jira push \(mock\)/);
  } finally {
    process.chdir(previous);
  }
});

test("jira push dry-run does not write a result file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jira-dry-"));
  fs.cpSync(path.join(repoRoot, "examples/sample-run"), dir, { recursive: true });
  const code = await main(["jira", "push", "--run", dir, "--dry-run"], () => undefined, () => undefined);
  assert.equal(code, 0);
  assert.equal(fs.existsSync(path.join(dir, "04-jira", "push-result.json")), false);
});

test("jira apply without credentials fails closed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jira-live-"));
  fs.mkdirSync(path.join(dir, "04-jira"), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, "examples/sample-run/04-jira/tickets.yaml"),
    path.join(dir, "04-jira", "tickets.yaml"),
  );
  await assert.rejects(
    createIssuesFromTicketsYaml(path.join(dir, "04-jira", "tickets.yaml"), {
      apply: true,
      env: { mock: false },
      fixturePath: jiraFixture,
    }),
    /JIRA_BASE_URL/,
  );
});

test("live jira create is skipped unless ATLASSIAN_LIVE=1", { skip: process.env.ATLASSIAN_LIVE !== "1" }, () => {
  assert.ok(process.env.JIRA_API_TOKEN);
});
