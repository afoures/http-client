// Compile-time type tests for context-driven (dynamic) schemas.
// Not executed at runtime (does not match the `*.test.ts` glob); validated by `pnpm typecheck`.
import {
  http_client,
  type $infer,
  type ClientContext,
  type HttpClientConfig,
} from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import { type ErrorMessage } from "./types.ts";
import z from "zod";

type Equal<left, right> =
  (<value>() => value extends left ? 1 : 2) extends <value>() => value extends right ? 1 : 2
    ? true
    : false;
declare function assert_type<condition extends true>(): condition;

// --- fixtures ---

// endpoint with a fully-required context
const with_ctx = new Endpoint(
  { method: "GET", pathname: "/user" },
  (ctx: { tz: string; locale: string }) => ({
    responses: {
      // the factory receives the declared context type, and `data` is the returned schema's output
      200: { schema: z.object({ tz: z.literal(ctx.tz), name: z.string() }), parse: "json" },
    },
  }),
);

// the annotation on the definition factory is what declares the context, and one annotation covers
// every slot in the definition at once
new Endpoint({ method: "GET", pathname: "/x" }, (ctx: { tz: string }) => {
  assert_type<Equal<typeof ctx, { tz: string }>>();
  return { responses: { 200: { schema: z.object({ ok: z.boolean() }), parse: "json" } } };
});

// and forgetting it fails loudly at the first use of `ctx` rather than degrading quietly: with no
// annotation there is no inference site for the context type, so it stays `unknown`
new Endpoint({ method: "GET", pathname: "/unannotated" }, (ctx) => {
  assert_type<Equal<typeof ctx, unknown>>();
  return { responses: { 200: { schema: z.object({ ok: z.boolean() }), parse: "json" } } };
});

// endpoint-level default makes one key optional
const with_default = new Endpoint(
  { method: "GET", pathname: "/user" },
  (_context: { tz: string; locale: string }) => ({
    responses: { 200: { schema: z.object({ ok: z.boolean() }), parse: "json" } },
  }),
  { context: { tz: "UTC" } },
);

// no context declared -> no `context` field at the call site
const no_ctx = new Endpoint(
  { method: "GET", pathname: "/plain" },
  { responses: { 200: { schema: z.object({ ok: z.boolean() }), parse: "json" } } },
);

// an endpoint-level default needs a declared context: on an endpoint that declares none it is a
// compile error rather than a default that silently does nothing
new Endpoint(
  { method: "GET", pathname: "/no-context" },
  { responses: { 200: { schema: z.object({ ok: z.boolean() }), parse: "json" } } },
  // @ts-expect-error: this endpoint declares no context, so it has no defaults to set
  { context: { tz: "UTC" } },
);

const api = http_client(
  { with_ctx, with_default, no_ctx },
  {
    base_url: "https://api.example.com",
    // client-level default (relaxes `locale` where it exists)
    context: { locale: "en" },
  },
);

// --- `$infer.Context` resolution ---

// `context` is required, and typed as the declared shape (client default relaxes `locale`)
assert_type<Equal<$infer.Context<typeof api.with_ctx>, { tz: string; locale?: string }>>();

// endpoint default `tz` + client default `locale` => both optional, so the whole `context`
// field is optional and `$infer.Context` includes `undefined`.
assert_type<
  Equal<$infer.Context<typeof api.with_default>, { tz?: string; locale?: string } | undefined>
>();

// no context declared => `$infer.Context` is `never` (key absent)
assert_type<Equal<$infer.Context<typeof api.no_ctx>, never>>();

// on a raw `Endpoint` there is no client and so no client-level defaults: every declared key stays
// required (`locale` is optional above only because `api` defaults it), and only an endpoint-level
// default makes one optional.
assert_type<Equal<$infer.Context<typeof with_ctx>, { tz: string; locale: string }>>();
assert_type<Equal<$infer.Input<typeof with_ctx>["context"], { tz: string; locale: string }>>();
assert_type<Equal<$infer.Context<typeof with_default>, { tz?: string; locale: string }>>();

// response `data` is inferred from the factory's returned schema
assert_type<Equal<$infer.Data<typeof api.with_ctx, 200>, { tz: string; name: string }>>();

