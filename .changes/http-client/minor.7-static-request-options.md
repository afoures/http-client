- Allow `options` in the client config to be a static object.

  The `options` client config field previously required a (sync or async) factory function.
  It now also accepts a plain object for the common case of fixed default request options.

  ```typescript
  http_client(endpoints, {
    base_url: "https://api.example.com",
    options: { headers: { "x-app": "web" } },
  });
  ```
