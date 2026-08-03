- `timeout` is now the call deadline, not a per-attempt bound

  It used to bound each attempt, so `{ timeout: 5000, retry: { attempts: 4, delay: 1000 } }` could run for 23 seconds while the config said 5. It now covers the whole call: every attempt, every retry delay, and response parsing.

  ```ts
  await api.users.get({ timeout: 5000 }); // was 5s per attempt, now 5s for the call
  await api.users.get({ timeout: { attempt: 5000 } }); // the old behavior
  ```

  `timeout` accepts `{ total?, attempt? }` and merges per key, so a client-level `{ attempt: 2000 }` survives a per-call `{ total: 5000 }`. `total` is terminal, so an expiry never reaches the retry condition; `attempt` is retryable, which is the point of it. This also fixes an attempt timeout firing during the retry delay, and an abort during a delay surfacing as `UnexpectedError: Failed to check retry policy` instead of an `AbortedError` with `operation: "retry_delay"`.
