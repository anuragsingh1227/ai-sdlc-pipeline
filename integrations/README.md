# Integrations

Confluence and Jira clients live here. The orchestrator does not import a model SDK. CI uses fixtures.

| File | Behavior |
| --- | --- |
| `confluence.ts` | `getPage(idOrUrl)` via Confluence Cloud REST, or `examples/fixtures/confluence-page.json` when `--mock` / `PIPELINE_MOCK_ATLASSIAN=1`. Base URLs are https only. |
| `jira.ts` | `createIssuesFromTicketsYaml` via Jira Cloud REST API v3, or the Jira fixture in mock mode. `tickets.project` must match `JIRA_PROJECT_KEY` when that variable is set. |

Commands:

```bash
npx tsx src/cli.ts confluence fetch --page <id|url> --out runs/<feature-id>/00-source --mock
npx tsx src/cli.ts jira push --run runs/<feature-id> --dry-run
```

Live credentials belong in an untracked `.env`. See `.env.example`. Missing credentials throw; they do not silently succeed.
