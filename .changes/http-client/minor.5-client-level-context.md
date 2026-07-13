- Add a client-level default `context` on `http_client`.

  The client config accepts a `context` object shared by every endpoint. It fills matching
  keys for any endpoint whose context type declares them, making those keys optional at the
  call site.

  ```typescript
  const api = http_client(endpoints, {
    base_url: "https://api.example.com",
    context: { locale: "en" },
  });
  ```

  The `context` option is typed as the merged shape of every endpoint's declared context, so
  the editor proposes valid keys and rejects unknown or mistyped ones.
