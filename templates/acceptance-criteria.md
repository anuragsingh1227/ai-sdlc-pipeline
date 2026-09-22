# Acceptance criteria: <feature name>

Spec: `runs/<feature-id>/02-spec/feature-spec.md`
Gate: `spec-approved` passed

## Stories

### Story: <short name>

Given <actor and state>
When <single action>
Then <observable result>
And <another observable result, if needed>

### Story: <negative path>

Given <actor missing a permission, or a missing record>
When <the same action>
Then <error the caller can see>
And <no side effect the spec forbids>
