# Brief: Order explain

Source: https://example.atlassian.net/wiki/spaces/OPS/pages/1042/Order-explain
Export: `runs/order-explain/00-source/page.md`
Captured: 2026-09-22

## Goals

- Let a support agent understand why an order is delayed, split, or in payment review without reconstructing the timeline by hand.
- Return a short explanation grounded only in that order's existing events, with an event id on each factual claim.
- Leave order status, events, refunds, and shipments unchanged.

## Users

- Internal support agents who already have `ORDER_READ`.
- Customers are not users. They must not see the control or call the API.

## Constraints

- Server-side calls go through the internal LLM gateway the order service already uses. No new vendor.
- p95 under 4 seconds for timelines shorter than 50 events.
- Drop any citation whose event id is not on the order.
- Orders with no events return a fixed sentence and do not call the model.
- Audit row stores agent id, order id, explanation id, and timestamp. Do not store a new copy of the customer address.
- Optional question text is at most 500 characters.
- The product stays on the current ECS service. Java order API and React order console.

## Out of scope

- Customer-facing chat and email to the customer.
- Editing the order from the explanation panel.
- Multi-order comparison.
- Model fine-tuning and a new ECS service.
- Free-form multi-turn conversation.

## Open questions

None. Model choice was closed on the page: use the existing internal LLM gateway.
