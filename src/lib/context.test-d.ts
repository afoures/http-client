// Compile-time type tests for context-driven (dynamic) schemas.
// Not executed at runtime (does not match the `*.test.ts` glob); validated by `pnpm typecheck`.
import {
  http_client,
  type $infer,
  type ClientContext,
  type HttpClientConfig,
} from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import { define_context } from "./endpoint.ts";
import { type ErrorMessage } from "./types.ts";
import z from "zod";

type Equal<left, right> =
  (<value>() => value extends left ? 1 : 2) extends <value>() => value extends right ? 1 : 2
    ? true
    : false;
declare function assert_type<condition extends true>(): condition;

// --- fixtures ---

// endpoint with a fully-required context
const with_ctx = new Endpoint({
  method: "GET",
  pathname: "/user",
  context: define_context<{ tz: string; locale: string }>(),
  responses: {
    // the factory receives the declared context type, and `data` is the returned schema's output
    200: { schema: (ctx) => z.object({ tz: z.literal(ctx.tz), name: z.string() }), parse: "json" },
  },
});

// the factory parameter is typed as the declared context (no annotation needed)
new Endpoint({
  method: "GET",
  pathname: "/x",
  context: define_context<{ tz: string }>(),
  responses: {
    200: {
      schema: (ctx) => {
        assert_type<Equal<typeof ctx, { tz: string }>>();
        return z.object({ ok: z.boolean() });
      },
      parse: "json",
    },
  },
});

// endpoint-level default makes one key optional
const with_default = new Endpoint({
  method: "GET",
  pathname: "/user",
  context: define_context<{ tz: string; locale: string }>().with_defaults({ tz: "UTC" }),
  responses: { 200: { schema: () => z.object({ ok: z.boolean() }), parse: "json" } },
});

// no context declared -> no `context` field at the call site
const no_ctx = new Endpoint({
  method: "GET",
  pathname: "/plain",
  responses: { 200: { schema: z.object({ ok: z.boolean() }), parse: "json" } },
});

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
  return new Endpoint({
    method: "GET",
    pathname: "/x",
    context: define_context<context_type>(),
    responses: { 200: { schema: () => z.object({ ok: z.boolean() }), parse: "json" } },
  });
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
