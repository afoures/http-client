- `HttpClientConfig` is now parameterized by the endpoint tree

  `HttpClientConfig<client_context>` became `HttpClientConfig<endpoints, default_context?>`, so the client-level `context` shape is derived from the endpoints instead of being restated by hand:

  ```ts
  const endpoints = { rooms };

  function create_my_client<const default_context extends ClientContext<typeof endpoints> = never>(
    config: HttpClientConfig<typeof endpoints, default_context>,
  ) {
    return http_client(endpoints, config);
  }
  ```

  The merged context shape is also exported as `ClientContext<endpoints>`, to constrain a wrapper's own context type parameter and keep the client-level defaults precise.

  `default_context` defaults to `never`: without it, a config declares no client-level defaults, so its `context` is rejected and every declared context key stays required at the call site. Thread the type parameter to record the defaults a caller actually passed, which is what makes those keys optional per call.
