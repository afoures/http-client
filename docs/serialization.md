# Serialization

Endpoints serialize path params, query strings, and request bodies using schemas. All serialization validates input and can transform data.

## Params

Path parameters are serialized from the `params` input into the URL pathname.

### Without Schema

If no schema is provided, params are inferred from the pathname pattern:

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users/(:id)',
})

const url = await endpoint.generate_url({
  base_url: 'https://api.example.com',
  params: { id: '123' },
})
// https://api.example.com/users/123
```

### With Schema

Use a schema to validate and transform params:

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users/(:id)',
  params: {
    schema: z.object({
      id: z.string().uuid(),
    }),
  },
})
```

### Custom Serialization

Provide a `serialization` function to transform validated params:

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users/(:id)',
  params: {
    schema: z.object({ id: z.number() }),
    serialization: (data) => ({ id: `user-${data.id}` }),
  },
})

const url = await endpoint.generate_url({
  base_url: 'https://api.example.com',
  params: { id: 123 },
})
// https://api.example.com/users/user-123
```

## Query

Query parameters are serialized into the URL search string.

### Object Schema

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users',
  query: {
    schema: z.object({
      page: z.number().transform(String),
      search: z.string().optional(),
    }),
  },
})

const url = await endpoint.generate_url({
  base_url: 'https://api.example.com',
  query: { page: 1, search: 'john' },
})
// https://api.example.com/users?page=1&search=john
```

### Custom Serialization

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users',
  query: {
    schema: z.object({
      tags: z.array(z.string()),
    }),
    serialization: (data) => {
      const params = new URLSearchParams()
      params.set('tags', data.tags.join(','))
      return params
    },
  },
})

const url = await endpoint.generate_url({
  base_url: 'https://api.example.com',
  query: { tags: ['admin', 'active'] },
})
// https://api.example.com/users?tags=admin,active
```

## Body

Request bodies are serialized for POST, PUT, PATCH, and DELETE methods.

### JSON

Use `serialization: 'json'` to serialize the body as JSON:

```typescript
const endpoint = new Endpoint({
  method: 'POST',
  pathname: '/users',
  body: {
    schema: z.object({
      name: z.string(),
      email: z.string().email(),
    }),
    serialization: 'json',
  },
})

const { body, content_type } = await endpoint.serialize_body({
  body: { name: 'John', email: 'john@example.com' },
})
// body: '{"name":"John","email":"john@example.com"}'
// content_type: 'application/json'
```

### Custom Serialization

For non-JSON bodies (FormData, text, etc.):

```typescript
const endpoint = new Endpoint({
  method: 'POST',
  pathname: '/upload',
  body: {
    schema: z.object({
      file: z.instanceof(File),
      name: z.string(),
    }),
    serialization: (data) => {
      const formData = new FormData()
      formData.append('file', data.file)
      formData.append('name', data.name)
      return { body: formData, content_type: 'multipart/form-data' }
    },
  },
})
```

### URL-Encoded

```typescript
const endpoint = new Endpoint({
  method: 'POST',
  pathname: '/login',
  body: {
    schema: z.object({
      username: z.string(),
      password: z.string(),
    }),
    serialization: (data) => {
      const params = new URLSearchParams()
      params.set('username', data.username)
      params.set('password', data.password)
      return { body: params, content_type: 'application/x-www-form-urlencoded' }
    },
  },
})
```

### Plain Text

```typescript
const endpoint = new Endpoint({
  method: 'POST',
  pathname: '/echo',
  body: {
    schema: z.string(),
    serialization: (text) => ({
      body: text,
      content_type: 'text/plain',
    }),
  },
})
```

## Validation Errors

If input fails schema validation, a `SerializationError` is returned:

```typescript
const result = await endpoint.serialize_body({ body: { name: '' } })

if (result instanceof SerializationError) {
  console.log(result.message) // "Body serialization failed"
  console.log(result.cause)    // Schema validation issues
}
```
