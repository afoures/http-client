# Serialization

Endpoints serialize path params, query strings, and request bodies using schemas. All serialization validates input and can transform data.

> A slot's `schema` may also be a `(context) => schema` factory, and each `serialize` function
> receives the per-call context as a second argument. See [Dynamic Context](./dynamic-context.md).

## Params

Path parameters are serialized from the `params` input into the URL pathname.

### Without Schema

If no schema is provided, params are inferred from the pathname pattern:

```typescript
const endpoint = new Endpoint({
  method: "GET",
  pathname: "/users/:id",
});

const url = await endpoint.generate_url({
  base_url: "https://api.example.com",
  params: { id: "123" },
});
// https://api.example.com/users/123
```

### With Schema

Use a schema to validate and transform params:

```typescript
const endpoint = new Endpoint({
  method: "GET",
  pathname: "/users/:id",
  params: {
    schema: z.object({
      id: z.string().uuid(),
    }),
  },
});
```

### Custom Serialization

Provide a `serialize` function to transform validated params:

```typescript
const endpoint = new Endpoint({
  method: "GET",
  pathname: "/users/:id",
  params: {
    schema: z.object({ id: z.number() }),
    serialize: (data) => ({ id: `user-${data.id}` }),
  },
});

const url = await endpoint.generate_url({
  base_url: "https://api.example.com",
  params: { id: 123 },
});
// https://api.example.com/users/user-123
```

`serialize` is optional when the schema output already matches the pathname's params (the keys the route declares, with `string`/`number` values). When the output shape differs (renamed keys, non-string values), `serialize` is **required** and the compiler enforces it.

## Query

Query parameters are serialized into the URL search string.

### Object Schema

```typescript
const endpoint = new Endpoint({
  method: "GET",
  pathname: "/users",
  query: {
    schema: z.object({
      page: z.number(),
      search: z.string().optional(),
    }),
  },
});

const url = await endpoint.generate_url({
  base_url: "https://api.example.com",
  query: { page: 1, search: "john" },
});
// https://api.example.com/users?page=1&search=john
```

### Custom Serialization

```typescript
const endpoint = new Endpoint({
  method: "GET",
  pathname: "/users",
  query: {
    schema: z.object({
      tags: z.array(z.string()),
    }),
    serialize: (data) => {
      const params = new URLSearchParams();
      params.set("tags", data.tags.join(","));
      return params;
    },
  },
});

const url = await endpoint.generate_url({
  base_url: "https://api.example.com",
  query: { tags: ["admin", "active"] },
});
// https://api.example.com/users?tags=admin,active
```

`serialize` is optional (defaulting to `"urlencoded"`) only when the schema output is a shape the default encoder accepts: a record of `string | number | boolean | null | undefined` values (or arrays of those), a list of `[key, value]` entries, or `undefined`. For anything richer (nested objects, or arrays that aren't key/value pairs) `serialize` is **required** and `"urlencoded"` is no longer offered, since it would stringify nested values into `[object Object]`.

### What `"urlencoded"` encodes to

Several of these shapes have more than one convention in the wild, so the default encoder commits to the ones `URLSearchParams` implements natively (a query is a flat list of name/value pairs, per the WHATWG URL Standard):

| Value               | Encoded as                | Not                                 |
| ------------------- | ------------------------- | ----------------------------------- |
| an array            | one repeated key per item | `tags[]=a`, `tags[0]=a`, `tags=a,b` |
| a number            | `String(value)`           |                                     |
| a boolean           | `"true"` / `"false"`      | `1` / `0`, a bare valueless flag    |
| `null`, `undefined` | dropped entirely          | `?cursor=`                          |

```typescript
{ tags: ["admin", "active"], page: 1, active: true, cursor: null }
// ?tags=admin&tags=active&page=1&active=true
```

If your backend expects a different dialect (bracketed array keys, `1`/`0` booleans, an explicit empty value), pass a `serialize` function and build the `URLSearchParams` yourself.

A value the encoder cannot express returns a `SerializationError` naming the key rather than writing `[object Object]`. That is reachable only by casting past the type above, since the compiler already requires `serialize` for those shapes.

## Body

Request bodies are serialized for POST, PUT, PATCH, and DELETE methods.

### JSON

Use `serialize: 'json'` to serialize the body as JSON:

```typescript
const endpoint = new Endpoint({
  method: "POST",
  pathname: "/users",
  body: {
    schema: z.object({
      name: z.string(),
      email: z.string().email(),
    }),
    serialize: "json",
  },
});

const { body, content_type } = await endpoint.serialize_body({
  body: { name: "John", email: "john@example.com" },
});
// body: '{"name":"John","email":"john@example.com"}'
// content_type: 'application/json'
```

### Custom Serialization

For non-JSON bodies (FormData, text, etc.):

```typescript
const endpoint = new Endpoint({
  method: "POST",
  pathname: "/upload",
  body: {
    schema: z.object({
      file: z.instanceof(File),
      name: z.string(),
    }),
    serialize: (data) => {
      const formData = new FormData();
      formData.append("file", data.file);
      formData.append("name", data.name);
      return { body: formData, content_type: "multipart/form-data" };
    },
  },
});
```

### URL-Encoded

```typescript
const endpoint = new Endpoint({
  method: "POST",
  pathname: "/login",
  body: {
    schema: z.object({
      username: z.string(),
      password: z.string(),
    }),
    serialize: (data) => {
      const params = new URLSearchParams();
      params.set("username", data.username);
      params.set("password", data.password);
      return { body: params, content_type: "application/x-www-form-urlencoded" };
    },
  },
});
```

### Plain Text

```typescript
const endpoint = new Endpoint({
  method: "POST",
  pathname: "/echo",
  body: {
    schema: z.string(),
    serialize: (text) => ({
      body: text,
      content_type: "text/plain",
    }),
  },
});
```

## Validation Errors

If input fails schema validation, a `SerializationError` is returned:

```typescript
const result = await endpoint.serialize_body({ body: { name: "" } });

if (result instanceof SerializationError) {
  console.log(result.message); // "Body serialization failed"
  console.log(result.cause); // Schema validation issues
}
```
