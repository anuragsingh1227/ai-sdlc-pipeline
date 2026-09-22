# Spec: Order explain

Brief: `runs/order-explain/01-brief/brief.md`
Status: draft (critic approved in round 2)

## Problem

Support agents with `ORDER_READ` reconstruct delayed, split, or payment-review orders by reading the event timeline and a carrier-code spreadsheet. The brief asks for one grounded explanation on the order they already have open.

## Proposal

Add a single-shot explanation on the internal order detail screen. The order API loads that order's events, calls the existing LLM gateway only when events exist, drops citations that are not on the order, and writes a thin audit row. The React console shows the text and the citations. Nothing in the call changes the order.

## Behavior

### Request an explanation

- Actor: support agent with `ORDER_READ`.
- Trigger: one request for one order id, with an optional question of at most 500 characters.
- Result: HTTP 200 and a body with explanation id, text, and citations. Every citation event id is in the order's event list.
- Failure: missing `ORDER_READ` returns 403 and does not call the model. Unknown order returns 404 and does not call the model. Gateway timeout returns 504 and does not write a successful audit row.

### No events

- Actor: support agent with `ORDER_READ`.
- Trigger: explanation request for an order whose event list is empty.
- Result: HTTP 200, text exactly `No order events are available to explain.`, citations empty, model not called.
- Failure: not applicable. This is the success path for an empty timeline.

### No mutation

- Actor: any caller who receives a 200.
- Trigger: a successful explanation.
- Result: order status, event list, refunds, and shipments are unchanged.
- Failure: a bug if any of those change.

## API

`POST /api/orders/{orderId}/explanations`

Auth: existing `ORDER_READ` authority.

Request:

```json
{ "question": "Why is this order delayed?" }
```

`question` may be omitted. When present it is at most 500 characters.

Response 200:

```json
{
  "explanationId": "exp-1001-1",
  "text": "The shipment paused at the hub.",
  "citations": [{ "eventId": "e-1", "summary": "Hub scan missed the departure window." }]
}
```

Errors: 400 when the question is longer than 500 characters, 403 without `ORDER_READ`, 404 when the order does not exist, 504 when the gateway times out.

## UI

On the internal order detail page, a section titled Order explain.

- Idle: button `Explain this order`.
- Loading: button disabled, status text `Explaining order`.
- Success: explanation text and one list item per citation (`eventId` and summary).
- Empty: the fixed no-events sentence and no citation list.
- Error: the API error text, button enabled again.

The panel does not navigate away and does not offer email or status edits.

## Data

- Read order events from the existing order port. Send the model only those events.
- Write an audit record: agent id, order id, explanation id, timestamp. Do not persist the question's customer data beyond the agent, order, and explanation identifiers, and do not copy the customer address.
- Do not add a table for transcripts. One request, one stored audit row.

## Test plan

- Unit test: citations not on the order are removed before the response is returned.
- Unit test: empty event list skips the gateway and returns the fixed sentence.
- Web test: missing `ORDER_READ` is 403 and the gateway port is not called.
- Web test: unknown order is 404.
- Unit test: a successful call does not invoke the order command port that mutates status.
- UI test: loading disables the button; success renders citation event ids.

## Out of scope

- Customer-facing chat and email to the customer.
- Editing the order from the explanation panel.
- Multi-order comparison.
- Model fine-tuning and a new ECS service.
- Free-form multi-turn conversation.
- A new datastore for prompts or a new framework on the console.
