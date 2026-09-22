# AC / Jira outputs

| Output | Path |
| --- | --- |
| Acceptance criteria | `runs/<feature-id>/04-jira/acceptance-criteria.md` |
| Ticket drafts | `runs/<feature-id>/04-jira/tickets.yaml` |

The criteria file has a `## Stories` heading and the words Given, When, and Then.

`tickets.yaml` has `project`, an `epic` with `issueType` and `summary`, and a non-empty `stories` list. Each story has `issueType`, `summary`, `description`, `acceptanceCriteria`, and `parent`.

Template: `templates/acceptance-criteria.md`.
