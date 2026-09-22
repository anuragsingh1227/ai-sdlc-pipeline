# Feature runs

Each feature gets a directory of files. Downstream roles read those files in a fresh session. They do not read an earlier role's chat transcript.

```text
runs/<feature-id>/
  manifest.yaml
  00-source/page.md
  01-brief/brief.md
  01-brief/brief.meta.yaml
  02-spec/feature-spec.md
  03-spec-critic/verdict.md
  04-jira/acceptance-criteria.md
  04-jira/tickets.yaml
  05-implement/change-summary.md
  06-code-critic/review.md
  07-release/mr-description.md
```

This directory is gitignored except for this note. Copy `examples/sample-run/` when you want a filled chain to start from.

```bash
mkdir -p runs
cp -R examples/sample-run runs/order-explain
npx tsx src/cli.ts status order-explain
```

Product code stays in the product repository. `05-implement/change-summary.md` records what changed there. The diff itself is the product repo's branch.