// --- client-level `context` is constrained to the merged endpoint contexts ---

// the client-level `context` is constrained to the merged shape of every endpoint's context
// (here `{ tz?: string; locale?: string }`), so editors propose keys and reject invalid ones.
http_client(
  { with_ctx, with_default, no_ctx },
  { base_url: "x", context: { tz: "UTC", locale: "en" } },
);
http_client(
  { with_ctx, with_default, no_ctx },
  {
    base_url: "x",
    // @ts-expect-error: `nope` is not a key of any endpoint's context
    context: { nope: true },
  },
);
http_client(
  { with_ctx, with_default, no_ctx },
  {
    base_url: "x",
    // @ts-expect-error: `locale` must be a string
    context: { locale: 123 },
  },
);

// --- call sites ---

// context required here (has a non-defaulted key `tz`)
await api.with_ctx({ context: { tz: "UTC", locale: "en" } });
// @ts-expect-error: `tz` is required (only `locale` is defaulted)
await api.with_ctx({ context: { locale: "en" } });
// @ts-expect-error: `context` itself is required
await api.with_ctx({});

// every key defaulted => `context` is optional
await api.with_default({});
await api.with_default({ context: { tz: "PST" } });

// no context declared => passing one is rejected
await api.no_ctx({});
// @ts-expect-error: this endpoint declares no context
await api.no_ctx({ context: { anything: true } });

// --- `HttpClientConfig` derives its `context` from the endpoint tree ---

const endpoints = { nested: { with_ctx, with_default, no_ctx } };

assert_type<Equal<ClientContext<typeof endpoints>, { tz?: string; locale?: string }>>();

// without a `default_context`, the config declares no client-level defaults, so it accepts none
assert_type<Equal<HttpClientConfig<typeof endpoints>["context"], undefined>>();
// the parameterized form carries exactly the defaults it was given
assert_type<
  Equal<
    HttpClientConfig<typeof endpoints, { locale: "en" }>["context"],
    { locale: "en" } | undefined
  >
>();

// a wrapper that takes no client-level defaults
type WrapperConfig = HttpClientConfig<typeof endpoints>;

function create_client(config: WrapperConfig) {
  return http_client(endpoints, config);
}

create_client({ base_url: "x" });
// @ts-expect-error: this config declares no client-level defaults, so `context` is rejected
create_client({ base_url: "x", context: { tz: "UTC" } });
// @ts-expect-error: rejected for the same reason, not because `nope` is an unknown key
create_client({ base_url: "x", context: { nope: true } });

// no client-level defaults => every declared context key stays required at the call site
const loose = create_client({ base_url: "x" });
await loose.nested.with_ctx({ context: { tz: "UTC", locale: "en" } });
// @ts-expect-error: nothing is defaulted, so `context` is required in full
await loose.nested.with_ctx({});

// spelling the sentinel out explicitly behaves the same
function create_explicit_client(config: HttpClientConfig<typeof endpoints, never>) {
  return http_client(endpoints, config);
}

const explicit = create_explicit_client({ base_url: "x" });
// @ts-expect-error: still nothing defaulted
await explicit.nested.with_ctx({});

// threading `default_context` through keeps track of the defaults actually provided
function create_precise_client<
  const default_context extends ClientContext<typeof endpoints> = never,
>(config: HttpClientConfig<typeof endpoints, default_context>) {
  return http_client(endpoints, config);
}

const precise = create_precise_client({ base_url: "x", context: { locale: "en" } });
await precise.nested.with_ctx({ context: { tz: "UTC" } });
// @ts-expect-error: only `locale` is defaulted, `tz` is still required
await precise.nested.with_ctx({});
// @ts-expect-error: `nope` is not a key of any endpoint's context
create_precise_client({ base_url: "x", context: { nope: true } });

const without_defaults = create_precise_client({ base_url: "x" });
// @ts-expect-error: no client-level default, so the whole declared context is required
await without_defaults.nested.with_default({});

// `= {}` behaves like `= never` for a wrapper's own default, thanks to the `keyof never` guard
function create_empty_default_client<
  const default_context extends ClientContext<typeof endpoints> = {},
