// Compile-time type tests for the `Endpoint` class.
// Not executed at runtime (does not match the `*.test.ts` glob); validated by `pnpm typecheck`.
import { Endpoint } from "./endpoint.ts";
import { ParseError } from "./errors.ts";
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
assert_type<
  Equal<
    Parameters<typeof get_user.generate_url>[0],
    { base_url: string; params: { id: string }; query: { include: string; page: string } }
  >
>();

// param route without a schema → params default to `Pathname.Params<pathname>` (string | number)
assert_type<
  Equal<Parameters<typeof get_user_no_schema.generate_url>[0]["params"], { id: string | number }>
>();

// optional path param → value widens to include `undefined`, key stays present
assert_type<
  Equal<
    Parameters<typeof get_user_optional.generate_url>[0]["params"],
    { id: string | number | undefined }
  >
>();

// every path param is required and string|number-typed
assert_type<
  Equal<
    Parameters<typeof get_comment.generate_url>[0]["params"],
    { postId: string | number; commentId: string | number }
  >
>();

// optional query schema → `query` is an optional key
assert_type<
  Equal<
    Parameters<typeof search_optional.generate_url>[0],
    { base_url: string; query?: { q: string } | undefined }
  >
>();

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
assert_type<
  Equal<Parameters<typeof create_required.serialize_body>[0], { body: { name: string } }>
>();

// optional body schema → `body` is an optional key
assert_type<
  Equal<
    Parameters<typeof create_optional.serialize_body>[0],
    { body?: { name: string } | undefined }
  >
>();

// negative: wrong body field type
// @ts-expect-error — `name` must be a string
create_required.serialize_body({ body: { name: 123 } });

// --- `parse_response` return narrowing ---

type GetUserResult = Awaited<ReturnType<typeof get_user.parse_response>>;

// keyed success status carries the 200 schema output as `data`
assert_type<
  Equal<Extract<GetUserResult, { ok: true; status: 200 }>["data"], { id: string; name: string }>
>();

// keyed client-error status carries the 404 schema output as `error`
assert_type<
  Equal<
    Extract<GetUserResult, { ok: false; status: 404 }>["error"],
    { message: string; code: number }
  >
>();

// unspecified 2xx falls back to the `2xx` default (`void` when none is declared)
assert_type<Equal<Extract<GetUserResult, { ok: true; data: void }>["data"], void>>();

// the redirect arm is always present and exposes `redirect_to`
assignable<string | null>(
  (null as unknown as Extract<GetUserResult, { redirect_to: unknown }>).redirect_to,
);

// `ParseError` is part of the returned union
assignable<GetUserResult>(null as unknown as ParseError);

// --- `parse_response` narrowing with `2xx` / `4xx` / `5xx` wildcard statuses ---

type WildcardResult = Awaited<ReturnType<typeof wildcard.parse_response>>;

// `2xx` default applies as `data` to every successful (non-204) status
assert_type<
  Equal<Extract<WildcardResult, { ok: true; data: { ok: boolean } }>["data"], { ok: boolean }>
>();
// `4xx` default applies as `error` to every client-error status
assert_type<
  Equal<
    Extract<WildcardResult, { ok: false; error: { error: string } }>["error"],
    { error: string }
  >
>();
// `5xx` default applies as `error` to every server-error status
assert_type<
  Equal<
    Extract<WildcardResult, { ok: false; error: { fatal: string } }>["error"],
    { fatal: string }
  >
>();

// --- specific status precedence over its wildcard ---

type MixedResult = Awaited<ReturnType<typeof mixed.parse_response>>;

// a specific status wins over its class wildcard
assert_type<Equal<Extract<MixedResult, { ok: true; status: 200 }>["data"], { id: string }>>();
assert_type<Equal<Extract<MixedResult, { ok: false; status: 404 }>["error"], { nf: string }>>();
// remaining statuses fall back to the wildcard default
assert_type<
  Equal<
    Extract<MixedResult, { ok: true; data: { generic: boolean } }>["data"],
    { generic: boolean }
  >
>();
assert_type<
  Equal<
    Extract<MixedResult, { ok: false; error: { generic_err: string } }>["error"],
    { generic_err: string }
  >
>();

// --- getters ---

// `method` carries the literal http method
assert_type<Equal<typeof get_user.method, "GET">>();
assert_type<Equal<typeof create_required.method, "POST">>();
