The `http_client` function creates a typed API client from endpoint definitions.

```typescript
const api = http_client({
  origin: 'https://api.example.com',
  endpoints: {
    users: {
      list: new Endpoint({ method: 'GET', pathname: '/users' }),
      get: new Endpoint({ method: 'GET', pathname: '/users/(:id)' }),
      create: new Endpoint({ method: 'POST', pathname: '/users' }),
    },
  },
})

await api.users.list({})
await api.users.get({ params: { id: '123' } })
```

Supports nested endpoints, shared options, custom fetch, and per-request overrides for timeout, retry, headers, and signal.
