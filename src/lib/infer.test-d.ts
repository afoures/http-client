// Compile-time type tests for the `$infer` namespace.
// Not executed at runtime (does not match the `*.test.ts` glob); validated by `pnpm typecheck`.
import { http_client, type $infer } from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import { NetworkError } from "./errors.ts";
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

const path_optional = new Endpoint(
  { method: "GET", pathname: "/search(/:query)" },
  {
    query: { schema: z.object({ q: z.string() }).optional() },
    responses: { 200: { schema: z.object({ hits: z.number() }), parse: "json" } },
  },
);

const search_optional = new Endpoint(
  { method: "GET", pathname: "/search" },
  {
    query: { schema: z.object({ q: z.string() }).optional() },
    responses: { 200: { schema: z.object({ hits: z.number() }), parse: "json" } },
  },
);

const create_optional = new Endpoint(
  { method: "POST", pathname: "/things" },
  {
    body: { schema: z.object({ name: z.string() }).optional(), serialize: "json" },
    responses: { 201: { schema: z.object({ id: z.string() }), parse: "json" } },
  },
);

const client = http_client(
  { get_user, wildcard, path_optional, search_optional, create_optional },
  { base_url: "https://api.example.com" },
);

// --- inputs resolve to the schema input type ---
assert_type<Equal<$infer.Params<typeof client.get_user>, { id: string }>>();
assert_type<
  Equal<
    $infer.Params<typeof client.path_optional>,
    {
      query: string | number | undefined;
    }
  >
>();
assert_type<Equal<$infer.Query<typeof client.get_user>, { include: string; page: string }>>();

// --- regression guard: optional input keys resolve to `T | undefined`, NOT `never` ---
assert_type<Equal<$infer.Query<typeof client.search_optional>, { q: string } | undefined>>();
assert_type<Equal<$infer.Body<typeof client.create_optional>, { name: string } | undefined>>();

// --- `Input` is the whole call payload: the typed slots plus the request init ---
type GetUserInput = $infer.Input<typeof client.get_user>;
assert_type<Equal<GetUserInput["params"], { id: string }>>();
assert_type<Equal<GetUserInput["query"], { include: string; page: string }>>();
assert_type<
  Equal<GetUserInput["timeout"], number | { total?: number; attempt?: number } | undefined>
>();
assert_type<Equal<"body" extends keyof GetUserInput ? true : false, false>>();
assert_type<Equal<"context" extends keyof GetUserInput ? true : false, false>>();
assert_type<
  Equal<"body" extends keyof $infer.Input<typeof client.create_optional> ? true : false, true>
>();

// --- every helper accepts a raw `Endpoint` instance, not just the bound fetch function ---
assert_type<Equal<$infer.Params<typeof get_user>, { id: string }>>();
assert_type<Equal<$infer.Query<typeof get_user>, { include: string; page: string }>>();
assert_type<Equal<$infer.Body<typeof create_optional>, { name: string } | undefined>>();
assert_type<Equal<$infer.Input<typeof get_user>["params"], { id: string }>>();
assert_type<Equal<$infer.Data<typeof get_user, 200>, { id: string; name: string }>>();
assert_type<Equal<$infer.Error<typeof get_user, 404>, { message: string; code: number }>>();
assignable<$infer.Result<typeof get_user>>(null as unknown as NetworkError);
// @ts-expect-error: `Response` on a raw Endpoint drops the transport errors too
assignable<$infer.Response<typeof get_user>>(null as unknown as NetworkError);
assert_type<Equal<$infer.Response<typeof get_user>, $infer.Response<typeof client.get_user>>>();
// an endpoint with no context has no `context` slot, so `Context` is `never` in both forms
assert_type<Equal<$infer.Context<typeof get_user>, never>>();
assert_type<Equal<$infer.Context<typeof client.get_user>, never>>();

// --- per-status data / error narrowing ---
assert_type<Equal<$infer.Data<typeof client.get_user, 200>, { id: string; name: string }>>();
assert_type<Equal<$infer.Data<typeof client.get_user>, { id: string; name: string } | null>>();
assert_type<Equal<$infer.Error<typeof client.get_user, 404>, { message: string; code: number }>>();
assert_type<
  Equal<$infer.Error<typeof client.get_user>, { message: string; code: number } | string>
>();
assert_type<Equal<$infer.Error<typeof client.get_user, 500>, string>>();

// an undeclared 2xx falls back to `null`, probed on a status the definition never names
assert_type<Equal<$infer.Data<typeof client.get_user, 201>, null>>();
// a status class that cannot carry the field resolves to `never` rather than a fallback
assert_type<Equal<$infer.Data<typeof client.get_user, 404>, never>>();
assert_type<Equal<$infer.Error<typeof client.get_user, 200>, never>>();
// an endpoint with no `responses` keeps the built-in fallbacks
const bare = new Endpoint({ method: "GET", pathname: "/bare" });
assert_type<Equal<$infer.Data<typeof bare>, null>>();
assert_type<Equal<$infer.Error<typeof bare>, string>>();

// --- wildcard setup: the wildcard's output lands on a status it was never spelled out for ---
assert_type<Equal<$infer.Data<typeof client.wildcard, 200>, { ok: boolean }>>();
assert_type<Equal<$infer.Data<typeof client.wildcard, 202>, { ok: boolean }>>();
// 204 is never claimed by the `2xx` wildcard: it has no body, so it stays `null`
assert_type<Equal<$infer.Data<typeof client.wildcard, 204>, null>>();
assert_type<Equal<$infer.Data<typeof client.wildcard>, { ok: boolean } | null>>();
assert_type<Equal<$infer.Error<typeof client.wildcard, 404>, { error: string }>>();
assert_type<Equal<$infer.Error<typeof client.wildcard, 418>, { error: string }>>();
assert_type<Equal<$infer.Error<typeof client.wildcard, 500>, { fatal: string }>>();
assert_type<Equal<$infer.Error<typeof client.wildcard, 503>, { fatal: string }>>();

// --- Result includes transport errors; Response excludes them but stays narrowable ---
assignable<$infer.Result<typeof client.get_user>>(null as unknown as NetworkError);
// @ts-expect-error: a transport error is not part of the `{ ok: boolean }` envelope union.
assignable<$infer.Response<typeof client.get_user>>(null as unknown as NetworkError);

// Response keeps the envelope discriminants, so it stays narrowable.
const response = null as unknown as $infer.Response<typeof client.get_user>;
assignable<boolean>(response.ok);
assignable<number>(response.status);
