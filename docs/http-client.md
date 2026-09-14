# HTTP Client

The `http_client` function creates a typed API client from a map of endpoints.

## Basic Usage

```typescript
import { Endpoint, http_client } from "@afoures/http-client";
import { z } from "zod";

const api = http_client(
  {
    users: new Endpoint(
      { method: "GET", pathname: "/users" },
      { responses: { 200: { schema: z.array(z.object({ id: z.string() })), parse: "json" } } },
    ),
  },
  { base_url: "https://api.example.com" },
);

const result = await api.users({});
```

Every call takes one argument, the request input, even when the endpoint needs nothing: `{}` is the
whole input for a parameterless `GET`. Request options such as `headers`, `timeout`, `retry` and
`signal` go in the same object (see [Per-Request Options](#per-request-options)).

## Base URL

Each endpoint's pathname is resolved against `base_url` with standard `URL` resolution, the same
rule as `new URL(pathname, base_url)`. A path prefix is kept only when the base ends with a slash;
otherwise its last segment is replaced by the pathname:

```typescript
base_url: "https://api.example.com"; // + "/users" -> https://api.example.com/users
base_url: "https://api.example.com/v1/"; // + "/users" -> https://api.example.com/v1/users
base_url: "https://api.example.com/v1"; // + "/users" -> https://api.example.com/users (prefix dropped)
```

`base_url` must be absolute and parsable. `http_client` throws a `TypeError` at construction
otherwise. That is one of only two things it throws for rather than returning an error, the other
being a malformed endpoint tree (see [Organizing Endpoints](#organizing-endpoints) and
[Error Handling](./error-handling.md)).

## Organizing Endpoints

Nest endpoints in objects for logical grouping:

```typescript
const api = http_client(
  {
    users: {
      list: new Endpoint({ method: "GET", pathname: "/users" }),
      get: new Endpoint({ method: "GET", pathname: "/users/:id" }),
      create: new Endpoint({ method: "POST", pathname: "/users" }),
      update: new Endpoint({ method: "PUT", pathname: "/users/:id" }),
      delete: new Endpoint({ method: "DELETE", pathname: "/users/:id" }),
    },
    posts: {
      list: new Endpoint({ method: "GET", pathname: "/posts" }),
      get: new Endpoint({ method: "GET", pathname: "/posts/:id" }),
      comments: {
        list: new Endpoint({ method: "GET", pathname: "/posts/:post_id/comments" }),
        create: new Endpoint(
          { method: "POST", pathname: "/posts/:post_id/comments" },
          { body: { schema: z.object({ text: z.string() }), serialize: "json" } },
        ),
      },
    },
  },
  { base_url: "https://api.example.com" },
);

// Fully typed paths
await api.users.list({});
await api.users.get({ params: { id: "123" } });
await api.posts.comments.create({ params: { post_id: "1" }, body: { text: "Nice!" } });
```

A `body` is only accepted where the endpoint declares a `body` serializer: on `users.create` above,
which declares none, passing one is a compile error, and the request goes out without a body.

Every node of the tree is an `Endpoint` or a plain object grouping more of them, and nothing else.

## Shared Options

Provide sync or async default options for all requests:

```typescript
const api = http_client(
  {
    /* ...endpoints... */
  },
  {
    base_url: "https://api.example.com",
    options: async () => {
      const token = await getAuthToken();
      return { headers: { Authorization: `Bearer ${token}` } };
    },
  },
);
```

Options are merged in this order (later overrides earlier):

1. `options()` from `http_client`
2. Endpoint default options
3. Per-request options

Three keys merge more finely than "later overrides earlier":

- `headers` merge per header name, see [Headers](#headers).
- `timeout` and `retry` merge per key, so a client-level `timeout: { attempt: 2000 }` survives a
  per-call `timeout: { total: 5000 }`, and a client-level `retry.when` survives a per-call
  `retry: { attempts: 3 }`. A key set to `undefined` at a more specific level means "not set here"
  and inherits the earlier value; only a different value replaces it.
- `signal`s are combined with `AbortSignal.any`, so a client-level, endpoint-level and per-call
  signal all stay in force and any one of them aborts the call.

Everything else in the merged options is passed to the `Request` constructor as-is: `credentials`,
`cache`, `redirect`, `mode`, `referrer` and the rest of `RequestInit`, minus `body` and `method`,
which the endpoint owns, and `Content-Type`, which the body serializer owns (see
[Content-Type](./serialization.md#content-type)).

The `options()` factory runs once per call, before anything else, so an `async` factory that fetches
a token adds its own duration to the call. That time counts against `timeout.total`.

## Shared Context

Provide a client-level default [context](./dynamic-context.md) shared by every
endpoint. It fills matching keys for any endpoint whose context type declares them, making those
keys optional at the call site:

```typescript
const api = http_client(
  {
    /* ...endpoints... */
  },
  { base_url: "https://api.example.com", context: { locale: "en" } },
);
```

The `context` option is typed as the merged shape of every endpoint's declared context, so your
editor proposes the valid keys and rejects unknown or mistyped ones. A key that several endpoints
declare with [conflicting types](./dynamic-context.md#shared-keys-must-agree-on-their-type) cannot
take a client-level default.

Context is merged in this order (later overrides earlier):

1. `context` from `http_client`
2. Endpoint-level defaults (the `context` option of the endpoint's third argument)
3. Per-request `context`

## Wrapping the Client

To expose your own factory that accepts client-level defaults, annotate its config with
`HttpClientConfig<typeof endpoints, default_context>` and thread `default_context` through a type
parameter constrained with `ClientContext`. The `context` shape is derived from the endpoint tree,
so there is nothing to restate by hand.

```typescript
const endpoints = { rooms };

export function create_my_client<
  const default_context extends ClientContext<typeof endpoints> = never,
>(config: HttpClientConfig<typeof endpoints, default_context>) {
  return http_client(endpoints, config);
}

const api = create_my_client({ base_url: "https://api.example.com", context: { locale: "en" } });
// `locale` is optional at the call site, keys the caller did not default stay required
```

The type parameter is what records which defaults the caller actually passed. Without it, the
config declares no client-level defaults at all: its `context` is rejected, and every declared
context key stays required at the call site.

```typescript
export type MyClientConfig = HttpClientConfig<typeof endpoints>;

export function create_my_client(config: MyClientConfig) {
  return http_client(endpoints, config);
}

const api = create_my_client({ base_url: "https://api.example.com" });
// every declared context key must be passed per call
```

## Custom Fetch

Provide a custom fetch function for proxying, logging, or modifying requests:

```typescript
const api = http_client(
  {
    /* ...endpoints... */
  },
  {
    base_url: "https://api.example.com",
    fetch: async (request) => {
      console.log("Request:", request.url);
      const response = await fetch(request);
      console.log("Response:", response.status);
      return response;
    },
  },
);
```

Return the response with its body untouched. Reading it here (`await response.text()` in a log line,
say) leaves nothing for the parser, and is the one way to break
[body handling](./response-parsing.md#reading-the-body) from the outside. To inspect a body, log
`await response.clone().text()` and return the original.

For testing, use tools like [MSW](https://mswjs.io/) instead of custom fetch.

## Per-Request Options

All `RequestInit` options plus custom options can be passed per-request:

```typescript
const result = await api.users.get({
  params: { id: "123" },
  headers: { "X-Custom": "value" },
  signal: abortController.signal,
  timeout: { total: 5000, attempt: 2000 },
  retry: { attempts: 3, delay: 1000 },
});
```

### Timeouts

`timeout` accepts two bounds, and a bare number is shorthand for `{ total }`:

```typescript
await api.users.get({ params, timeout: 5000 }); // the whole call gets 5 seconds
await api.users.get({ params, timeout: { total: 5000 } }); // the same thing, spelled out
await api.users.get({ params, timeout: { attempt: 2000 } }); // each try gets 2s, the call is unbounded
await api.users.get({ params, timeout: { total: 5000, attempt: 2000 } }); // both
```

- `total` is the **call deadline**. It covers initial setup, every attempt, every inter-attempt retry delay, and response parsing. When
  it expires the call is over: the retry condition is never consulted, and the error reads
  `Call deadline of 5000ms exceeded`.
- `attempt` bounds **one try**. It has no default. Use it to cut a hung connection loose so the retry policy
  can start a fresh one; an expiry goes through `when` like any other failure and is retried by the
  default condition.

Both are floored and clamped to `0`, and `0` means "already expired", not "disabled": only omitting
a key leaves that bound off. So a computed budget that runs out fails fast:

```typescript
// a budget of 0 (or negative) gives a TimeoutError and zero attempts
await api.users.get({ params, timeout: { total: budget_remaining() } });
```

`NaN` and `Infinity` have no sensible reading and come back as an `UnexpectedError` with
`context.operation === "resolve_timeout"`.

All three layers (client, endpoint, call) merge per key, so a client-level `{ attempt: 2000 }`
survives a per-call `{ total: 5000 }` instead of being replaced by it. See
[Retry Policy](./retry-policy.md#timeouts-and-retries) for how the bounds interact with retries.

## Headers

`headers` at every level accepts what `fetch` accepts (a record, an array of pairs, or a `Headers`
instance), and the three levels are merged into one `Headers` object, header by header:

- Names are case-insensitive: `Authorization` and `authorization` are the same header, and a later
  level replaces the earlier value.
- A `null` or `undefined` value deletes the header set by an earlier level.
- Numbers and booleans are stringified, so `{ "x-retry": 2 }` sends `x-retry: 2`.
- A function is a reducer: it receives the current value (or `undefined`) and returns the new one,
  or `null` / `undefined` to delete the header.

```typescript
const endpoint = new Endpoint(
  { method: "GET", pathname: "/users" },
  {},
  {
    headers: {
      "X-Request-ID": (current) => current ?? crypto.randomUUID(),
      "X-Legacy": null, // drop a client-level default for this endpoint
    },
  },
);
```

`Content-Type` is the one header this merge does not control: the body serializer sets it, and a
value given through `headers` is dropped. See [Content-Type](./serialization.md#content-type).

## Response Handling

All endpoint functions return a union of four response envelopes and the error instances. Failures
are returned, never thrown, so peel them off with a single `instanceof Error` first. That is what
makes `status` and `ok` reachable, since only the envelopes carry them.

Narrow on `status` when the response schemas differ per code. Each branch then sees the exact
declared shape:

```typescript
// declared responses: 200, 201, 404
const result = await api.users.create({ body: { name: "Ada" } });

if (result instanceof Error) {
  console.error(result.message, result.context);
  return;
}

switch (result.status) {
  case 200:
    console.log("already existed", result.data.id);
    break;
  case 201:
    console.log("created at", result.data.created_at);
    break;
  case 404:
    console.warn(result.error.message);
    break;
  default:
    // undeclared statuses, 204 and 3xx land here, always keep this branch
    console.warn("unhandled response", result.status);
}
```

Narrow on `ok` when the endpoint declares a single success shape, or when the call site only needs
to know whether the request worked:

```typescript
// declared responses: 200, 404
const result = await api.users.get({ params: { id: "123" } });

if (result instanceof Error) {
  console.error(result.message, result.context);
  return;
}

if (result.ok) {
  console.log(result.data);
} else if (result.kind === "RedirectMessage") {
  console.warn("unexpected redirect to", result.redirect_to);
} else {
  console.error(result.error); // ClientErrorResponse | ServerErrorResponse
}
```

The redirect arm needs its own branch because `ok: false` covers redirects as well as errors, so the
`else` of an `ok` check has no `error` field until you separate it out. With `status` the question
does not come up, since a `case 404` never sees a 3xx.

See [Error Handling](./error-handling.md) for why a `status` chain always needs its `default`, for
per-error handling, and for narrowing on `kind` when a value has been spread or serialized and
`instanceof` no longer holds.

## Type Inference

The `$infer` namespace provides helpers to extract types from an endpoint. Each
helper accepts **either** an `Endpoint` instance or a bound fetch function from a
client:

```typescript
import { $infer, http_client, Endpoint } from "@afoures/http-client";
import { z } from "zod";

const get_user = new Endpoint(
  { method: "GET", pathname: "/users/:id" },
  {
    responses: {
      200: { schema: z.object({ id: z.string(), name: z.string() }), parse: "json" },
      404: { schema: z.object({ message: z.string() }), parse: "json" },
    },
  },
);

const api = http_client(
  {
    users: {
      get: get_user,
      create: new Endpoint(
        { method: "POST", pathname: "/users" },
        {
          body: { schema: z.object({ name: z.string() }), serialize: "json" },
          responses: {
            201: { schema: z.object({ id: z.string(), name: z.string() }), parse: "json" },
          },
        },
      ),
    },
  },
  { base_url: "https://api.example.com" },
);

// From a fetch function...
type UsersGetParams = $infer.Params<typeof api.users.get>;
type UsersGetData = $infer.Data<typeof api.users.get>; // data for any success status
type UsersGetError = $infer.Error<typeof api.users.get>;
type CreateBody = $infer.Body<typeof api.users.create>; // { name: string }

// ...or directly from an Endpoint instance
type GetUserParams = $infer.Params<typeof get_user>; // { id: string | number }

// Narrow data/error to a specific status code
type User = $infer.Data<typeof api.users.get, 200>; // { id: string; name: string }
type NotFound = $infer.Error<typeof api.users.get, 404>; // { message: string }
```

Available type helpers (each takes an `Endpoint` instance or a fetch function):

- `$infer.Params` - The URL params input type
- `$infer.Query` - The query parameter input type
- `$infer.Body` - The request body input type (`never` when the endpoint declares no `body`)
- `$infer.Context` - The per-call [context](./dynamic-context.md) argument (`never` when the endpoint declares none)
- `$infer.Input` - The full request argument (params + query + body + context + request init)
- `$infer.Result` - Everything a call can resolve to: the response envelopes plus the returned error classes (`NetworkError`, `TimeoutError`, `ParseError`, …)
- `$infer.Response` - The discriminated HTTP response envelope only (drops the transport errors); narrowable on `ok` / `status`
- `$infer.Data<endpoint, status?>` - Successful response `data`, optionally narrowed to a status code (or wildcard class)
- `$infer.Error<endpoint, status?>` - Error response `error`, optionally narrowed to a status code (or wildcard class)
