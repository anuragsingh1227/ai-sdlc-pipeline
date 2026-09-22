# Hosts

The pipeline is provider-agnostic. The host is whatever coding CLI runs one stage. The control plane tells you which stage, which role, and which files.

## Shared procedure

Run this from the control-plane repo:

```bash
npx tsx src/cli.ts status <feature-id>
```

The output names a role, a skill, input paths, and output paths. Then:

1. Start a **new** session. Do not resume the session that wrote the artifact under review.
2. Set the working directory to the product repo for `implement`, and to the control-plane repo for every other stage. The implementer still needs the run directory for the AC files and the change summary.
3. Give the worker `agents/<role>/SYSTEM.md`, the skill file, and the input files. Do not attach the other roles' system prompts.
4. Tell the worker the output paths. Refuse edits outside those outputs (and, for the implementer, the product files named in the AC).
5. When the session ends, run `pipeline validate --run <dir>` and `pipeline status` again.

Record the host session id in `manifest.yaml` under `sessions.<role>`. The validator rejects a run where the spec writer and spec critic share an id, or where the implementer and the code critic share an id.

Skills are ordinary markdown. You can symlink `skills/*` into a host skill directory. The source of truth stays `skills/`.

## Grok Build (`grok`)

Grok reads a root `AGENTS.md` and `.cursor/rules/` automatically. That is enough for the separation rules. For a single stage, prefer a headless run so the session cannot wander into the next role:

```bash
# From the control-plane repo, after `pipeline status` says spec-draft is next.
grok -p --prompt-file agents/spec-writer/SYSTEM.md --rules "$(cat skills/write-spec/SKILL.md)"
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
