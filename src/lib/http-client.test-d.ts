// Compile-time type tests for the `http_client` factory.
// Not executed at runtime (does not match the `*.test.ts` glob); validated by `pnpm typecheck`.
import { http_client, type $infer } from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import { NetworkError, ParseError, TimeoutError } from "./errors.ts";
import type { HTTPFetch, RetryPolicy, Schema } from "./types.ts";
import z from "zod";

type Equal<left, right> =
  (<value>() => value extends left ? 1 : 2) extends <value>() => value extends right ? 1 : 2
    ? true
    : false;
declare function assert_type<condition extends true>(): condition;
declare function assignable<target>(value: target): void;

// --- fixtures ---

const get_user = new Endpoint({
  method: "GET",
  pathname: "/users/:id",
  params: { schema: z.object({ id: z.string() }) },
  query: { schema: z.object({ include: z.string(), page: z.string() }) },
  responses: {
    200: { schema: z.object({ id: z.string(), name: z.string() }), parse: "json" },
    404: { schema: z.object({ message: z.string(), code: z.number() }), parse: "json" },
  },
});

const create_required = new Endpoint({
  method: "POST",
  pathname: "/things",
  body: { schema: z.object({ name: z.string() }), serialize: "json" },
  responses: { 201: { schema: z.object({ id: z.string() }), parse: "json" } },
});

// several success codes with different schemas, the case `ok` cannot narrow on its own
const create_user = new Endpoint({
  method: "POST",
  pathname: "/users",
  body: { schema: z.object({ name: z.string() }), serialize: "json" },
  responses: {
    200: { schema: z.object({ id: z.string(), existing: z.literal(true) }), parse: "json" },
    201: { schema: z.object({ id: z.string(), created_at: z.string() }), parse: "json" },
    404: { schema: z.object({ message: z.string() }), parse: "json" },
  },
});

// optional path param via the `(/:id)` group syntax (no schema)
const get_user_optional = new Endpoint({
  method: "GET",
  pathname: "/users(/:id)",
});

// wildcard response statuses (`2xx` / `4xx` / `5xx`) acting as per-class defaults
const wildcard = new Endpoint({
  method: "GET",
  pathname: "/wild",
  responses: {
    "2xx": { schema: z.object({ ok: z.boolean() }), parse: "json" },
    "4xx": { schema: z.object({ error: z.string() }), parse: "json" },
    "5xx": { schema: z.object({ fatal: z.string() }), parse: "json" },
  },
});

const client = http_client(
  {
    get_user,
    create_required,
    create_user,
    get_user_optional,
    wildcard,
    // nested endpoint map → mapped recursively
    admin: { get_user },
  },
  { base_url: "https://api.example.com" },
);

// --- mapping: endpoints become callable fetch functions, including nested maps ---

assert_type<
  Equal<typeof client.get_user extends (...args: never[]) => unknown ? true : false, true>
>();
assert_type<
  Equal<typeof client.admin.get_user extends (...args: never[]) => unknown ? true : false, true>
>();

// --- fetch input shape ---

type GetUserInput = Parameters<typeof client.get_user>[0];

assert_type<Equal<GetUserInput["params"], { id: string }>>();
assert_type<Equal<GetUserInput["query"], { include: string; page: string }>>();
// request-init keys are merged in (OptionalRequestInit + DefaultRequestInit)
assert_type<Equal<GetUserInput["timeout"], number | HTTPFetch.TimeoutConfig | undefined>>();

// optional path param flows through the mapped fetch input
assert_type<
  Equal<
    Parameters<typeof client.get_user_optional>[0]["params"],
    { id: string | number | undefined }
  >
>();

// positive: a fully-formed call with request-init options type-checks
client.get_user({
  params: { id: "1" },
  query: { include: "a", page: "1" },
  timeout: 1000,
  signal: new AbortController().signal,
  headers: { "x-trace": "y" },
});

// negative: required `params` omitted
// @ts-expect-error: `params` is required
client.get_user({ query: { include: "a", page: "1" } });

// negative: required `query` omitted
// @ts-expect-error: `query` is required
client.get_user({ params: { id: "1" } });

// negative: GET input has no `body` key
client.get_user({
  params: { id: "1" },
  query: { include: "a", page: "1" },
  // @ts-expect-error: a GET endpoint's input does not accept `body`
  body: { anything: true },
});

// negative: wrong body field type on a POST endpoint
// @ts-expect-error: `name` must be a string
client.create_required({ body: { name: 123 } });

// --- retry recover ---

// the recover context carries request/response/error/attempt plus a `current.headers` copy
type RecoverContext = Parameters<RetryPolicy.Recover>[0];
assert_type<Equal<RecoverContext["attempt"], number>>();
assert_type<Equal<RecoverContext["current"], { headers: Headers }>>();

// overrides are headers-only for now
assert_type<Equal<keyof RetryPolicy.Overrides, "headers">>();

