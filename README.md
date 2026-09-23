# AI SDLC pipeline

A control-plane playbook for building features with AI agents. Humans write the intent and merge the result. Agents turn a Confluence page into a brief, a spec, acceptance criteria, code, and a merge request. Each role writes files. The next role starts from those files in a new session.

This repository is not the Java or React product. Clone it beside the product repo, or add it as a submodule. The examples assume a Java Spring service and a React app on AWS ECS. The pipeline itself is stack-neutral.

The orchestrator does not call a model. `pipeline.yaml` is the phase graph. A small CLI reads that graph and the files under a run directory, then prints the next stage and the paths the worker must read and write. Grok Build, Cursor, Claude Code, and Codex are interchangeable workers.

## Stages and roles

Seven stages, five agent roles, and a thin orchestrator. Spec critic is never the spec writer. Code critic is never the implementer.

```text
human intent (Confluence page)
        │
        ▼
1. Confluence brief          spec writer
        │  human gate if open questions remain
        ▼
2. Spec draft                spec writer
        │
        ▼
3. Spec critic               spec critic     approve, or send back to 2
        │  human gate: spec approved
        ▼
4. Jira AC                   AC / Jira agent
        │
        ▼
5. Implement                 implementer     code and unit tests against AC
        │
        ▼
6. Code critic               code critic     edge cases; send back to 5
        │
        ▼
7. Release                   code critic + release
        │  opens the MR; does not merge
        ▼
   human merges
```

| Role | Stages | Writes | Must not |
| --- | --- | --- | --- |
| Spec writer | 1–2 | Brief and feature spec | Critique the spec, file Jira issues, or edit product code |
| Spec critic | 3 | Gap list and approve / send-back | Rewrite the spec or implement it |
| AC / Jira agent | 4 | Given/When/Then and ticket drafts | Invent scope or write code |
| Implementer | 5 | Product change and unit tests | Approve its own change or open the MR |
| Code critic + release | 6–7 | Review verdict, then MR body | Edit the product code, or merge |

Role prompts and I/O contracts live in [`agents/`](agents/) and are summarized in [`docs/AGENTS.md`](docs/AGENTS.md).

## How this differs from kspec, Troika, and Red Queen

Those projects are the references for the ideas below. This repo does not ship their code, plugins, or CLIs.

| | kspec | Troika | Red Queen | This repo |
| --- | --- | --- | --- | --- |
| What it is | Spec-driven workflow and skills, oriented around Kiro | Plain-markdown multi-role pipeline and host plugins | Deterministic orchestrator that dispatches coding workers | Playbook, templates, and a local validator |
| Intent source | Spec text, often from Jira | A tracker ticket | A Jira or GitHub ticket | A Confluence page, frozen into a brief file |
| Handoff | Spec files and context docs in the working tree | Files between roles, never shared chat memory | Phase state on the ticket, isolated workers | Files under `runs/<feature-id>/`, one fresh session per role |
| Who reviews the spec | A verify step in the same workflow | A different role, often a different model family | A later phase, with a human gate | A different role that only hunts gaps against the Confluence brief |
| Routing | Skill sequence inside one CLI | Slash commands on Claude Code, Codex, and Cursor | YAML phase graph, zero tokens in the router, Claude Code or Codex workers | YAML phase graph, zero tokens in the router, any of four workers |
| What it runs | The host's agent | The host's agent, including QA on a local stack | Polling, gates, PR creation | `check`, `validate`, `status`, `run`, Confluence fetch, and Jira push |

Use this repo when the team wants the Confluence → spec → separate critic → Jira → implement → separate code critic → human merge loop written down, and wants to point whichever coding CLI they already have at the next file. It can fetch one Confluence page and push ticket drafts. It does not poll Jira, and it does not merge pull requests.

## Quickstart

Requires Node.js 20 or newer.

```bash
npm install
npm run check
npm run validate
npm run status
npm test
```

The same commands through the CLI:

```bash
npx tsx src/cli.ts check
npx tsx src/cli.ts validate --run examples/sample-run
npx tsx src/cli.ts status --run examples/sample-run
```

`check` verifies the scaffold: docs, agent folders, skill frontmatter, template headings, role-separation rules, and empty API tokens in `.env.example`. It does not read a feature run.

`validate` checks that scaffold and, with `--run`, each present artifact: non-empty files, required headings, brief meta fields, Given/When/Then, ticket shape, verdicts, gates, and separate critic sessions. The sample feature must pass.

`status` prints the next stage, the role that must run it, and the artifact paths. The sample feature, Order explain, is waiting on the human merge gate.

## Path to 9/10

This repository orchestrates and validates. It does not contain the product source, and it does not deploy to ECS. Coding still happens in the product repo. A human can do that in Grok Build, or the CLI can shell out to `grok`, `claude`, or `codex` for a single stage. Routing stays in `pipeline.yaml`. No model SDK is imported.

Offline path (no Atlassian credentials):

