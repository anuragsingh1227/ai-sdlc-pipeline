# Java Spring endpoint pattern

Example for a product repo that already runs a Spring Boot service on ECS. Adapt package names to that repo. If the repo already has a controller style, follow the repo and ignore this file.

This is not a compilable module. It shows the shape an implementer copies.

## Shape

```text
com.example.order.explanation/
  ExplanationController.java      HTTP only
  ExplanationService.java         use case
  ExplanationRequest.java         record, validated
  ExplanationResponse.java        record, no persistence types
  ExplanationAudit.java           what we store
  ExplanationServiceTest.java
  ExplanationControllerTest.java
```

The controller depends on the service. The service depends on existing ports (`OrderEventPort`, `LlmGatewayPort`, `ExplanationAuditPort`). Do not return a JPA entity from the controller.

## Controller sketch

```java
@RestController
@RequestMapping("/api/orders/{orderId}/explanations")
public class ExplanationController {

    private final ExplanationService explanations;

    public ExplanationController(ExplanationService explanations) {
        this.explanations = explanations;
    }

    @PostMapping
    @PreAuthorize("hasAuthority('ORDER_READ')")
    public ExplanationResponse create(
            @PathVariable long orderId,
            @Valid @RequestBody ExplanationRequest request,
            @AuthenticationPrincipal AgentPrincipal agent) {
        return explanations.explain(orderId, request.question(), agent.id());
    }
}
```

```java
public record ExplanationRequest(
        @Size(max = 500) String question) {
}

public record ExplanationResponse(
        String explanationId,
        String text,
        List<Citation> citations) {
    public record Citation(String eventId, String summary) {}
}
```

## Service rules

- Load events through the existing order port. If the order does not exist, throw the product's not-found error (HTTP 404).
- If there are no events, return the spec's empty copy and an empty citation list. Do not call the model.
- Call the model only with event ids and text the port returned. Drop any citation whose event id is not in that set.
- Write an audit row with agent id, order id, and explanation id. Do not write a new customer address or a new order status.
- Map a gateway timeout to the product's gateway-timeout error. Do not catch and return a 200 with a guessed explanation.

## Test sketch

```java
@Test
void rejectsCitationsThatAreNotOnTheOrder() {
    when(orders.events(1001L)).thenReturn(List.of(event("e-1")));
    when(gateway.complete(any())).thenReturn(new GatewayReply(
            "Delayed at the hub.", List.of("e-1", "e-other")));

    ExplanationResponse response = service.explain(1001L, "Why is this delayed?", "agent-7");

    assertThat(response.citations()).extracting(Citation::eventId).containsExactly("e-1");
}
```

Use JUnit 5 and AssertJ. Use MockMvc only for the HTTP mapping and auth. Do not boot a new Spring Cloud stack for one route.

## ECS

Add no service. If the gateway base URL is not already on the task, stop and ask a human to extend the existing task definition through the product's secret mechanism. Do not put the URL's credential in the image or in source.
