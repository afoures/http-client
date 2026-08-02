# HTTP Client

The `http_client` function creates a typed API client from a map of endpoints.

## Basic Usage

```typescript
import { Endpoint, http_client } from "@afoures/http-client";
import { z } from "zod";

const api = http_client(
  {
    users: new Endpoint({
      method: "GET",
      pathname: "/users",
      responses: { 200: { schema: z.array(z.object({ id: z.string() })), parse: "json" } },
    }),
  },
  { base_url: "https://api.example.com" },
);

const result = await api.users({});
```

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
        create: new Endpoint({ method: "POST", pathname: "/posts/:post_id/comments" }),
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
2. Endpoint-level defaults (`define_context<T>().with_defaults({ ... })`)
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

For testing, use tools like [MSW](https://mswjs.io/) instead of custom fetch.

## Per-Request Options

All `RequestInit` options plus custom options can be passed per-request:

```typescript
const result = await api.users.get({
  params: { id: "123" },
  headers: { "X-Custom": "value" },
  signal: abortController.signal,
  timeout: 5000,
  retry: { attempts: 3, delay: 1000 },
});
```

## Headers with Reducers

Headers can be functions that receive the current value:

```typescript
const endpoint = new Endpoint({
  method: "GET",
  pathname: "/users",
  headers: {
    "X-Request-ID": (current) => current ?? crypto.randomUUID(),
  },
});
```

## Response Handling

All endpoint functions return a union of four response envelopes and the error instances. Every arm
carries a `kind` literal, so the whole union narrows in one `switch`:

```typescript
const result = await api.users.get({ params: { id: "123" } });

switch (result.kind) {
  case "SuccessfulResponse":
    console.log(result.data);
    break;
  case "RedirectMessage":
    console.warn("unexpected redirect to", result.redirect_to);
    break;
  case "ClientErrorResponse":
  case "ServerErrorResponse":
    console.log(result.error);
    break;
  default:
    // TimeoutError, NetworkError, SerializationError, etc.
    console.log(result.message);
}
```

Or peel the errors off with `instanceof Error` first, then narrow on `ok` and `status`. Note that
`ok: false` covers redirects as well as errors, so the `else` of an `ok` check has no `error` field
until you separate the redirect arm:

```typescript
if (result instanceof Error) return;

if (result.ok) {
  console.log(result.data);
} else if (result.kind === "RedirectMessage") {
  console.warn(result.redirect_to);
} else {
  console.log(result.error);
}
```

See [Error Handling](./error-handling.md) for the full list of kinds.

## Type Inference

The `$infer` namespace provides helpers to extract types from an endpoint. Each
helper accepts **either** an `Endpoint` instance or a bound fetch function from a
client:

```typescript
import { $infer, http_client, Endpoint } from "@afoures/http-client";
import { z } from "zod";

const get_user = new Endpoint({
  method: "GET",
  pathname: "/users/:id",
  responses: {
    200: { schema: z.object({ id: z.string(), name: z.string() }), parse: "json" },
    404: { schema: z.object({ message: z.string() }), parse: "json" },
  },
});

const api = http_client(
  {
    users: {
      get: get_user,
      create: new Endpoint({
        method: "POST",
        pathname: "/users",
        body: { schema: z.object({ name: z.string() }), serialize: "json" },
        responses: {
          201: { schema: z.object({ id: z.string(), name: z.string() }), parse: "json" },
        },
      }),
    },
  },
  { base_url: "https://api.example.com" },
);

// From a fetch function...
type UsersGetParams = $infer.Params<typeof api.users.get>;
type UsersGetData = $infer.Data<typeof api.users.get>; // data for any success status
type UsersGetError = $infer.Error<typeof api.users.get>;

// ...or directly from an Endpoint instance
type CreateBody = $infer.Body<typeof get_user>;

// Narrow data/error to a specific status code
type User = $infer.Data<typeof api.users.get, 200>; // { id: string; name: string }
type NotFound = $infer.Error<typeof api.users.get, 404>; // { message: string }
```

Available type helpers (each takes an `Endpoint` instance or a fetch function):

- `$infer.Params` - The URL params input type
- `$infer.Query` - The query parameter input type
- `$infer.Body` - The request body input type
- `$infer.Context` - The per-call [context](./dynamic-context.md) argument (`never` when the endpoint declares none)
- `$infer.Input` - The full request argument (params + query + body + context + request init)
- `$infer.Result` - Everything `fetch` can return, including thrown transport error classes (`NetworkError`, `TimeoutError`, `ParseError`, …)
- `$infer.Response` - The discriminated HTTP response envelope only (drops the transport errors); narrowable on `ok` / `status`
- `$infer.Data<endpoint, status?>` - Successful response `data`, optionally narrowed to a status code (or wildcard class)
- `$infer.Error<endpoint, status?>` - Error response `error`, optionally narrowed to a status code (or wildcard class)
