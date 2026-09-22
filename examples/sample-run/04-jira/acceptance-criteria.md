# Acceptance criteria: Order explain

Spec: `runs/order-explain/02-spec/feature-spec.md`
Gate: `spec-approved` passed

## Stories

### Story: Support agent requests an explanation

Given a support agent with role ORDER_READ
And order 1001 has event e-1
When the agent requests an explanation for order 1001
Then the response is HTTP 200
And every citation event id belongs to order 1001

### Story: Empty event timeline

Given a support agent with role ORDER_READ
And order 1002 has no events
When the agent requests an explanation for order 1002
Then the response is HTTP 200
And the text is "No order events are available to explain."
And the citation list is empty
And the model gateway is not called

### Story: Agent lacks ORDER_READ

Given an agent without role ORDER_READ
When the agent requests an explanation for order 1001
Then the response is HTTP 403
And the model gateway is not called

### Story: Unknown order

Given a support agent with role ORDER_READ
And order 9999 does not exist
When the agent requests an explanation for order 9999
Then the response is HTTP 404
And the model gateway is not called

### Story: Question too long

Given a support agent with role ORDER_READ
When the agent submits a question longer than 500 characters
Then the response is HTTP 400
And the model gateway is not called

### Story: Gateway timeout

Given a support agent with role ORDER_READ
And order 1001 has events
And the model gateway times out
When the agent requests an explanation for order 1001
Then the response is HTTP 504
And no successful audit row is written

### Story: Order is not mutated

Given a support agent with role ORDER_READ
And order 1001 has events
When an explanation request for order 1001 succeeds
Then order status, events, refunds, and shipments are unchanged

### Story: Order detail panel

Given a support agent is viewing the order detail page for order 1001
When the agent activates Explain this order
Then the panel stays on the order page
And while the request is in flight the button is disabled and the status text is "Explaining order"
And a successful response shows the explanation text and each citation event id
