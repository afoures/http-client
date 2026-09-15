# Serialization

Endpoints serialize path params, query strings, and request bodies using schemas. All serialization validates input and can transform data.

> The whole definition may instead be a `(context) => definition` factory, in which case every
> `schema` and `serialize` below can be built from the per-call context. See
> [Dynamic Context](./dynamic-context.md).

## Params

Path parameters are serialized from the `params` input into the URL pathname.

### Without Schema

If no schema is provided, params are inferred from the pathname pattern:

```typescript
const endpoint = new Endpoint({ method: "GET", pathname: "/users/:id" });

const url = await endpoint.generate_url({
  base_url: "https://api.example.com",
  params: { id: "123" },
});
// https://api.example.com/users/123
```

### With Schema

Use a schema to validate and transform params:

```typescript
const endpoint = new Endpoint(
  { method: "GET", pathname: "/users/:id" },
  {
    params: {
      schema: z.object({
        id: z.string().uuid(),
      }),
    },
  },
);
```

### Custom Serialization

Provide a `serialize` function to transform validated params:

```typescript
const endpoint = new Endpoint(
  { method: "GET", pathname: "/users/:id" },
  {
    params: {
      schema: z.object({ id: z.number() }),
      serialize: (data) => ({ id: `user-${data.id}` }),
    },
  },
);

const url = await endpoint.generate_url({
  base_url: "https://api.example.com",
  params: { id: 123 },
});
// https://api.example.com/users/user-123
```

`serialize` is optional when the schema output already matches the pathname's params: the keys the route declares, each a `string` or `number` (or `undefined` for a param inside an optional group). When the output shape differs (renamed keys, missing keys, values of another type), `serialize` is **required** and the compiler enforces it.

## Query

Query parameters are serialized into the URL search string.

### Object Schema

```typescript
const endpoint = new Endpoint(
  { method: "GET", pathname: "/users" },
  {
    query: {
      schema: z.object({
        page: z.number(),
        search: z.string().optional(),
      }),
    },
  },
);

const url = await endpoint.generate_url({
  base_url: "https://api.example.com",
  query: { page: 1, search: "john" },
});
// https://api.example.com/users?page=1&search=john
```

### Custom Serialization

```typescript
const endpoint = new Endpoint(
  { method: "GET", pathname: "/users" },
  {
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
  },
);

const url = await endpoint.generate_url({
  base_url: "https://api.example.com",
  query: { tags: ["admin", "active"] },
});
// https://api.example.com/users?tags=admin,active
```

