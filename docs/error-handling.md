# Error Handling

The HTTP client provides typed errors for different failure scenarios. Every request failure is
**returned** as a value, never thrown, so a call result is either a response envelope or an error
instance.

The exceptions are construction time, where a mistake is in code rather than in call input, so it
surfaces once at startup instead of from every call:

- `http_client` throws a `TypeError` when `base_url` is not a parsable absolute URL.
- `new Endpoint(...)` throws a `PathnameError` when the pathname pattern is malformed: a `?` or `#`,
  a `:` with no param name after it, or unbalanced optional-group parentheses.

```typescript
http_client(endpoints, { base_url: "/api" });
// TypeError: Invalid base_url: /api. Expected an absolute URL parsable by `new URL()`.

new Endpoint({ method: "GET", pathname: "/users/(:id" });
// PathnameError: unmatched '('
```

`PathnameError` and its subclass `MissingParamsError` are exported from the package root. A call
never returns them directly: a param value that cannot produce a pathname (missing, empty, `"."` or
`".."`) is returned as a `SerializationError` whose `cause` is the pathname error.

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
  console.log(result.context.operation); // "fetch" | "retry_delay" | "parse_response"
}
```

The message tells the two bounds apart: a `total` expiry reads `Call deadline of 1000ms exceeded`,
an `attempt` expiry keeps the runtime's own `The operation was aborted due to timeout`. An expiry
that lands while the body is being read carries `operation: "parse_response"` and the response's
`status` and `headers` in `context.response`. See [Timeouts](./http-client.md#timeouts).

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

A path param that is missing, empty, `"."` or `".."` is a `SerializationError` too (with
`operation: "generate_url"`), since those values cannot produce a pathname. Its `cause` is then a
`MissingParamsError` (listing every missing name in `missing_params`) or a `PathnameError`.

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

Unexpected failure during request, including a definition factory or a retry callback throwing:

```typescript
const result = await api.users.get({ params: { id: "123" } });

if (result instanceof UnexpectedError) {
  console.log(result.kind); // "UnexpectedError"
  console.log(result.context.operation); // "resolve_definition" | "create_request" | etc.
}
```

It also covers a response no envelope describes: a `1xx` status comes back as an `UnexpectedError`
with `operation: "parse_response"`, as does a `status` of `0` (an opaque response in a browser).

`UnexpectedError` extends `Error` directly rather than `HttpClientError`, so that a broad
`instanceof HttpClientError` cannot swallow what is most likely a bug in your own callback.

## Checking Results

A call resolves to one of four response envelopes or one of six error instances. Every result is
read the same way: peel the errors off with a single `instanceof Error`, then narrow the envelopes
that remain.

```typescript
const result = await api.users.get({ params: { id: "123" } });

if (result instanceof Error) {
  console.error(result.message, result.context);
  return;
}

// `result` is now a response envelope: narrow it on `status` or on `ok`
```

`instanceof Error` is the single check that covers every failure. `UnexpectedError` extends `Error`
directly rather than `HttpClientError`, so `instanceof HttpClientError` is **not** a complete check.
Peeling first is also what makes `status` and `ok` reachable, since only the envelopes carry them.

The two ways to read the envelope are below. Narrow on `status` when the response schemas differ per
code, which is the common case and the reason responses are declared per status at all. Narrow on
`ok` when there is a single success shape and you only need to split success from failure.

### Narrowing on `status`

`status` narrows to the exact declared schema, so each branch sees one shape:

```typescript
// declared responses: 200, 201, 404
const result = await api.users.create({ body: { name: "Ada" } });

if (result instanceof Error) {
  console.error(result.message, result.context);
  return;
}

switch (result.status) {
  case 200:
    console.log("already existed", result.data.id);
    break;
  case 201:
    console.log("created at", result.data.created_at);
    break;
  case 404:
    console.warn(result.error.message);
    break;
  default:
    console.warn("unhandled response", result.status);
}
```

**Always keep the `default` branch.** A `status` chain is never exhaustive, because the status space
is open: any code the endpoint does not declare stays in the union, and so do `204` and every 3xx.
After handling `200`, `201` and `404` above, what remains is

```text
204 | RedirectMessage | undeclared 2xx | undeclared 4xx | ServerErrorResponse
```

so the compiler cannot tell you that you forgot a code the way it can for a `kind` switch. An
undeclared status carries its class fallback: the output of the `2xx` / `4xx` / `5xx` wildcard
parser when one is declared, otherwise `null` for a 2xx and the raw text for a 4xx or 5xx. That is
what `default` is there to handle.

Compare exact statuses. Relational comparisons such as `result.status >= 400` do not narrow a union
of numeric literals in TypeScript, so `result.error` stays inaccessible.

### Narrowing on `ok`

`ok` splits the envelopes in two, which is the shorter read when an endpoint declares one success
shape, or when the call site only needs to know whether it worked:

```typescript
// declared responses: 200, 404
const result = await api.users.get({ params: { id: "123" } });

if (result instanceof Error) {
  console.error(result.message, result.context);
  return;
}

