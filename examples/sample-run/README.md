# Sample run: Order explain

A filled artifact chain for a fictional support-console feature. Nothing here is a live Confluence page or a real Jira issue. It shows what each stage leaves on disk.

Read in order:

1. `00-source/page.md` — the Confluence export a human dropped in
2. `01-brief/brief.md` — spec writer
3. `02-spec/feature-spec.md` — spec writer
4. `03-spec-critic/verdict.md` — a different role; round 1 sent the spec back, round 2 approved
5. `04-jira/` — acceptance criteria and ticket drafts after the human gate
6. `05-implement/change-summary.md` — what the implementer would change in the product repo
7. `06-code-critic/review.md` — a different session than the implementer
8. `07-release/mr-description.md` — MR body; merge stays pending

```bash
npx tsx src/cli.ts validate --run examples/sample-run
npx tsx src/cli.ts status --run examples/sample-run
```

Status should stop on the human gate `merge`.
