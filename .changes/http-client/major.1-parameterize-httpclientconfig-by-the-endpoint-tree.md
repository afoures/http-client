- Parameterize `HttpClientConfig` by the endpoint tree

  `HttpClientConfig<client_context>` became `HttpClientConfig<endpoints, default_context?>`, so the client-level `context` shape is derived from the endpoints instead of being restated by hand. The merged shape is exported as `ClientContext<endpoints>` to constrain a wrapper's own context type parameter.

  ```ts
  function create_my_client<const default_context extends ClientContext<typeof endpoints> = never>(
    config: HttpClientConfig<typeof endpoints, default_context>,
  ) {
    return http_client(endpoints, config);
  }
  ```

  `default_context` defaults to `never`: a config that does not thread it declares no client-level defaults, so its `context` is rejected and every declared context key stays required at the call site.
