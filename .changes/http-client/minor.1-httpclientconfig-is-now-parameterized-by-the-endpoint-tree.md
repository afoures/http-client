- `HttpClientConfig` is now parameterized by the endpoint tree

  `HttpClientConfig<client_context>` became `HttpClientConfig<endpoints, default_context?>`, so the client-level `context` shape is derived from the endpoints instead of being restated by hand:

  ```ts
  const endpoints = { rooms };
  export type MyClientConfig = HttpClientConfig<typeof endpoints>;
  ```

  The merged context shape is also exported as `ClientContext<endpoints>`, to constrain a wrapper's own context type parameter and keep the client-level defaults precise.
