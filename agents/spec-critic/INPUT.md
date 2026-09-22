# Spec critic inputs

| Input | Required | Path |
| --- | --- | --- |
| Confluence export | yes | `runs/<feature-id>/00-source/page.md` |
| Brief | yes | `runs/<feature-id>/01-brief/brief.md` |
| Brief meta | yes | `runs/<feature-id>/01-brief/brief.meta.yaml` |
| Feature spec | yes | `runs/<feature-id>/02-spec/feature-spec.md` |
| Writer session id | yes | `manifest.yaml` `sessions.spec-writer` |

You need the page, not only the brief. The brief can already have dropped a constraint.

Skill: `skills/critique-spec/SKILL.md`.
