Fix `params` and `query` schema factories losing their types

A `(context) => schema` factory for `params` or `query` did not typecheck, and the context parameter fell back to an implicit `any`:

```ts
new Endpoint({
  method: "GET",
  pathname: "/search",
  context: define_context<{ locale: string }>(),
  // previously: the factory parameter was `any` and `query` collapsed to `never`
  query: { schema: (ctx) => z.object({ q: z.string(), locale: z.literal(ctx.locale) }) },
});
```

The conditional that decides whether `serialize` is required is what gives `schema` its contextual type, so it has to resolve while `schema` is still being inferred, where an unresolved parameter reads as `never`. Distributing it over `never` produced `never` and collapsed the whole serializer type, so the factory got no contextual type and its return type was never inferred. The check is now non-distributive, matching the form `Parser.ResponseBody` already used, which is why `responses` and `body` factories were unaffected.

Only the types changed: the runtime already resolved these factories.

The narrowing itself is now stricter for a union schema whose members disagree. A union with one urlencoded-incompatible member requires `serialize` rather than accepting its omission.