>(config: HttpClientConfig<typeof endpoints, default_context>) {
  return http_client(endpoints, config);
}

const empty_default = create_empty_default_client({ base_url: "x" });
// @ts-expect-error: no client-level default, so the whole declared context is required
await empty_default.nested.with_default({});

// a wrapper adding its own config fields keeps the same precision
function create_wrapped_client<
  const default_context extends ClientContext<typeof endpoints> = never,
>(config: HttpClientConfig<typeof endpoints, default_context> & { api_key: string }) {
  const { api_key: _api_key, ...client_config } = config;
  return http_client(endpoints, client_config);
}

const wrapped = create_wrapped_client({ base_url: "x", api_key: "k", context: { locale: "en" } });
await wrapped.nested.with_ctx({ context: { tz: "UTC" } });
// @ts-expect-error: only `locale` is defaulted, `tz` is still required
await wrapped.nested.with_ctx({});

// a key defaulted at both the endpoint and the client level stays optional
const both = create_precise_client({
  base_url: "x",
  context: { tz: "Europe/Paris", locale: "en" },
});
await both.nested.with_default({});

// --- conflicting context keys across endpoints ---

// two endpoints declaring the same key with incompatible types: a client-level default for it would
// be valid for one endpoint and invalid for the other, so `ClientContext` rejects the value.
function context_endpoint<context_type>() {
  return new Endpoint({ method: "GET", pathname: "/x" }, (_context: context_type) => ({
    responses: { 200: { schema: z.object({ ok: z.boolean() }), parse: "json" } },
  }));
}

const tenant_string = context_endpoint<{ tenant: string }>();
const tenant_number = context_endpoint<{ tenant: number; locale: string }>();
const tenant_string_too = context_endpoint<{ tenant: string; locale: string }>();
const tenant_boolean = context_endpoint<{ tenant: boolean }>();
const tenant_boolean_too = context_endpoint<{ tenant: boolean }>();
const tenant_widened = context_endpoint<{ tenant: string | number }>();

type ConflictingTenant =
  ErrorMessage<"context key 'tenant' is declared with conflicting types across endpoints; give it the same type in every endpoint, or use separate clients">;

// 1. a tree with no context at all still accepts a config with no `context`
http_client({ no_ctx }, { base_url: "x" });

// 2. consistent keys: the client-level default is accepted, and relaxes the key at both call sites
const consistent = http_client(
  { tenant_string, tenant_string_too },
  { base_url: "x", context: { tenant: "acme" } },
);
await consistent.tenant_string({});
await consistent.tenant_string_too({ context: { locale: "fr" } });
// @ts-expect-error: only `tenant` is defaulted, `locale` is still required
await consistent.tenant_string_too({});

// 3. conflicting `tenant`: a client-level default for it is rejected
http_client(
  { tenant_string, tenant_number },
  {
    base_url: "x",
    // @ts-expect-error: `tenant` is `string` in one endpoint and `number` in another
    context: { tenant: "acme" },
  },
);

// 4. a conflicting key the config leaves alone is fine; it just stays required at every call site
const conflicting = http_client({ tenant_string, tenant_number }, { base_url: "x" });
await conflicting.tenant_string({ context: { tenant: "acme" } });
await conflicting.tenant_number({ context: { tenant: 1, locale: "fr" } });
// @ts-expect-error: nothing is defaulted, so `tenant` is required
await conflicting.tenant_string({});
// @ts-expect-error: nothing is defaulted, so `tenant` is required
await conflicting.tenant_number({ context: { locale: "fr" } });

// 5. a non-colliding sibling key in the same tree is unaffected
http_client({ tenant_string, tenant_number }, { base_url: "x", context: { locale: "fr" } });

// 6. `boolean` is `true | false`, so a cardinality-based check would flag it: it must not
http_client({ tenant_boolean, tenant_boolean_too }, { base_url: "x", context: { tenant: true } });

// 7. a union declared by a single endpoint is consistent with itself
http_client({ tenant_widened }, { base_url: "x", context: { tenant: 1 } });
http_client({ tenant_widened }, { base_url: "x", context: { tenant: "acme" } });

