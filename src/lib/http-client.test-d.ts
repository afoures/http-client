// Compile-time type tests for the `http_client` factory.
// Not executed at runtime (does not match the `*.test.ts` glob); validated by `pnpm typecheck`.
import { http_client } from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import { NetworkError, ParseError, TimeoutError } from "./errors.ts";
import type { Schema } from "./types.ts";
import z from "zod";

type Equals<left, right> =
  (<value>() => value extends left ? 1 : 2) extends <value>() => value extends right ? 1 : 2
    ? true
    : false;
type Expect<condition extends true> = condition;

// --- sample endpoints ---

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

// optional path param via route-pattern's `(/:id)` syntax (no schema)
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

const client = http_client({
  base_url: "https://api.example.com",
  endpoints: {
    get_user,
    create_required,
    get_user_optional,
    wildcard,
    // nested endpoint map → mapped recursively
    admin: { get_user },
  },
});

// --- mapping: endpoints become callable fetch functions, including nested maps ---

type _is_fn = Expect<
  Equals<typeof client.get_user extends (...args: never[]) => unknown ? true : false, true>
>;
type _nested_is_fn = Expect<
  Equals<typeof client.admin.get_user extends (...args: never[]) => unknown ? true : false, true>
>;

// --- fetch input shape ---

type GetUserInput = Parameters<typeof client.get_user>[0];

type _in_params = Expect<Equals<GetUserInput["params"], { id: string }>>;
type _in_query = Expect<Equals<GetUserInput["query"], { include: string; page: string }>>;
// request-init keys are merged in (OptionalRequestInit + DefaultRequestInit)
type _in_timeout = Expect<Equals<GetUserInput["timeout"], number | undefined>>;

// optional path param flows through the mapped fetch input
type _in_optional_param = Expect<
  Equals<
    Parameters<typeof client.get_user_optional>[0]["params"],
    { id: string | number | undefined }
  >
>;

// positive: a fully-formed call with request-init options type-checks
client.get_user({
  params: { id: "1" },
  query: { include: "a", page: "1" },
  timeout: 1000,
  signal: new AbortController().signal,
  headers: { "x-trace": "y" },
});

// negative: required `params` omitted
// @ts-expect-error — `params` is required
client.get_user({ query: { include: "a", page: "1" } });

// negative: required `query` omitted
// @ts-expect-error — `query` is required
client.get_user({ params: { id: "1" } });

// negative: GET input has no `body` key
client.get_user({
  params: { id: "1" },
  query: { include: "a", page: "1" },
  // @ts-expect-error — a GET endpoint's input does not accept `body`
  body: { anything: true },
});

// negative: wrong body field type on a POST endpoint
// @ts-expect-error — `name` must be a string
client.create_required({ body: { name: 123 } });

// --- fetch output: transport errors + narrowable response envelope ---

type GetUserResult = Awaited<ReturnType<typeof client.get_user>>;

// transport error classes are part of the result union
const _net: GetUserResult = null as unknown as NetworkError;
const _timeout: GetUserResult = null as unknown as TimeoutError;
const _parse: GetUserResult = null as unknown as ParseError;

// the response envelope narrows by ok/status to the schema outputs
type _out_data_200 = Expect<
  Equals<Extract<GetUserResult, { ok: true; status: 200 }>["data"], { id: string; name: string }>
>;
type _out_error_404 = Expect<
  Equals<
    Extract<GetUserResult, { ok: false; status: 404 }>["error"],
    { message: string; code: number }
  >
>;

// --- fetch output narrowing with `2xx` / `4xx` / `5xx` wildcard statuses ---

type WildcardResult = Awaited<ReturnType<typeof client.wildcard>>;

type _w_2xx = Expect<
  Equals<Extract<WildcardResult, { ok: true; data: { ok: boolean } }>["data"], { ok: boolean }>
>;
type _w_4xx = Expect<
  Equals<
    Extract<WildcardResult, { ok: false; error: { error: string } }>["error"],
    { error: string }
  >
>;
type _w_5xx = Expect<
  Equals<
    Extract<WildcardResult, { ok: false; error: { fatal: string } }>["error"],
    { fatal: string }
  >
>;

// --- `any`-schema escape hatch: a query schema typed as `Schema.Any` widens input to `{ query: any }` ---

const any_endpoint = null as unknown as Endpoint<"GET", "/any", never, Schema.Any, never, {}>;
const any_client = http_client({ base_url: "https://x", endpoints: { any_endpoint } });
type _any_query = Expect<Equals<Parameters<typeof any_client.any_endpoint>[0]["query"], any>>;

// --- endpoints declared INLINE in the map keep their inferred generics ---
// Regression guard: the `endpoints` option must not be constrained in a way that
// contextually widens an inline `new Endpoint({...})` — doing so collapses every
// schema to `Schema.Any` (losing `query`/`body` typing) and forces a spurious
// required `params: any`. Defining endpoints by reference (above) hides this, so
// these cases are intentionally inline.

const inline_client = http_client({
  base_url: "https://x",
  endpoints: {
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
});

// paramless inline endpoint does NOT require `params` (callable with `{}`)
inline_client.list({});
type _inline_no_params = Expect<
  Equals<"params" extends keyof Parameters<typeof inline_client.list>[0] ? true : false, false>
>;
// inline query keeps its schema input type
type _inline_query = Expect<
  Equals<Parameters<typeof inline_client.list>[0]["query"], { page: string } | undefined>
>;
// inline body keeps its schema input type
type _inline_body = Expect<
  Equals<Parameters<typeof inline_client.create>[0]["body"], { name: string }>
>;
// inline response schema flows through to the narrowed output
type _inline_data = Expect<
  Equals<
    Extract<Awaited<ReturnType<typeof inline_client.get>>, { ok: true; status: 200 }>["data"],
    { id: string; name: string }
  >
>;

// negative: a parameterized inline route still requires `params`
// @ts-expect-error — `params` is required
inline_client.get({});
// negative: wrong inline body field type is still caught (not silently `any`)
// @ts-expect-error — `name` must be a string
inline_client.create({ body: { name: 123 } });

// reference the unused-symbol-sensitive bindings
void _net;
void _timeout;
void _parse;

export type {
  _is_fn,
  _nested_is_fn,
  _in_params,
  _in_query,
  _in_timeout,
  _in_optional_param,
  _out_data_200,
  _out_error_404,
  _w_2xx,
  _w_4xx,
  _w_5xx,
  _any_query,
  _inline_no_params,
  _inline_query,
  _inline_body,
  _inline_data,
};
