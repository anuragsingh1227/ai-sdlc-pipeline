# Spec writer outputs

## Stage `confluence-brief`

| Output | Path |
| --- | --- |
| Brief | `runs/<feature-id>/01-brief/brief.md` |
| Brief meta | `runs/<feature-id>/01-brief/brief.meta.yaml` |

Brief headings, in order: Goals, Users, Constraints, Out of scope, Open questions.

Brief meta fields: `source.url`, `source.pageId`, `source.export`, `openQuestions` (list of strings), `capturedAt` (ISO date).

## Stage `spec-draft`

| Output | Path |
| --- | --- |
| Feature spec | `runs/<feature-id>/02-spec/feature-spec.md` |

Spec headings, in order: Problem, Proposal, Behavior, API, UI, Data, Test plan, Out of scope.

Schemas match `templates/confluence-brief.md` and `templates/feature-spec.md`. Do not write other run files.
