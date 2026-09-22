# Order explain on ECS

This is the product-shaped proof for the sample feature. The artifact chain that `pipeline validate` checks is [`examples/sample-run`](../sample-run/). Nothing here was deployed, and this repo does not contain the commerce console source.

Hypothetical product tree the implementer would touch:

```text
commerce-console/
  order-api/
    src/main/java/com/example/order/explanation/
      ExplanationController.java
      ExplanationService.java
      ExplanationAudit.java
    src/test/java/com/example/order/explanation/
      ExplanationServiceTest.java
      ExplanationControllerTest.java
    src/main/resources/application.yml
  order-console/
    src/orders/explain/OrderExplainPanel.tsx
    src/orders/explain/useOrderExplanation.ts
    src/orders/explain/OrderExplainPanel.test.tsx
    src/orders/detail/OrderDetailPage.tsx
  deploy/ecs/order-api-taskdef.json
```

Runtime shape:

- One existing ECS service, `order-api`, behind the current target group.
- Container health check stays `GET /actuator/health`.
- `LLM_GATEWAY_URL` is already on the task definition. No new secret and no new service.
- The React app is the existing `order-console` image. The panel is mounted on the order detail route.

A human still merges and, after that, chooses whether the product pipeline deploys to dev.
