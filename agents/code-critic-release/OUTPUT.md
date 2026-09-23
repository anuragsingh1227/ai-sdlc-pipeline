# Code critic and release outputs

## Stage `code-critic`

| Output | Path |
| --- | --- |
| Review | `runs/<feature-id>/06-code-critic/review.md` |

Headings: `## Verdict`, `## Findings`, `## Edge cases`.

The first non-empty line under `## Verdict` is `approve` or `send-back`. Findings name paths and the AC story they affect. `None.` is allowed when approving, but the edge-case section must still say which cases you checked.

## Stage `release`

| Output | Path |
| --- | --- |
| MR description | `runs/<feature-id>/07-release/mr-description.md` |

Headings: `## Summary`, `## Acceptance criteria`, `## Test plan`, `## Deploy`.

The CLI does not open the remote MR. Write the body and leave the URL as "not opened yet" until a human opens it. Record that URL in the summary when a human has one. Merging is not an output.
