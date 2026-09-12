- Make `timeout` the call deadline, not a per-attempt bound

  It used to bound each attempt, so `{ timeout: 5000, retry: { attempts: 4, delay: 1000 } }` could run for 23 seconds while the config said 5. It now covers the whole call: every attempt, every retry delay, and response parsing.

  ```ts
  await api.users.get({ timeout: 5000 }); // was 5s per attempt, now 5s for the call
  await api.users.get({ timeout: { attempt: 5000 } }); // the old behavior
  ```

  `timeout` accepts `{ total?, attempt? }` and merges per key, so a client-level `{ attempt: 2000 }` survives a per-call `{ total: 5000 }`. `total` is terminal, so an expiry never reaches the retry condition; `attempt` is retryable. `ErrorContext.request.timeout` carries that normalized config instead of a number, so `result.context.request?.timeout` reads `{ total: 5000 }` where it used to read `5000`.

  Only `undefined` disables the timeout now, so `{ total: 0 }` means immediately rather than never: a `TimeoutError` and zero attempts, which is what `timeout: { total: budget_remaining() }` needs on an exhausted budget. Both keys are also floored and clamped to `0`, so `1.5` and `-1` no longer throw a `RangeError` out of the call, and `NaN` and `Infinity` come back as an `UnexpectedError` with `operation: "resolve_timeout"` naming the key.

  This also fixes an attempt timeout firing during a retry delay, and an abort during a delay surfacing as `UnexpectedError: Failed to check retry policy` instead of an `AbortedError` with `operation: "retry_delay"`.

  Both bounds cover the body read. A `total` expiry while the body is being read is a `TimeoutError` with `operation: "parse_response"` (it used to surface as `UnexpectedError: Failed to parse response`), and an `attempt` expiry there is retried like any other attempt failure: the retry condition sees the `TimeoutError` as `error` and the metadata of the response whose body was lost as `response`. `attempt: 0` is an immediate expiry like `total: 0`, and never reaches `fetch`. An async client-level `options()` factory counts against `total`, since the deadline is measured from the start of the call rather than from the moment the options resolved.