// positive: recover may return overrides, a Promise of overrides, or nothing
client.get_user({
  params: { id: "1" },
  query: { include: "a", page: "1" },
  retry: {
    when: ({ response }) => response?.status === 401,
    recover: async ({ current }) => ({ headers: new Headers(current.headers) }),
  },
});
client.get_user({
  params: { id: "1" },
  query: { include: "a", page: "1" },
  retry: { recover: () => undefined },
});

// negative: recover overrides accept only `headers`
client.get_user({
  params: { id: "1" },
  query: { include: "a", page: "1" },
  // @ts-expect-error: recover overrides only accept `headers`
  retry: { recover: () => ({ body: { anything: true } }) },
});

// negative: `headers` must be a valid HeadersInit
client.get_user({
  params: { id: "1" },
  query: { include: "a", page: "1" },
  // @ts-expect-error: `headers` must be a valid HeadersInit
  retry: { recover: () => ({ headers: 123 }) },
});

// --- fetch output: transport errors + narrowable response envelope ---

type GetUserResult = Awaited<ReturnType<typeof client.get_user>>;

// transport error classes are part of the result union
assignable<GetUserResult>(null as unknown as NetworkError);
assignable<GetUserResult>(null as unknown as TimeoutError);
assignable<GetUserResult>(null as unknown as ParseError);

// the response envelope narrows by ok/status to the schema outputs
assert_type<
  Equal<Extract<GetUserResult, { ok: true; status: 200 }>["data"], { id: string; name: string }>
>();
assert_type<
  Equal<
    Extract<GetUserResult, { ok: false; status: 404 }>["error"],
    { message: string; code: number }
  >
>();

// --- fetch output narrowing with `2xx` / `4xx` / `5xx` wildcard statuses ---

type WildcardResult = Awaited<ReturnType<typeof client.wildcard>>;

assert_type<
  Equal<Extract<WildcardResult, { ok: true; data: { ok: boolean } }>["data"], { ok: boolean }>
>();
assert_type<
  Equal<
    Extract<WildcardResult, { ok: false; error: { error: string } }>["error"],
    { error: string }
  >
>();
assert_type<
  Equal<
    Extract<WildcardResult, { ok: false; error: { fatal: string } }>["error"],
    { fatal: string }
  >
>();

// --- `any`-schema escape hatch: a query schema typed as `Schema.Any` widens input to `{ query: any }` ---

const any_endpoint = null as unknown as Endpoint<"GET", "/any", never, Schema.Any, never, {}>;
const any_client = http_client({ any_endpoint }, { base_url: "https://x" });
assert_type<Equal<Parameters<typeof any_client.any_endpoint>[0]["query"], any>>();

// --- endpoints declared INLINE in the map keep their inferred generics ---
// Regression guard: the `endpoints` option must not be constrained in a way that
// contextually widens an inline `new Endpoint({...})`; doing so collapses every
// schema to `Schema.Any` (losing `query`/`body` typing) and forces a spurious
// required `params: any`. Defining endpoints by reference (above) hides this, so
// these cases are intentionally inline.

const inline_client = http_client(
  {
    // paramless route, optional query → callable with `{}`, query stays typed
    list: new Endpoint({
      method: "GET",
      pathname: "/users",
      query: { schema: z.object({ page: z.string() }).optional() },
      responses: { 200: { schema: z.array(z.object({ id: z.string() })), parse: "json" } },
    }),
    // parameterized route → `params` required and typed from the schema
    get: new Endpoint({
      method: "GET",
      pathname: "/users/:id",
      params: { schema: z.object({ id: z.string() }) },
      responses: { 200: { schema: z.object({ id: z.string(), name: z.string() }), parse: "json" } },
    }),
    // body stays typed (not widened to `any`)
    create: new Endpoint({
      method: "POST",
      pathname: "/things",
      body: { schema: z.object({ name: z.string() }), serialize: "json" },
      responses: { 201: { schema: z.object({ id: z.string() }), parse: "json" } },
    }),
  },
  { base_url: "https://x" },
);

// paramless inline endpoint does NOT require `params` (callable with `{}`)
inline_client.list({});
assert_type<
  Equal<"params" extends keyof Parameters<typeof inline_client.list>[0] ? true : false, false>
>();
// inline query keeps its schema input type
assert_type<
  Equal<Parameters<typeof inline_client.list>[0]["query"], { page: string } | undefined>
>();
// inline body keeps its schema input type
assert_type<Equal<Parameters<typeof inline_client.create>[0]["body"], { name: string }>>();
// inline response schema flows through to the narrowed output
assert_type<
  Equal<
    Extract<Awaited<ReturnType<typeof inline_client.get>>, { ok: true; status: 200 }>["data"],
    { id: string; name: string }
  >
>();

// negative: a parameterized inline route still requires `params`
// @ts-expect-error: `params` is required
inline_client.get({});
// negative: wrong inline body field type is still caught (not silently `any`)
// @ts-expect-error: `name` must be a string
inline_client.create({ body: { name: 123 } });

// --- `kind` discriminant: one flat switch over the whole result union ---

declare function assert_never(value: never): never;
declare function use(value: unknown): void;

