---
name: critique-code
description: Review a product diff against acceptance criteria and edge cases. Do not edit the code.
stage: code-critic
role: code-critic-release
---

# Critique code

## When to use

The next stage is `code-critic`. You are in a session that did not implement the change.

## Steps

1. Compare your session id with `sessions.implementer`. If they match, stop.
2. Read `agents/code-critic-release/SYSTEM.md`, the AC, and the change summary.
3. Read the product diff. Check each Then clause against assertions, not against the summary's prose.
4. Check edge cases: empty collections, missing auth, not found, timeout, duplicate submit, and forbidden mutations.
5. Write `06-code-critic/review.md` with verdict `approve` or `send-back`, findings, and edge cases.
6. Do not patch files. Do not start the MR in this step.

## Required inputs

- `runs/<feature-id>/04-jira/acceptance-criteria.md`
- `runs/<feature-id>/05-implement/change-summary.md`
- The product branch named in the summary

## Required outputs

- `runs/<feature-id>/06-code-critic/review.md` with headings Verdict, Findings, Edge cases

## Stop and ask a human

- You are the implementer session.
- The diff is missing or does not match the summary's file list.
- Retry limit 3 is already used on this implement/critic loop. Escalate to a human at the merge gate instead of another silent loop.
- You cannot decide whether a failing test is acceptable.

## Done when

The verdict line is exact, every story is covered or cited, and the product tree is unchanged by this session.
