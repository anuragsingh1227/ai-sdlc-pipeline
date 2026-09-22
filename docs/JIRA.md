# Jira acceptance criteria

Stage 4 runs only after the spec critic's verdict is `approve` and the manifest gate `spec-approved` is `passed`. The agent writes ticket drafts. A human pushes them.

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

Push from the control plane:

```bash
npx tsx src/cli.ts jira push --run runs/<feature-id> --dry-run
npx tsx src/cli.ts jira push --run runs/<feature-id> --mock
npx tsx src/cli.ts jira push --run runs/<feature-id> --apply
```

Dry-run is the default. `--mock` reads `examples/fixtures/jira-create-response.json`, writes `04-jira/push-result.json`, and stores keys back into `tickets.yaml`. `--apply` calls Jira Cloud `POST /rest/api/3/issue` (or `PUT` when a story already has a `key`). The epic is created first. Story descriptions are Atlassian document format built from the Given/When/Then text. Auth is Basic `JIRA_EMAIL`:`JIRA_API_TOKEN`. The token is not written into the URL or the JSON body.

Without credentials, `--apply` fails and names `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, and `JIRA_PROJECT_KEY`.

## Trace

Every story summary should be findable in the spec's behavior section. The code critic later checks the diff against these stories, not against a looser reading of the spec.
