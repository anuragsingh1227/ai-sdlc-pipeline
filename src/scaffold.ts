import fs from "node:fs";
import path from "node:path";
import { loadPipeline } from "./pipeline.js";

const REQUIRED_FILES = [
  "README.md",
  "LICENSE",
  ".gitignore",
  ".env.example",
  "pipeline.yaml",
  "AGENTS.md",
  "docs/ARCHITECTURE.md",
  "docs/AGENTS.md",
  "docs/CONFLUENCE.md",
  "docs/JIRA.md",
  "docs/HOSTS.md",
  "orchestrator/README.md",
  "integrations/README.md",
  "integrations/confluence.ts",
  "integrations/jira.ts",
  ".cursor/rules/separation-of-roles.mdc",
  ".cursor/rules/java-react-ecs.mdc",
];

const ENV_KEYS = [
  "CONFLUENCE_BASE_URL",
  "CONFLUENCE_EMAIL",
  "CONFLUENCE_API_TOKEN",
  "CONFLUENCE_PAGE_ID",
  "JIRA_BASE_URL",
  "JIRA_EMAIL",
  "JIRA_API_TOKEN",
  "JIRA_PROJECT_KEY",
];

const SECRET_PATTERN = /sk-|xox[baprs]-|AKIA[0-9A-Z]{16}|ghp_|github_pat_|ATATT/;

/**
 * Checks the control-plane repo itself: required files, env placeholders,
 * integration clients, and role-separation prompts. Does not assess a feature run.
 * Pipeline graph, skill frontmatter, and template headings are included via loadPipeline.
 */
export function checkScaffold(rootDir: string): string[] {
  const root = path.resolve(rootDir);
  const errors: string[] = [];
  for (const relative of REQUIRED_FILES) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) {
      errors.push(`${relative}: missing`);
      continue;
    }
    if (fs.readFileSync(full, "utf8").trim().length === 0) {
      errors.push(`${relative}: file is empty`);
    }
  }

  const licensePath = path.join(root, "LICENSE");
  if (fs.existsSync(licensePath) && !fs.readFileSync(licensePath, "utf8").includes("MIT License")) {
    errors.push("LICENSE: must be the MIT license");
  }

  const gitignorePath = path.join(root, ".gitignore");
  if (fs.existsSync(gitignorePath)) {
    const gitignore = fs.readFileSync(gitignorePath, "utf8");
    for (const entry of ["node_modules/", ".env"]) {
      if (!gitignore.includes(entry)) {
        errors.push(`.gitignore: missing ${entry}`);
      }
    }
  }

  checkEnvExample(root, errors);
  checkStubs(root, errors);
  checkRolePhrases(root, errors);

  const loaded = loadPipeline(path.join(root, "pipeline.yaml"));
  errors.push(...loaded.errors);
  return errors;
}

function checkEnvExample(root: string, errors: string[]): void {
  const full = path.join(root, ".env.example");
  if (!fs.existsSync(full)) {
    return;
  }
  const text = fs.readFileSync(full, "utf8");
  if (SECRET_PATTERN.test(text)) {
    errors.push(".env.example: looks like a real secret; keep token values empty");
  }
  for (const key of ENV_KEYS) {
    const match = text.match(new RegExp(`^${key}=(.*)$`, "m"));
    if (!match) {
      errors.push(`.env.example: missing ${key}`);
    }
  }
  for (const key of ["CONFLUENCE_API_TOKEN", "JIRA_API_TOKEN"]) {
    const match = text.match(new RegExp(`^${key}=(.*)$`, "m"));
    if (match && match[1].trim() !== "") {
      errors.push(`.env.example: ${key} must be empty`);
    }
  }
}

function checkStubs(root: string, errors: string[]): void {
  const expectations: Array<{ file: string; phrase: string }> = [
    { file: "integrations/confluence.ts", phrase: "export async function getPage" },
    { file: "integrations/jira.ts", phrase: "export async function createIssuesFromTicketsYaml" },
  ];
  for (const expectation of expectations) {
    const full = path.join(root, expectation.file);
    if (!fs.existsSync(full)) {
      continue;
    }
    const text = fs.readFileSync(full, "utf8");
    if (!text.includes(expectation.phrase)) {
      errors.push(`${expectation.file}: missing ${expectation.phrase}`);
    }
    if (!text.includes("credentials are not set")) {
      errors.push(`${expectation.file}: missing a credentials-are-not-set error`);
    }
    if (/sk-|xox[baprs]-|ATATT|ghp_/.test(text)) {
      errors.push(`${expectation.file}: looks like a committed secret`);
    }
  }
  for (const relative of ["examples/fixtures/confluence-page.json", "examples/fixtures/jira-create-response.json"]) {
    const full = path.join(root, relative);
    if (!fs.existsSync(full)) {
      errors.push(`${relative}: missing`);
    }
  }
}

function checkRolePhrases(root: string, errors: string[]): void {
  const expectations: Array<{ file: string; phrases: string[] }> = [
    {
      file: "agents/spec-critic/SYSTEM.md",
      phrases: ["Do not edit the brief", "Do not file Jira issues or write code"],
    },
    {
      file: "agents/implementer/SYSTEM.md",
      phrases: ["do not approve your own work", "Do not write `06-code-critic/review.md`"],
    },
    {
      file: "agents/code-critic-release/SYSTEM.md",
      phrases: ["do not edit the product code", "do not merge"],
    },
  ];
  for (const expectation of expectations) {
    const full = path.join(root, expectation.file);
    if (!fs.existsSync(full)) {
      errors.push(`${expectation.file}: missing`);
      continue;
    }
    const text = fs.readFileSync(full, "utf8").toLowerCase();
    for (const phrase of expectation.phrases) {
      if (!text.includes(phrase.toLowerCase())) {
        errors.push(`${expectation.file}: missing required rule "${phrase}"`);
      }
    }
  }
}
