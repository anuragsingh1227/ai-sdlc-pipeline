# Spec critic outputs

| Output | Path |
| --- | --- |
| Verdict | `runs/<feature-id>/03-spec-critic/verdict.md` |

Required headings: `## Verdict`, `## Gaps`.

The first non-empty line under `## Verdict` is exactly `approve` or `send-back`.

Under `## Gaps`, each finding names the brief or page statement and the spec section that misses or contradicts it. Write `None.` when the verdict is `approve`. Earlier rounds may stay in the file as history under the gaps section; the verdict line is the current decision only.

Do not write `02-spec/feature-spec.md`.
