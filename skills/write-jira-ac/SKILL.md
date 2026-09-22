---
name: write-jira-ac
description: Turn an approved spec into Given/When/Then acceptance criteria and Jira ticket drafts.
stage: jira-ac
role: jira-ac
---

# Write Jira acceptance criteria

## When to use

The next stage is `jira-ac`. The spec critic approved, and a human set `gates.spec-approved` to `passed`.

## Steps

1. Read the verdict. If it is not `approve`, stop.
2. Read `gates.spec-approved`. If it is not `passed`, stop and ask the human to record the gate.
3. Read `docs/JIRA.md`, `templates/acceptance-criteria.md`, and the spec's behavior and out-of-scope sections.
4. Write one Given/When/Then story per behavior, including the failure behaviors the spec names.
5. Write `tickets.yaml` with one story per AC story and a single epic. Leave story points unset.
6. Do not call Jira. Leave remote creation as a TODO for `integrations/jira.ts`.

## Required inputs

- `runs/<feature-id>/02-spec/feature-spec.md`
- `runs/<feature-id>/03-spec-critic/verdict.md`
- Manifest gate `spec-approved: passed`
- Jira project key

## Required outputs

- `runs/<feature-id>/04-jira/acceptance-criteria.md`
- `runs/<feature-id>/04-jira/tickets.yaml`

## Stop and ask a human

- The verdict is `send-back` or missing.
- The human gate is not `passed`.
- A behavior has no observable Then. Ask rather than inventing a metric or a status code.
- The project key is unknown.

## Done when

Stories and tickets match, every story traces to the spec, and no out-of-scope work has a ticket.
