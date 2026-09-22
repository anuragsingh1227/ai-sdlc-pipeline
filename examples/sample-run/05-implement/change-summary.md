# Change summary: Order explain

Product repo: `../commerce-console`
Branch: `feature/order-explain`
Implementer session: impl-session-01

## Product repo changes

- `order-api/src/main/java/com/example/order/explanation/ExplanationController.java` — `POST /api/orders/{orderId}/explanations`, `ORDER_READ`, request record with `@Size(max = 500)`.
- `order-api/src/main/java/com/example/order/explanation/ExplanationService.java` — loads events, skips the gateway when empty, filters citations, writes the audit row, does not call the order command port.
- `order-api/src/main/java/com/example/order/explanation/ExplanationAudit.java` — agent id, order id, explanation id, timestamp. No address fields.
- `order-console/src/orders/explain/OrderExplainPanel.tsx` — button, status text, citation list. No navigation.
- `order-console/src/orders/explain/useOrderExplanation.ts` — calls the existing API client.
- `order-console/src/orders/detail/OrderDetailPage.tsx` — mounts the panel under the event timeline on the existing order route.
- `order-api/src/main/resources/application.yml` — no new property. `llm.gateway.url` already maps from `LLM_GATEWAY_URL`.
- `deploy/ecs/order-api-taskdef.json` — unchanged. Service `order-api`, same target group, container health check `GET /actuator/health`. No new secret and no new service.

The product repo is not this control plane. Paths above are the files the implementer would change in the commerce console.

## Tests

| Story | Test | Command |
| --- | --- | --- |
| Cited explanation | `ExplanationServiceTest.dropsCitationsThatAreNotOnTheOrder` | `./gradlew :order-api:test --tests com.example.order.explanation.ExplanationServiceTest` |
| Empty timeline | `ExplanationServiceTest.emptyTimelineSkipsGateway` | same |
| Missing ORDER_READ | `ExplanationControllerTest.forbiddenWhenMissingOrderRead` | same module |
| Unknown order | `ExplanationControllerTest.notFoundWhenOrderMissing` | same module |
| Question too long | `ExplanationControllerTest.badRequestWhenQuestionTooLong` | same module |
| Gateway timeout | `ExplanationServiceTest.timeoutDoesNotWriteSuccessfulAudit` | same module |
| No mutation | `ExplanationServiceTest.doesNotCallOrderCommandPort` | same module |
| Order detail panel | `OrderExplainPanel.test.tsx` covers idle, loading, success, empty | `npm test -- OrderExplainPanel` in `order-console` |

Result: both commands passed locally on 2026-09-22. This summary is the handoff. The product diff is on the branch above, not in this control-plane repo.

## Scope check

Implemented the eight stories in `04-jira/acceptance-criteria.md`.

Left out, because the AC does not ask for them:

- Email to the customer
- Order status controls on the panel
- Multi-order comparison
- A new ECS service or a new model vendor
- Multi-turn chat history
