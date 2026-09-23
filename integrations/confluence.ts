import fs from "node:fs";
import path from "node:path";
import { assertAtlassianRequestUrl, assertConfiguredBaseUrl, fetchAtlassian } from "../src/atlassian-url.js";
import { basicAuthHeader, wikiBaseUrl, type AtlassianEnv } from "../src/env.js";

export interface ConfluencePage {
  id: string;
  title: string;
  url: string;
  markdown: string;
}

export interface ConfluenceClientOptions {
  mock?: boolean;
  env?: AtlassianEnv;
  fetchImpl?: typeof fetch;
  fixturePath?: string;
}

const MISSING_CREDENTIALS =
  "Confluence credentials are not set. Export CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, and CONFLUENCE_API_TOKEN, or pass --mock / set PIPELINE_MOCK_ATLASSIAN=1.";

export function parseConfluencePageRef(pageIdOrUrl: string): { pageId: string; baseUrlFromUrl?: string } {
  const trimmed = pageIdOrUrl.trim();
  if (/^\d+$/.test(trimmed)) {
    return { pageId: trimmed };
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`Not a Confluence page id or URL: ${pageIdOrUrl}`);
  }
  const match = url.pathname.match(/\/pages\/(\d+)/);
  if (!match) {
    throw new Error(`URL does not contain /pages/{id}: ${pageIdOrUrl}`);
  }
  const baseUrlFromUrl = `${url.origin}${url.pathname.includes("/wiki/") ? "/wiki" : ""}`;
  return { pageId: match[1], baseUrlFromUrl };
}

export function storageToMarkdown(storage: string): string {
  let text = unwrapStructuredMacros(storage);
  text = text.replace(/<ac:structured-macro[\s\S]*?<\/ac:structured-macro>/gi, "");
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, inner: string) => `**${stripTags(inner)}**`);
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, inner: string) => `*${stripTags(inner)}*`);
  text = text.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
    return `[${stripTags(inner).trim()}](${href})`;
  });
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => {
    return `\n${"#".repeat(Number(level))} ${stripTags(inner).trim()}\n`;
  });
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => `\n- ${stripTags(inner).trim()}`);
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = stripTags(text);
  text = decodeEntities(text);
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function pageDocumentToMarkdown(page: ConfluencePage): string {
  return `# ${page.title}\n\nSource: ${page.url}\nPage id: ${page.id}\n\n${page.markdown}\n`;
}

