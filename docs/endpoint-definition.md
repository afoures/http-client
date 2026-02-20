# Endpoint Definition

The `Endpoint` class defines an HTTP endpoint with its method, path, serializers, and parsers.

## Constructor

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users/(:id)',
  // ...options
})
```

## Options

### `method` (required)

HTTP method for the endpoint:

```typescript
type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
```

- `GET` - Cannot have a body schema
- `POST`, `PUT`, `PATCH`, `DELETE` - Can have a body schema

### `pathname` (required)

URL path with optional dynamic segments:

```typescript
pathname: '/users'           // Static path
pathname: '/users/:id'       // Required param
pathname: '/users/(:id)'     // Optional param
pathname: '/posts/:id/comments/:commentId'  // Multiple params
```

### `params`

Serializer for path parameters. See [Serialization](./serialization.md#params).

### `query`

Serializer for query string parameters. See [Serialization](./serialization.md#query).

### `body`

Serializer for request body. See [Serialization](./serialization.md#body).

### `data`

Parser for successful response body. See [Response Parsing](./response-parsing.md#data).

### `error`

Parser for error response body. See [Response Parsing](./response-parsing.md#error).

## Constructor

The `Endpoint` constructor takes a definition and optional default options:

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users',
  // Definition: method, pathname, params, query, body, data, error
}, {
  headers: {
    'X-API-Version': '2',
  },
  timeout: 5000,
  retry: {
    attempts: 3,
    delay: 1000,
    when: ({ response }) => response?.status === 503,
  },
})
```

The second argument accepts:
- `headers`: Default headers for all requests
- `timeout`: Request timeout in milliseconds
- `retry`: Default retry policy

These can be overridden per-request.

See [Retry Policy](./retry-policy.md) for retry configuration.

## Low-level Methods

Most users should use `http_client` instead of calling these methods directly. The HTTP client handles URL generation, body serialization, and response parsing automatically.

### `generate_url(init)`

Generates a full URL with params and query serialized:

```typescript
const url = await endpoint.generate_url({
  origin: 'https://api.example.com',
  params: { id: '123' },
  query: { include: 'posts' },
})
```

Returns `URL` on success or `SerializationError` on validation failure.

### `serialize_body(init)`

Serializes the request body:

```typescript
const { body, content_type } = await endpoint.serialize_body({
  body: { name: 'John' },
})
```

Returns `{ body, content_type }` on success or `SerializationError` on validation failure.

### `parse_response(response)`

Parses an HTTP response:

```typescript
const result = await endpoint.parse_response(response)
```

Returns typed result based on status code. See [Response Parsing](./response-parsing.md).