if (result.ok) {
  console.log(result.data);
} else if (result.kind === "RedirectMessage") {
  // rare under the default `redirect: "follow"`, see Redirects in Response Parsing
  console.warn("unexpected redirect to", result.redirect_to);
} else {
  console.error(result.error); // ClientErrorResponse | ServerErrorResponse
}
```

The redirect arm needs its own branch because `ok: false` covers redirects as well as errors, so the
`else` of an `ok` check has no `error` field until the redirect is separated out. Narrowing on
`status` sidesteps this, since a `case 404` never sees a 3xx.

The trade-off is precision. `ok` only tells you the response was a 2xx, so `data` stays the union of
every success shape the endpoint declares. On the `create` endpoint above, the `ok` branch gives

```typescript
result.data; // { id: string; existing: true } | { id: string; created_at: string } | null
```

and no field is reachable without checking `status` anyway. `null` covers both an undeclared
2xx and `204`. Reach for `ok` when that union is a single type, and for `status` when it is not.

### Reacting to a Specific Error

Nest the checks inside the error branch when one kind needs its own handling:

```typescript
if (result instanceof Error) {
  if (result instanceof TimeoutError) {
    console.error("deadline exceeded after", result.context.timing?.duration, "ms");
  } else if (result instanceof SerializationError) {
    console.error("bad request input", result.cause);
  } else {
    console.error(result.message);
  }
  return;
}
```

`TimeoutError` and `NetworkError` do not mean "retry this". The default retry condition already
retries both, so by the time either reaches the caller the client has exhausted its attempts. See
[Retry Policy](./retry-policy.md) to change how many, or which failures qualify.

### Narrowing on `kind`

Every arm, response and error alike, also carries a `kind` literal named after its own type or class.
Reach for it when `instanceof` cannot be trusted: when the value may have been spread, cloned or
serialized, or when two copies of this package could end up installed. All of those break a prototype
check and leave `kind` intact.

```typescript
declare function assert_never(value: never): never;

switch (result.kind) {
  case "SuccessfulResponse":
    console.log(result.data);
    break;
  case "RedirectMessage":
    console.warn("unexpected redirect to", result.redirect_to);
    break;
  case "ClientErrorResponse":
  case "ServerErrorResponse":
    console.error(result.error);
    break;
  case "TimeoutError":
  case "AbortedError":
  case "NetworkError":
  case "SerializationError":
  case "ParseError":
  case "UnexpectedError":
    console.error(result.message, result.context);
    break;
  default:
    assert_never(result);
}
```

List the error kinds as real cases and keep `default` for the `(value: never) => never` call, as
above. Collapsing the errors into `default` compiles, but it spends the exhaustiveness check: a kind
added in a later release then falls into the error branch silently instead of failing the build.

Each `kind` is the name of the type or class it identifies, so the value tells you exactly what to
look up:

- Responses, exported as `HTTPFetch.ResponseKind`: `"SuccessfulResponse"`, `"RedirectMessage"`,
  `"ClientErrorResponse"`, `"ServerErrorResponse"`.
- Errors, exported as `ErrorKind`: `"TimeoutError"`, `"AbortedError"`, `"SerializationError"`,
  `"ParseError"`, `"NetworkError"`, `"UnexpectedError"`, plus `"HttpClientError"` for the base
  class, which a call never returns on its own (so the switch above need not list it).

For the error classes this matches `name`, which carries the same string. The difference is that
`name` is typed as `string` by `Error` and so cannot discriminate a union, whereas `kind` is a literal
type on each class.

## Error Context

All errors, `UnexpectedError` included, have a `context` property with the operation that failed:

```typescript
if (result instanceof Error) {
  result.context.operation;
  // "resolve_timeout" | "resolve_definition" | "generate_url" | "serialize_body" | "create_request"
  // | "fetch" | "retry_policy" | "retry_delay" | "recover" | "parse_response"
}
```

Roughly in the order a call runs through them, with the class each one comes back as:

| Operation            | Class                                                           | Failed at                                                                                                              |
| -------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `resolve_timeout`    | `UnexpectedError`                                               | reading `timeout`: a key was `NaN` or `Infinity`                                                                       |
| `resolve_definition` | `UnexpectedError`                                               | the definition factory threw                                                                                           |
| `generate_url`       | `SerializationError`                                            | validating or serializing `params` / `query`, or a param that is missing, empty, `.` or `..`                           |
| `serialize_body`     | `SerializationError`                                            | validating or serializing `body`                                                                                       |
| `create_request`     | `UnexpectedError`                                               | constructing the `Request` (a stream body re-sent by a retry lands here)                                               |
| `fetch`              | `NetworkError`, `TimeoutError`, `AbortedError`                  | the request itself: network failure, timeout, or abort                                                                 |
| `retry_policy`       | `UnexpectedError`                                               | a `when`, `attempts` or `delay` callback threw                                                                         |
| `retry_delay`        | `TimeoutError`, `AbortedError`                                  | the wait between attempts was cut short by a timeout or an abort                                                       |
| `recover`            | `UnexpectedError`                                               | a `recover` callback threw                                                                                             |
| `parse_response`     | `ParseError`, `TimeoutError`, `AbortedError`, `UnexpectedError` | decoding or validating the body, a timeout or abort while reading it, a `parse` function that threw, or a `1xx` status |

`context.request.timeout` carries the **normalized** `{ total?, attempt? }` the call actually ran
under, never the bare number a caller may have passed.

## Response Details

A failed response's details are on the result itself, and on `context.response` for an error:

```typescript
const result = await api.users.get({ params: { id: "123" } });

if (!(result instanceof Error) && !result.ok) {
  console.log(result.status, result.url, result.method);
  console.log(result.headers.get("x-request-id"));
}
```

`context.response.body` is filled in for the two failures where the body is the problem: the decoded
payload a schema rejected, and the raw text that was not valid JSON. Every other error reports
`status` and `headers` only. Reach for the body itself in your `parse` function, which is the one
place it is available (see [Reading the Body](./response-parsing.md#reading-the-body)).
