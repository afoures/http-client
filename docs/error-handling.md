# Error Handling

The HTTP client provides typed errors for different failure scenarios.

## Error Types

### `HttpClientError`

Base class for all HTTP client errors:

```typescript
if (error instanceof HttpClientError) {
  console.log(error.name)    // "HttpClientError"
  console.log(error.message) // Error message
  console.log(error.context) // { operation: string }
}
```

### `TimeoutError`

Request exceeded the timeout:

```typescript
const result = await api.users.get({ params: { id: '123' }, timeout: 1000 })

if (result instanceof TimeoutError) {
  console.log(result.kind) // "TimeoutError"
  console.log(result.context.operation) // "fetch"
}
```

### `AbortedError`

Request was aborted via `AbortSignal`:

```typescript
const controller = new AbortController()
const result = await api.users.get({
  params: { id: '123' },
  signal: controller.signal,
})

if (result instanceof AbortedError) {
  console.log(result.kind) // "AbortedError"
}
```

### `NetworkError`

Network-level failure (no response received):

```typescript
const result = await api.users.get({ params: { id: '123' } })

if (result instanceof NetworkError) {
  console.log(result.kind) // "NetworkError"
  console.log(result.cause) // Underlying error
}
```

### `SerializationError`

Failed to serialize params, query, or body:

```typescript
const result = await api.users.create({
  body: { name: '' }, // Fails validation
})

if (result instanceof SerializationError) {
  console.log(result.kind) // "SerializationError"
  console.log(result.context.operation) // "serialize_body" | "generate_url"
  console.log(result.cause) // Schema validation issues
}
```

### `DeserializationError`

Failed to parse response:

```typescript
const result = await api.users.get({ params: { id: '123' } })

if (result instanceof DeserializationError) {
  console.log(result.kind) // "DeserializationError"
  console.log(result.cause) // Schema validation issues
}
```

### `UnexpectedError`

Unexpected failure during request:

```typescript
const result = await api.users.get({ params: { id: '123' } })

if (result instanceof UnexpectedError) {
  console.log(result.name) // "UnexpectedError"
  console.log(result.context.operation) // "create_request" | "parse_response" | etc.
}
```

## Checking Results

### Instance Check

```typescript
const result = await api.users.get({ params: { id: '123' } })

if (result instanceof Error) {
  // Handle all error types
  if (result instanceof TimeoutError) {
    // Retry or show timeout message
  } else if (result instanceof NetworkError) {
    // Show network error, maybe retry
  }
  return
}

// Handle successful response
if (result.ok) {
  console.log(result.data)
}
```

## Error Context

All errors have a `context` property with the operation that failed:

```typescript
if (result instanceof HttpClientError) {
  result.context.operation
  // "fetch" | "generate_url" | "serialize_body" | "parse_response" | "create_request" | "retry_policy" | "..."
}
```

## Raw Response

When available, the raw `Response` object is accessible:

```typescript
const result = await api.users.get({ params: { id: '123' } })

if (!result.ok && !(result instanceof Error)) {
  console.log(result.raw_response.status)
  console.log(result.raw_response.headers)
}
```
