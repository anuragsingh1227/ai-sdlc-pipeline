# <feature name>

## Summary

<what a reviewer sees in the product. Link the run id and the spec path.>

Remote MR: <URL once opened, or "not opened yet">

## Acceptance criteria

- [ ] <story name> — <test name>

## Test plan

- `<command>` — <what it covers>
- <manual check, if any, and who runs it>

## Deploy

- ECS: <no new service / task-definition note>
- Config: <env vars, and that secrets stay in the existing store>
- Dev: <optional deploy-to-dev is a human step after merge, unless the product runbook says otherwise>
- Merge: a human merges. This agent does not.
