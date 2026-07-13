- Pass the per-call context to custom `serialize` and `parse` functions.

  Custom `serialize` (params/query/body) and `parse` (responses) functions now receive the
  resolved context as a second argument, alongside the validated data/body.

  ```typescript
  body: {
    schema: my_schema,
    serialize: (data, ctx) => ({
      body: encode(data, ctx.key),
      content_type: "application/octet-stream",
    }),
  }
  ```

  As a consequence of supporting `(context) => schema` factories at these slots, `serialize`
  is now always optional in the types and `parse` accepts both `"json"` and `"text"`
  regardless of the schema's output type (the previous schema-driven narrowing that made
  `serialize` required, or forced `"json"` vs `"text"`, is gone).
