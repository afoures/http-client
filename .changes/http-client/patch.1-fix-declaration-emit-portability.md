Fix `TS2883` "inferred type cannot be named" errors in consumers that emit declarations.

The `fetch_endpoint` input type was wrapped in `Pretty<>`, which eagerly flattened the request-init intersection and inlined the members of `HTTPFetch.OptionalRequestInit` (the internal `MaybePromise` helper) and `HTTPFetch.DefaultRequestInit` (`RequestInit`'s `Dispatcher`/`ReferrerPolicy`/`RequestCache`/… members from `undici-types`). Those inlined members aren't portably nameable from a consumer's `.d.ts`. Dropping `Pretty` keeps them as named references, so the generated declarations stay portable.
