Type `data` in a custom body `serialize` when the schema comes from a factory

A custom `serialize` receives the schema's validated output, but with a `(context) => schema` factory that parameter fell back to `any`:

```ts
body: {
  schema: (ctx) => z.object({ name: z.string() }),
  // `data` was `any`; it is now `{ name: string }`
  serialize: (data, ctx) => ({ body: JSON.stringify(data), content_type: "application/json" }),
}
```

`body` was reachable only through a conditional on the HTTP method, and a conditional on the path to a serializer has to resolve before its schema is inferred. `body` now sits in the definition's base object, with the "this http method does not support body" diagnostic moved to a sibling member that contributes an optional error under the same key. The diagnostic still lands on `body`, and the arm that spelled out `body?: never` is gone, since an optional property already permits omission.

`params` and `query` are unchanged: their serializer types carry a second conditional of their own, so the same move would not type their `data`. Annotate the factory's context parameter (`schema: (ctx: Ctx) => ...`) or hoist the factory to a named function to get a typed `data` there.

Every endpoint instantiation bench got cheaper, by 1.9% to 16.8%.
