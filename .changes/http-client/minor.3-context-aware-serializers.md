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

  The schema-driven narrowing is preserved: `params`/`query` `serialize` stays required when the
  schema output can't be encoded by the default, `body.serialize` stays required, and `parse`
  still forces `"text"` for string schemas and `"json"` otherwise.
