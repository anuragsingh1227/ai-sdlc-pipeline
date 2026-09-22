# React feature pattern

Example for an order-detail screen in the product's existing React app. Follow that app's data client, router, and test setup if they differ from this sketch.

## Shape

```text
src/orders/explain/
  OrderExplainPanel.tsx
  useOrderExplanation.ts
  OrderExplainPanel.test.tsx
```

The panel does not fetch by itself if the app already uses a hook layer. The hook calls the existing API client.

## States

| State | What the agent sees |
| --- | --- |
| Idle | Button `Explain this order` |
| Loading | Button disabled, status text `Explaining order` |
| Success | Explanation text and one element per citation event id |
| Empty | The API's empty copy, and no citation list |
| Error | The API error message, button enabled again |

Do not communicate state by color alone. Keep the panel on the order page. Do not navigate away.

## Sketch

```tsx
export function OrderExplainPanel({ orderId }: { orderId: string }) {
  const explanation = useOrderExplanation(orderId);

  return (
    <section aria-labelledby="order-explain-heading">
      <h2 id="order-explain-heading">Order explain</h2>
      <button
        type="button"
        onClick={() => explanation.request("Why is this order in its current state?")}
        disabled={explanation.status === "loading"}
      >
        Explain this order
      </button>
      {explanation.status === "loading" && <p role="status">Explaining order</p>}
      {explanation.status === "error" && <p role="alert">{explanation.message}</p>}
      {explanation.status === "ready" && (
        <>
          <p>{explanation.text}</p>
          <ul>
            {explanation.citations.map((citation) => (
              <li key={citation.eventId}>{citation.eventId}: {citation.summary}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

## Tests

Use the product's Testing Library setup. Cover idle, loading (button disabled), success with a citation, empty citations, and error. Mock the API client. Do not add a new design system.

## Out of the component

No customer email button, no order-status control, no free-form chat transcript. Those are out of scope unless the AC says otherwise.
