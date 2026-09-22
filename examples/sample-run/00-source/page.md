# Order explain

Source: https://example.atlassian.net/wiki/spaces/OPS/pages/1042/Order-explain
Space: OPS
Page id: 1042

## Intent

Support agents spend several minutes reconstructing why an order is delayed, split across shipments, or stuck in payment review. They open the order, then the event timeline, then a spreadsheet of carrier codes.

Add an **Explain this order** action on the internal order detail screen. The action returns a short explanation grounded only in that order's events. Each factual claim cites an event id from the timeline we already store.

## Who

- Internal support agents who already have the `ORDER_READ` permission.
- Customers do not see this control and cannot call the API.

## Rules

- The explanation is generated server-side through the internal LLM gateway the order service already uses. No new model vendor.
- Responses should stay under 4 seconds at p95 for orders with a typical timeline (under 50 events).
- The service must not invent events. If the model cites an event id that is not on the order, drop that citation.
- If the order has no events, show a fixed sentence and no citations. Do not call the model.
- Record an audit row: agent id, order id, explanation id, and timestamp. Do not store a new copy of the customer address.
- The action must not change order status, events, refunds, or shipments.
- Question text, when the client sends it, is at most 500 characters.

## Not in this work

- No customer-facing chat and no email to the customer.
- No editing the order from the explanation panel.
- No multi-order comparison.
- No model fine-tuning and no new ECS service.
- No free-form multi-turn conversation. One request, one explanation.

## Resolved before build

Model choice is the existing internal LLM gateway. That question is closed.
