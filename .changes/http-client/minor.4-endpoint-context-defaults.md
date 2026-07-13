- Add endpoint-level context defaults via `.with_defaults(...)`.

  Chain `.with_defaults({ ... })` on `define_context` to supply default values for some
  context keys. Any defaulted key becomes optional at the call site; if every key has a
  default, the `context` argument itself becomes optional.

  ```typescript
  context: (define_context<{ tz: string; locale: string }>().with_defaults({ tz: "UTC" }),
    // caller may now omit `tz`
    await api.get_user({ params: { id: "1" }, context: { locale: "en" } }));
  ```

  Context layers merge in order (later wins): client-level → endpoint defaults → per-call.
  `undefined` values are skipped, so a partial per-call context never clobbers a default.
