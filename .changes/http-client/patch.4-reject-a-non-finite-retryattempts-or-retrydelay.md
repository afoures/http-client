- Reject a non-finite `retry.attempts` or `retry.delay`

  Both keys are now floored and clamped to `0` and required to be finite, the same rule `timeout` already followed. `NaN` and `Infinity`, from a literal or from a callback, come back as an `UnexpectedError` naming the key with `context.operation === "retry_policy"`.

  A `NaN` was the one that mattered: every comparison against it is `false`, so it never tripped the exhaustion guard and the call retried until the deadline stopped it, or forever without one. Spell unbounded retry as `attempts: Number.MAX_SAFE_INTEGER` paired with a `timeout.total`.
