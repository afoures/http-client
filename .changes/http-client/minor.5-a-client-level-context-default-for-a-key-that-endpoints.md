- A client-level `context` default for a key that endpoints declare with conflicting types is now a compile error

  `ClientContext` checks, per key, that every endpoint declaring it agrees on its type. A key two endpoints declare as `string` and `number` resolves to an `ErrorMessage` instead of `string | number`, so supplying a client-level default for it fails to compile.

  ```ts
  const endpoints = {
    billing: new Endpoint({ context: define_context<{ tenant: string }>() /* ... */ }),
    metrics: new Endpoint({ context: define_context<{ tenant: number }>() /* ... */ }),
  };

  // error: context key 'tenant' is declared with conflicting types across endpoints
  http_client(endpoints, { base_url: "https://api.example.com", context: { tenant: "acme" } });
  ```

  Previously this was accepted and unsound: the default made `tenant` optional at every call site, including the one needing a `number`, so a string reached a schema factory expecting a number. The check fires on the value, not the tree: the same endpoints are fine as long as no client-level default is set for the conflicting key. Fix by aligning the type in every endpoint that declares the key, or by using separate clients. Mutually assignable declarations stay valid, so `boolean` on both sides and a single endpoint's `string | number` are unaffected.