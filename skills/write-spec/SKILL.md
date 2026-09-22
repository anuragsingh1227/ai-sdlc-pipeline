---
name: write-spec
description: Write a feature spec from an approved Confluence brief. Do not critique it and do not start implementation.
stage: spec-draft
role: spec-writer
---

# Write spec

## When to use

The next stage is `spec-draft`. The brief exists. Open questions are empty, or the human gate `brief-questions` is `passed`. On a send-back, the critic verdict is also an input.

## Steps

1. Read `agents/spec-writer/SYSTEM.md`, the brief, and the brief meta.
2. If `03-spec-critic/verdict.md` exists and its verdict is `send-back`, read the gaps and plan an edit that addresses them without new scope.
3. Read `templates/feature-spec.md`.
4. Write behavior, API, UI, data, and tests only for goals in the brief.
5. Copy every brief exclusion into the spec's out of scope.
6. Write `02-spec/feature-spec.md` and stop before any review or tickets.

## Required inputs

- `runs/<feature-id>/01-brief/brief.md`
- `runs/<feature-id>/01-brief/brief.meta.yaml`
- Critic verdict, only when this run is a send-back

## Required outputs

- `runs/<feature-id>/02-spec/feature-spec.md` with headings Problem, Proposal, Behavior, API, UI, Data, Test plan, Out of scope

## Stop and ask a human

- The brief still has open questions and the gate is not `passed`.
- A critic gap cannot be fixed without contradicting the brief.
- The page and the brief disagree. Do not pick a winner silently.

## Done when

Each brief goal is visible in the spec, each constraint is honored, and you did not write a verdict or a ticket file.
