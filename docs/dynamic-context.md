# Dynamic Context

Sometimes a schema (or a `serialize` / `parse` function) needs data that is **not** part of the
request payload: a decryption key, the caller's timezone, a set of expected values fetched
elsewhere. `@afoures/http-client` lets you pass that data per call as **context**, and build schemas
from it on the fly.

Context is:

- **Declared once** on the endpoint, so the type flows to every factory and to the call site.
- **Out-of-band**: it is never serialized into the URL, query string, or body.
- **Optional to pass** for any key you provide a default for.

## Declaring context

Use `define_context<T>()` to declare the context type, then make any slot's `schema` a function of
it. The factory receives the context, fully typed:

```typescript
import { Endpoint, http_client, define_context } from "@afoures/http-client";
import { z } from "zod";

const report = new Endpoint({
  method: "GET",
  pathname: "/report/:id",
  context: define_context<{ tz: string }>(),
  responses: {
    // `ctx` is typed as { tz: string }; `data` is inferred from the returned schema
    200: { schema: (ctx) => z.object({ at: z.string(), tz: z.literal(ctx.tz) }), parse: "json" },
  },
});

const api = http_client({ report }, { base_url: "https://api.example.com" });
const res = await api.report({ params: { id: "1" }, context: { tz: "UTC" } });
```

Any slot can use a factory: `params`, `query`, `body`, and per-status `responses`:

```typescript
new Endpoint({
  method: "POST",
  pathname: "/users",
  context: define_context<{ role: "admin" | "user" }>(),
  body: { schema: (ctx) => bodySchemaFor(ctx.role), serialize: "json" },
  responses: { 201: { schema: (ctx) => userSchemaFor(ctx.role), parse: "json" } },
});
```

Endpoints that declare no `context` are unchanged and take no `context` argument.

## `serialize` and `parse` receive the context

The custom `serialize` (request side) and `parse` (response side) functions receive the same
context as a second argument. A common use is encrypt-on-serialize / decrypt-on-parse with a
per-call key that never appears in the payload types:

```typescript
new Endpoint({
  method: "PUT",
  pathname: "/blob",
  context: define_context<{ key: CryptoKey }>(),
  body: {
    schema: (ctx) => z.instanceof(Uint8Array),
    serialize: (value, ctx) => ({
      body: encrypt(value, ctx.key),
      content_type: "application/octet-stream",
    }),
  },
  responses: {
    200: {
      schema: (ctx) => z.instanceof(Uint8Array),
      parse: async (body, ctx) => decrypt(await new Response(body).arrayBuffer(), ctx.key),
    },
  },
});
```

## Default context

Defaults can be set at two levels. A key covered by **either** level becomes optional at the call
site; keys without a default stay required. If every key is defaulted, the whole `context` argument
is optional. Merge order is `client → endpoint → per-call` (later wins).

### Endpoint-level

Chain `.with_defaults({...})` after `define_context`:

```typescript
context: define_context<{ tz: string; locale: string }>().with_defaults({ tz: "UTC" }),
// call site: `locale` required, `tz` optional
```

> `.with_defaults` is a separate call (rather than an argument to `define_context`) because passing
> the context type argument explicitly would disable inference of the defaults (TypeScript's
> partial type-argument inference), losing the default keys.

### Client-level

Pass `context` to `http_client`. It fills matching keys for every endpoint whose context type
declares them. See [Shared Context](./http-client.md#shared-context).

```typescript
const api = http_client(
  {
    report: new Endpoint({
      method: "GET",
      pathname: "/report/:id",
      context: define_context<{ tz: string; locale: string }>().with_defaults({ tz: "UTC" }),
      responses: { 200: { schema: (ctx) => z.object({ at: z.string() }), parse: "json" } },
    }),
  },
  {
    base_url: "https://api.example.com",
    // relaxes `locale` on any endpoint that declares it
    context: { locale: "en" },
  },
);

// both `tz` (endpoint default) and `locale` (client default) are optional here:
await api.report({ params: { id: "1" } });
await api.report({ params: { id: "1" }, context: { tz: "PST" } }); // override a default
```

## Type inference

- The response `data` type is inferred from the schema the factory **returns**
  (`Schema.infer_output<ReturnType<factory>>`). A branching factory yields a union. It does not
  vary with the runtime context value.
- Extract the call-site context type with [`$infer.Context`](./http-client.md#type-inference):

  ```typescript
  type Ctx = $infer.Context<typeof api.report>;
  ```

## Errors

If a factory (or a context-aware `serialize` / `parse`) throws, or the schema it builds fails
validation, the call resolves to a returned error, never a throw:

- request side (`params` / `query` / `body`) → `SerializationError`
- response side (`responses`) → `ParseError`

The original error is attached as the error's `cause`. See [Error Handling](./error-handling.md).
