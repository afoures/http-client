- Restructure the `http_client` signature and rename `HttpClientOptions` to `HttpClientConfig`.

  `http_client` now takes the endpoint map as its first positional argument and the client
  configuration (`base_url`, `options`, `context`, `fetch`) as a second argument. The single
  options object with an `endpoints` field is gone.

  ```typescript
  // Before
  const api = http_client({
    base_url: "https://api.example.com",
    endpoints: { users: new Endpoint({ method: "GET", pathname: "/users" }) },
  });

  // After
  const api = http_client(
    { users: new Endpoint({ method: "GET", pathname: "/users" }) },
    { base_url: "https://api.example.com" },
  );
  ```

  The exported `HttpClientOptions` type is renamed to `HttpClientConfig`; update any imports.
