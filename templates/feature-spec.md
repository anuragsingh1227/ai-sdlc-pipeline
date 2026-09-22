# Spec: <feature name>

Brief: `runs/<feature-id>/01-brief/brief.md`
Status: draft

## Problem

<who is blocked, and what they do today. Only facts from the brief.>

## Proposal

<the smallest change that meets the goals. One paragraph.>

## Behavior

### <behavior name>

- Actor:
- Trigger:
- Result:
- Failure:

## API

<method, path, auth, request, response, and error codes. Write "No API change" if the brief is UI-only.>

## UI

<screen, control, states: idle, loading, success, empty, error. Write "No UI change" if the brief is API-only.>

## Data

<what is read, what is written, what must not be stored. Name existing services. Do not introduce a store the brief did not ask for.>

## Test plan

- <unit-level assertion tied to a behavior above>

## Out of scope

- <every exclusion from the brief>
- <technical work you will not do, such as a new ECS service>
