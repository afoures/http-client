// Compile-time type tests for the `Endpoint` class.
// Not executed at runtime (does not match the `*.test.ts` glob); validated by `pnpm typecheck`.
import { Endpoint } from "./endpoint.ts";
import { type $infer } from "./http-client.ts";
import { ParseError } from "./errors.ts";
import z from "zod";

type Equal<left, right> =
  (<value>() => value extends left ? 1 : 2) extends <value>() => value extends right ? 1 : 2
    ? true
    : false;
declare function assert_type<condition extends true>(): condition;
declare function assignable<target>(value: target): void;

// --- fixtures ---

const get_user = new Endpoint(
  { method: "GET", pathname: "/users/:id" },
  {
    params: { schema: z.object({ id: z.string() }) },
    query: { schema: z.object({ include: z.string(), page: z.string() }) },
    responses: {
      200: { schema: z.object({ id: z.string(), name: z.string() }), parse: "json" },
      404: { schema: z.object({ message: z.string(), code: z.number() }), parse: "json" },
    },
  },
);

// param route with no params schema → params fall back to the pathname-derived shape
const get_user_no_schema = new Endpoint({ method: "GET", pathname: "/users/:id" });

// optional path param via the `(/:id)` group syntax (no schema)
const get_user_optional = new Endpoint({ method: "GET", pathname: "/users(/:id)" });

// multiple path params, no schema
const get_comment = new Endpoint({ method: "GET", pathname: "/posts/:postId/comments/:commentId" });

const search_optional = new Endpoint(
  { method: "GET", pathname: "/search" },
  {
    query: { schema: z.object({ q: z.string() }).optional() },
    responses: { 200: { schema: z.object({ hits: z.number() }), parse: "json" } },
  },
);

const create_required = new Endpoint(
  { method: "POST", pathname: "/things" },
  {
    body: { schema: z.object({ name: z.string() }), serialize: "json" },
    responses: { 201: { schema: z.object({ id: z.string() }), parse: "json" } },
  },
);

const create_optional = new Endpoint(
  { method: "POST", pathname: "/things" },
  {
    body: { schema: z.object({ name: z.string() }).optional(), serialize: "json" },
    responses: { 201: { schema: z.object({ id: z.string() }), parse: "json" } },
  },
);

// wildcard response statuses (`2xx` / `4xx` / `5xx`) acting as per-class defaults
const wildcard = new Endpoint(
  { method: "GET", pathname: "/wild" },
  {
    responses: {
      "2xx": { schema: z.object({ ok: z.boolean() }), parse: "json" },
      "4xx": { schema: z.object({ error: z.string() }), parse: "json" },
      "5xx": { schema: z.object({ fatal: z.string() }), parse: "json" },
    },
  },
);

// specific status + wildcard fallback in the same class
const mixed = new Endpoint(
  { method: "GET", pathname: "/mixed" },
  {
    responses: {
      200: { schema: z.object({ id: z.string() }), parse: "json" },
      "2xx": { schema: z.object({ generic: z.boolean() }), parse: "json" },
      404: { schema: z.object({ nf: z.string() }), parse: "json" },
      "4xx": { schema: z.object({ generic_err: z.string() }), parse: "json" },
    },
  },
);

// --- constructor / `EndpointDefinition` compile-time guards (negative cases) ---

new Endpoint(
  { method: "GET", pathname: "/no-params" },
  // @ts-expect-error: params are not allowed on a route without dynamic segments
  { params: { schema: z.object({ id: z.string() }) } },
);

new Endpoint(
  { method: "GET", pathname: "/no-body" },
  // @ts-expect-error: a GET request cannot declare a body
  { body: { schema: z.object({ name: z.string() }), serialize: "json" } },
);

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
// @ts-expect-error: `params` is required for a parameterized route
get_user.generate_url({ base_url: "https://x", query: { include: "a", page: "1" } });

// negative: an undeclared param key is rejected on its own, with `id` present
get_user.generate_url({
  base_url: "https://x",
  // @ts-expect-error: `wrong` is not a declared param
  params: { id: "1", wrong: "a" },
  query: { include: "a", page: "1" },
});

// negative: a declared param cannot be left out
get_user.generate_url({
  base_url: "https://x",
  // @ts-expect-error: `id` is missing
  params: {},
  query: { include: "a", page: "1" },
});

