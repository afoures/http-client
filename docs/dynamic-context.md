# Dynamic Context

Sometimes a schema (or a `serialize` / `parse` function) needs data that is **not** part of the
request payload: a decryption key, the caller's timezone, a set of expected values fetched
elsewhere. `@afoures/http-client` lets you pass that data per call as **context**, and build the
whole endpoint definition from it on the fly.

Context is:

- **Declared once**, by annotating the definition factory's parameter, so the type flows to every
  schema in the definition and to the call site.
- **Out-of-band**: it is never serialized into the URL, query string, or body.
- **Optional to pass** for any key you provide a default for.

## Declaring context

Pass a `(context) => definition` factory as the endpoint's second argument and annotate its
parameter. The annotation is what declares the endpoint's context type:

```typescript
import { Endpoint, http_client } from "@afoures/http-client";
import { z } from "zod";

const report = new Endpoint({ method: "GET", pathname: "/report/:id" }, (ctx: { tz: string }) => ({
  responses: {
    // `ctx` is typed as { tz: string }; `data` is inferred from the schema below
    200: { schema: z.object({ at: z.string(), tz: z.literal(ctx.tz) }), parse: "json" },
  },
}));

const api = http_client({ report }, { base_url: "https://api.example.com" });
const res = await api.report({ params: { id: "1" }, context: { tz: "UTC" } });
```

One annotation covers the whole definition, so every slot can use the context: `params`, `query`,
`body`, and per-status `responses`.

```typescript
new Endpoint({ method: "POST", pathname: "/users" }, (ctx: { role: "admin" | "user" }) => ({
  body: { schema: body_schema_for(ctx.role), serialize: "json" },
  responses: { 201: { schema: user_schema_for(ctx.role), parse: "json" } },
}));
```

Endpoints that do not need a context pass a plain object instead, and take no `context` argument at
the call site.

Forgetting the annotation is a loud failure rather than a quiet downgrade: nothing else declares the
context type, so it stays `unknown` and the first property access on the parameter is an error.

The factory runs **once per request**, before the URL is built, and its result is used for the URL,
the body and the response. Keep it cheap, and do not rely on it running a fixed number of times per
call.

## `serialize` and `parse` close over the context

The context is in scope for a custom `serialize` (request side) or `parse` (response side), so
neither takes a context argument. A common use is encrypt-on-serialize / decrypt-on-parse with a
per-call key that never appears in the payload types:

```typescript
new Endpoint({ method: "PUT", pathname: "/blob" }, (ctx: { key: CryptoKey }) => ({
  body: {
    schema: z.instanceof(Uint8Array),
    serialize: (value) => ({
      body: encrypt(value, ctx.key),
      content_type: "application/octet-stream",
    }),
  },
  responses: {
    200: {
      schema: z.instanceof(Uint8Array),
      parse: async (body) => decrypt(await new Response(body).arrayBuffer(), ctx.key),
    },
  },
}));
```

`data` is typed as the schema's validated output in every slot, including `params` and `query`, and
regardless of whether `serialize` is written before or after `schema`.

## Default context

Defaults can be set at two levels. A key covered by **either** level becomes optional at the call
site; keys without a default stay required. If every key is defaulted, the whole `context` argument
is optional. Merge order is `client → endpoint → per-call` (later wins).

### Endpoint-level

Pass `context` in the endpoint's third argument, alongside its default request options:

```typescript
new Endpoint(
  { method: "GET", pathname: "/report/:id" },
  (ctx: { tz: string; locale: string }) => ({
    responses: {
      200: { schema: z.object({ at: z.string(), tz: z.literal(ctx.tz) }), parse: "json" },
    },
  }),
  { context: { tz: "UTC" }, timeout: 5000 },
);
// call site: `locale` required, `tz` optional
```

`context` is only accepted once the factory declares a context type. On an endpoint that declares
none it is a compile error, rather than a default that silently does nothing. Its keys are checked
against that type too, so a misspelled key or a value of the wrong type is rejected.

### Client-level

Pass `context` to `http_client`. It fills matching keys for every endpoint whose context type
declares them. See [Shared Context](./http-client.md#shared-context).

```typescript
const api = http_client(
  {
    report: new Endpoint(
      { method: "GET", pathname: "/report/:id" },
      (_ctx: { tz: string; locale: string }) => ({
        responses: { 200: { schema: z.object({ at: z.string() }), parse: "json" } },
      }),
      { context: { tz: "UTC" } },
    ),
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

#### Shared keys must agree on their type

A client-level default applies to every endpoint declaring that key, so all of them must declare it
with the same type. If two endpoints disagree, a client-level default for that key is a compile
error:

```typescript
const endpoints = {
  billing: new Endpoint(
    { method: "GET", pathname: "/billing" },
    (_ctx: { tenant: string }) => ({}),
  ),
  metrics: new Endpoint(
    { method: "GET", pathname: "/metrics" },
    (_ctx: { tenant: number }) => ({}),
  ),
};

http_client(endpoints, {
  base_url: "https://api.example.com",
  // error: context key 'tenant' is declared with conflicting types across endpoints
  context: { tenant: "acme" },
});
```

The error fires on the value, not on the tree: the same endpoints are fine as long as no
client-level default is set for `tenant`, and other keys in the config are unaffected. To set one,
either align the type in every endpoint that declares the key, or split the endpoints across
separate clients. Endpoint-level defaults and per-call context never collide, since each is typed
from a single endpoint's context.

## Type inference

- The response `data` type is inferred from the schema in the definition the factory **returns**
  (`Schema.infer_output<…>`). A branching factory yields a union. It does not vary with the runtime
  context value.
- Extract the call-site context type with [`$infer.Context`](./http-client.md#type-inference).

```typescript
type Ctx = $infer.Context<typeof api.report>;
```

## Diagnostics

The one cost of the factory form: a mistake inside the definition is reported against the whole
factory argument rather than against the slot that caused it, because the argument is what fails to
match. The useful sentence is still in the diagnostic, just further down. A plain-object definition
keeps the precise, slot-level message, so only context-driven endpoints are affected.

## Errors

If the definition factory throws, or a schema it builds fails validation, the call resolves to a
returned error, never a throw:

- the factory itself throwing → `UnexpectedError`, with `context.operation === "resolve_definition"`
- request-side validation or `serialize` (`params` / `query` / `body`) → `SerializationError`
- response-side parsing or validation (`responses`) → `ParseError`

The original error is attached as the error's `cause`. `UnexpectedError` extends `Error` directly
rather than `HttpClientError`, so a single `instanceof HttpClientError` check does not catch it; use
`instanceof Error`. See [Error Handling](./error-handling.md).
