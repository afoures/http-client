// Compile-time type tests for the `$infer` namespace.
// Not executed at runtime (does not match the `*.test.ts` glob); validated by `pnpm typecheck`.
import { http_client, type $infer } from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import { NetworkError } from "./errors.ts";
import z from "zod";

type Equals<left, right> =
  (<value>() => value extends left ? 1 : 2) extends <value>() => value extends right ? 1 : 2
    ? true
    : false;
type Expect<condition extends true> = condition;

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

const search_optional = new Endpoint({
  method: "GET",
  pathname: "/search",
  query: { schema: z.object({ q: z.string() }).optional() },
  responses: { 200: { schema: z.object({ hits: z.number() }), parse: "json" } },
});

const create_optional = new Endpoint({
  method: "POST",
  pathname: "/things",
  body: { schema: z.object({ name: z.string() }).optional(), serialize: "json" },
  responses: { 201: { schema: z.object({ id: z.string() }), parse: "json" } },
});

const client = http_client({
  base_url: "https://api.example.com",
  endpoints: { get_user, search_optional, create_optional },
});

// --- inputs resolve to the schema input type ---
type _params = Expect<Equals<$infer.Params<typeof client.get_user>, { id: string }>>;
type _query = Expect<
  Equals<$infer.Query<typeof client.get_user>, { include: string; page: string }>
>;

// --- regression guard: optional input keys resolve to `T | undefined`, NOT `never` ---
type _optional_query = Expect<
  Equals<$infer.Query<typeof client.search_optional>, { q: string } | undefined>
>;
type _optional_body = Expect<
  Equals<$infer.Body<typeof client.create_optional>, { name: string } | undefined>
>;

// --- accepts a raw `Endpoint` instance, not just the bound fetch function ---
type _query_from_endpoint = Expect<
  Equals<$infer.Query<typeof get_user>, { include: string; page: string }>
>;

// --- per-status data / error narrowing ---
type _data_200 = Expect<
  Equals<$infer.Data<typeof client.get_user, 200>, { id: string; name: string }>
>;
type _error_404 = Expect<
  Equals<$infer.Error<typeof client.get_user, 404>, { message: string; code: number }>
>;

// --- Result includes transport errors; Response excludes them but stays narrowable ---
const _is_result: $infer.Result<typeof client.get_user> = null as unknown as NetworkError;
// @ts-expect-error — a transport error is not part of the `{ ok: boolean }` envelope union.
const _not_response: $infer.Response<typeof client.get_user> = null as unknown as NetworkError;

// Response keeps the envelope discriminants, so it stays narrowable.
const _response = null as unknown as $infer.Response<typeof client.get_user>;
const _response_ok: boolean = _response.ok;
const _response_status: number = _response.status;

// reference the type aliases so `noUnusedLocals`-style tools stay quiet
export type {
  _params,
  _query,
  _optional_query,
  _optional_body,
  _query_from_endpoint,
  _data_200,
  _error_404,
};
