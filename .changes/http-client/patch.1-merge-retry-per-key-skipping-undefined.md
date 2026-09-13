- Inherit an earlier `retry` key when a later layer sets it to `undefined`

  `retry` is merged per key across the client, endpoint and call levels. A key set to `undefined` at a more specific level used to replace the earlier value, so a per-call `retry: { when: options?.when }` with the option absent silently reset a client-level `when` to the default condition. `undefined` now means "not set here", as it already did for `context`.
