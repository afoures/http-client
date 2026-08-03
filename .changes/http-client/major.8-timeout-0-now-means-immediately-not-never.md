- `timeout: 0` now means immediately, not never

  A truthy gate made `0` disable the timeout, which was an oversight. Only `undefined` disables it now, so `{ total: 0 }` gives a `TimeoutError` and zero attempts. That is the reading a call deadline needs: people write `timeout: { total: budget_remaining() }`, and an exhausted budget must fail fast.

  Both keys are also floored and clamped to `0`, so `1.5` and `-1` no longer throw a `RangeError` out of the call. `NaN` and `Infinity` come back as an `UnexpectedError` with `operation: "resolve_timeout"` naming the key.
