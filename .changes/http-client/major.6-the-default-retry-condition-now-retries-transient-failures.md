- The default retry condition now retries transient failures instead of every non-ok response.

  ```typescript
  // before: ({ response }) => response?.ok === false
  // after:  retry NetworkError / TimeoutError, and 408, 429, 5xx
  ```

  The old default was inverted: a network error or timeout left `response` undefined and was never retried, while a `400` was retried until attempts ran out. The new default retries `NetworkError` and `TimeoutError`, plus `408`, `429` and every `5xx`. It no longer retries other `4xx` responses, `3xx` responses read under `redirect: "manual"`, aborts, or an `UnexpectedError` thrown by your own callback. `default_retry_condition` is exported so you can compose with it, and it is deliberately not method-aware: an explicit `retry` on a `POST` is honored, so guard non-idempotent calls yourself with `when: (ctx) => ctx.request.method !== "POST" && default_retry_condition(ctx)`.