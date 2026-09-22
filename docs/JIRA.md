# Jira acceptance criteria

Stage 4 runs only after the spec critic's verdict is `approve` and the manifest gate `spec-approved` is `passed`. v1 writes ticket drafts into the run directory. It does not create issues.

## Acceptance criteria

File: `runs/<feature-id>/04-jira/acceptance-criteria.md`

Template: [`templates/acceptance-criteria.md`](../templates/acceptance-criteria.md)

Each story uses Given / When / Then. One behavior per story. The Then clause is observable without reading the implementation.

```markdown
### Story: Support agent requests an explanation

Given a support agent with role ORDER_READ
And order 1001 has at least one order event
When the agent requests an explanation for order 1001
Then the response is HTTP 200
And every citation event id belongs to order 1001
```

Include unhappy paths the spec names: missing auth, missing order, empty events, and "this call does not change the order". Do not add a story for work listed under the spec's out of scope.

## Ticket fields

File: `runs/<feature-id>/04-jira/tickets.yaml`

| Field | Required | Notes |
| --- | --- | --- |
| `project` | yes | From `JIRA_PROJECT_KEY` or the human. Example: `OPS` |
| `epic.issueType` | yes | `Epic` |
| `epic.summary` | yes | Feature name, not a task list |
| `stories[].issueType` | yes | `Story` unless the human asked for `Task` |
| `stories[].summary` | yes | Imperative, specific |
| `stories[].description` | yes | Spec trace: which behavior section |
| `stories[].acceptanceCriteria` | yes | The Given/When/Then for that story |
| `stories[].parent` | yes | `epic` until a real key exists |
| `stories[].labels` | no | Include the feature id |
| `stories[].components` | no | Product components, such as `order-api` or `order-console` |
| `stories[].storyPoints` | no | Leave unset. Humans estimate |

Placeholder env vars: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`.

`integrations/jira.ts` is a stub. Creating issues remotely is a TODO that should create the epic first, store returned keys back into `tickets.yaml`, and link stories to that epic. Do not call Jira from the orchestrator CLI.

## Trace

Every story summary should be findable in the spec's behavior section. The code critic later checks the diff against these stories, not against a looser reading of the spec.
