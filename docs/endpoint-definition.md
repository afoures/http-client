# Endpoint Definition

The `Endpoint` class defines an HTTP endpoint with its route, serializers, and parsers. It takes
three arguments: the route, the definition, and default options.

```typescript
const endpoint = new Endpoint(
  { method: "GET", pathname: "/users/:id" }, // route
  {
    // definition: params, query, body, responses
  },
  {
    // options: headers, timeout, retry, context, and any other `RequestInit` key
  },
);
```

The second and third arguments are optional. An endpoint with no definition validates nothing, sends
no body, and yields `null` data for a 2xx and the raw text for a 4xx or 5xx.

## Route

### `method` (required)

HTTP method for the endpoint:

```typescript
type HTTPMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "QUERY";
```

- `GET` - Cannot have a body schema
- `POST`, `PUT`, `PATCH`, `DELETE`, `QUERY` - Can have a body schema

### `pathname` (required)

URL path with optional dynamic segments:

```typescript
pathname: "/users"; // Static path
pathname: "/users/:id"; // Required param
pathname: "/users/(:id)"; // Optional param
pathname: "/users(/:id)"; // Optional param, dropping the separator with it
pathname: "/posts/:id/comments/:commentId"; // Multiple params
pathname: "/v:major.:minor/users"; // Multiple params in one segment
pathname: "/blog/:year-:month-:day/:slug"; // Params separated by any non-identifier character
```

A param name starts with a letter, `_` or `$`, and continues with those plus digits. The name ends
at the first character outside that set, which is what lets several params share a segment.

Param values are percent-encoded, so a value can never add a path segment or start a query string.
The two values percent-encoding leaves alone, `"."` and `".."`, are rejected instead, since URL
resolution would collapse them into the parent segment. An empty string is rejected too. All three
come back as a `SerializationError` from the call (see [Error Handling](./error-handling.md)).

A param inside an optional group may be `undefined` or `null`, which drops the whole group. The key
itself stays required in the `params` type, with `undefined` allowed as its value, so pass it through
unconditionally rather than omitting it:

```typescript
const endpoint = new Endpoint({ method: "GET", pathname: "/users(/:id)" });

await endpoint.generate_url({ base_url, params: { id: undefined } }); // /users
await endpoint.generate_url({ base_url, params: { id: "1" } }); // /users/1
```

The pattern describes a pathname only. A `?` or `#` is rejected, both at the type level and when the
pattern is compiled - declare search params with [`query`](#query) instead. A malformed pattern (a
`:` with no name after it, or unbalanced parentheses) makes the constructor throw a `PathnameError`,
because the pattern is code rather than call input.

## Definition

The second argument holds the serializers and parsers. Pass a plain object, or a
`(context) => definition` factory when the definition depends on the per-call context (see
[Dynamic Context](./dynamic-context.md)).

### `params`

Serializer for path parameters. See [Serialization](./serialization.md#params).

### `query`

Serializer for query string parameters. See [Serialization](./serialization.md#query).

### `body`

Serializer for request body. See [Serialization](./serialization.md#body).

### `responses`

A map of response parsers keyed by status code. Keys can be a specific status
(`200`, `201`, `404`, `500`, …) or a class wildcard (`"2xx"`, `"4xx"`, `"5xx"`),
and each value is a `{ schema, parse }` parser. A specific status takes
precedence over its wildcard. See [Response Parsing](./response-parsing.md).

```typescript
responses: {
  200: { schema: z.object({ id: z.string() }), parse: "json" },
  "4xx": { schema: z.object({ message: z.string() }), parse: "json" },
}
```

## Options

The third argument holds default request options, plus the endpoint's default context values:

```typescript
const endpoint = new Endpoint(
  { method: "GET", pathname: "/users" },
  { responses: { 200: { schema: z.array(z.object({ id: z.string() })), parse: "json" } } },
  {
    headers: { accept: "application/json" },
    timeout: { total: 5000 },
    retry: { attempts: 2 },
  },
);
```

It accepts:

- `headers`: Default headers for all requests. See
  [Headers](./http-client.md#headers) for the merge rules.
- `timeout`: Request timeouts in milliseconds, as `{ total, attempt }` or a bare number (shorthand
  for `{ total }`)
- `retry`: Default retry policy
- `signal`, `credentials`, `cache`, `redirect`, `mode`, and every other `RequestInit` key except
  `body` and `method`, which the endpoint owns
- `context`: Endpoint-level default context values, which make those keys optional at the call site.
  Only accepted once the definition factory declares a context type, and only for keys that type
  declares. See [Dynamic Context](./dynamic-context.md).

These can be overridden per-request. `headers`, `timeout` and `retry` merge per key, so a default
that a call does not mention survives. `signal`s combine, so any one of them aborts the call.

See [Timeouts](./http-client.md#timeouts) and [Retry Policy](./retry-policy.md) for configuration.

## Public Members

An `Endpoint` exposes what it was built from:

- `method`: the HTTP method of the route.
- `options`: the default request options from the third argument, without `context`.
- `context_default`: the endpoint-level default context from the third argument (`{}` when none).
- `resolve_definition(context?)`: the normalized serializers and parsers for one call, running the
  definition factory with `context` if there is one. Returns an `UnexpectedError` as a value when
  the factory throws.

## Low-level Methods

Most users should use `http_client` instead of calling these methods directly. The HTTP client handles URL generation, body serialization, and response parsing automatically.

Each method takes an optional `context` argument, used to resolve a definition factory for that
call, and an optional trailing `resolved` argument, the result of `resolve_definition`. Pass
`resolved` to run the factory once and share its result across the three methods, which is what
`http_client` does. Without it, each method resolves the definition itself.

Because a definition factory is user code, all three can also return an `UnexpectedError` when it
throws.

All three return their failures as values, the same way a client call does, so peel them off with
`instanceof Error` before reading the result. That is what makes `url`, `body` or `status` reachable
at all.

### `generate_url(init, context?, resolved?)`

Generates a full URL with params and query serialized:

```typescript
const url = await endpoint.generate_url({
  base_url: "https://api.example.com",
  params: { id: "123" },
  query: { include: "posts" },
});
```

Returns `URL` on success, or `SerializationError` when `params` or `query` fail validation or
serialization, or when a param is missing, empty, `"."` or `".."` (its `cause` is then the
`PathnameError` or `MissingParamsError` describing it).

`base_url` follows standard URL resolution, so a path prefix needs a trailing slash to survive. See
[Base URL](./http-client.md#base-url).

### `serialize_body(init, context?, resolved?)`

Serializes the request body:

```typescript
const result = await endpoint.serialize_body({ body: { name: "John" } });
if (result instanceof Error) throw result;

result.body;
result.content_type;
```

Returns `{ body, content_type }` on success, or `SerializationError` on validation failure.
`content_type` is `undefined` when there is no body, and for a `FormData` or `URLSearchParams` body,
whose type the runtime derives itself (see [Content-Type](./serialization.md#content-type)).

### `parse_response(response, context?, resolved?)`

Parses an HTTP response:

```typescript
const result = await endpoint.parse_response(response);
```

Returns typed result based on status code. See [Response Parsing](./response-parsing.md).

The response you pass in is consumed: its body goes to the matching parser, so do not read it
yourself afterwards. Pass a `clone()` if you also need the raw body.