// positive: optional path param accepts a value, `undefined`, or string|number
get_user_optional.generate_url({ base_url: "https://x", params: { id: "1" } });
get_user_optional.generate_url({ base_url: "https://x", params: { id: undefined } });
get_user_optional.generate_url({
  base_url: "https://x",
  // @ts-expect-error: an optional param is still string | number | undefined, not boolean
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
// @ts-expect-error: `name` must be a string
create_required.serialize_body({ body: { name: 123 } });

// a body-capable method with no body schema has no `body` key at all
const create_without_schema = new Endpoint({ method: "POST", pathname: "/things" });
assert_type<Equal<Parameters<typeof create_without_schema.serialize_body>[0], {}>>();

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

// an undeclared 2xx status falls back to `null` when no `2xx` parser is declared; probed by status,
// since an `Extract` on `{ data: null }` would be satisfied by the 204 arm alone
assert_type<Equal<$infer.Data<typeof get_user, 201>, null>>();
assert_type<Equal<$infer.Data<typeof get_user, 204>, null>>();
// an undeclared 4xx or 5xx falls back to the body text
assert_type<Equal<$infer.Error<typeof get_user, 418>, string>>();
assert_type<Equal<$infer.Error<typeof get_user, 503>, string>>();

// the redirect arm is always present and exposes `redirect_to`
assignable<string | null>(
  (null as unknown as Extract<GetUserResult, { redirect_to: unknown }>).redirect_to,
);

// `ParseError` is part of the returned union
assignable<GetUserResult>(null as unknown as ParseError);

// --- no `responses` at all: the four envelopes with their built-in fallbacks ---

type NoSchemaResult = Awaited<ReturnType<typeof get_user_no_schema.parse_response>>;

assert_type<Equal<Extract<NoSchemaResult, { ok: true }>["data"], null>>();
assert_type<Equal<Extract<NoSchemaResult, { kind: "ClientErrorResponse" }>["error"], string>>();
assert_type<Equal<Extract<NoSchemaResult, { kind: "ServerErrorResponse" }>["error"], string>>();
assert_type<
  Equal<Extract<NoSchemaResult, { kind: "RedirectMessage" }>["redirect_to"], string | null>
>();

// --- `parse_response` narrowing with `2xx` / `4xx` / `5xx` wildcard statuses ---

// a wildcard's output shows up on a status it was never spelled out for
assert_type<Equal<$infer.Data<typeof wildcard, 202>, { ok: boolean }>>();
assert_type<Equal<$infer.Error<typeof wildcard, 418>, { error: string }>>();
assert_type<Equal<$infer.Error<typeof wildcard, 503>, { fatal: string }>>();
// 204 never has a body, so it yields `null` even under a `2xx` wildcard: the fallback arm of
// `HTTPFetch.SuccessfulResponse` keeps 204 out of its status set.
assert_type<Equal<$infer.Data<typeof wildcard, 204>, null>>();

// --- specific status precedence over its wildcard ---

// a specific status wins over its class wildcard
assert_type<Equal<$infer.Data<typeof mixed, 200>, { id: string }>>();
assert_type<Equal<$infer.Error<typeof mixed, 404>, { nf: string }>>();
// a status the definition does not spell out takes its class wildcard
assert_type<Equal<$infer.Data<typeof mixed, 202>, { generic: boolean }>>();
assert_type<Equal<$infer.Error<typeof mixed, 418>, { generic_err: string }>>();
// a class with no wildcard keeps the built-in fallback
assert_type<Equal<$infer.Error<typeof mixed, 500>, string>>();

// --- getters ---

// `method` carries the literal http method
assert_type<Equal<typeof get_user.method, "GET">>();
assert_type<Equal<typeof create_required.method, "POST">>();

// --- endpoint-level options accept the object form of `timeout` ---

new Endpoint(
  { method: "GET", pathname: "/timed" },
  {},
  { timeout: { total: 5000, attempt: 1000 } },
);
new Endpoint({ method: "GET", pathname: "/timed" }, {}, { timeout: 5000 });

// --- response keys: `204` is not a parser slot, since it never carries a body ---

new Endpoint(
  { method: "GET", pathname: "/no-content" },
  // @ts-expect-error: 204 is excluded from `Parser.AllowedStatus`
  { responses: { 204: { schema: z.object({ id: z.string() }), parse: "json" } } },
);

// --- schema-driven narrowing of `serialize` / `parse` (regression guards) ---

// params: an output shape that matches the pathname params keeps `serialize` optional
new Endpoint(
  { method: "GET", pathname: "/users/:id" },
  { params: { schema: z.object({ id: z.string() }) } },
);
// params: an output shape that does NOT match the pathname params makes `serialize` required
new Endpoint(
  { method: "GET", pathname: "/users/:id" },
  // @ts-expect-error: output `{ userId }` can't fill `:id`, so `serialize` is required
  { params: { schema: z.object({ userId: z.number() }) } },
);
// params: providing a `serialize` that maps to the pathname params compiles
new Endpoint(
  { method: "GET", pathname: "/users/:id" },
  {
    params: {
      schema: z.object({ userId: z.number() }),
      serialize: (data) => ({ id: String(data.userId) }),
    },
  },
);

// query: a urlencoded-compatible output keeps `serialize` optional (defaults to "urlencoded")
new Endpoint(
  { method: "GET", pathname: "/search" },
  { query: { schema: z.object({ q: z.string() }) } },
);
// query: an `Array<[string, string]>` output is also urlencoded-compatible, so `serialize` is optional
new Endpoint(
  { method: "GET", pathname: "/search" },
  { query: { schema: z.array(z.tuple([z.string(), z.string()])) } },
);
// query: array, number and boolean values are urlencoded-compatible, so `serialize` stays optional
new Endpoint(
  { method: "GET", pathname: "/search" },
  {
    query: {
      schema: z.object({
        tags: z.array(z.string()),
        page: z.number(),
        active: z.boolean(),
        cursor: z.string().nullable().optional(),
      }),
    },
  },
);
// query: a loose `string[][]` output is NOT urlencoded-compatible (pairs aren't guaranteed)
new Endpoint(
  { method: "GET", pathname: "/search" },
  // @ts-expect-error: `string[][]` isn't `Array<[string, string]>`, so `serialize` is required
  { query: { schema: z.array(z.array(z.string())) } },
);
// query: a nested-object output makes `serialize` required and rejects "urlencoded"
new Endpoint(
  { method: "GET", pathname: "/search" },
  // @ts-expect-error: nested output isn't urlencoded-compatible, so `serialize` is required
  { query: { schema: z.object({ filter: z.object({ min: z.number() }) }) } },
);
new Endpoint(
  { method: "GET", pathname: "/search" },
  {
    query: {
      schema: z.object({ filter: z.object({ min: z.number() }) }),
      // @ts-expect-error: "urlencoded" can't encode a nested object; a function is required
      serialize: "urlencoded",
    },
  },
);
// query: a URLSearchParams-returning function compiles for a nested-object output
new Endpoint(
  { method: "GET", pathname: "/search" },
  {
    query: {
      schema: z.object({ filter: z.object({ min: z.number() }) }),
      serialize: (data) => new URLSearchParams({ min: String(data.filter.min) }),
    },
  },
);

// body: `serialize` is required
new Endpoint(
  { method: "POST", pathname: "/things" },
  // @ts-expect-error: `serialize` is required for a body
  { body: { schema: z.object({ name: z.string() }) } },
);

// `data` in a custom `serialize` is the schema's validated output, in every slot
new Endpoint(
  { method: "POST", pathname: "/typed/:id" },
  {
    params: {
      schema: z.object({ id: z.number() }),
      serialize: (data) => {
        assert_type<Equal<typeof data, { id: number }>>();
        return { id: String(data.id) };
      },
    },
    query: {
      schema: z.object({ q: z.string() }),
      serialize: (data) => {
        assert_type<Equal<typeof data, { q: string }>>();
        return new URLSearchParams({ q: data.q });
      },
    },
    body: {
      schema: z.object({ name: z.string() }),
      serialize: (data) => {
        assert_type<Equal<typeof data, { name: string }>>();
        return { body: JSON.stringify(data), content_type: "application/json" };
      },
    },
  },
);

// response: a string-input schema parses as "text", not "json"
new Endpoint(
  { method: "GET", pathname: "/text" },
  {
    // @ts-expect-error: a string schema parses as "text", not "json"
    responses: {
      200: { schema: z.string(), parse: "json" },
    },
  },
);
new Endpoint(
  { method: "GET", pathname: "/text" },
  { responses: { 200: { schema: z.string(), parse: "text" } } },
);
// response: an object-input schema parses as "json", not "text"
new Endpoint(
  { method: "GET", pathname: "/obj" },
  {
    // @ts-expect-error: an object schema parses as "json", not "text"
    responses: {
      200: { schema: z.object({ id: z.string() }), parse: "text" },
    },
  },
);

// response: a custom `parse` must resolve to the schema's input
new Endpoint(
  { method: "GET", pathname: "/typed-parse" },
  {
    // @ts-expect-error: the parser yields a number where the schema expects `{ id: string }`
    responses: {
      200: { schema: z.object({ id: z.string() }), parse: async () => 123 },
    },
  },
);
new Endpoint(
  { method: "GET", pathname: "/typed-parse" },
  {
    responses: {
      200: { schema: z.object({ id: z.string() }), parse: async () => ({ id: "1" }) },
    },
  },
);

// --- a schema that accepts anything needs a `parse` function (any / unknown / void / never) ---

new Endpoint(
  { method: "GET", pathname: "/anything" },
  // @ts-expect-error: z.any() says nothing about the encoding, so "json" is rejected
  { responses: { 200: { schema: z.any(), parse: "json" } } },
);
new Endpoint(
  { method: "GET", pathname: "/anything" },
  // @ts-expect-error: and so is "text"
  { responses: { 200: { schema: z.any(), parse: "text" } } },
);
new Endpoint(
  { method: "GET", pathname: "/anything" },
  // @ts-expect-error: z.unknown() likewise
  { responses: { 200: { schema: z.unknown(), parse: "json" } } },
);
new Endpoint(
  { method: "GET", pathname: "/anything" },
  // @ts-expect-error: z.void()
  { responses: { 200: { schema: z.void(), parse: "json" } } },
);
new Endpoint(
  { method: "GET", pathname: "/anything" },
  // @ts-expect-error: z.never()
  { responses: { 200: { schema: z.never(), parse: "text" } } },
);
new Endpoint(
  { method: "GET", pathname: "/anything" },
  {
    responses: {
      200: { schema: z.any(), parse: async (body) => new Response(body).json() },
      201: { schema: z.unknown(), parse: async (body) => new Response(body).json() },
      202: { schema: z.void(), parse: async () => undefined },
    },
  },
);
// a concrete non-string schema still parses as "json", and an object with unknown values too
new Endpoint(
  { method: "GET", pathname: "/record" },
  { responses: { 200: { schema: z.record(z.string(), z.unknown()), parse: "json" } } },
);

// --- a schema that produces anything needs a `serialize` function, on the query and params slots ---
// The output-side mirror of the `parse` rule above: `any` satisfies every compatibility check, so
// without this it would take the default encoder and have its value silently dropped at runtime.

new Endpoint(
  { method: "GET", pathname: "/search" },
  // @ts-expect-error: z.any() says nothing about the encoding, so `serialize` is required
  { query: { schema: z.any() } },
);
new Endpoint(
  { method: "GET", pathname: "/search" },
  {
    query: {
      schema: z.any(),
      // @ts-expect-error: and "urlencoded" is rejected for the same reason
      serialize: "urlencoded",
    },
  },
);
new Endpoint(
  { method: "GET", pathname: "/users/:id" },
  // @ts-expect-error: an `any` params output cannot be placed in the pathname on its own
  { params: { schema: z.any() } },
);
// a function makes both slots compile again
new Endpoint(
  { method: "GET", pathname: "/users/:id" },
  {
    query: { schema: z.any(), serialize: () => new URLSearchParams() },
    params: { schema: z.any(), serialize: () => ({ id: "1" }) },
  },
);
// a concrete output is untouched by the rule, including one that is mutually assignable with the
// pathname's own params type
new Endpoint(
  { method: "GET", pathname: "/users/:id" },
  { params: { schema: z.object({ id: z.union([z.string(), z.number()]) }) } },
);

// --- custom body serializer return shapes ---

new Endpoint(
  { method: "POST", pathname: "/form" },
  {
    body: {
      schema: z.object({ name: z.string() }),
      // @ts-expect-error: FormData derives its own content type (boundary included)
      serialize: (data) => {
        const form = new FormData();
        form.append("name", data.name);
        return { body: form, content_type: "multipart/form-data" };
      },
    },
  },
);
new Endpoint(
  { method: "POST", pathname: "/form" },
  {
    body: {
      schema: z.object({ name: z.string() }),
      serialize: (data) => {
        const form = new FormData();
        form.append("name", data.name);
        return { body: form };
      },
    },
  },
);
new Endpoint(
  { method: "POST", pathname: "/stream" },
  {
    body: {
      schema: z.object({ name: z.string() }),
      // @ts-expect-error: raw bytes carry no type, so a stream requires a content_type
      serialize: (data) => ({ body: new Blob([JSON.stringify(data)]).stream() }),
    },
  },
);
new Endpoint(
  { method: "POST", pathname: "/stream" },
  {
    body: {
      schema: z.object({ name: z.string() }),
      serialize: (data) => ({
        body: new Blob([JSON.stringify(data)]).stream(),
        content_type: "application/json",
      }),
    },
  },
);
new Endpoint(
  { method: "POST", pathname: "/text" },
  {
    body: {
      schema: z.object({ name: z.string() }),
      // a string may or may not name its type
      serialize: (data) => ({ body: data.name }),
    },
  },
);
