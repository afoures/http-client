- Add `$infer.Context` to extract an endpoint's per-call context type.

  Like the other `$infer.*` helpers it accepts either an `Endpoint` instance or a bound fetch
  function, and resolves to the `context` argument type (never present when the endpoint
  declares no context).

  ```typescript
  type Ctx = $infer.Context<typeof api.get_user>;
  ```
