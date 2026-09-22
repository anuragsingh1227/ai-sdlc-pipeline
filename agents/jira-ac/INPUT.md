# AC / Jira inputs

| Input | Required | Path |
| --- | --- | --- |
| Feature spec | yes | `runs/<feature-id>/02-spec/feature-spec.md` |
| Spec verdict | yes | `runs/<feature-id>/03-spec-critic/verdict.md` |
| Human gate | yes | `manifest.yaml` `gates.spec-approved: passed` |
| Jira project key | yes | Human, or `JIRA_PROJECT_KEY` in the environment (name only; do not print secrets) |

If the verdict is `send-back`, or the gate is missing or `pending`, stop. Do not draft tickets "in the meantime".

Skill: `skills/write-jira-ac/SKILL.md`. Field list: `docs/JIRA.md`.
