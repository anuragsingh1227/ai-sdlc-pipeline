import fs from "node:fs";
import path from "node:path";
import { parse, stringify } from "yaml";
import { assertAtlassianRequestUrl, assertConfiguredBaseUrl, fetchAtlassian } from "../src/atlassian-url.js";
import { basicAuthHeader, siteBaseUrl, type AtlassianEnv } from "../src/env.js";
import { isUnderExamples } from "../src/paths.js";

export interface JiraIssuePlan {
  key?: string;
  summary: string;
  issueType: string;
  description: string;
  labels: string[];
  action: "create" | "update" | "dry-run";
}

export interface JiraPushResult {
  mode: "dry-run" | "mock" | "live";
  project: string;
  epicKey?: string;
  issues: JiraIssuePlan[];
  resultPath?: string;
}

export interface JiraClientOptions {
  mock?: boolean;
  dryRun?: boolean;
  apply?: boolean;
  env?: AtlassianEnv;
  fetchImpl?: typeof fetch;
  fixturePath?: string;
  /** Write keys back into a run under examples/. Off by default. */
  force?: boolean;
  /** Repo root used to detect examples/. Defaults to the process working directory. */
  repoRoot?: string;
}

interface TicketFile {
  project: string;
  epic: {
    issueType?: string;
    summary?: string;
    description?: string;
    key?: string;
    labels?: string[];
    components?: string[];
  };
  stories: Array<Record<string, unknown>>;
}

const MISSING_CREDENTIALS =
  "Jira credentials are not set. Export JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, and JIRA_PROJECT_KEY, or pass --mock / set PIPELINE_MOCK_ATLASSIAN=1.";

const JIRA_ISSUE_KEY = /^[A-Z][A-Z0-9]*-\d+$/;

export function plainTextToAdf(text: string): { type: "doc"; version: 1; content: unknown[] } {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  const content = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    }));
  if (content.length === 0) {
    content.push({ type: "paragraph", content: [{ type: "text", text: "(empty)" }] });
  }
  return { type: "doc", version: 1, content };
}

export function buildCreatePayload(input: {
  project: string;
  issueType: string;
  summary: string;
  description: string;
  labels?: string[];
  parentKey?: string;
  components?: string[];
  /** Company-managed Epic Link field id, when known. Team-managed projects use `parent`. */
  epicLinkField?: string;
  epicLinkKey?: string;
}): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    project: { key: input.project },
    summary: input.summary,
    issuetype: { name: input.issueType },
    description: plainTextToAdf(input.description),
  };
  if (input.labels && input.labels.length > 0) {
    fields.labels = input.labels;
  }
  if (input.components && input.components.length > 0) {
    fields.components = input.components.map((name) => ({ name }));
  }
  if (input.parentKey) {
    fields.parent = { key: input.parentKey };
  }
  if (input.epicLinkField && input.epicLinkKey) {
    fields[input.epicLinkField] = input.epicLinkKey;
  }
  return { fields };
}

/**
 * `parent: epic` means the epic in this tickets file (its key, once created).
 * Any other value must already be a Jira issue key.
 */
export function resolveStoryParent(parent: string, epicKey: string | undefined): string | undefined {
  const trimmed = parent.trim();
  if (trimmed.length === 0 || trimmed === "epic") {
    return epicKey;
  }
  if (!JIRA_ISSUE_KEY.test(trimmed)) {
    throw new Error(`story parent must be "epic" or a Jira issue key, found "${trimmed}"`);
  }
  return trimmed;
}

