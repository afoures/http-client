// Compile-time type tests for pathname pattern parsing.
// Not executed at runtime (does not match the `*.test.ts` glob); validated by `pnpm typecheck`.
import { Endpoint } from "./endpoint.ts";
import { type PathnameParams } from "./pathname.ts";
import { type Pathname } from "./types.ts";

type Equal<left, right> =
  (<value>() => value extends left ? 1 : 2) extends <value>() => value extends right ? 1 : 2
    ? true
    : false;
declare function assert_type<condition extends true>(): condition;

type Pretty<value> = { [key in keyof value]: value[key] } & {};
type Params<pathname extends string> = Pretty<PathnameParams<pathname>>;

// --- required params ---

assert_type<Equal<Params<"/users">, {}>>();
assert_type<Equal<Params<"/users/:id">, { id: string }>>();
assert_type<
  Equal<Params<"/posts/:postId/comments/:commentId">, { postId: string; commentId: string }>
>();

// --- the full identifier charset, `[a-zA-Z_$][a-zA-Z_$0-9]*` ---

assert_type<Equal<Params<"/:_hello_WORLD">, { _hello_WORLD: string }>>();
assert_type<Equal<Params<"/:$_hello_WORLD$123$">, { $_hello_WORLD$123$: string }>>();

// A name stops at the first character outside the charset, so the surrounding text is not
// swallowed into it.
assert_type<Equal<Params<"/:id|x">, { id: string }>>();
assert_type<Equal<Params<"/:id-y">, { id: string }>>();
assert_type<Equal<Params<"/:id.z">, { id: string }>>();
assert_type<Equal<Params<"/:id x">, { id: string }>>();

// --- several params in one segment ---

assert_type<Equal<Params<"/v:major.:minor">, { major: string; minor: string }>>();
assert_type<Equal<Params<"/x-:id-y">, { id: string }>>();
assert_type<
  Equal<
    Params<"/blog/:year-:month-:day/:slug">,
    { year: string; month: string; day: string; slug: string }
  >
>();

// --- optional groups keep their key and widen the value ---

assert_type<Equal<Params<"/users(/:id)">, { id: string | undefined }>>();
assert_type<Equal<Params<"/users/(:id)">, { id: string | undefined }>>();
assert_type<Equal<Params<"/files(.:ext)">, { ext: string | undefined }>>();
assert_type<Equal<Params<"/a(/:b)(/:c)">, { b: string | undefined; c: string | undefined }>>();
assert_type<Equal<Params<"/a(/:b(/:c))/d">, { b: string | undefined; c: string | undefined }>>();

// A required param stays required alongside an optional one.
assert_type<Equal<Params<"/users/:id(/:tab)">, { id: string; tab: string | undefined }>>();

// --- a non-literal pathname falls back to an open record ---

assert_type<Equal<PathnameParams<string>, Record<string, string | undefined>>>();

// --- `Pathname.Params` widens each value to accept a number ---

assert_type<Equal<Pathname.Params<"/users/:id">, { id: string | number }>>();
assert_type<Equal<Pathname.Params<"/users(/:id)">, { id: string | number | undefined }>>();

// --- `Pathname.Validate` rejects a search string or fragment ---

assert_type<Equal<Pathname.Validate<"/users/:id">, "/users/:id">>();
assert_type<Equal<Pathname.Validate<"/users(/:id)">, "/users(/:id)">>();

// @ts-expect-error a search string belongs in `query`, not the pathname
new Endpoint({ method: "GET", pathname: "/users?page=1" });

// @ts-expect-error a fragment is never sent to the server
new Endpoint({ method: "GET", pathname: "/users#top" });

// The pathname literal is still inferred through the validation, so params stay typed.
const versioned = new Endpoint({ method: "GET", pathname: "/v:major.:minor/users/:id" });
assert_type<
  Equal<
    Parameters<typeof versioned.generate_url>[0]["params"],
    { major: string | number; minor: string | number; id: string | number }
  >
>();
