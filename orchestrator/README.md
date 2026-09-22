# Orchestrator

The orchestrator sequences the seven stages. It is a YAML file and a local CLI. No model is required, and no model SDK is imported.

## What it does

1. Load `pipeline.yaml`.
2. Confirm the graph is closed: every success, send-back, and escalate target is a stage or a human gate; critic roles differ from author roles; skill files exist.
3. Look at one run directory.
4. Print the first incomplete stage or the human gate that is blocking, with the artifact paths for that step.

Commands, from the repo root:

```bash
npx tsx src/cli.ts validate
npx tsx src/cli.ts validate --run examples/sample-run
npx tsx src/cli.ts status --run examples/sample-run
npx tsx src/cli.ts status <feature-id>          # reads runs/<feature-id>
```

Exit code `0` means the graph (and the run, if given) is consistent. Exit code `1` means a validation error. Exit code `2` means bad arguments.

## How a stage becomes "next"

Walk stages by `order`:

- If an output file is missing or empty, that stage is next. Print its role, skill, inputs, and outputs.
- If the stage expects a verdict and the verdict is `send-back`, the next stage is `onSendBack` (the writer or the implementer), not the following stage.
- If the verdict is `approve`, look at the human gate whose `after` is this stage.
  - `brief-questions` blocks only when `01-brief/brief.meta.yaml` has a non-empty `openQuestions` list and the gate is not `passed`.
  - `spec-approved` always blocks until the manifest says `passed`.
  - `merge` always blocks until a human sets it to `passed`. There is no stage after it.

The CLI does not launch workers. A human or an external script reads the status and starts the host named in [`docs/HOSTS.md`](../docs/HOSTS.md).

## Human gates

Gates are recorded only in `runs/<feature-id>/manifest.yaml`. The CLI never flips them.

```yaml
gates:
  brief-questions: skipped   # allowed when openQuestions is empty
  spec-approved: passed      # a human wrote this
  merge: pending
```

Allowed values are `passed`, `pending`, and `skipped`. `skipped` is valid only for `brief-questions`. Setting `spec-approved: passed` is the human's signature that tickets and code may start. Setting `merge: passed` means a human merged. Agents do not write `passed` for those two gates unless the human has explicitly told that session to record a decision the human already made.

## Retry limits

Each automated stage has `retryLimit`. A send-back consumes an attempt. Record counts under `attempts` in the manifest if you want them visible. When the count would exceed the limit, stop the loop and take the `escalateTo` gate to a human (`spec-approved` or `merge`). The CLI prints the limit on the next-stage block; it does not auto-escalate, because it does not invent gate decisions.

## Separation checks

When `03-spec-critic/verdict.md` exists, `sessions.spec-writer` and `sessions.spec-critic` must both be set and must differ. When `06-code-critic/review.md` exists, `sessions.implementer` and `sessions.code-critic-release` must differ. Matching ids fail `validate`.

## Out of scope for the orchestrator

Live Confluence or Jira calls, git push, MR creation, CI watches, and deploy. Those are worker skills or human actions. Stubs live in [`integrations/`](../integrations/).
