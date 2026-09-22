# Architecture

This repository is the control plane. The product repository is the system under change. They share files and merge requests. They do not share agent transcripts.

## Two repositories

```text
ai-sdlc-pipeline/                         product repo (example)
  pipeline.yaml                           order-api/          Java, Spring, ECS service
  agents/  skills/  templates/            order-console/      React
  runs/<feature-id>/*.md                  existing CI
        │                                       ▲
        │  05-implement/change-summary.md       │
        └──────── describes the diff ───────────┘
```

Keep the playbook next to the product repo or as a submodule. Agents that edit code run with the product repo as their working tree, and they write the handoff markdown back into the control-plane run directory (or a copy of it the human points them at).

A run never stores the product source. It stores the brief, the spec, the verdicts, the acceptance criteria, a change summary, and the MR body. The branch in the product repo is the code.

## Handoffs are files

Troika-style handoff, applied to this loop:

- Each role runs in its own session.
- The session's inputs are the files listed on that stage in `pipeline.yaml`.
- The session's outputs are new files. It does not edit the previous role's verdict to hide a gap.
- The next session is not a continuation of the previous chat. It cannot see tool traces, rejected ideas, or unstated assumptions.
- `runs/<feature-id>/manifest.yaml` records role session ids and human-gate decisions so the CLI can tell whether the critic was actually someone else.

If a fact is not in an input file, the role treats it as unknown and either leaves it out or stops and asks a human.

## What the orchestrator is

The orchestrator is `pipeline.yaml` plus `src/cli.ts`. It sequences stages. It does not:

- choose a model
- rewrite a spec
- decide that a send-back is "close enough"
- call Confluence, Jira, GitHub, or GitLab
- merge

`pipeline status` walks the stages in `order`. A stage is complete when every output file exists, is non-empty, and (when the stage has a verdict) the verdict line is `approve`. Human gates sit between stages. A required gate with status `pending` is the next action even if a model could have continued.

Retry limits are caps, not targets. `onSendBack` names the stage that must be repeated. `escalateTo` names the human gate a human should take over once the cap is hit. The CLI reports the cap; a human enforces it by refusing another automatic loop. Record attempts in the manifest when you want that visible:

```yaml
attempts:
  spec-draft: 2
  spec-critic: 2
```

## Stage graph

| Order | Stage id | Role | Next on success | Loop |
| --- | --- | --- | --- | --- |
| 1 | `confluence-brief` | spec writer | gate `brief-questions` | Ask a human instead of guessing the page |
| 2 | `spec-draft` | spec writer | `spec-critic` | Repeat when the critic sends the spec back |
| 3 | `spec-critic` | spec critic | gate `spec-approved` | `send-back` returns to `spec-draft` (limit 3) |
| 4 | `jira-ac` | AC / Jira | `implement` | Only after `spec-approved` is `passed` |
| 5 | `implement` | implementer | `code-critic` | Repeat when the code critic sends it back |
| 6 | `code-critic` | code critic + release | `release` | `send-back` returns to `implement` (limit 3) |
| 7 | `release` | code critic + release | gate `merge` | Opens the MR. Does not merge |

Gates:

| Gate | When | Who |
| --- | --- | --- |
| `brief-questions` | The brief meta lists any open question | Human answers, then the spec writer continues |
| `spec-approved` | Spec critic verdict is `approve` | Human accepts the spec before tickets or code |
| `merge` | MR body is written | Human reviews CI and merges |

`brief-questions` is conditional. An empty `openQuestions` list skips it. The other two gates are always required.

## Session separation

`pipeline.yaml` `separation` is enforced when a run manifest is present:

- `sessions.spec-writer` and `sessions.spec-critic` must differ once a spec verdict exists.
- `sessions.implementer` and `sessions.code-critic-release` must differ once a code review exists.

The same person may run the orchestrator CLI between sessions. The same agent session may not play both sides of a pair. Code critic and release are one role: the critic writes the verdict, and after `approve` a release step (same role, still not the implementer) writes the MR body. That role still does not edit product code.

## Where product patterns live

Java, React, and ECS conventions for the example stack are templates plus Cursor rules. They are frozen only in the sense that an implementer follows the product repo when the product repo already has a pattern, and follows `templates/` when it does not. The control plane does not generate a service skeleton.
