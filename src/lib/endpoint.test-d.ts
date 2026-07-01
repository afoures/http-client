// Compile-time type tests for the `Endpoint` class.
// Not executed at runtime (does not match the `*.test.ts` glob); validated by `pnpm typecheck`.
import { Endpoint } from "./endpoint.ts";
import { ParseError } from "./errors.ts";
import z from "zod";

type Equals<left, right> =
  (<value>() => value extends left ? 1 : 2) extends <value>() => value extends right ? 1 : 2
    ? true
    : false;
type Expect<condition extends true> = condition;

// --- sample endpoints covering the public surface ---

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

// param route with no params schema → params fall back to the pathname-derived shape
const get_user_no_schema = new Endpoint({
  method: "GET",
  pathname: "/users/:id",
});

// optional path param via route-pattern's `(/:id)` syntax (no schema)
const get_user_optional = new Endpoint({
  method: "GET",
  pathname: "/users(/:id)",
});

// multiple path params, no schema
const get_comment = new Endpoint({
  method: "GET",
  pathname: "/posts/:postId/comments/:commentId",
});

const search_optional = new Endpoint({
  method: "GET",
  pathname: "/search",
  query: { schema: z.object({ q: z.string() }).optional() },
  responses: { 200: { schema: z.object({ hits: z.number() }), parse: "json" } },
});

const create_required = new Endpoint({
  method: "POST",
  pathname: "/things",
  body: { schema: z.object({ name: z.string() }), serialize: "json" },
  responses: { 201: { schema: z.object({ id: z.string() }), parse: "json" } },
});

