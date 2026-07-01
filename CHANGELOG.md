# `http-client` changelog

This is the changelog for `http-client`.

## 0.5.1

### Bug Fixes

- Fix `TS2883` "inferred type cannot be named" errors in consumers that emit declarations.
  
  The `fetch_endpoint` input type was wrapped in `Pretty<>`, which eagerly flattened the request-init intersection and inlined the members of `HTTPFetch.OptionalRequestInit` (the internal `MaybePromise` helper) and `HTTPFetch.DefaultRequestInit` (`RequestInit`'s `Dispatcher`/`ReferrerPolicy`/`RequestCache`/… members from `undici-types`). Those inlined members aren't portably nameable from a consumer's `.d.ts`. Dropping `Pretty` keeps them as named references, so the generated declarations stay portable.

## 0.5.0

### Features

- Replace the separate `data` and `error` parser definitions with a single `responses` map keyed by HTTP status code.
  
  Each key is a status code (or a `2xx`/`4xx`/`5xx` wildcard) and each value is a `{ schema, parse }` parser. Parsed bodies are typed per status — landing on `data` for `2xx` responses and `error` for `4xx`/`5xx` responses — so `parse_response` returns a discriminated union you narrow on `ok` and `status`.
  
  ```typescript
  const endpoint = new Endpoint({
    method: "GET",
    pathname: "/users/(:id)",
    responses: {
      200: { schema: z.object({ id: z.string(), name: z.string() }), parse: "json" },
      404: { schema: z.object({ message: z.string() }), parse: "json" },
      "5xx": { schema: z.object({ message: z.string() }), parse: "json" },
    },
  });
  ```
  
  Per-status parser resolution falls back from an exact status to its class wildcard (`200` → `2xx`, `404` → `4xx`, `503` → `5xx`). Statuses with no matching parser default to raw text so the body is never lost; `204` always yields `null` data regardless of any parser.

- Expand the `$infer` namespace.
  
  - All `$infer.*` helpers now accept either an `Endpoint` instance or a bound fetch function.
  - `$infer.Data` and `$infer.Error` take an optional second `status` type parameter to extract the body for a specific status or status class, e.g. `$infer.Data<typeof endpoint, 200>`.
  - Add `$infer.Input` (the full request argument), `$infer.Result` (everything `fetch` can return, including transport errors), and `$infer.Response` (the HTTP response union only, narrowable on `ok`/`status`).

### Bug Fixes

- Fix inline endpoints losing their inferred types in `http_client`.
  
  `endpoints` was constrained with `EndpointMap` directly, which contextually widened inline `new Endpoint({...})` generics — collapsing every schema to `Schema.Any` and forcing a spurious `params: any`. The tree is now validated with a homomorphic mapped type, so inline endpoints keep their own inferred `pathname`, schema, and `responses` types.

## 0.4.0

### Features

- Add `$infer` namespace to infer `data`, `error`, `query`, `params`, `body` types from an http_client.

## 0.3.0

### Features

- Add `url` and `method` properties to `SuccessfulResponse`, `RedirectMessage`, `ClientErrorResponse` and `ServerErrorResponse`.

- Add request, response, timing and input context to errors returned by the `http_client`. It should help when investigating issues.

## 0.2.0

### Features

- Rename `serialization` to `serialize` on all serializer definitions and `deserialization` to `parse` on all parser definitions. `DeserializationError` has been renamed to `ParseError`.

  ```typescript
  // Before
  body: {
    schema: z.object({ name: z.string() }),
    serialization: 'json',
  }
  data: {
    schema: z.object({ id: z.string() }),
    deserialization: 'json',
  }

  // After
  body: {
    schema: z.object({ name: z.string() }),
    serialize: 'json',
  }
  data: {
    schema: z.object({ id: z.string() }),
    parse: 'json',
  }
  ```

- `serialize` is now required on body definitions and `parse` is now required on data and error parser definitions.

  Previously these were optional and defaulted to `"json"` when the schema type was JSON-compatible. You must now always explicitly specify the serialization/parse strategy.

  ```typescript
  body: {
    schema: z.object({ name: z.string() }),
    serialize: 'json', // was optional, now required
  }

  data: {
    schema: z.object({ id: z.string() }),
    parse: 'json', // was optional, now required
  }
  ```

## 0.1.1

### Bug Fixes

- Remove `/` prefix to computed pathname to allow for native URL relative pathname resolving.

  Also renamed `http_client` `origin` parameter to `base_url` to better match behavior.

## 0.1.0

### Features

- New error type hierarchy for better error handling:
  - `HttpClientError` - Base class for all HTTP client errors
  - `TimeoutError` - Request exceeded timeout
  - `AbortedError` - Request was aborted via AbortSignal
  - `NetworkError` - Network-level failure
  - `SerializationError` - Failed to serialize params, query, or body
  - `DeserializationError` - Failed to parse response body
  - `UnexpectedError` - Unexpected failure during request lifecycle

  All errors include a `context` property with the operation that failed.

  ```typescript
  const result = await api.users.get({ params: { id: "123" }, timeout: 5000 });

  if (result instanceof TimeoutError) {
    console.log(result.kind); // "TimeoutError"
    console.log(result.context.operation); // "fetch"
  }
  ```

- The `Endpoint` class defines HTTP endpoints with full type safety.

  ```typescript
  const endpoint = new Endpoint({
    method: "GET",
    pathname: "/users/(:id)",
    params: { schema: z.object({ id: z.string() }) },
    query: { schema: z.object({ include: z.string().optional() }) },
    body: { schema: z.object({ name: z.string() }) },
    data: { schema: z.object({ id: z.string(), name: z.string() }) },
    error: { schema: z.object({ message: z.string() }) },
  });
  ```

  Supports path parameters, query strings, request bodies, and response parsing via Standard Schema validators.

  Endpoint-level options for headers, timeout, and retry:

  ```typescript
  new Endpoint(definition, {
    headers: { "X-API-Version": "2" },
    timeout: 5000,
    retry: { attempts: 3, delay: 1000 },
  });
  ```

- The `http_client` function creates a typed API client from endpoint definitions.

  ```typescript
  const api = http_client({
    origin: "https://api.example.com",
    endpoints: {
      users: {
        list: new Endpoint({ method: "GET", pathname: "/users" }),
        get: new Endpoint({ method: "GET", pathname: "/users/(:id)" }),
        create: new Endpoint({ method: "POST", pathname: "/users" }),
      },
    },
  });

  await api.users.list({});
  await api.users.get({ params: { id: "123" } });
  ```

  Supports nested endpoints, shared options, custom fetch, and per-request overrides for timeout, retry, headers, and signal.

- Configurable automatic retries for failed requests.

  ```typescript
  const result = await api.users.get({
    params: { id: "123" },
    retry: {
      attempts: 3,
      delay: 1000,
      when: ({ response, error }) => response?.status >= 500,
    },
  });
  ```

  Supports exponential backoff via delay functions, dynamic attempts, conditional retry, and endpoint-level defaults. Retries respect AbortSignal.

- Built-in timeout support with AbortSignal integration.

  ```typescript
  const result = await api.users.get({
    params: { id: "123" },
    timeout: 5000,
  });

  if (result instanceof TimeoutError) {
    console.log(result.kind); // "TimeoutError"
  }
  ```

  Timeouts work alongside existing AbortSignal and can be set at endpoint level or per-request.
