# Error Handling

The HTTP client provides typed errors for different failure scenarios. Every request failure is
**returned** as a value, never thrown, so a call result is either a response envelope or an error
instance.

The single exception is client construction: `http_client` throws a `TypeError` when `base_url` is
not a parsable absolute URL. That is a static misconfiguration rather than a request outcome, so it
surfaces once at startup instead of from every call.

```typescript
http_client(endpoints, { base_url: "/api" });
// TypeError: Invalid base_url: /api. Expected an absolute URL parsable by `new URL()`.
```

## Error Types

### `HttpClientError`

Base class for all HTTP client errors:

```typescript
if (error instanceof HttpClientError) {
  console.log(error.kind); // "HttpClientError"
  console.log(error.message); // Error message
  console.log(error.context); // { operation: string }
}
```

### `TimeoutError`

Request exceeded the timeout:

```typescript
const result = await api.users.get({ params: { id: "123" }, timeout: 1000 });

if (result instanceof TimeoutError) {
  console.log(result.kind); // "TimeoutError"
  console.log(result.context.operation); // "fetch" | "retry_delay"
}
```

The message tells the two bounds apart: a `total` expiry reads `Call deadline of 1000ms exceeded`,
an `attempt` expiry keeps the runtime's own `The operation was aborted due to timeout`. See
[Timeouts](./http-client.md#timeouts).

### `AbortedError`

Request was aborted via `AbortSignal`:

```typescript
const controller = new AbortController();
const result = await api.users.get({
  params: { id: "123" },
  signal: controller.signal,
});

if (result instanceof AbortedError) {
  console.log(result.kind); // "AbortedError"
}
```

### `NetworkError`

Network-level failure (no response received):

```typescript
const result = await api.users.get({ params: { id: "123" } });

if (result instanceof NetworkError) {
  console.log(result.kind); // "NetworkError"
  console.log(result.cause); // Underlying error
}
```

### `SerializationError`

Failed to serialize params, query, or body:

```typescript
const result = await api.users.create({
  body: { name: "" }, // Fails validation
});

if (result instanceof SerializationError) {
  console.log(result.kind); // "SerializationError"
  console.log(result.context.operation); // "serialize_body" | "generate_url"
  console.log(result.cause); // Schema validation issues
}
```

### `ParseError`

Failed to parse response:

```typescript
const result = await api.users.get({ params: { id: "123" } });

if (result instanceof ParseError) {
  console.log(result.kind); // "ParseError"
  console.log(result.cause); // Schema validation issues
}
```

### `UnexpectedError`

Unexpected failure during request:

```typescript
const result = await api.users.get({ params: { id: "123" } });

if (result instanceof UnexpectedError) {
  console.log(result.kind); // "UnexpectedError"
  console.log(result.context.operation); // "create_request" | "parse_response" | etc.
}
```

## Checking Results

A call resolves to one of four response envelopes or one of seven error instances. There are two
ways to tell them apart.

### Kind Check

Every arm, response and error alike, carries a `kind` literal, so the whole union narrows in one flat
`switch` with no `instanceof` and no value import:

```typescript
const result = await api.users.get({ params: { id: "123" } });

switch (result.kind) {
  case "SuccessfulResponse":
    console.log(result.data);
    break;
  case "RedirectMessage":
    // rare under the default `redirect: "follow"`, see Response Parsing
    console.warn("unexpected redirect to", result.redirect_to);
    break;
  case "ClientErrorResponse":
  case "ServerErrorResponse":
    show(result.error);
    break;
  case "TimeoutError":
  case "NetworkError":
    retry();
    break;
  case "AbortedError":
    break;
  case "SerializationError":
  case "ParseError":
  case "UnexpectedError":
    report(result.context);
    break;
}
```

Add a `default` branch calling a `(value: never) => never` helper and the compiler will tell you when
an arm is unhandled.

Prefer `kind` when the value may have been spread, cloned or serialized, or when two copies of this
package could end up installed. All of those break `instanceof` and leave `kind` intact.

Each `kind` is the name of the type or class it identifies, so the value tells you exactly what to
look up:

- Responses, exported as `HTTPFetch.ResponseKind`: `"SuccessfulResponse"`, `"RedirectMessage"`,
  `"ClientErrorResponse"`, `"ServerErrorResponse"`.
- Errors, exported as `ErrorKind`: `"HttpClientError"`, `"TimeoutError"`, `"AbortedError"`,
  `"SerializationError"`, `"ParseError"`, `"NetworkError"`, `"UnexpectedError"`.

For the error classes this matches `name`, which carries the same string. The difference is that
`name` is typed as `string` by `Error` and so cannot discriminate a union, whereas `kind` is a literal
type on each class.

### Instance Check

`instanceof Error` is the single check that covers every failure. Note that `UnexpectedError` extends
`Error` directly rather than `HttpClientError`, so it must be handled on its own:

```typescript
const result = await api.users.get({ params: { id: "123" } });

if (result instanceof Error) {
  // Handle all error types
  if (result instanceof TimeoutError) {
    // Retry or show timeout message
  } else if (result instanceof NetworkError) {
    // Show network error, maybe retry
  }
  return;
}

// Handle successful response
if (result.ok) {
  console.log(result.data);
}
```

Peeling the errors off first is also what makes `status` directly narrowable, since only the response
envelopes carry it:

```typescript
if (result instanceof Error) return;

if (result.status === 200) {
  result.data; // typed from the 200 schema
} else if (result.status === 404) {
  result.error; // typed from the 404 schema
}
```

Ranges do not narrow: `result.status >= 400` leaves the redirect arm in the union, so `result.error`
stays inaccessible. Compare exact statuses, or switch on `kind`.

## Error Context

All errors have a `context` property with the operation that failed:

```typescript
if (result instanceof HttpClientError) {
  result.context.operation;
  // "resolve_timeout" | "generate_url" | "serialize_body" | "create_request" | "fetch"
  // | "retry_policy" | "retry_delay" | "recover" | "parse_response"
}
```

Roughly in the order a call runs through them:

| Operation         | Failed at                                                        |
| ----------------- | ---------------------------------------------------------------- |
| `resolve_timeout` | reading `timeout`: a key was `NaN` or `Infinity`                 |
| `generate_url`    | validating or serializing `params` / `query`                     |
| `serialize_body`  | validating or serializing `body`                                 |
| `create_request`  | constructing the `Request`                                       |
| `fetch`           | the request itself: network failure, timeout, or abort           |
| `retry_policy`    | a `when`, `attempts` or `delay` callback threw                   |
| `retry_delay`     | the wait between attempts was cut short by a timeout or an abort |
| `recover`         | a `recover` callback threw                                       |
| `parse_response`  | reading or validating the response body                          |

`context.request.timeout` carries the **normalized** `{ total?, attempt? }` the call actually ran
under, never the bare number a caller may have passed.

## Raw Response

When available, the raw `Response` object is accessible:

```typescript
const result = await api.users.get({ params: { id: "123" } });

if (!result.ok && !(result instanceof Error)) {
  console.log(result.raw_response.status);
  console.log(result.raw_response.headers);
}
```