// 8. a union in one endpoint and a narrower type in another do collide: `1` would be valid for the
// first and invalid for the second, which is the exact unsoundness being closed
http_client(
  { tenant_widened, tenant_string },
  {
    base_url: "x",
    // @ts-expect-error: `string | number` in one endpoint and `string` in another
    context: { tenant: "acme" },
  },
);

// 9. the wrapper pattern documented on `HttpClientConfig` produces the same diagnostics
const mixed_endpoints = { billing: tenant_string, metrics: tenant_number };

function create_mixed_client<
  const default_context extends ClientContext<typeof mixed_endpoints> = never,
>(config: HttpClientConfig<typeof mixed_endpoints, default_context>) {
  return http_client(mixed_endpoints, config);
}

// @ts-expect-error: `tenant` is declared with conflicting types across the tree
create_mixed_client({ base_url: "x", context: { tenant: "acme" } });
create_mixed_client({ base_url: "x", context: { locale: "fr" } });

// 10. the resulting shape, pinned: the colliding key carries the diagnostic, the rest are usable
assert_type<
  Equal<ClientContext<typeof mixed_endpoints>, { tenant?: ConflictingTenant; locale?: string }>
>();

// --- context-driven schemas for `params` and `query` ---
//
// `responses` and `body` are built from the context above. The same must hold for `params` and
// `query`: a schema closing over the context still drives the call-site input types.

const contextual_query = new Endpoint(
  { method: "GET", pathname: "/search" },
  (ctx: { locale: string }) => ({
    query: { schema: z.object({ q: z.string(), locale: z.literal(ctx.locale) }) },
    responses: { 200: { schema: z.object({ ok: z.boolean() }), parse: "json" } },
  }),
);

const contextual_params = new Endpoint(
  { method: "GET", pathname: "/tenants/:tenant" },
  (ctx: { tenant: string }) => ({
    params: { schema: z.object({ tenant: z.literal(ctx.tenant) }) },
    responses: { 200: { schema: z.object({ ok: z.boolean() }), parse: "json" } },
  }),
);

// every request-side schema of one endpoint driven by the same context
const contextual_everything = new Endpoint(
  { method: "POST", pathname: "/tenants/:tenant/items" },
  (ctx: { tenant: string; locale: string }) => ({
    params: { schema: z.object({ tenant: z.literal(ctx.tenant) }) },
    query: { schema: z.object({ locale: z.literal(ctx.locale) }) },
    body: { schema: z.object({ name: z.string() }), serialize: "json" },
    responses: { 200: { schema: z.object({ ok: z.boolean() }), parse: "json" } },
  }),
);

const contextual_api = http_client(
  { contextual_query, contextual_params, contextual_everything },
  { base_url: "https://api.example.com" },
);

// the factory's returned schema drives the call-site input types
assert_type<
  Equal<$infer.Query<typeof contextual_api.contextual_query>, { q: string; locale: string }>
>();
assert_type<Equal<$infer.Params<typeof contextual_api.contextual_params>, { tenant: string }>>();
assert_type<
  Equal<$infer.Params<typeof contextual_api.contextual_everything>, { tenant: string }>
>();
assert_type<Equal<$infer.Query<typeof contextual_api.contextual_everything>, { locale: string }>>();
assert_type<Equal<$infer.Body<typeof contextual_api.contextual_everything>, { name: string }>>();

// and the call sites accept the right input and reject the wrong input
await contextual_api.contextual_query({
  context: { locale: "fr" },
  query: { q: "socks", locale: "fr" },
});
await contextual_api.contextual_query({
  context: { locale: "fr" },
  // @ts-expect-error: `q` must be a string
  query: { q: 1, locale: "fr" },
});
await contextual_api.contextual_params({
  context: { tenant: "acme" },
  params: { tenant: "acme" },
});
await contextual_api.contextual_params({
  context: { tenant: "acme" },
  // @ts-expect-error: `tenant` must be a string
  params: { tenant: { nested: true } },
});

// --- `serialize` narrowing inside a definition factory ---
//
// The narrowing guards in `endpoint.test-d.ts` pin this behaviour for a plain-object definition. A
// definition factory must narrow identically: the decision depends on the schema's output, not on
// how the definition is supplied.
//
// Note where the two directives below have to sit: on the CALL, not on the `query` / `params`
// property. In the factory form the whole argument is what fails to match, so that is where the
// diagnostic is reported. The plain-object form keeps the precise, slot-level diagnostic.

