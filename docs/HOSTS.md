# Hosts

The pipeline is provider-agnostic. The host is whatever coding CLI runs one stage. The control plane tells you which stage, which role, and which files.

## Shared procedure

Run this from the control-plane repo:

```bash
npx tsx src/cli.ts status <feature-id>
```

Or let the runner prepare the next stage and stop if the next action is a human gate:

```bash
npx tsx src/cli.ts run --run runs/<feature-id> --dry-run
npx tsx src/cli.ts run --run runs/<feature-id> --worker none
npx tsx src/cli.ts run --run runs/<feature-id> --worker grok
```

`--worker none` is the default. It copies a template into a missing output and appends a `pipeline-draft` marker. `validate` fails that file until the worker replaces it. `--dry-run` prints the same plan and does not write or launch anything.

When a worker is set and the binary is on `PATH`, the runner writes `<run>/.pipeline/task.md` (system prompt, skill, input paths, output paths) and invokes exactly:

| Worker | Command |
| --- | --- |
| Grok Build | `grok --prompt-file <task.md> --sandbox workspace` with `Read` and `Edit` denied on `manifest.yaml` |
| Claude Code | `claude -p --append-system-prompt-file <task.md>` with the same file on stdin |
| Codex | `codex exec -` with `<task.md>` on stdin |

The prompt file is the only copy of the task. Claude Code loads it with `--append-system-prompt-file` and also receives it on stdin. Codex reads it with `codex exec -`. Grok reads it with `--prompt-file` (not `-p`). The task text is not an argv entry. `--worker none` still writes `<run>/.pipeline/task.md` when it is not a dry-run. The working directory is the run directory, except `implement`, whose cwd is `manifest.productRepo` (resolved from the pipeline root) and whose task file includes that path. A `.env` in the control-plane root is not the process cwd. The child environment drops `*_API_TOKEN`, `*_TOKEN`, `*_PASSWORD`, `*_SECRET`, and the same class of credential. The worker still receives its own `*_API_KEY` when that is how the coding CLI authenticates. A hard timeout kills the process; a signal or timeout is a non-zero exit. If the worker changes a gate to `passed` or `skipped`, the runner restores the previous manifest gates and exits 1. An empty `sessions.<role>` is filled with a new UUID before a real worker starts. If the binary is missing, the runner exits with an error and does not pretend the stage ran. The runner does not pick a model and does not import an LLM SDK.

Grok Build teammates can ignore `--worker` and follow `pipeline status` by hand. The CLI is still the validator: run `check`, `validate`, and `status` around that work.

The output names a role, a skill, input paths, and output paths. Then:

1. Start a **new** session. Do not resume the session that wrote the artifact under review.
2. For a hand-driven session, set the working directory to the product repo for `implement`, and to the control-plane repo for every other stage. `pipeline run` uses the run directory for every stage except `implement`, which uses `manifest.productRepo` when that directory exists. The task file lists that absolute path. The implementer still needs the run directory for the AC files and the change summary.
3. Give the worker `agents/<role>/SYSTEM.md`, the skill file, and the input files. Do not attach the other roles' system prompts.
4. Tell the worker the output paths. Refuse edits outside those outputs (and, for the implementer, the product files named in the AC).
5. When the session ends, run `pipeline validate --run <dir>` and `pipeline status` again.

Record the host session id in `manifest.yaml` under `sessions.<role>`. The validator rejects a run where the spec writer and spec critic share an id, or where the implementer and the code critic share an id.

Those ids are advisory. `validate` compares the strings you wrote down. It cannot see the host process, and it cannot prove two roles ran in different sessions. Record them honestly; do not reuse an id to satisfy the check.

Skills are ordinary markdown. You can symlink `skills/*` into a host skill directory. The source of truth stays `skills/`.

## Grok Build (`grok`)

Grok reads a root `AGENTS.md` and `.cursor/rules/` automatically. That is enough for the separation rules. For a single stage, prefer a headless run so the session cannot wander into the next role:

```bash
# From the control-plane repo, after `pipeline status` says spec-draft is next.
grok --prompt-file agents/spec-writer/SYSTEM.md --sandbox workspace
```

Put the concrete input and output paths in the prompt file or in `--rules` for that invocation. Use a new process for the critic. Do not `--resume` the writer session to run `critique-spec`.

Check `grok --help` if a flag has moved. Routing stays in `pipeline status`, not in a Grok workflow.

## Cursor cloud agent

Start a cloud agent with a prompt that quotes the status block and tells it to follow one skill file. One agent run per stage. The critic run must be a different agent from the writer run.

This repo's `.cursor/rules/` apply when the agent opens the control plane: critics never implement, and Java/React/ECS changes follow frozen patterns. When the implementer opens the product repo instead, copy or submodule those rules if the product repo should enforce them too.

## Claude Code

Start Claude Code in a fresh directory session (`claude`), not a `--resume` of the author. Ask it to read the role `SYSTEM.md` and the skill, then write only the output files. If you install skills as Claude skills, symlink the folder:

```bash
mkdir -p .claude/skills
ln -s ../../skills/critique-spec .claude/skills/critique-spec
```

A skill install does not remove the need for a new session. The same Claude project can still leak the writer's chat into the critic if you continue the conversation.

## Codex

Start a new Codex thread or `codex exec` invocation per stage. Pass the system file and the skill as the task, plus the input paths from `pipeline status`. Keep the critic's thread distinct from the implementer's thread so the review cannot inherit the implementer's justifications.

## What not to do

- Do not let one long chat "switch hats" from writer to critic.
- Do not put API tokens in a prompt. They belong in the host's secret store or a local `.env` that is gitignored.
- Do not ask the host to merge. The release skill stops at an open MR and a deploy note.
