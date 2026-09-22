# Code critic and release done-when

## Review

- [ ] Session id differs from `sessions.implementer`
- [ ] Every AC story is marked covered or listed as a finding
- [ ] Tests were read, not only the change summary's claim
- [ ] Edge cases include empty input, auth failure, and "does not mutate" when the AC says so
- [ ] Verdict line is `approve` or `send-back`
- [ ] No product file was modified in this session

## Release

- [ ] Verdict is `approve`
- [ ] MR summary states the user-visible change in a few sentences
- [ ] Acceptance criteria section checks each story
- [ ] Test plan names commands
- [ ] Deploy section says whether deploy-to-dev needs a human step, and does not claim the agent merged
- [ ] `gates.merge` was left `pending`