`serialize` is optional (defaulting to `"urlencoded"`) only when the schema output is a shape the default encoder accepts: a record of `string | number | boolean | null | undefined` values (or arrays of those), a list of `[key, value]` entries, or `undefined`. For anything richer (nested objects, or arrays that aren't key/value pairs) `serialize` is **required** and `"urlencoded"` is no longer offered, since it would stringify nested values into `[object Object]`.

A schema whose output is `any` or `unknown` is in that second group, and for a stricter reason: it does not describe a shape at all, so the client has nothing to decide an encoding from. `serialize` is required there too. This mirrors `parse`, which a schema with an `any` input has to spell out for the same reason.

```typescript
// compile error: `serialize` is required, since `any` says nothing about the encoding
new Endpoint({ method: "GET", pathname: "/users" }, { query: { schema: z.any() } });

// fine: the function is the encoding
new Endpoint(
  { method: "GET", pathname: "/users" },
  { query: { schema: z.any(), serialize: (data) => new URLSearchParams(data) } },
);
```

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

A value the encoder cannot express returns a `SerializationError` naming the key rather than writing `[object Object]`. So does an output that is not a record or an entry list at all, such as a bare string, a number or `null`: there are no key/value pairs to be had, and emitting no search string at all is the one failure you would have no way to notice. Both are reachable only by casting past the type above, since the compiler already requires `serialize` for those shapes.

The exception is `undefined`, which is not an error but the documented way to send nothing. See [Omitted Input](#omitted-input).

## Body

Request bodies are serialized for POST, PUT, PATCH, DELETE, and QUERY methods. A `body` serializer on a GET endpoint is a compile error.

### JSON

Use `serialize: 'json'` to serialize the body as JSON:

```typescript
const endpoint = new Endpoint(
  { method: "POST", pathname: "/users" },
  {
    body: {
      schema: z.object({
        name: z.string(),
        email: z.string().email(),
      }),
      serialize: "json",
    },
  },
);

const result = await endpoint.serialize_body({
  body: { name: "John", email: "john@example.com" },
});
// `serialize_body` returns its failures, so peel them off before reading the encoded body
if (result instanceof Error) throw result;

result.body; // '{"name":"John","email":"john@example.com"}'
result.content_type; // 'application/json'
```

### Custom Serialization

For non-JSON bodies (FormData, text, etc.), `serialize` returns `{ body, content_type? }`. Whether
`content_type` is allowed, required or forbidden depends on the body type:

| `body`                           | `content_type`                                                        |
| -------------------------------- | --------------------------------------------------------------------- |
| `FormData`, `URLSearchParams`    | not accepted: the runtime derives it from the body, boundary included |
| `BufferSource`, `ReadableStream` | required: raw bytes carry no type                                     |
| `Blob`, `string`, `null`         | optional: a `Blob` brings its own `type`, a string defaults to text   |

```typescript
const endpoint = new Endpoint(
  { method: "POST", pathname: "/upload" },
  {
    body: {
      schema: z.object({
        file: z.instanceof(File),
        name: z.string(),
      }),
      serialize: (data) => {
        const formData = new FormData();
        formData.append("file", data.file);
        formData.append("name", data.name);
        // no content_type: fetch derives it automatically from the body, boundary included
        return { body: formData };
      },
    },
  },
);
```

### URL-Encoded

```typescript
const endpoint = new Endpoint(
  { method: "POST", pathname: "/login" },
  {
    body: {
      schema: z.object({
        username: z.string(),
        password: z.string(),
      }),
      serialize: (data) => {
        const params = new URLSearchParams();
        params.set("username", data.username);
        params.set("password", data.password);
        // no content_type: fetch derives it automatically from the body
        return { body: params };
      },
    },
  },
);
```

### Plain Text

```typescript
const endpoint = new Endpoint(
  { method: "POST", pathname: "/echo" },
  {
    body: {
      schema: z.string(),
      serialize: (text) => ({
        body: text,
        content_type: "text/plain",
      }),
    },
  },
);
```

### Content-Type

The serializer owns the `Content-Type` header. What `serialize` returns is what the request carries,
and a `Content-Type` set through `headers` (at the client, endpoint or call level) is dropped: a
request without a body sends none, a request with one sends the serializer's. The `recover` retry
hook cannot change it either. This keeps one source of truth for the header and its body, which is
what a `FormData` boundary or a charset parameter needs.

Some bodies do not take an explicit `Content-Type` at all: `FormData` and `URLSearchParams` carry
enough for the runtime to derive it, so `serialize` must not return one for them (see the table
above), and the request goes out with whatever `fetch` computes.

To send a media type the `"json"` serializer does not produce, write the serializer out. Here is
JSON under a vendor media type (JSON:API, `merge-patch+json`, GitHub's `vnd.github+json`):

```typescript
const endpoint = new Endpoint(
  { method: "PATCH", pathname: "/users/:id" },
  {
    body: {
      schema: z.object({ name: z.string().optional(), email: z.string().optional() }),
      serialize: (data) => ({
        body: JSON.stringify(data),
        content_type: "application/merge-patch+json",
      }),
    },
  },
);
```

### Stream Bodies

A `ReadableStream` body is sent with `duplex: "half"`, as `fetch` requires. A stream can only be
read once, so it is consumed by the first attempt: a retry cannot re-send it and fails with an
`UnexpectedError` (`context.operation === "create_request"`). Leave `retry.attempts` at `0` for a
stream body, or buffer it into a `Blob` first when retries matter.

## Omitted Input

A declared `params`, `query` or `body` serializer always runs its schema, including when the slot
is omitted at the call site. The type only allows the omission when the schema's input accepts
`undefined`, so that is exactly what the schema sees, and defaults/transforms apply:

```typescript
const endpoint = new Endpoint(
  { method: "GET", pathname: "/items" },
  {
    query: {
      schema: z.preprocess((value) => value ?? {}, z.object({ page: z.number().default(1) })),
    },
  },
);

await endpoint.generate_url({ base_url: "https://api.example.com" });
// https://api.example.com/items?page=1
```

A schema output of `undefined` means there is nothing to send: no search string for `query`, no
body for `body`, and `serialize` is not called for it.

`undefined` is the only output read that way. `null` and every other non-record output are rejected
by `"urlencoded"` rather than skipped, since "send nothing" and "I cannot encode this" are different
answers and only one of them should be silent.

## Validation Errors

If input fails schema validation, a `SerializationError` is returned:

```typescript
const result = await endpoint.serialize_body({ body: { name: "" } });

if (result instanceof SerializationError) {
  console.log(result.message); // "Body serialization failed"
  console.log(result.cause); // Schema validation issues
}
```
