# HTTP Client

The `http_client` function creates a typed API client from a map of endpoints.

## Basic Usage

```typescript
import { Endpoint, http_client } from '@afoures/http-client'
import { z } from 'zod'

const api = http_client({
  base_url: 'https://api.example.com',
  endpoints: {
    users: new Endpoint({
      method: 'GET',
      pathname: '/users',
      data: { schema: z.array(z.object({ id: z.string() })), parse: 'json' },
    }),
  },
})

const result = await api.users({})
```

## Organizing Endpoints

Nest endpoints in objects for logical grouping:

```typescript
const api = http_client({
  base_url: 'https://api.example.com',
  endpoints: {
    users: {
      list: new Endpoint({ method: 'GET', pathname: '/users' }),
      get: new Endpoint({ method: 'GET', pathname: '/users/(:id)' }),
      create: new Endpoint({ method: 'POST', pathname: '/users' }),
      update: new Endpoint({ method: 'PUT', pathname: '/users/(:id)' }),
      delete: new Endpoint({ method: 'DELETE', pathname: '/users/(:id)' }),
    },
    posts: {
      list: new Endpoint({ method: 'GET', pathname: '/posts' }),
      get: new Endpoint({ method: 'GET', pathname: '/posts/(:id)' }),
      comments: {
        list: new Endpoint({ method: 'GET', pathname: '/posts/(:postId)/comments' }),
        create: new Endpoint({ method: 'POST', pathname: '/posts/(:postId)/comments' }),
      },
    },
  },
})

// Fully typed paths
await api.users.list({})
await api.users.get({ params: { id: '123' } })
await api.posts.comments.create({ params: { postId: '1' }, body: { text: 'Nice!' } })
```

## Shared Options

Provide sync or async default options for all requests:

```typescript
const api = http_client({
  base_url: 'https://api.example.com',
  endpoints: { /* ... */ },
  options: async () => {
    const token = await getAuthToken()
    return {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  },
})
```

Options are merged in this order (later overrides earlier):
1. `options()` from `http_client`
2. Endpoint default options
3. Per-request options

## Custom Fetch

Provide a custom fetch function for proxying, logging, or modifying requests:

```typescript
const api = http_client({
  base_url: 'https://api.example.com',
  endpoints: { /* ... */ },
  fetch: async (request) => {
    console.log('Request:', request.url)
    const response = await fetch(request)
    console.log('Response:', response.status)
    return response
  },
})
```

For testing, use tools like [MSW](https://mswjs.io/) instead of custom fetch.

## Per-Request Options

All `RequestInit` options plus custom options can be passed per-request:

```typescript
const result = await api.users.get({
  params: { id: '123' },
  headers: { 'X-Custom': 'value' },
  signal: abortController.signal,
  timeout: 5000,
  retry: { attempts: 3, delay: 1000 },
})
```

## Headers with Reducers

Headers can be functions that receive the current value:

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users',
  headers: {
    'X-Request-ID': (current) => current ?? crypto.randomUUID(),
  },
})
```

## Response Handling

All endpoint functions return a union type:

```typescript
const result = await api.users.get({ params: { id: '123' } })

// Can be an error
if (result instanceof Error) {
  // TimeoutError, NetworkError, SerializationError, etc.
  return
}

// Or a response
if (result.ok) {
  console.log(result.data)
} else {
  console.log(result.error)
}
```
