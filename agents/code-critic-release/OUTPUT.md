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

Opening the remote MR is allowed when `GIT_HOST` and the product remote are already set up for the host you are running in. Record the URL in the summary. Merging is not an output.
