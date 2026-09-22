# Implementer inputs

| Input | Required | Path |
| --- | --- | --- |
| Acceptance criteria | yes, this is the contract | `runs/<feature-id>/04-jira/acceptance-criteria.md` |
| Ticket drafts | yes | `runs/<feature-id>/04-jira/tickets.yaml` |
| Product repo | yes | The human's product checkout, not this control plane |
| Patterns | when the product repo is silent | `templates/java-spring-endpoint.md`, `templates/react-feature.md`, `.cursor/rules/java-react-ecs.mdc` |

The feature spec is not an input for new scope. You may open it only to resolve a name that the AC already uses. If you need a rule that is only in the spec, stop and ask a human to amend the AC.

On a code-critic send-back, also read `06-code-critic/review.md` and change only what the findings require.

Skill: `skills/implement-feature/SKILL.md`.
