- Allow a slot's `schema` to be a factory of the per-call context.

  `params`, `query`, `body`, and each `responses` entry now accept either a schema or a
  `(context) => schema` function, so the schema used to validate a request or response can
  depend on the per-call context.

  ```typescript
  new Endpoint({
    method: "POST",
    pathname: "/items",
    context: define_context<{ max_len: number }>(),
    body: {
      schema: (ctx) => z.object({ name: z.string().max(ctx.max_len) }),
      serialize: "json",
    },
  });
  ```