// a urlencoded-compatible output keeps `serialize` optional
new Endpoint({ method: "GET", pathname: "/a" }, (_context: { locale: string }) => ({
  query: { schema: z.object({ q: z.string() }) },
}));

// a nested output is not urlencoded-compatible, so `serialize` is required
// @ts-expect-error: nested output isn't urlencoded-compatible, so `serialize` is required
new Endpoint({ method: "GET", pathname: "/b" }, (_context: { locale: string }) => ({
  query: { schema: z.object({ filter: z.object({ min: z.number() }) }) },
}));

// an output that cannot fill the pathname params makes `serialize` required
// @ts-expect-error: output `{ user_id }` can't fill `:id`, so `serialize` is required
new Endpoint({ method: "GET", pathname: "/c/:id" }, (_context: { locale: string }) => ({
  params: { schema: z.object({ user_id: z.number() }) },
}));

// --- `data` in a custom `serialize` is typed from the schema ---
//
// A custom `serialize` receives the schema's validated output. Inside a definition factory that
// type resolves for every slot, `params` and `query` included: the annotated factory is not
// context-sensitive, so its schemas are concrete expressions by the time `serialize` is typed.
// This is what the previous layout could not do, where `params` and `query` fell back to `any`.
new Endpoint({ method: "POST", pathname: "/serialize/:id" }, (ctx: { tz: string }) => ({
  params: {
    schema: z.object({ id: z.number() }),
    serialize: (data) => {
      assert_type<Equal<typeof data, { id: number }>>();
      assert_type<Equal<typeof ctx, { tz: string }>>();
      return { id: String(data.id) };
    },
  },
  query: {
    schema: z.object({ q: z.string() }),
    serialize: (data) => {
      assert_type<Equal<typeof data, { q: string }>>();
      assert_type<Equal<typeof ctx, { tz: string }>>();
      return new URLSearchParams({ q: data.q });
    },
  },
  body: {
    schema: z.object({ name: z.string() }),
    serialize: (data) => {
      assert_type<Equal<typeof data, { name: string }>>();
      assert_type<Equal<typeof ctx, { tz: string }>>();
      return { body: JSON.stringify(data), content_type: "application/json" };
    },
  },
}));

// property order does not matter: `serialize` written before `schema` types `data` just the same.
// The previous layout degraded `data` to `any` here, because `schema` and `serialize` were deferred
// siblings in one object literal.
new Endpoint({ method: "POST", pathname: "/order" }, (_context: { tz: string }) => ({
  body: {
    serialize: (data) => {
      assert_type<Equal<typeof data, { name: string }>>();
      return { body: JSON.stringify(data), content_type: "application/json" };
    },
    schema: z.object({ name: z.string() }),
  },
}));

// --- an endpoint-level `context` default is constrained to the declared context ---

new Endpoint(
  { method: "GET", pathname: "/tz" },
  (context: { tz: string }) => ({
    responses: { 200: { schema: z.object({ tz: z.literal(context.tz) }), parse: "json" } },
  }),
  // @ts-expect-error: `nope` is not a key of the declared context
  { context: { nope: 1 } },
);
new Endpoint(
  { method: "GET", pathname: "/tz" },
  (context: { tz: string }) => ({
    responses: { 200: { schema: z.object({ tz: z.literal(context.tz) }), parse: "json" } },
  }),
  // @ts-expect-error: a known key with the wrong type is rejected too
  { context: { tz: 1 } },
);
// the default is still inferred as a literal, so `tz` becomes optional at the call site
const tz_defaulted = new Endpoint(
  { method: "GET", pathname: "/tz" },
  (context: { tz: string }) => ({
    responses: { 200: { schema: z.object({ tz: z.literal(context.tz) }), parse: "json" } },
  }),
  { context: { tz: "UTC" } },
);
assert_type<Equal<typeof tz_defaulted.context_default, { readonly tz: "UTC" }>>();
http_client({ tz_defaulted }, { base_url: "x" }).tz_defaulted({});