```bash
npm install
npm run check
npm run validate
npm run status
npm test
npm run typecheck

# Recorded Confluence page -> markdown export
npx tsx src/cli.ts confluence fetch --page 1042 --out runs/order-explain/00-source --mock

# Sample is already at the merge gate. Dry-run stops there and writes nothing.
npx tsx src/cli.ts run --run examples/sample-run --dry-run

# Planned Jira issues. Dry-run does not write. --mock writes fixture keys into a copy.
npx tsx src/cli.ts jira push --run examples/sample-run --dry-run
```

Live Atlassian, after you copy `.env.example` to `.env` and fill the tokens locally. Required names:

- `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`, `CONFLUENCE_PAGE_ID`
- `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`

`PIPELINE_MOCK_ATLASSIAN=1` is the same as `--mock`. Leave it unset for live calls.

```bash
npx tsx src/cli.ts confluence fetch --page "$CONFLUENCE_PAGE_ID" --out runs/my-feature/00-source
npx tsx src/cli.ts run --run runs/my-feature --worker none
npx tsx src/cli.ts status my-feature
npx tsx src/cli.ts jira push --run runs/my-feature --apply
```

`jira push` dry-runs unless you pass `--apply` or `--mock`. `pipeline run` stops at `brief-questions`, `spec-approved`, and `merge`. Set those gates yourself in `manifest.yaml`. Workers, when you opt in:

| Worker | Argv |
| --- | --- |
| grok | `grok --prompt-file <run>/.pipeline/task.md --sandbox workspace` (Read/Edit denied on `manifest.yaml`) |
| claude | `claude -p --append-system-prompt-file <run>/.pipeline/task.md` (task also on stdin) |
| codex | `codex exec -` with `<run>/.pipeline/task.md` on stdin |

The task file contains that stage's `SYSTEM.md`, skill, and artifact paths. The prompt is not passed on the command line. The worker's working directory is the run directory (`implement` uses `manifest.productRepo`), and token, password, and secret variables are removed from its environment. Default `--worker none` copies a template, writes `.pipeline/task.md`, and marks the scaffold `pipeline-draft`, which `validate` rejects until a worker replaces it.

What you still do outside this repo:

- Build and test Java and React in the product repo (see `examples/order-explain-ecs/README.md` for the shape, not a real checkout).
- Review the spec at the `spec-approved` gate.
- Merge the pull request. Deploy-to-dev stays on the product pipeline.

Start a real feature:

```bash
mkdir -p runs/my-feature/00-source
# Export the Confluence page to runs/my-feature/00-source/page.md
# Add runs/my-feature/manifest.yaml (see examples/sample-run/manifest.yaml)
npx tsx src/cli.ts status my-feature
```

Open a **new** worker session. Paste the status output, and point the worker at that role's `agents/<role>/SYSTEM.md` and the skill path it printed. When the worker finishes, run `status` again. Do not continue the writer's chat as the critic.

The filled chain for a fictional support-console feature is in [`examples/sample-run/`](examples/sample-run/).

## Provider stance

Workers are replaceable. The router is not a model, and it does not import an LLM SDK.

1. Run `pipeline status`.
2. Start a fresh session of Grok Build (`grok`), a Cursor cloud agent, Claude Code, or Codex.
3. Give it only the role prompt, the skill, and the input files listed for that stage.
4. The worker writes the output files. A human passes the gates in `pipeline.yaml`.

Host notes: [`docs/HOSTS.md`](docs/HOSTS.md).

## Repository map

| Path | Purpose |
| --- | --- |
| [`pipeline.yaml`](pipeline.yaml) | Stages, inputs, outputs, gates, roles, retry limits |
| [`src/cli.ts`](src/cli.ts) | `check`, `validate`, `status`, `run`, `confluence fetch`, `jira push` |
| [`docs/`](docs/) | Architecture, role contracts, Confluence, Jira, hosts |
| [`agents/`](agents/) | System prompt, inputs, outputs, and done-when for each role |
| [`skills/`](skills/) | One skill per stage, including the release step |
| [`templates/`](templates/) | Brief, spec, AC, MR, and Java/React example patterns |
| [`examples/sample-run/`](examples/sample-run/) | Order explain artifact chain |
| [`orchestrator/README.md`](orchestrator/README.md) | How sequencing and human gates work |
| [`integrations/`](integrations/) | Confluence and Jira REST clients, with fixture mode for CI |
| [`.env.example`](.env.example) | Placeholder names for `CONFLUENCE_*` and `JIRA_*` |

## Rules that are not optional

- Critics never implement. Implementers never self-approve.
- The spec critic compares the spec to the Confluence brief. It does not redesign the feature.
- The implementer builds the acceptance criteria. If the spec and the AC disagree, the implementer stops and asks a human.
- Agents open merge requests. Humans merge them.
- No API keys in the repo. Put secrets in an untracked `.env`.

Frozen Java, React, and ECS patterns for the product repo are in [`.cursor/rules/`](.cursor/rules/).