// every arm is reachable from `kind` alone, with no `instanceof` and no value import
async function exhaustive_switch() {
  const result = await client.get_user({ params: { id: "1" }, query: { include: "a", page: "1" } });

  switch (result.kind) {
    case "SuccessfulResponse":
      assert_type<Equal<typeof result.ok, true>>();
      use(result.data);
      return;
    case "RedirectMessage":
      assert_type<Equal<typeof result.redirect_to, string | null>>();
      return;
    case "ClientErrorResponse":
    case "ServerErrorResponse":
      use(result.error);
      return;
    case "TimeoutError":
    case "AbortedError":
    case "NetworkError":
    case "ParseError":
    case "SerializationError":
    case "UnexpectedError":
      use(result.context);
      return;
    default:
      // the union is fully covered: nothing reaches here
      assert_never(result);
  }
}

// negative: dropping an arm is a compile error rather than a silent fallthrough
async function non_exhaustive_switch() {
  const result = await client.get_user({ params: { id: "1" }, query: { include: "a", page: "1" } });

  switch (result.kind) {
    case "SuccessfulResponse":
      return;
    case "RedirectMessage":
      return;
    case "ClientErrorResponse":
    case "ServerErrorResponse":
      return;
    case "TimeoutError":
    case "AbortedError":
    case "NetworkError":
    case "ParseError":
    case "SerializationError":
      return;
    default:
      // `unexpected` is unhandled, so `result` is not `never` here
      // @ts-expect-error: UnexpectedError is not assignable to never
      assert_never(result);
  }
}

// `kind` discriminates without excluding the error classes first, unlike `ok` and `status`
async function kind_needs_no_peel() {
  const result = await client.get_user({ params: { id: "1" }, query: { include: "a", page: "1" } });
  if (result.kind === "SuccessfulResponse") use(result.data);

  // @ts-expect-error: `ok` still requires peeling the error classes off first
  use(result.ok);
  // @ts-expect-error: `status` still requires peeling the error classes off first
  use(result.status);
}

// the documented default: one `instanceof Error` peel, then narrow the envelopes
async function peel_then_narrow() {
  const result = await client.get_user({ params: { id: "1" }, query: { include: "a", page: "1" } });

  if (result instanceof Error) {
    use(result.message);
    use(result.context);
    return;
  }

  if (result.ok) {
    use(result.data);
  } else if (result.kind === "RedirectMessage") {
    assert_type<Equal<typeof result.redirect_to, string | null>>();
  } else {
    // only the 4xx and 5xx envelopes are left, so `error` is reachable
    assert_type<Equal<typeof result.kind, "ClientErrorResponse" | "ServerErrorResponse">>();
    use(result.error);
  }
}

// negative: the redirect arm has no `error`, so it must be split off before the `else`
async function redirect_has_no_error() {
  const result = await client.get_user({ params: { id: "1" }, query: { include: "a", page: "1" } });
  if (result instanceof Error) return;

  if (!result.ok) {
    // @ts-expect-error: RedirectMessage is still in the union here
    use(result.error);
  }
}

// `status` reaches one declared schema per branch, where `ok` cannot
async function status_narrows_per_schema() {
  const result = await client.create_user({ body: { name: "Ada" } });
  if (result instanceof Error) return;

  if (result.status === 201) {
    assert_type<Equal<typeof result.data, { id: string; created_at: string }>>();
    // @ts-expect-error: the 200-only field is not reachable from the 201 arm
    use(result.data.existing);
  }

  if (result.status === 404) {
    assert_type<Equal<typeof result.error, { message: string }>>();
    // @ts-expect-error: an error arm carries `error`, never `data`
    use(result.data);
  }
}

// the `ok` branch keeps every declared success shape in one union, so no field is directly readable
async function ok_keeps_the_success_union() {
  const result = await client.create_user({ body: { name: "Ada" } });
  if (result instanceof Error) return;

  if (result.ok) {
    // `void` is an undeclared 2xx, `null` is 204
    assert_type<
      Equal<
        typeof result.data,
        void | { id: string; existing: true } | { id: string; created_at: string } | null
      >
    >();
    // @ts-expect-error: reading a per-status field still requires narrowing on `status`
    use(result.data.created_at);
  }
}

// negative: a `status` chain is never exhaustive, which is why `default` is required
async function status_chain_is_open() {
  const result = await client.create_user({ body: { name: "Ada" } });
  if (result instanceof Error) return;

  if (result.status === 200) return;
  if (result.status === 201) return;
  if (result.status === 404) return;

  // 204, 3xx, undeclared 2xx / 4xx and every 5xx are still in the union here
  // @ts-expect-error: the remaining envelopes are not assignable to never
  const leftover: never = result;
  use(leftover);
}

// the response-side kinds are exactly the four envelopes
assert_type<
  Equal<
    Extract<$infer.Result<typeof client.get_user>, { ok: boolean }>["kind"],
    HTTPFetch.ResponseKind
  >
>();

use([
  exhaustive_switch,
  non_exhaustive_switch,
  kind_needs_no_peel,
  peel_then_narrow,
  redirect_has_no_error,
  status_narrows_per_schema,
  ok_keeps_the_success_union,
  status_chain_is_open,
]);
