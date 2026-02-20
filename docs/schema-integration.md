# Schema Integration

`@afoures/http-client` uses the [Standard Schema spec](https://github.com/standard-schema/standard-schema) for schema validation. Any compliant library works.

## Zod

```typescript
import { z } from 'zod'

const endpoint = new Endpoint({
  method: 'POST',
  pathname: '/users',
  body: {
    schema: z.object({
      name: z.string().min(1),
      email: z.string().email(),
    }),
  },
  data: {
    schema: z.object({
      id: z.string(),
      name: z.string(),
      createdAt: z.string().datetime(),
    }),
  },
})
```

### Transforms

Zod transforms work for both input and output:

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users',
  query: {
    schema: z.object({
      page: z.number().transform(String), // number input, string output
    }),
  },
  data: {
    schema: z.object({
      createdAt: z.string().transform(s => new Date(s)), // parse ISO to Date
    }),
  },
})

// Input: { page: 1 }
// Query string: ?page=1
// Response: { createdAt: "2024-01-15T10:30:00Z" }
// Output: { createdAt: Date }
```

## ArkType

```typescript
import { type } from 'arktype'

const endpoint = new Endpoint({
  method: 'POST',
  pathname: '/users',
  body: {
    schema: type({
      name: 'string>0',
      email: 'string',
      age: 'number?',
    }),
  },
  data: {
    schema: type({
      id: 'string',
      name: 'string',
      'email?': 'string',
    }),
  },
})
```

### Transforms

```typescript
import { type } from 'arktype'

const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users',
  data: {
    schema: type({
      id: 'string',
      'createdAt': 'string.parse(v => new Date(v))',
    }),
  },
})
```

## Valibot

```typescript
import * as v from 'valibot'

const endpoint = new Endpoint({
  method: 'POST',
  pathname: '/users',
  body: {
    schema: v.object({
      name: v.pipe(v.string(), v.minLength(1)),
      email: v.pipe(v.string(), v.email()),
    }),
  },
  data: {
    schema: v.object({
      id: v.string(),
      name: v.string(),
    }),
  },
})
```

### Transforms

```typescript
import * as v from 'valibot'

const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users',
  data: {
    schema: v.object({
      id: v.string(),
      createdAt: v.pipe(v.string(), v.transform(s => new Date(s))),
    }),
  },
})
```

## Input vs Output Types

Schemas define both input validation and output parsing:

- **Input** (`Schema.infer_input`): What you pass to the endpoint
- **Output** (`Schema.infer_output`): What you get back after validation/transforms

```typescript
const schema = z.object({
  id: z.string().transform(s => parseInt(s)),
})

// Input: string
// Output: number

const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/items',
  query: {
    schema: z.object({
      id: z.string().transform(parseInt),
    }),
  },
})

// You pass: { query: { id: '123' } }  (string)
// URL becomes: /items?id=123
// After validation, id is: 123 (number)
```

## Reusable Schemas

Share schemas across endpoints:

```typescript
import { z } from 'zod'

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
})

const CreateUserSchema = UserSchema.omit({ id: true })

const api = http_client({
  origin: 'https://api.example.com',
  endpoints: {
    users: {
      list: new Endpoint({
        method: 'GET',
        pathname: '/users',
        data: { schema: z.array(UserSchema) },
      }),
      get: new Endpoint({
        method: 'GET',
        pathname: '/users/(:id)',
        data: { schema: UserSchema },
      }),
      create: new Endpoint({
        method: 'POST',
        pathname: '/users',
        body: { schema: CreateUserSchema },
        data: { schema: UserSchema },
      }),
    },
  },
})
```

## Custom Schema Libraries

Any library implementing the Standard Schema spec works:

```typescript
interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: Input) => StandardResult<Output>
  }
}
```

The HTTP client uses `schema['~standard'].validate()` for both input serialization and output parsing.
