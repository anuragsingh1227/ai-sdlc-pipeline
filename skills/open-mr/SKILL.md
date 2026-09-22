---
name: open-mr
description: Write the merge request body and open the MR after code-critic approval. Humans merge.
stage: release
role: code-critic-release
---

# Open merge request

## When to use

The code critic verdict is `approve` and `pipeline status` names stage `release`.

## Steps

1. Read the verdict. If it is not `approve`, stop and return to critique or implement. Do not open an MR for a send-back.
2. Read the change summary, the AC, and `templates/mr-description.md`.
3. Write `07-release/mr-description.md` with Summary, Acceptance criteria, Test plan, and Deploy.
4. If the host is already authenticated to `GIT_HOST`, open the MR against the product repo's default branch and paste the URL into the summary. If it is not authenticated, leave the URL as "not opened yet" and stop. Do not invent credentials.
5. In Deploy, state whether a dev deploy is needed. Default: a human deploys to dev after merge, using the product pipeline. Do not run a production deploy.
6. Leave `gates.merge` as `pending`.

## Required inputs

- `runs/<feature-id>/06-code-critic/review.md`
- `runs/<feature-id>/05-implement/change-summary.md`
- `runs/<feature-id>/04-jira/acceptance-criteria.md`

## Required outputs

- `runs/<feature-id>/07-release/mr-description.md`
- Optional: an open MR URL recorded in that file

## Stop and ask a human

- The verdict is missing or is `send-back`.
- CI on the new MR is red. Do not merge to "see if it goes away".
- The deploy note would require a new ECS service or a secret you cannot see in the existing task definition.
- The host has no git credentials. Ask a human to open the MR from the body you wrote.

## Done when

The MR body maps each AC story to a test, the deploy section names the human merge, and no merge was performed.
