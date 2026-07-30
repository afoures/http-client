# Endpoint Definition

The `Endpoint` class defines an HTTP endpoint with its method, path, serializers, and parsers.

## Constructor

```typescript
const endpoint = new Endpoint({
  method: "GET",
  pathname: "/users/:id",
  // ...options
});
```

## Options

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

### `context`

Declares an out-of-band, per-call **context** used to build schemas dynamically. Created with
`define_context<T>()`; any slot's `schema` (and its `serialize` / `parse`) may then be a function
of it. See [Dynamic Context](./dynamic-context.md).

## Constructor

The `Endpoint` constructor takes a definition and optional default options:

```typescript
const endpoint = new Endpoint(
  {
    method: "GET",
    pathname: "/users",
    // Definition: method, pathname, params, query, body, responses
  },
  {
    headers: {
      "X-API-Version": "2",
    },
    timeout: 5000,
    retry: {
      attempts: 3,
      delay: 1000,
      when: ({ response }) => response?.status === 503,
    },
  },
);
```

The second argument accepts:

- `headers`: Default headers for all requests
- `timeout`: Request timeout in milliseconds
- `retry`: Default retry policy

These can be overridden per-request.

See [Retry Policy](./retry-policy.md) for retry configuration.

## Low-level Methods

Most users should use `http_client` instead of calling these methods directly. The HTTP client handles URL generation, body serialization, and response parsing automatically.

Each method takes an optional trailing `context` argument, forwarded to any schema factory and to
custom `serialize` / `parse` functions. `http_client` supplies it automatically from the merged
per-call context.

### `generate_url(init, context?)`

Generates a full URL with params and query serialized:

```typescript
const url = await endpoint.generate_url({
  base_url: "https://api.example.com",
  params: { id: "123" },
  query: { include: "posts" },
});
```

Returns `URL` on success or `SerializationError` on validation failure.

### `serialize_body(init, context?)`

Serializes the request body:

```typescript
const { body, content_type } = await endpoint.serialize_body({
  body: { name: "John" },
});
```

Returns `{ body, content_type }` on success or `SerializationError` on validation failure.

### `parse_response(response, context?)`

Parses an HTTP response:

```typescript
const result = await endpoint.parse_response(response);
```

Returns typed result based on status code. See [Response Parsing](./response-parsing.md).
