The `Endpoint` class defines HTTP endpoints with full type safety.

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users/(:id)',
  params: { schema: z.object({ id: z.string() }) },
  query: { schema: z.object({ include: z.string().optional() }) },
  body: { schema: z.object({ name: z.string() }) },
  data: { schema: z.object({ id: z.string(), name: z.string() }) },
  error: { schema: z.object({ message: z.string() }) },
})
```

Supports path parameters, query strings, request bodies, and response parsing via Standard Schema validators.

Endpoint-level options for headers, timeout, and retry:

```typescript
new Endpoint(definition, {
  headers: { 'X-API-Version': '2' },
  timeout: 5000,
  retry: { attempts: 3, delay: 1000 },
})
```
