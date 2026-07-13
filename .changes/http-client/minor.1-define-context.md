- Add out-of-band request `context` via `define_context`.

  Declare an endpoint's `context` type with `define_context<T>()` and pass a matching
  `context` object per call. Unlike `params`/`query`/`body`, context is never serialized into
  the request — it is threaded into schema factories and into custom `serialize`/`parse`
  functions so those can adapt to per-call data (locale, timezone, feature flags, ...).

  ```typescript
  import { Endpoint, define_context } from "@afoures/http-client";

  const get_user = new Endpoint({
    method: "GET",
    pathname: "/users/:id",
    context: define_context<{ locale: string }>(),
    responses: { 200: { schema: (ctx) => user_schema(ctx.locale), parse: "json" } },
  });

  await api.get_user({ params: { id: "1" }, context: { locale: "en" } });
  ```

  The declared type is the single source of truth: `context` is required at the call site
  unless every key is supplied by a default, and endpoints that declare no context have no
  `context` field at all.
