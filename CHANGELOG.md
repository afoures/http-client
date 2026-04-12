# `http-client` changelog

This is the changelog for `http-client`.

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
  const result = await api.users.get({ params: { id: '123' }, timeout: 5000 })
  
  if (result instanceof TimeoutError) {
    console.log(result.kind)  // "TimeoutError"
    console.log(result.context.operation)  // "fetch"
  }
  ```

- The `Endpoint` class defines HTTP endpoints with full type safety.
  
  ```typescript
  const endpoint = new Endpoint({
    method: 'GET',
    pathname: '/users/(:id)',
    params: { schema: z.object({ id: z.string() }) },
    query: { schema: z.object({ include: z.string().optional() }) },
    body: { schema: z.object({ name: z.string() }) },
    data: { schema: z.object({ id: z.string(), name: z.string() }) },
    error: { schema: z.object({ message: z.string() }) },
  })
  ```
  
  Supports path parameters, query strings, request bodies, and response parsing via Standard Schema validators.
  
  Endpoint-level options for headers, timeout, and retry:
  
  ```typescript
  new Endpoint(definition, {
    headers: { 'X-API-Version': '2' },
    timeout: 5000,
    retry: { attempts: 3, delay: 1000 },
  })
  ```

- The `http_client` function creates a typed API client from endpoint definitions.
  
  ```typescript
  const api = http_client({
    origin: 'https://api.example.com',
    endpoints: {
      users: {
        list: new Endpoint({ method: 'GET', pathname: '/users' }),
        get: new Endpoint({ method: 'GET', pathname: '/users/(:id)' }),
        create: new Endpoint({ method: 'POST', pathname: '/users' }),
      },
    },
  })
  
  await api.users.list({})
  await api.users.get({ params: { id: '123' } })
  ```
  
  Supports nested endpoints, shared options, custom fetch, and per-request overrides for timeout, retry, headers, and signal.

- Configurable automatic retries for failed requests.
  
  ```typescript
  const result = await api.users.get({
    params: { id: '123' },
    retry: {
      attempts: 3,
      delay: 1000,
      when: ({ response, error }) => response?.status >= 500,
    },
  })
  ```
  
  Supports exponential backoff via delay functions, dynamic attempts, conditional retry, and endpoint-level defaults. Retries respect AbortSignal.

- Built-in timeout support with AbortSignal integration.
  
  ```typescript
  const result = await api.users.get({
    params: { id: '123' },
    timeout: 5000,
  })
  
  if (result instanceof TimeoutError) {
    console.log(result.kind)  // "TimeoutError"
  }
  ```
  
  Timeouts work alongside existing AbortSignal and can be set at endpoint level or per-request.
