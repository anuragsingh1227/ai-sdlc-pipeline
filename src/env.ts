import fs from "node:fs";
import path from "node:path";

export interface AtlassianEnv {
  confluenceBaseUrl?: string;
  confluenceEmail?: string;
  confluenceToken?: string;
  confluencePageId?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraToken?: string;
  jiraProjectKey?: string;
  mock: boolean;
}

/** Load `.env` without overriding variables already set in the process. Never prints values. */
export function loadLocalEnv(rootDir: string): void {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function readAtlassianEnv(source: NodeJS.ProcessEnv = process.env): AtlassianEnv {
  return {
    confluenceBaseUrl: nonempty(source.CONFLUENCE_BASE_URL),
    confluenceEmail: nonempty(source.CONFLUENCE_EMAIL),
    confluenceToken: nonempty(source.CONFLUENCE_API_TOKEN),
    confluencePageId: nonempty(source.CONFLUENCE_PAGE_ID),
    jiraBaseUrl: nonempty(source.JIRA_BASE_URL),
    jiraEmail: nonempty(source.JIRA_EMAIL),
    jiraToken: nonempty(source.JIRA_API_TOKEN),
    jiraProjectKey: nonempty(source.JIRA_PROJECT_KEY),
    mock: source.PIPELINE_MOCK_ATLASSIAN === "1",
  };
}

export function basicAuthHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`, "utf8").toString("base64")}`;
}

export function wikiBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  if (trimmed.endsWith("/wiki")) {
    return trimmed;
  }
  return `${trimmed}/wiki`;
}

export function siteBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/wiki$/, "");
}

function nonempty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
