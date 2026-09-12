# Endpoint Definition

The `Endpoint` class defines an HTTP endpoint with its route, serializers, and parsers. It takes
three arguments: the route, the definition, and default options.

```typescript
const endpoint = new Endpoint(
  { method: "GET", pathname: "/users/:id" },
  {},
  {
    // params, query, body, responses
  },
);
```

## Route

### `method` (required)

HTTP method for the endpoint:

```typescript
type HTTPMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
```

- `GET` - Cannot have a body schema
- `POST`, `PUT`, `PATCH`, `DELETE` - Can have a body schema

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
A param inside an optional group may be `undefined` or `null`, which drops the whole group.

The pattern describes a pathname only. A `?` or `#` is rejected, both when the endpoint is defined
and when the pattern is compiled - declare search params with [`query`](#query) instead.

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
  {},
  {
    // params, query, body, responses
  },
);
```

It accepts:

- `headers`: Default headers for all requests
- `timeout`: Request timeouts in milliseconds, as `{ total, attempt }` or a bare number (shorthand
  for `{ total }`)
- `retry`: Default retry policy
- `context`: Endpoint-level default context values, which make those keys optional at the call site.
  Only accepted once the definition factory declares a context type. See
  [Dynamic Context](./dynamic-context.md).

These can be overridden per-request. `headers`, `timeout` and `retry` merge per key, so a default
that a call does not mention survives.

See [Timeouts](./http-client.md#timeouts) and [Retry Policy](./retry-policy.md) for configuration.

## Low-level Methods

Most users should use `http_client` instead of calling these methods directly. The HTTP client handles URL generation, body serialization, and response parsing automatically.

Each method takes an optional `context` argument, used to resolve a definition factory for that
call. `http_client` supplies it automatically from the merged per-call context, and resolves the
definition once per request rather than once per method.

Because a definition factory is user code, all three can also return an `UnexpectedError` when it
throws.

### `generate_url(init, context?)`

Generates a full URL with params and query serialized:

```typescript
const url = await endpoint.generate_url({
  base_url: "https://api.example.com",
  params: { id: "123" },
  query: { include: "posts" },
});
```

Returns `URL` on success, or `SerializationError` when `params` or `query` fail validation or
serialization, or when a param is missing, empty, `"."` or `".."`.

### `serialize_body(init, context?)`

Serializes the request body:

```typescript
const { body, content_type } = await endpoint.serialize_body({
  body: { name: "John" },
});
```

Returns `{ body, content_type }` on success, or `SerializationError` on validation failure.

### `parse_response(response, context?)`

Parses an HTTP response:

```typescript
const result = await endpoint.parse_response(response);
```

Returns typed result based on status code. See [Response Parsing](./response-parsing.md).

The response you pass in is consumed: its body goes to the matching parser, so do not read it
yourself afterwards. Pass a `clone()` if you also need the raw body.
