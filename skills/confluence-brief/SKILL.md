---
name: confluence-brief
description: Freeze a Confluence page into a structured brief with goals, users, constraints, out of scope, and open questions.
stage: confluence-brief
role: spec-writer
---

# Confluence brief

## When to use

`pipeline status` names stage `confluence-brief`. You have a Confluence export and no agreed brief yet, or a human rejected the previous brief.

## Steps

1. Read `agents/spec-writer/SYSTEM.md` and `runs/<feature-id>/00-source/page.md`.
2. Read `templates/confluence-brief.md` and `docs/CONFLUENCE.md`.
3. List goals, users, constraints, and exclusions that the page actually states.
4. List open questions for anything a spec would otherwise have to invent.
5. Write `01-brief/brief.md` and `01-brief/brief.meta.yaml`.
6. Stop. Do not draft the spec in this same pass unless `pipeline status` has already moved to `spec-draft`.

## Required inputs

- `runs/<feature-id>/00-source/page.md`
- Page URL and page id from the human or `manifest.yaml`

## Required outputs

- `runs/<feature-id>/01-brief/brief.md` with headings Goals, Users, Constraints, Out of scope, Open questions
- `runs/<feature-id>/01-brief/brief.meta.yaml` with `source` and `openQuestions`

## Stop and ask a human

- The export is missing, empty, or is a different page than the URL.
- The page contradicts itself on a goal or an exclusion.
- You would have to guess a user, a limit, or an out-of-scope boundary.
- `openQuestions` is non-empty. Hand the brief to the human gate `brief-questions` and wait.

## Done when

A reader can check each bullet against the export, and the meta list matches the open-questions section.
