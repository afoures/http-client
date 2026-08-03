- `ErrorContext.request.timeout` is now a `TimeoutConfig`, not a number

  It carries the normalized `{ total?, attempt? }` the call ran under, so `result.context.request?.timeout` reads `{ total: 5000 }` where it used to read `5000`. Breaking for anyone reading it as a number.
