# Code critic and release inputs

## Stage `code-critic`

| Input | Required | Path |
| --- | --- | --- |
| Acceptance criteria | yes | `runs/<feature-id>/04-jira/acceptance-criteria.md` |
| Change summary | yes | `runs/<feature-id>/05-implement/change-summary.md` |
| Product diff | yes | The product branch the summary names |
| Implementer session id | yes | `manifest.yaml` `sessions.implementer` |

## Stage `release`

| Input | Required | Path |
| --- | --- | --- |
| Review | yes | `runs/<feature-id>/06-code-critic/review.md` with verdict `approve` |
| Change summary | yes | `runs/<feature-id>/05-implement/change-summary.md` |
| Acceptance criteria | yes | `runs/<feature-id>/04-jira/acceptance-criteria.md` |

Skill files: `skills/critique-code/SKILL.md`, `skills/open-mr/SKILL.md`. MR shape: `templates/mr-description.md`.
