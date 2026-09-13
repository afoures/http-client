- Type a `204` as `data: null` even when a `2xx` wildcard parser is declared

  The success envelope's fallback arm claimed `204` alongside the other undeclared statuses, so `$infer.Data<typeof endpoint, 204>` read as the wildcard's output or `null`. A `204` has no body and always yields `null` at runtime; the type now says so.
