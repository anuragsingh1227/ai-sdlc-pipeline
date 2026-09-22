# Spec writer inputs

## Stage `confluence-brief`

| Input | Required | Path |
| --- | --- | --- |
| Confluence export | yes | `runs/<feature-id>/00-source/page.md` |
| Page URL and page id | yes | Told by the human, or `manifest.yaml` `source` |

The export is the source of truth. A URL without an export is not enough, because the next session cannot log into Confluence.

## Stage `spec-draft`

| Input | Required | Path |
| --- | --- | --- |
| Brief | yes | `runs/<feature-id>/01-brief/brief.md` |
| Brief meta | yes | `runs/<feature-id>/01-brief/brief.meta.yaml` |
| Gate | yes, if `openQuestions` is non-empty | `manifest.yaml` `gates.brief-questions: passed` |

Do not read the spec critic's notes from a previous round unless this is a send-back and the human attached `03-spec-critic/verdict.md`. On a send-back, that verdict is an input: fix the gaps it lists, and do not silently expand scope.

Skill files: `skills/confluence-brief/SKILL.md`, `skills/write-spec/SKILL.md`.
