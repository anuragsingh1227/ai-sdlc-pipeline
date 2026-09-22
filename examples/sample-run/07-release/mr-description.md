# Order explain

## Summary

Support agents with `ORDER_READ` can request one grounded explanation for the order they are viewing. The order API cites only that order's events, skips the model when there are no events, and writes a thin audit row. The order console shows the text and citations on the same page.

Run: `order-explain`
Spec: `examples/sample-run/02-spec/feature-spec.md`
Product branch: `feature/order-explain`

Remote MR: not opened yet

## Acceptance criteria

- [ ] Support agent requests an explanation — `ExplanationServiceTest.dropsCitationsThatAreNotOnTheOrder`
- [ ] Empty event timeline — `ExplanationServiceTest.emptyTimelineSkipsGateway`
- [ ] Agent lacks ORDER_READ — `ExplanationControllerTest.forbiddenWhenMissingOrderRead`
- [ ] Unknown order — `ExplanationControllerTest.notFoundWhenOrderMissing`
- [ ] Question too long — `ExplanationControllerTest.badRequestWhenQuestionTooLong`
- [ ] Gateway timeout — `ExplanationServiceTest.timeoutDoesNotWriteSuccessfulAudit`
- [ ] Order is not mutated — `ExplanationServiceTest.doesNotCallOrderCommandPort`
- [ ] Order detail panel — `OrderExplainPanel.test.tsx`

## Test plan

- `./gradlew :order-api:test --tests com.example.order.explanation.*`
- `npm test -- OrderExplainPanel` in `order-console`
- CI: the product repo's existing pull-request checks on `order-api` and `order-console`
- Manual: a human with `ORDER_READ` opens an order in dev after deploy and confirms the panel stays on the page

## Deploy

- ECS: no new service. `order-api` and `order-console` stay on their current services.
- Config: `LLM_GATEWAY_URL` is already injected on the order-api task. No new secret and no image change for credentials.
- Dev: deploy-to-dev is optional and is a human step after merge, using the product pipeline. This agent does not deploy.
- Merge: a human reviews CI and merges. This agent does not merge. `gates.merge` stays `pending`.
