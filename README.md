# http-client

A typesafe and robust HTTP client with schema validation.

## Why?

**Typesafe by design**: Path params, query strings, request bodies, and responses are all typed. Schema validation happens at runtime with full TypeScript inference.

**Standard Schema compatible**: Works with Zod, ArkType, Valibot, or any schema library implementing the [Standard Schema spec](https://github.com/standard-schema/standard-schema).

**Robust error handling**: Typed errors for timeouts, network failures, serialization issues, and unexpected errors. No more guessing what went wrong.

**Built-in retry**: Configurable retry policies with contextual conditions and exponential backoff support.

## Installation

```bash
npm install @afoures/http-client
# or
pnpm add @afoures/http-client
# or
yarn add @afoures/http-client
# or
bun add @afoures/http-client
```

```typescript
import { Endpoint, http_client } from '@afoures/http-client'
import { z } from 'zod'

const api = http_client({
  base_url: 'https://api.example.com',
  endpoints: {
    users: {
      list: new Endpoint({
        method: 'GET',
        pathname: '/users',
        query: {
          schema: z.object({
            page: z.number().optional(),
            limit: z.number().optional(),
          }),
        },
        data: {
          schema: z.array(z.object({ id: z.string(), name: z.string() })),
        },
      }),
      get: new Endpoint({
        method: 'GET',
        pathname: '/users/(:id)',
        data: {
          schema: z.object({ id: z.string(), name: z.string() }),
        },
      }),
      create: new Endpoint({
        method: 'POST',
        pathname: '/users',
        body: {
          schema: z.object({ name: z.string(), email: z.string().email() }),
        },
        data: {
          schema: z.object({ id: z.string(), name: z.string() }),
        },
      }),
    },
  },
})

// All endpoints are fully typed
const list = await api.users.list({ query: { page: 1, limit: 10 } })
const user = await api.users.get({ params: { id: '123' } })
const created = await api.users.create({ body: { name: 'John', email: 'john@example.com' } })
```

## Documentation

- [HTTP Client](./docs/http-client.md)
- [Endpoint Definition](./docs/endpoint-definition.md)
- [Schema Integration](./docs/schema-integration.md)
- [Serialization](./docs/serialization.md)
- [Response Parsing](./docs/response-parsing.md)
- [Error Handling](./docs/error-handling.md)
- [Retry Policy](./docs/retry-policy.md)

## License

MIT