const create_optional = new Endpoint({
  method: "POST",
  pathname: "/things",
  body: { schema: z.object({ name: z.string() }).optional(), serialize: "json" },
  responses: { 201: { schema: z.object({ id: z.string() }), parse: "json" } },
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

// specific status + wildcard fallback in the same class
const mixed = new Endpoint({
  method: "GET",
  pathname: "/mixed",
  responses: {
    200: { schema: z.object({ id: z.string() }), parse: "json" },
    "2xx": { schema: z.object({ generic: z.boolean() }), parse: "json" },
    404: { schema: z.object({ nf: z.string() }), parse: "json" },
    "4xx": { schema: z.object({ generic_err: z.string() }), parse: "json" },
  },
});

// --- constructor / `EndpointDefinition` compile-time guards (negative cases) ---

new Endpoint({
  method: "GET",
  pathname: "/no-params",
  // @ts-expect-error — params are not allowed on a route without dynamic segments
  params: { schema: z.object({ id: z.string() }) },
});

new Endpoint({
  method: "GET",
  pathname: "/no-body",
  // @ts-expect-error — a GET request cannot declare a body
  body: { schema: z.object({ name: z.string() }), serialize: "json" },
});

// --- `generate_url` input ---

// full input: base_url + required params (schema input) + required query
type _gu_input = Expect<
  Equals<
    Parameters<typeof get_user.generate_url>[0],
    { base_url: string; params: { id: string }; query: { include: string; page: string } }
  >
>;

// param route without a schema → params default to `Pathname.Params<pathname>` (string | number)
type _gu_no_schema_params = Expect<
  Equals<Parameters<typeof get_user_no_schema.generate_url>[0]["params"], { id: string | number }>
>;

// optional path param → value widens to include `undefined`, key stays present
type _gu_optional_param = Expect<
  Equals<
    Parameters<typeof get_user_optional.generate_url>[0]["params"],
    { id: string | number | undefined }
  >
>;

// every path param is required and string|number-typed
type _gu_multi_params = Expect<
  Equals<
    Parameters<typeof get_comment.generate_url>[0]["params"],
    { postId: string | number; commentId: string | number }
  >
>;

// optional query schema → `query` is an optional key
type _gu_optional_query = Expect<
  Equals<
    Parameters<typeof search_optional.generate_url>[0],
    { base_url: string; query?: { q: string } | undefined }
  >
>;

// negative: required params omitted
// @ts-expect-error — `params` is required for a parameterized route
get_user.generate_url({ base_url: "https://x", query: { include: "a", page: "1" } });

// negative: wrong param key
get_user.generate_url({
  base_url: "https://x",
  // @ts-expect-error — `wrong` is not a declared param; `id` is missing
  params: { wrong: "a" },
  query: { include: "a", page: "1" },
});

// positive: optional path param accepts a value, `undefined`, or string|number
get_user_optional.generate_url({ base_url: "https://x", params: { id: "1" } });
get_user_optional.generate_url({ base_url: "https://x", params: { id: undefined } });
get_user_optional.generate_url({
  base_url: "https://x",
  // @ts-expect-error — an optional param is still string | number | undefined, not boolean
  params: { id: true },
});

// --- `serialize_body` input ---

// required body schema → `body` is a required key typed to the schema input
type _sb_required = Expect<
  Equals<Parameters<typeof create_required.serialize_body>[0], { body: { name: string } }>
>;

// optional body schema → `body` is an optional key
type _sb_optional = Expect<
  Equals<
    Parameters<typeof create_optional.serialize_body>[0],
    { body?: { name: string } | undefined }
  >
>;

// negative: wrong body field type
// @ts-expect-error — `name` must be a string
create_required.serialize_body({ body: { name: 123 } });

// --- `parse_response` return narrowing ---

type GetUserResult = Awaited<ReturnType<typeof get_user.parse_response>>;

// keyed success status carries the 200 schema output as `data`
type _data_200 = Expect<
  Equals<Extract<GetUserResult, { ok: true; status: 200 }>["data"], { id: string; name: string }>
>;

// keyed client-error status carries the 404 schema output as `error`
type _error_404 = Expect<
  Equals<
    Extract<GetUserResult, { ok: false; status: 404 }>["error"],
    { message: string; code: number }
  >
>;

// unspecified 2xx falls back to the `2xx` default (`void` when none is declared)
type _success_fallback = Expect<
  Equals<Extract<GetUserResult, { ok: true; data: void }>["data"], void>
>;

// the redirect arm is always present and exposes `redirect_to`
const _redirect = null as unknown as Extract<GetUserResult, { redirect_to: unknown }>;
const _redirect_to: string | null = _redirect.redirect_to;

// `ParseError` is part of the returned union
const _includes_parse_error: GetUserResult = null as unknown as ParseError;

// --- `parse_response` narrowing with `2xx` / `4xx` / `5xx` wildcard statuses ---

type WildcardResult = Awaited<ReturnType<typeof wildcard.parse_response>>;

// `2xx` default applies as `data` to every successful (non-204) status
type _wild_2xx = Expect<
  Equals<Extract<WildcardResult, { ok: true; data: { ok: boolean } }>["data"], { ok: boolean }>
>;
// `4xx` default applies as `error` to every client-error status
type _wild_4xx = Expect<
  Equals<
    Extract<WildcardResult, { ok: false; error: { error: string } }>["error"],
    { error: string }
  >
>;
// `5xx` default applies as `error` to every server-error status
type _wild_5xx = Expect<
  Equals<
    Extract<WildcardResult, { ok: false; error: { fatal: string } }>["error"],
    { fatal: string }
  >
>;

// --- specific status precedence over its wildcard ---

type MixedResult = Awaited<ReturnType<typeof mixed.parse_response>>;

// a specific status wins over its class wildcard
type _mixed_200 = Expect<
  Equals<Extract<MixedResult, { ok: true; status: 200 }>["data"], { id: string }>
>;
type _mixed_404 = Expect<
  Equals<Extract<MixedResult, { ok: false; status: 404 }>["error"], { nf: string }>
>;
// remaining statuses fall back to the wildcard default
type _mixed_2xx = Expect<
  Equals<
    Extract<MixedResult, { ok: true; data: { generic: boolean } }>["data"],
    { generic: boolean }
  >
>;
type _mixed_4xx = Expect<
  Equals<
    Extract<MixedResult, { ok: false; error: { generic_err: string } }>["error"],
    { generic_err: string }
  >
>;

// --- getters ---

// `method` carries the literal http method
type _method = Expect<Equals<typeof get_user.method, "GET">>;
type _method_post = Expect<Equals<typeof create_required.method, "POST">>;

// reference the unused-symbol-sensitive bindings
void _redirect_to;
void _includes_parse_error;

export type {
  _gu_input,
  _gu_no_schema_params,
  _gu_optional_param,
  _gu_multi_params,
  _gu_optional_query,
  _sb_required,
  _sb_optional,
  _data_200,
  _error_404,
  _success_fallback,
  _wild_2xx,
  _wild_4xx,
  _wild_5xx,
  _mixed_200,
  _mixed_404,
  _mixed_2xx,
  _mixed_4xx,
  _method,
  _method_post,
};
