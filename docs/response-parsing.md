# Response Parsing

Endpoints parse HTTP responses into typed results based on status code.

## Response Types

### Successful Response (20x)

```typescript
type SuccessfulResponse<Data> = {
  ok: true
  status: 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226
  data: Data
  headers: Headers
  raw_response: Response
}
```

### Redirect (30x)

```typescript
type RedirectMessage = {
  ok: false
  status: 300 | 301 | 302 | 303 | 304 | 307 | 308
  redirect_to: string | null
  headers: Headers
  raw_response: Response
}
```

### Client Error (40x)

```typescript
type ClientErrorResponse<Error> = {
  ok: false
  status: 400 | 401 | 402 | 403 | 404 | /* ... */
  error: Error
  headers: Headers
  raw_response: Response
}
```

### Server Error (50x)

```typescript
type ServerErrorResponse<Error> = {
  ok: false
  status: 500 | 501 | 502 | 503 | 504 | /* ... */
  error: Error
  headers: Headers
  raw_response: Response
}
```

## Data Parser

Define a `data` parser for successful responses:

### JSON (Default)

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users/(:id)',
  data: {
    schema: z.object({
      id: z.string(),
      name: z.string(),
    }),
  },
})

const result = await endpoint.parse_response(response)
if (result.ok) {
  console.log(result.data) // { id: string, name: string }
}
```

### Text

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/health',
  data: {
    schema: z.string(),
    deserialization: 'text',
  },
})
```

### Custom Deserialization

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/data',
  data: {
    schema: z.object({ value: z.number() }),
    deserialization: async (body) => {
      const text = await new Response(body).text()
      return JSON.parse(text)
    },
  },
})
```

### 204 No Content

For endpoints that return no content:

```typescript
const endpoint = new Endpoint({
  method: 'DELETE',
  pathname: '/users/(:id)',
})

const result = await endpoint.parse_response(response)
// result.ok === true, result.status === 204, result.data === null
```

## Error Parser

Define an `error` parser for error responses:

### JSON

```typescript
const endpoint = new Endpoint({
  method: 'POST',
  pathname: '/users',
  body: { schema: z.object({ name: z.string() }) },
  error: {
    schema: z.object({
      message: z.string(),
      code: z.string(),
    }),
    deserialization: 'json',
  },
})

const result = await endpoint.parse_response(response)
if (!result.ok && result.status === 400) {
  console.log(result.error.message)
  console.log(result.error.code)
}
```

### Text

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users/(:id)',
  error: {
    schema: z.string(),
    deserialization: 'text',
  },
})

const result = await endpoint.parse_response(response)
if (!result.ok && result.status === 404) {
  console.log(result.error) // "Not Found"
}
```

### Default (No Schema)

Without an error parser, errors default to text:

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users/(:id)',
})

const result = await endpoint.parse_response(response)
if (!result.ok) {
  console.log(typeof result.error) // "string"
}
```

## Schema Transforms

Schemas can transform response data:

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users/(:id)',
  data: {
    schema: z.object({
      name: z.string().transform(s => s.toUpperCase()),
      createdAt: z.string().transform(s => new Date(s)),
    }),
  },
})

const result = await endpoint.parse_response(response)
if (result.ok) {
  console.log(result.data.name)      // uppercase string
  console.log(result.data.createdAt) // Date object
}
```

## Deserialization Errors

If response parsing fails validation, a `DeserializationError` is returned:

```typescript
const result = await endpoint.parse_response(response)

if (result instanceof DeserializationError) {
  console.log(result.message) // "Response deserialization failed"
  console.log(result.cause)    // Schema validation issues
}
```

## Handling All Cases

```typescript
const result = await api.users.get({ params: { id: '123' } })

if (result instanceof Error) {
  // UnexpectedError, NetworkError, TimeoutError, etc.
  console.log(result.message)
  return
}

if (result.ok) {
  // 20x success
  console.log(result.data)
} else if (result.status >= 300 && result.status < 400) {
  // Redirect
  console.log(result.redirect_to)
} else if (result.status >= 400 && result.status < 500) {
  // Client error
  console.log(result.error)
} else {
  // Server error
  console.log(result.error)
}
```
