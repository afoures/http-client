`Endpoint` now takes three arguments: route, definition, options

The method and pathname move to their own first argument, the serializers and parsers become the second, and the request options become the third, alongside the endpoint's default context.

```ts
// before
new Endpoint(
  {
    method: "POST",
    pathname: "/tenants/:tenant/items",
    context: define_context<Ctx>().with_defaults({ tenant: "acme" }),
    params: { schema: (ctx) => z.object({ tenant: z.literal(ctx.tenant) }) },
    body: { schema: (ctx) => z.object({ name: z.string() }), serialize: "json" },
  },
  { timeout: 5000 },
);

// after
new Endpoint(
  { method: "POST", pathname: "/tenants/:tenant/items" },
  (ctx: Ctx) => ({
    params: { schema: z.object({ tenant: z.literal(ctx.tenant) }) },
    body: { schema: z.object({ name: z.string() }), serialize: "json" },
  }),
  { timeout: 5000, context: { tenant: "acme" } },
);
```

A definition that depends on the per-call context is a `(context) => definition` factory, and annotating its parameter is what declares the endpoint's context type. The context is then in scope by closure for every schema, `serialize` and `parse` in the definition, so `define_context`, `with_defaults`, per-schema `(context) => schema` factories and the trailing `context` parameter of `serialize` / `parse` are all gone.

What this buys, beyond not threading the context by hand through every slot:

- `data` in a custom `serialize` is now typed as the schema's validated output for `params` and `query` too, not just `body`.
- Property order stops mattering. Writing `serialize` before `schema` used to degrade `data` to `any`.
- The `data` fallback, for the cases where the schema cannot be resolved, is `unknown` rather than `any`, so a wrong type fails visibly instead of passing silently.
- Endpoint instantiation costs less: the benches are 4% to 52% below their old baselines, and `http_client` 27% to 29% below.

The cost, which only context-declaring endpoints pay: inside a factory, a mistake in one slot is reported against the whole factory argument rather than against the slot, because the argument is what fails to match. A plain-object definition keeps today's precise, slot-level diagnostics.

A definition factory runs exactly once per request. `http_client` resolves it and passes the result to `generate_url`, `serialize_body` and `parse_response`, each of which also accepts an already-resolved definition as a trailing argument. If the factory throws, all three return an `UnexpectedError` with `operation: "resolve_definition"` instead of the `SerializationError` / `ParseError` a throwing schema factory used to produce.

An endpoint-level `context` default is only accepted once the factory declares a context type; on an endpoint that declares none it is now a compile error rather than a default that silently does nothing.
