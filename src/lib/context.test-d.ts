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
assert_type<
  Equal<HttpClientConfig<typeof endpoints>["context"], { tz?: string; locale?: string } | undefined>
>();

// a wrapper can annotate its config without restating the context shape
type WrapperConfig = HttpClientConfig<typeof endpoints>;

function create_client(config: WrapperConfig) {
  return http_client(endpoints, config);
}

create_client({ base_url: "x", context: { tz: "UTC" } });
// @ts-expect-error: `nope` is not a key of any endpoint's context
create_client({ base_url: "x", context: { nope: true } });

// the config type alone cannot tell which defaults were passed, so every context key is optional
const loose = create_client({ base_url: "x" });
await loose.nested.with_ctx({});

// threading `default_context` through keeps track of the defaults actually provided
function create_precise_client<const default_context extends ClientContext<typeof endpoints> = {}>(
  config: HttpClientConfig<typeof endpoints, default_context>,
) {
  return http_client(endpoints, config);
}

const precise = create_precise_client({ base_url: "x", context: { locale: "en" } });
await precise.nested.with_ctx({ context: { tz: "UTC" } });
// @ts-expect-error: only `locale` is defaulted, `tz` is still required
await precise.nested.with_ctx({});

const without_defaults = create_precise_client({ base_url: "x" });
// @ts-expect-error: no client-level default, so the whole declared context is required
await without_defaults.nested.with_default({});
