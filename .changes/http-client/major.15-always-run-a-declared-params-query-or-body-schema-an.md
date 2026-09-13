- Always run a declared `params`, `query` or `body` schema, an omitted slot included

  A slot the call site omits used to bypass its serializer entirely, so schema defaults and `preprocess` never ran and `query: {}` and no `query` produced different URLs. The type only allows the omission when the schema's input accepts `undefined`, so the schema now sees that `undefined` like any other value, and defaults apply.

  ```ts
  query: {
    schema: z.preprocess((value) => value ?? {}, z.object({ page: z.number().default(1) }));
  }
  await api.items.list({}); // was /items, now /items?page=1
  ```

  A schema output of `undefined` means there is nothing to send: no search string, no body, and `serialize` is not called for it.
