- Rework retry and timeout semantics

  `timeout` is the deadline for the whole call, covering every attempt, every retry delay and
  response parsing, where it used to bound each attempt. `retry.attempts` counts retries rather
  than requests.

  ```ts
  await api.users.get({ timeout: 5000 }); // was 5s per attempt, now 5s for the call
  await api.users.get({ timeout: { attempt: 5000 } }); // the old behavior
  await api.users.get({ retry: { attempts: 3 } }); // was 3 requests at most, now 4
  ```

  `timeout` accepts `{ total?, attempt? }` and merges per key, and `ErrorContext.request.timeout`
  carries that object instead of a number. Only `undefined` disables it, so `0` means immediately.

  The default retry condition retries only transient failures (`NetworkError`, `TimeoutError`, 408,
  429 and 5xx) rather than every non-ok response, and `retry` merges per key, with `undefined`
  meaning "not set here". A non-finite `attempts`, `delay` or timeout is rejected instead of, in
  the case of `NaN`, retrying forever. This also fixes a retried body being held for the whole
  backoff, a zero-delay retry loop starving the event loop, and an abort during a delay surfacing
  as an `UnexpectedError`.