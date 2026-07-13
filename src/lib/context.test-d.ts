// Compile-time type tests for context-driven (dynamic) schemas.
// Not executed at runtime (does not match the `*.test.ts` glob); validated by `pnpm typecheck`.
import { http_client, type $infer } from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import { define_context } from "./endpoint.ts";
import z from "zod";

type Equals<left, right> =
  (<value>() => value extends left ? 1 : 2) extends <value>() => value extends right ? 1 : 2
    ? true
    : false;
type Expect<condition extends true> = condition;

// --- endpoint with a fully-required context ---
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
        type _ctx = Expect<Equals<typeof ctx, { tz: string }>>;
        return z.object({ ok: z.boolean() });
      },
      parse: "json",
    },
  },
});

// --- endpoint-level default makes one key optional ---
const with_default = new Endpoint({
  method: "GET",
  pathname: "/user",
  context: define_context<{ tz: string; locale: string }>().with_defaults({ tz: "UTC" }),
  responses: { 200: { schema: () => z.object({ ok: z.boolean() }), parse: "json" } },
});

// --- no context declared -> no `context` field at the call site ---
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

// `context` is required, and typed as the declared shape (client default relaxes `locale`)
type CtxInput = $infer.Context<typeof api.with_ctx>;
type _ctx_optional_via_client = Expect<Equals<CtxInput, { tz: string; locale?: string }>>;

// endpoint default `tz` + client default `locale` => both optional, so the whole `context`
// field is optional and `$infer.Context` includes `undefined`.
type CtxDefaulted = $infer.Context<typeof api.with_default>;
type _ctx_all_optional = Expect<Equals<CtxDefaulted, { tz?: string; locale?: string } | undefined>>;

// no context declared => `$infer.Context` is `never` (key absent)
type CtxNone = $infer.Context<typeof api.no_ctx>;
type _ctx_none = Expect<Equals<CtxNone, never>>;

// response `data` is inferred from the factory's returned schema
type Data = $infer.Data<typeof api.with_ctx, 200>;
type _data = Expect<Equals<Data, { tz: string; name: string }>>;

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
    // @ts-expect-error - `nope` is not a key of any endpoint's context
    context: { nope: true },
  },
);
http_client(
  { with_ctx, with_default, no_ctx },
  {
    base_url: "x",
    // @ts-expect-error - `locale` must be a string
    context: { locale: 123 },
  },
);

async function call_sites() {
  // context required here (has a non-defaulted key `tz`)
  await api.with_ctx({ context: { tz: "UTC", locale: "en" } });
  // @ts-expect-error - `tz` is required (only `locale` is defaulted)
  await api.with_ctx({ context: { locale: "en" } });
  // @ts-expect-error - `context` itself is required
  await api.with_ctx({});

  // every key defaulted => `context` is optional
  await api.with_default({});
  await api.with_default({ context: { tz: "PST" } });

  // no context declared => passing one is rejected
  await api.no_ctx({});
  // @ts-expect-error - this endpoint declares no context
  await api.no_ctx({ context: { anything: true } });
}

void call_sites;
