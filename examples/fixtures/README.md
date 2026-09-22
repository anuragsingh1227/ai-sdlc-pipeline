# Atlassian fixtures

Recorded JSON for `PIPELINE_MOCK_ATLASSIAN=1` and `--mock`. Tests and local dry runs read these files. They are not live responses from a customer site.

- `confluence-page.json` — Confluence Cloud `GET /wiki/rest/api/content/{id}?expand=body.storage`
- `jira-create-response.json` — keys returned after an epic and its stories are created
