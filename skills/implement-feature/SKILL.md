---
name: implement-feature
description: Implement acceptance criteria in the product repo with unit tests. Do not self-approve.
stage: implement
role: implementer
---

# Implement feature

## When to use

The next stage is `implement`, or the code critic sent the change back. You are not the code critic.

## Steps

1. Read `agents/implementer/SYSTEM.md` and the AC file. Treat AC as the only scope.
2. On a send-back, read `06-code-critic/review.md` and touch only the findings.
3. Read the product repo's nearby patterns. Fall back to `templates/java-spring-endpoint.md` and `templates/react-feature.md`.
4. Write the code and unit tests in the product repo.
5. Run the unit tests the product already uses.
6. Write `05-implement/change-summary.md` with product paths, test names, the command you ran, and a scope check.
7. Stop. Do not open an MR and do not write a review verdict.

## Required inputs

- `runs/<feature-id>/04-jira/acceptance-criteria.md`
- `runs/<feature-id>/04-jira/tickets.yaml`
- Product repository checkout
- Critic review, only on send-back

## Required outputs

- Product diff covering the AC
- `runs/<feature-id>/05-implement/change-summary.md` with headings Product repo changes, Tests, Scope check

## Stop and ask a human

- The AC and the spec disagree.
- A Then clause is not testable.
- The change needs a new ECS service, a new datastore, or a secret the product does not already inject.
- Tests fail for a reason outside the AC, such as a broken local toolchain.

## Done when

Each story has a test, the scope check names something you did not build, and this session did not approve the change.
