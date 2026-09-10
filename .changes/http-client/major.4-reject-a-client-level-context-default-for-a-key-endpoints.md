- Reject a client-level `context` default for a key endpoints declare with conflicting types

  `ClientContext` checks, per key, that every endpoint declaring it agrees on its type. A key two endpoints declare as `string` and `number` resolves to an `ErrorMessage` instead of `string | number`, so a client-level default for it fails to compile.

  ```ts
  // error: context key 'tenant' is declared with conflicting types across endpoints
  http_client(endpoints, { base_url: "https://api.example.com", context: { tenant: "acme" } });
  ```

  This was previously accepted and unsound: the default made `tenant` optional at every call site, including the one needing a `number`. The check fires on the value, not the tree, so the same endpoints are fine as long as no default is set for the conflicting key. Fix by aligning the type, or by using separate clients. Mutually assignable declarations stay valid.
