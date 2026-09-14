- Hold the retry deadline against a `fetch` that never yields

  Both timeouts are `AbortSignal.timeout`, so both are timers, and the microtask queue is drained before the event loop reaches the timer phase. A zero-delay retry loop against a `fetch` that resolves without real I/O (a test double, a cache layer, a service worker) therefore never let `timeout.total` fire, and the call spun with the event loop starved. The loop now yields a macrotask between attempts when the delay is `0`.
