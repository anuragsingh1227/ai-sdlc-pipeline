# Code review: Order explain

Session: review-session-01
Implementer session on the summary: impl-session-01
Diff: `commerce-console` branch `feature/order-explain`

## Verdict

approve

## Findings

None.

Story check against the diff and tests named in the change summary:

- Cited explanation: `ExplanationService` filters gateway citations to the order event ids before building the response. The unit test supplies an extra id and expects only `e-1`.
- Empty timeline: the service returns the fixed sentence and does not call `LlmGatewayPort` when the event list is empty.
- Missing `ORDER_READ`: controller test expects 403. The service mock is never invoked.
- Unknown order: controller test expects 404 from the existing not-found error.
- Question length: `@Size(max = 500)` plus a MockMvc test for 400.
- Timeout: gateway timeout maps to the existing 504 error, and the audit port has no successful write.
- No mutation: the service constructor does not take the order command port. The test verifies that port's mock is unused.
- Panel: Testing Library test disables the button while loading and renders citation event ids. The component has no route change and no email control.

I could not re-run Gradle in this session. The test names and assertions are present in the diff. A human can re-run the commands in the change summary before merge.

## Edge cases

- Empty event list: covered. Model is not called.
- Empty question: request field is optional. Service uses the default prompt only after events are loaded. Covered by `ExplanationServiceTest.omittedQuestionStillCitesOrderEvents`.
- Question of 500 characters: accepted. 501 characters: 400. Both are in the controller test.
- Citation id not on the order: dropped. Covered.
- Duplicate click: the button is disabled while `status === "loading"`. Not a server idempotency key. Acceptable because the AC does not require deduplication, and the audit row is append-only.
- Auth missing: 403, gateway not called.
- Order missing: 404, gateway not called.
- Timeout: 504, no successful audit.
- Forbidden mutation: no write path to status, events, refunds, or shipments in the new package.
- Customer address: audit type has four fields and no address. Checked the entity.
