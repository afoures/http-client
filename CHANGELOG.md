# `http-client` changelog

This is the changelog for `http-client`.

## 0.6.0

### Breaking Changes

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

### Features

- Add out-of-band request `context` via `define_context`.

  Declare an endpoint's `context` type with `define_context<T>()` and pass a matching
  `context` object per call. Unlike `params`/`query`/`body`, context is never serialized into
  the request; it is threaded into schema factories and into custom `serialize`/`parse`
  functions so those can adapt to per-call data (locale, timezone, feature flags, ...).

  ```typescript
  import { Endpoint, define_context } from "@afoures/http-client";

  const get_user = new Endpoint({
    method: "GET",
    pathname: "/users/:id",
    context: define_context<{ locale: string }>(),
    responses: { 200: { schema: (ctx) => user_schema(ctx.locale), parse: "json" } },
  });

  await api.get_user({ params: { id: "1" }, context: { locale: "en" } });
  ```

  The declared type is the single source of truth: `context` is required at the call site
  unless every key is supplied by a default, and endpoints that declare no context have no
  `context` field at all.

- Allow a slot's `schema` to be a factory of the per-call context.

  `params`, `query`, `body`, and each `responses` entry now accept either a schema or a
  `(context) => schema` function, so the schema used to validate a request or response can
  depend on the per-call context.

  ```typescript
  new Endpoint({
    method: "POST",
    pathname: "/items",
    context: define_context<{ max_len: number }>(),
    body: {
      schema: (ctx) => z.object({ name: z.string().max(ctx.max_len) }),
      serialize: "json",
    },
  });
  ```

- Pass the per-call context to custom `serialize` and `parse` functions.

  Custom `serialize` (params/query/body) and `parse` (responses) functions now receive the
  resolved context as a second argument, alongside the validated data/body.

  ```typescript
  body: {
    schema: my_schema,
    serialize: (data, ctx) => ({
      body: encode(data, ctx.key),
      content_type: "application/octet-stream",
    }),
  }
  ```

  The schema-driven narrowing is preserved: `params`/`query` `serialize` stays required when the
  schema output can't be encoded by the default, `body.serialize` stays required, and `parse`
  still forces `"text"` for string schemas and `"json"` otherwise.

- Add endpoint-level context defaults via `.with_defaults(...)`.

  Chain `.with_defaults({ ... })` on `define_context` to supply default values for some
  context keys. Any defaulted key becomes optional at the call site; if every key has a
  default, the `context` argument itself becomes optional.

  ```typescript
  context: (define_context<{ tz: string; locale: string }>().with_defaults({ tz: "UTC" }),
    // caller may now omit `tz`
    await api.get_user({ params: { id: "1" }, context: { locale: "en" } }));
  ```

  Context layers merge in order (later wins): client-level → endpoint defaults → per-call.
  `undefined` values are skipped, so a partial per-call context never clobbers a default.

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

- Add `$infer.Context` to extract an endpoint's per-call context type.

  Like the other `$infer.*` helpers it accepts either an `Endpoint` instance or a bound fetch
  function, and resolves to the `context` argument type (never present when the endpoint
  declares no context).

  ```typescript
  type Ctx = $infer.Context<typeof api.get_user>;
  ```

- Allow `options` in the client config to be a static object.

  The `options` client config field previously required a (sync or async) factory function.
  It now also accepts a plain object for the common case of fixed default request options.

  ```typescript
  http_client(endpoints, {
    base_url: "https://api.example.com",
    options: { headers: { "x-app": "web" } },
  });
  ```

- Add a `recover` step to the retry policy for rewriting requests between attempts.

  The retry policy now accepts a `recover` callback that overrides request headers before the
  next attempt, for example to refresh an expired auth token or recompute a per-attempt
  signature. It runs once a retry has been decided (after `when` passes and while attempts
  remain), after any `delay`, and immediately before the next attempt. Returned headers replace
  the current set (no merge); `current.headers` is passed as a copy to start from. Available at
  the client, endpoint, and per-call layers with the same last-wins resolution as the other
  retry keys.

  ```typescript
  const result = await api.users.get({
    params: { id: "123" },
    headers: { authorization: "Bearer stale" },
    retry: {
      attempts: 2,
      when: ({ response }) => response?.status === 401,
      recover: async () => ({
        headers: { authorization: `Bearer ${await refresh_token()}` },
      }),
    },
  });
  ```

## 0.5.1

### Bug Fixes

- Fix `TS2883` "inferred type cannot be named" errors in consumers that emit declarations.

  The `fetch_endpoint` input type was wrapped in `Pretty<>`, which eagerly flattened the request-init intersection and inlined the members of `HTTPFetch.OptionalRequestInit` (the internal `MaybePromise` helper) and `HTTPFetch.DefaultRequestInit` (`RequestInit`'s `Dispatcher`/`ReferrerPolicy`/`RequestCache`/… members from `undici-types`). Those inlined members aren't portably nameable from a consumer's `.d.ts`. Dropping `Pretty` keeps them as named references, so the generated declarations stay portable.

## 0.5.0

### Features

- Replace the separate `data` and `error` parser definitions with a single `responses` map keyed by HTTP status code.

  Each key is a status code (or a `2xx`/`4xx`/`5xx` wildcard) and each value is a `{ schema, parse }` parser. Parsed bodies are typed per status (landing on `data` for `2xx` responses and `error` for `4xx`/`5xx` responses), so `parse_response` returns a discriminated union you narrow on `ok` and `status`.

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

  `endpoints` was constrained with `EndpointMap` directly, which contextually widened inline `new Endpoint({...})` generics, collapsing every schema to `Schema.Any` and forcing a spurious `params: any`. The tree is now validated with a homomorphic mapped type, so inline endpoints keep their own inferred `pathname`, schema, and `responses` types.

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
