- Split `Endpoint` into three arguments: route, definition, options

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

  A definition that depends on the per-call context is a `(context) => definition` factory, and annotating its parameter is what declares the endpoint's context type. The context is then in scope by closure for every schema, `serialize` and `parse`, so `define_context`, `with_defaults`, per-schema `(context) => schema` factories and the trailing `context` parameter of `serialize` / `parse` are all gone. An endpoint-level `context` default now requires a declared context type, instead of silently doing nothing.

  With the context in scope, `data` in a custom `serialize` is typed as the schema's validated output for `params` and `query` too, property order stops mattering, and the fallback where a schema cannot be resolved is `unknown` rather than `any`. The cost, paid only by context-declaring endpoints: inside a factory, a mistake in one slot is reported against the whole factory argument rather than the slot. A plain-object definition keeps slot-level diagnostics.

  A factory runs exactly once per request. `generate_url`, `serialize_body` and `parse_response` each accept the already-resolved definition as a trailing argument, and a throwing factory makes all three return an `UnexpectedError` with `operation: "resolve_definition"`.
