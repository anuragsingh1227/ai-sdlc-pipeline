---
name: critique-spec
description: Compare a feature spec to the Confluence brief and approve it or send it back. Never rewrite the spec.
stage: spec-critic
role: spec-critic
---

# Critique spec

## When to use

The next stage is `spec-critic`. You are in a new session that did not write the spec.

## Steps

1. Confirm your session id is not `sessions.spec-writer`. If it is, stop and tell the human to open a new session.
2. Read `agents/spec-critic/SYSTEM.md`.
3. Read the page export, the brief, the brief meta, and the spec. Do not read implementer notes.
4. Build a coverage list: each goal, constraint, and exclusion, marked covered or gap.
5. Check that the spec did not decide an open question on its own.
6. Write `03-spec-critic/verdict.md`. The verdict line is `approve` or `send-back`.
7. Stop. Do not edit the spec.

## Required inputs

- `runs/<feature-id>/00-source/page.md`
- `runs/<feature-id>/01-brief/brief.md`
- `runs/<feature-id>/01-brief/brief.meta.yaml`
- `runs/<feature-id>/02-spec/feature-spec.md`

## Required outputs

- `runs/<feature-id>/03-spec-critic/verdict.md` with `## Verdict` and `## Gaps`

## Stop and ask a human

- Any required input is missing.
- This session wrote the spec.
- The retry count for this loop is already at `retryLimit` (3). Escalate to the `spec-approved` gate instead of another automatic send-back.

## Done when

The verdict line is exact, every material gap cites the brief or the page, and the spec file is unchanged.