export async function getPage(pageIdOrUrl: string, options: ConfluenceClientOptions = {}): Promise<ConfluencePage> {
  const useMock = options.mock === true;
  if (useMock) {
    return pageFromFixture(pageIdOrUrl, options.fixturePath);
  }
  const env = options.env;
  if (!env?.confluenceBaseUrl || !env.confluenceEmail || !env.confluenceToken) {
    throw new Error(MISSING_CREDENTIALS);
  }
  const parsed = parseConfluencePageRef(pageIdOrUrl);
  // The page URL is only a page id. It must not replace CONFLUENCE_BASE_URL.
  const configured = assertConfiguredBaseUrl(env.confluenceBaseUrl, { allowHost: env.atlassianAllowHost });
  const host = configured.hostname.toLowerCase();
  const base = wikiBaseUrl(configured.toString());
  const url = assertAtlassianRequestUrl(
    `${base}/rest/api/content/${encodeURIComponent(parsed.pageId)}?expand=body.storage,space,version`,
    host,
  );
  if (url.includes(env.confluenceToken)) {
    throw new Error("Refusing to put the Confluence API token in the request URL.");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchAtlassian(
    url,
    {
      headers: {
        Authorization: basicAuthHeader(env.confluenceEmail, env.confluenceToken),
        Accept: "application/json",
      },
    },
    fetchImpl,
    host,
  );
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Confluence GET /rest/api/content/${parsed.pageId} failed: HTTP ${response.status} ${clip(body)}`);
  }
  return pageFromApiJson(JSON.parse(body) as unknown, base);
}

export async function writeConfluenceExport(page: ConfluencePage, outDir: string): Promise<string> {
  fs.mkdirSync(outDir, { recursive: true });
  const destination = path.join(outDir, "page.md");
  fs.writeFileSync(destination, pageDocumentToMarkdown(page));
  return destination;
}

function pageFromFixture(pageIdOrUrl: string, fixturePath: string | undefined): ConfluencePage {
  const parsed = parseConfluencePageRef(pageIdOrUrl);
  const filePath = fixturePath ?? path.resolve("examples/fixtures/confluence-page.json");
  if (!fs.existsSync(filePath)) {
    throw new Error(`Confluence fixture not found: ${filePath}`);
  }
  const document = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  const page = pageFromApiJson(document, "https://example.atlassian.net/wiki");
  return { ...page, id: parsed.pageId || page.id };
}

function pageFromApiJson(document: unknown, fallbackBase: string): ConfluencePage {
  if (!isRecord(document) || typeof document.id !== "string" || typeof document.title !== "string") {
    throw new Error("Confluence response is missing id or title.");
  }
  const storage = readStorage(document);
  const links = isRecord(document._links) ? document._links : {};
  const base = typeof links.base === "string" ? links.base : fallbackBase;
  const webui = typeof links.webui === "string" ? links.webui : `/pages/${document.id}`;
  return {
    id: document.id,
    title: document.title,
    url: `${base}${webui}`,
    markdown: storageToMarkdown(storage),
  };
}

function readStorage(document: Record<string, unknown>): string {
  const body = document.body;
  if (!isRecord(body) || !isRecord(body.storage) || typeof body.storage.value !== "string") {
    throw new Error("Confluence response is missing body.storage.value. Fetch with expand=body.storage.");
  }
  return body.storage.value;
}

/**
 * Code macros become fenced blocks. Panel, info, note, warning, and tip macros keep their rich text.
 * Other macros are dropped by the caller.
 */
function unwrapStructuredMacros(storage: string): string {
  return storage.replace(/<ac:structured-macro\b([^>]*)>([\s\S]*?)<\/ac:structured-macro>/gi, (_full, attrs: string, inner: string) => {
    const name = macroName(attrs, inner);
    if (name === "code") {
      const language = macroParameter(inner, "language");
      const body = cdataBody(inner);
      return `\n\n\`\`\`${language}\n${body}\n\`\`\`\n\n`;
    }
    if (name === "panel" || name === "info" || name === "note" || name === "warning" || name === "tip") {
      const title = macroParameter(inner, "title");
      const rich = richTextBody(inner);
      const heading = title ? `**${title}**\n\n` : "";
      return `\n\n${heading}${rich}\n\n`;
    }
    return "";
  });
}

function macroName(attrs: string, inner: string): string {
  const named = /ac:name="([^"]+)"/i.exec(attrs);
  if (named) {
    return named[1].trim().toLowerCase();
  }
  return macroParameter(inner, "name").toLowerCase();
}

function macroParameter(inner: string, name: string): string {
  const pattern = new RegExp(`<ac:parameter\\b[^>]*ac:name="${name}"[^>]*>([\\s\\S]*?)<\\/ac:parameter>`, "i");
  const match = pattern.exec(inner);
  return match ? stripTags(match[1]).trim() : "";
}

function cdataBody(inner: string): string {
  const match = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(inner);
  if (match) {
    return match[1];
  }
  const plain = /<ac:plain-text-body\b[^>]*>([\s\S]*?)<\/ac:plain-text-body>/i.exec(inner);
  return plain ? stripTags(plain[1]) : "";
}

function richTextBody(inner: string): string {
  const match = /<ac:rich-text-body\b[^>]*>([\s\S]*?)<\/ac:rich-text-body>/i.exec(inner);
  return match ? match[1] : inner;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function clip(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