export async function createIssuesFromTicketsYaml(
  ticketsPath: string,
  options: JiraClientOptions = {},
): Promise<JiraPushResult> {
  const absolute = path.resolve(ticketsPath);
  const tickets = readTickets(absolute);
  assertStoryParents(tickets.stories);
  if (options.env?.jiraProjectKey && options.env.jiraProjectKey !== tickets.project) {
    throw new Error(
      `tickets.project "${tickets.project}" does not match JIRA_PROJECT_KEY "${options.env.jiraProjectKey}"`,
    );
  }
  const project = tickets.project;
  const mode = resolveMode(options);
  if (mode === "live") {
    assertJiraEnv(options.env);
    assertConfiguredBaseUrl(options.env?.jiraBaseUrl ?? "", { allowHost: options.env?.atlassianAllowHost });
  }
  assertExamplesWritable(absolute, options, mode);

  const epicDescription = stringField(tickets.epic.description) || tickets.epic.summary || "Epic";
  const epicPlan: JiraIssuePlan = {
    key: stringField(tickets.epic.key),
    summary: stringField(tickets.epic.summary) || "Epic",
    issueType: stringField(tickets.epic.issueType) || "Epic",
    description: epicDescription,
    labels: stringList(tickets.epic.labels),
    action: stringField(tickets.epic.key) ? "update" : "create",
  };
  const storyPlans: JiraIssuePlan[] = tickets.stories.map((story) => ({
    key: stringField(story.key),
    summary: stringField(story.summary) || "Story",
    issueType: stringField(story.issueType) || "Story",
    description: storyDescription(story),
    labels: stringList(story.labels),
    action: stringField(story.key) ? "update" : "create",
  }));

  if (mode === "dry-run") {
    return {
      mode,
      project,
      epicKey: epicPlan.key,
      issues: [epicPlan, ...storyPlans].map((issue) => ({ ...issue, action: "dry-run" })),
    };
  }

  if (mode === "mock") {
    const fixture = readFixture(options.fixturePath);
    epicPlan.key = epicPlan.key || fixture.epic.key;
    epicPlan.action = stringField(tickets.epic.key) ? "update" : "create";
    storyPlans.forEach((story, index) => {
      const assigned = fixture.issues[index]?.key ?? `OPS-MOCK-${index + 1}`;
      story.action = story.key ? "update" : "create";
      story.key = story.key || assigned;
    });
    const result: JiraPushResult = {
      mode,
      project,
      epicKey: epicPlan.key,
      issues: [epicPlan, ...storyPlans],
    };
    const resultPath = path.join(path.dirname(absolute), "push-result.json");
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    writeKeys(absolute, epicPlan.key, storyPlans);
    result.resultPath = resultPath;
    return result;
  }

  const env = options.env;
  if (!env?.jiraBaseUrl || !env.jiraEmail || !env.jiraToken) {
    throw new Error(MISSING_CREDENTIALS);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const configured = assertConfiguredBaseUrl(env.jiraBaseUrl, { allowHost: env.atlassianAllowHost });
  const host = configured.hostname.toLowerCase();
  const base = siteBaseUrl(configured.toString());
  const epicLinkField = await resolveEpicLinkField(base, host, env, fetchImpl);
  const result: JiraPushResult = {
    mode: "live",
    project,
    issues: [epicPlan, ...storyPlans],
  };

  epicPlan.key = await upsertIssue(base, host, env, fetchImpl, project, epicPlan, {
    components: stringList(tickets.epic.components),
  });
  result.epicKey = epicPlan.key;
  persistProgress(absolute, result);

  for (let index = 0; index < storyPlans.length; index += 1) {
    const story = storyPlans[index];
    const source = tickets.stories[index];
    const parentKey = resolveStoryParent(stringField(source?.parent), epicPlan.key);
    story.key = await upsertIssue(base, host, env, fetchImpl, project, story, {
      parentKey,
      components: stringList(source?.components),
      epicLinkField,
      epicLinkKey: epicPlan.key,
    });
    result.epicKey = epicPlan.key;
    persistProgress(absolute, result);
  }
  return result;
}

/** @deprecated Use createIssuesFromTicketsYaml. Kept so a one-issue call still fails closed without credentials. */
export async function createJiraIssue(draft: { project: string; summary: string }, options: JiraClientOptions = {}): Promise<never> {
  if (options.mock || options.dryRun) {
    throw new Error("createJiraIssue is a single-issue helper. Use createIssuesFromTicketsYaml for mock and dry-run.");
  }
  if (!options.env?.jiraBaseUrl || !options.env.jiraEmail || !options.env.jiraToken) {
    throw new Error(MISSING_CREDENTIALS);
  }
  throw new Error(`Refusing to create ${draft.project} ${draft.summary} outside createIssuesFromTicketsYaml.`);
}

function resolveMode(options: JiraClientOptions): "dry-run" | "mock" | "live" {
  if (options.dryRun) {
    return "dry-run";
  }
  if (options.mock) {
    return "mock";
  }
  if (options.apply) {
    return "live";
  }
  return "dry-run";
}

function assertJiraEnv(env: AtlassianEnv | undefined): void {
  if (!env?.jiraBaseUrl || !env.jiraEmail || !env.jiraToken || !env.jiraProjectKey) {
    throw new Error(MISSING_CREDENTIALS);
  }
}

interface IssueWriteOptions {
  parentKey?: string;
  components?: string[];
  epicLinkField?: string;
  epicLinkKey?: string;
}

const EPIC_LINK_CUSTOM = "com.pyxis.greenhopper.jira:gh-epic-link";

/**
 * Best-effort company-managed Epic Link id.
 * `JIRA_EPIC_LINK_FIELD` wins. Otherwise GET /rest/api/3/field.
 * A failed lookup keeps `parent` only so team-managed projects still push.
 */
async function resolveEpicLinkField(
  base: string,
  configuredHost: string,
  env: AtlassianEnv,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  if (env.jiraEpicLinkField) {
    return env.jiraEpicLinkField;
  }
  try {
    const url = assertAtlassianRequestUrl(`${base}/rest/api/3/field`, configuredHost);
    const token = env.jiraToken ?? "";
    const response = await fetchAtlassian(
      url,
      {
        method: "GET",
        headers: {
          Authorization: basicAuthHeader(env.jiraEmail ?? "", token),
          Accept: "application/json",
        },
      },
      fetchImpl,
      configuredHost,
    );
    if (!response.ok) {
      await response.text();
      return undefined;
    }
    const body = (await response.json()) as unknown;
    if (!Array.isArray(body)) {
      return undefined;
    }
    for (const field of body) {
      if (!isRecord(field) || typeof field.id !== "string") {
        continue;
      }
      const schema = isRecord(field.schema) ? field.schema : {};
      const custom = typeof schema.custom === "string" ? schema.custom : "";
      const name = typeof field.name === "string" ? field.name : "";
      if (name === "Epic Link" || custom === EPIC_LINK_CUSTOM) {
        return field.id;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function upsertIssue(
  base: string,
  configuredHost: string,
  env: AtlassianEnv,
  fetchImpl: typeof fetch,
  project: string,
  issue: JiraIssuePlan,
  write: IssueWriteOptions = {},
): Promise<string> {
  const payload = buildCreatePayload({
    project,
    issueType: issue.issueType,
    summary: issue.summary,
    description: issue.description,
    labels: issue.labels,
    components: write.components,
    parentKey: issue.issueType === "Epic" ? undefined : write.parentKey,
    epicLinkField: issue.issueType === "Epic" ? undefined : write.epicLinkField,
    epicLinkKey: issue.issueType === "Epic" ? undefined : write.epicLinkKey,
  });
  const token = env.jiraToken ?? "";
  const existing = issue.key;
  const url = assertAtlassianRequestUrl(
    existing ? `${base}/rest/api/3/issue/${encodeURIComponent(existing)}` : `${base}/rest/api/3/issue`,
    configuredHost,
  );
  const fields = payload.fields as Record<string, unknown>;
  const bodyDocument = existing ? fieldsForUpdate(fields) : payload;
  const serialized = JSON.stringify(bodyDocument);
  if (url.includes(token) || serialized.includes(token)) {
    throw new Error("Refusing to send the Jira API token in the URL or body.");
  }
  const response = await fetchAtlassian(
    url,
    {
      method: existing ? "PUT" : "POST",
      headers: {
        Authorization: basicAuthHeader(env.jiraEmail ?? "", token),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: serialized,
    },
    fetchImpl,
    configuredHost,
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Jira ${existing ? "PUT" : "POST"} /rest/api/3/issue failed: HTTP ${response.status} ${clip(body)}`);
  }
  if (existing) {
    return existing;
  }
  const created = JSON.parse(body) as unknown;
  if (!isRecord(created) || typeof created.key !== "string") {
    throw new Error("Jira create response did not include an issue key.");
  }
  return created.key;
}

function fieldsForUpdate(fields: Record<string, unknown>): { fields: Record<string, unknown> } {
  const update: Record<string, unknown> = {
    summary: fields.summary,
    description: fields.description,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (key === "project" || key === "issuetype" || key === "summary" || key === "description") {
      continue;
    }
    update[key] = value;
  }
  return { fields: update };
}

/** Write keys and push-result.json after every successful create or update. */
function persistProgress(ticketsPath: string, result: JiraPushResult): void {
  const resultPath = path.join(path.dirname(ticketsPath), "push-result.json");
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  const stories = result.issues.filter((issue) => issue.issueType !== "Epic");
  writeKeys(ticketsPath, result.epicKey, stories);
  result.resultPath = resultPath;
}

function assertStoryParents(stories: Array<Record<string, unknown>>): void {
  stories.forEach((story, index) => {
    const parent = stringField(story.parent).trim();
    if (parent !== "epic" && !JIRA_ISSUE_KEY.test(parent)) {
      throw new Error(`story ${index + 1} parent must be "epic" or a Jira issue key, found "${parent || "(empty)"}"`);
    }
  });
}

function assertExamplesWritable(ticketsPath: string, options: JiraClientOptions, mode: "dry-run" | "mock" | "live"): void {
  if (mode === "dry-run" || options.force) {
    return;
  }
  const repoRoot = options.repoRoot ?? process.cwd();
  if (isUnderExamples(repoRoot, ticketsPath)) {
    throw new Error("Refusing to modify examples/. Copy the run out of examples/ or pass --force.");
  }
}

function readTickets(filePath: string): TicketFile {
  const document = parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(document) || typeof document.project !== "string" || !isRecord(document.epic) || !Array.isArray(document.stories)) {
    throw new Error(`${filePath}: tickets.yaml needs project, epic, and stories`);
  }
  return {
    project: document.project,
    epic: document.epic as TicketFile["epic"],
    stories: document.stories.filter(isRecord),
  };
}

function readFixture(fixturePath: string | undefined): { epic: { key: string }; issues: Array<{ key: string }> } {
  const filePath = fixturePath ?? path.resolve("examples/fixtures/jira-create-response.json");
  if (!fs.existsSync(filePath)) {
    throw new Error(`Jira fixture not found: ${filePath}`);
  }
  const document = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!isRecord(document) || !isRecord(document.epic) || typeof document.epic.key !== "string" || !Array.isArray(document.issues)) {
    throw new Error(`${filePath}: fixture needs epic.key and issues`);
  }
  return {
    epic: { key: document.epic.key },
    issues: document.issues.filter(isRecord).map((issue) => ({ key: String(issue.key) })),
  };
}

function writeKeys(filePath: string, epicKey: string | undefined, stories: JiraIssuePlan[]): void {
  const document = parse(fs.readFileSync(filePath, "utf8"));
  if (!isRecord(document) || !isRecord(document.epic) || !Array.isArray(document.stories)) {
    return;
  }
  if (epicKey) {
    document.epic.key = epicKey;
  }
  document.stories.forEach((story, index) => {
    if (isRecord(story) && stories[index]?.key) {
      story.key = stories[index].key;
    }
  });
  fs.writeFileSync(filePath, stringify(document));
}

function storyDescription(story: Record<string, unknown>): string {
  const description = stringField(story.description);
  const criteria = stringField(story.acceptanceCriteria);
  return [description, criteria].filter((part) => part.length > 0).join("\n\n");
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function clip(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
