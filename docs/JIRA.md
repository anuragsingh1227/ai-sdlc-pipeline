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
| `project` | yes | Must equal `JIRA_PROJECT_KEY` when that variable is set. Example: `OPS` |
| `epic.issueType` | yes | `Epic` |
| `epic.summary` | yes | Feature name, not a task list |
| `stories[].issueType` | yes | `Story` unless the human asked for `Task` |
| `stories[].summary` | yes | Imperative, specific |
| `stories[].description` | yes | Spec trace: which behavior section |
| `stories[].acceptanceCriteria` | yes | The Given/When/Then for that story |
| `stories[].parent` | yes | `epic` links the story to the epic in this file. A Jira issue key (for example `OPS-10`) is sent as `parent` unchanged. |
| `stories[].labels` | no | Include the feature id |
| `stories[].components` | no | Sent as Jira component names, such as `order-api` or `order-console` |
| `stories[].storyPoints` | no | Leave unset. Humans estimate |

Placeholder env vars: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`.

Push from the control plane:

```bash
npx tsx src/cli.ts jira push --run runs/<feature-id> --dry-run
npx tsx src/cli.ts jira push --run runs/<feature-id> --mock
npx tsx src/cli.ts jira push --run runs/<feature-id> --apply
```

Dry-run is the default. `--mock` reads `examples/fixtures/jira-create-response.json`, writes `04-jira/push-result.json`, and stores keys back into `tickets.yaml`. `--apply` calls Jira Cloud `POST /rest/api/3/issue` (or `PUT` when an issue already has a `key`). It refuses to run unless `validate --run` is clean and gate `spec-approved` is `passed`. `tickets.project` must equal `JIRA_PROJECT_KEY`.

Each successful create or update writes that issue key into `tickets.yaml` and refreshes `04-jira/push-result.json` before the next issue is sent. A retry after a mid-loop timeout PUTs the keys already stored instead of creating duplicates.

The epic is created first. A story whose `parent` is `epic` is filed under that epic key. Team-managed projects use the `parent` field. Company-managed projects also need Epic Link (`com.pyxis.greenhopper.jira:gh-epic-link`, often `customfield_10014`). Set `JIRA_EPIC_LINK_FIELD` to send that field. When it is unset, the client GETs `/rest/api/3/field` and uses the Epic Link id if the lookup succeeds. A failed lookup still sends `parent` and does not fail the push. Story `components` are sent as `{ name }` entries on create and on update.

Story descriptions are Atlassian document format built from the Given/When/Then text. Auth is Basic `JIRA_EMAIL`:`JIRA_API_TOKEN`. The token is not written into the URL or the JSON body. `JIRA_BASE_URL` must be `https` on `*.atlassian.net`, or the exact host named by `ATLASSIAN_ALLOW_HOST`. That override does not allow link-local, loopback, metadata, or private IP hosts. Redirects are refused (`redirect: "error"`).

`jira push` will not write into `examples/` unless you pass `--force`. Copy the run under `runs/` before a mock or live push.

Without credentials, `--apply` fails and names `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, and `JIRA_PROJECT_KEY`.

## Trace

Every story summary should be findable in the spec's behavior section. The code critic later checks the diff against these stories, not against a looser reading of the spec.
