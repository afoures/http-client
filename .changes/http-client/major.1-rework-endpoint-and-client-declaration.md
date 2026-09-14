- Rework how endpoints and clients are declared

  `Endpoint` takes three arguments now: the route, the definition, the options.

  ```ts
  // before
  new Endpoint(
    {
      method: "POST",
      pathname: "/tenants/:tenant/items",
      context: define_context<Ctx>().with_defaults({ tenant: "acme" }),
      params: { schema: (ctx) => z.object({ tenant: z.literal(ctx.tenant) }) },
    },
    { timeout: 5000 },
  );

  // after
  new Endpoint(
    { method: "POST", pathname: "/tenants/:tenant/items" },
    (ctx: Ctx) => ({ params: { schema: z.object({ tenant: z.literal(ctx.tenant) }) } }),
    { timeout: 5000, context: { tenant: "acme" } },
  );
  ```

  A definition that needs the per-call context is a `(context) => definition` factory whose
  parameter annotation declares the context type. The context is then in scope by closure, so
  `define_context`, `with_defaults` and per-schema `(context) => schema` factories are gone.
  `HttpClientConfig` is parameterized by the endpoint tree rather than by a hand-written context,
  with `ClientContext<endpoints>` exported for wrappers, and `EndpointMap` is no longer exported.

  Pathnames use a built-in parser, so the package has no runtime dependencies. `:param` and nested
  optional groups are unchanged; wildcards, enums and the protocol, hostname, port and search
  patterns are gone, and `?` and `#` are rejected. An unparsable `base_url` or a tree leaf that is
  not an `Endpoint` now throws when the client is built, instead of failing per call.