# Response Parsing

Endpoints parse HTTP responses into typed results based on status code. The
result is a discriminated union you narrow on `kind`, `ok` or `status`; each
status carries the body type declared for it in the endpoint's `responses` map.

> The whole definition may instead be a `(context) => definition` factory, in which case every
> `schema` and `parse` below can be built from the per-call context. See
> [Dynamic Context](./dynamic-context.md).

## Response Types

### Successful Response (20x)

```typescript
type SuccessfulResponse<Data> = {
  kind: "SuccessfulResponse";
  ok: true;
  status: 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;
  data: Data;
  url: string;
  method: HTTPMethod;
  headers: Headers;
};
```

### Redirect (30x)

```typescript
type RedirectMessage = {
  kind: "RedirectMessage";
  ok: false;
  status: 300 | 301 | 302 | 303 | 304 | 307 | 308;
  redirect_to: string | null;
  url: string;
  method: HTTPMethod;
  headers: Headers;
};
```

### Client Error (40x)

```typescript
type ClientErrorResponse<Error> = {
  kind: "ClientErrorResponse"
  ok: false
  status: 400 | 401 | 402 | 403 | 404 | /* ... */
  error: Error
  url: string
  method: HTTPMethod
  headers: Headers
}
```

### Server Error (50x)

```typescript
type ServerErrorResponse<Error> = {
  kind: "ServerErrorResponse"
  ok: false
  status: 500 | 501 | 502 | 503 | 504 | /* ... */
  error: Error
  url: string
  method: HTTPMethod
  headers: Headers
}
```

## Defining Responses

Responses are declared with a single `responses` map. Each key is a status code
and each value is a `{ schema, parse }` parser. The parsed body lands on `data`
for successful (`2xx`) statuses and on `error` for error (`4xx`/`5xx`) statuses,
typed per status:

```typescript
const endpoint = new Endpoint(
  { method: "GET", pathname: "/users/:id" },
  {
    responses: {
      200: { schema: z.object({ id: z.string(), name: z.string() }), parse: "json" },
      404: { schema: z.object({ message: z.string() }), parse: "json" },
    },
  },
);

const result = await endpoint.parse_response(response);

if (result.ok && result.status === 200) {
  console.log(result.data); // { id: string; name: string }
} else if (!result.ok && result.status === 404) {
  console.log(result.error.message); // string
}
```

### Parse Modes

Each parser's `parse` controls how the raw body is read before validation. `parse` is always
required (there is no runtime default) and is narrowed by the schema:

- `"json"`: parse the body as JSON. Required/allowed for object (non-string) schemas; the compiler rejects `"json"` on a string schema. An empty body decodes to `null`, which is then validated like any other value, so a `200` with no body fails an object schema with a `ParseError` whose `context.response.body` is `null`. Make the schema `.nullable()` when the server may legitimately send nothing. Malformed JSON is a `ParseError` carrying the raw text in `context.response.body`.
- `"text"`: read the body as text. Required/allowed for string-input schemas; the compiler rejects `"text"` on an object schema.
- A function: custom deserialization, allowed for any schema. It receives the raw
  `Response["body"]` stream, plus the response's `status`, `ok`, `url` and `headers` as a second
  argument, which is what a wildcard parser needs to tell its statuses apart.

A schema whose input is `any`, `unknown`, `void` or `never` says
nothing about how the body is encoded, so neither string mode is allowed for it: `parse` must be a
function, and decoding is yours.

```typescript
const endpoint = new Endpoint(
  { method: "GET", pathname: "/data" },
  {
    responses: {
      // text body
      200: { schema: z.string(), parse: "text" },
      // custom deserialization, with the response metadata to decide from
      "2xx": {
        schema: z.object({ value: z.number() }),
        parse: async (body, metadata) => {
          if (metadata.status === 202) return { value: 0 }; // accepted, no body to read
          return JSON.parse(await new Response(body).text());
        },
      },
    },
  },
);
```

### Reading the Body

A body can only be read once, and a `parse` function is the only place you are handed one. Read it
once there, and everything else takes care of itself:

- Results carry `status`, `ok`, `url`, `method` and `headers`, and the
  [retry callbacks](./retry-policy.md) see the same. Neither is given a `Response`, so nothing can
  consume the body your parser needs and there is no `Body is unusable` to debug.
- You never have to clean up. A body no parser asked for (a redirect, a `204`, a status you declared
  no parser for, an attempt that was retried away) is released for you, as is a body your `parse`
  left behind when it threw.

To hand a body to your own caller instead of decoding it, return the stream as the parsed value.
That makes the caller its reader, so it stays open:

```typescript
const download = new Endpoint(
  { method: "GET", pathname: "/files/:id" },
  {
    responses: {
      200: { schema: z.instanceof(ReadableStream), parse: async (body) => body! },
    },
  },
);

const api = http_client({ files: { download } }, { base_url: "https://api.example.com" });

const result = await api.files.download({ params: { id: "1" } });
if (!(result instanceof Error) && result.ok) {
  await result.data.pipeTo(destination);
}
```

### Status Wildcards

Use `"2xx"`, `"4xx"`, or `"5xx"` as a class default that applies to every status
in that class. A specific status always takes precedence over its wildcard:

```typescript
const endpoint = new Endpoint(
  { method: "GET", pathname: "/users/:id" },
  {
    responses: {
      200: { schema: z.object({ id: z.string() }), parse: "json" }, // exact 200
      "2xx": { schema: z.object({ ok: z.boolean() }), parse: "json" }, // any other 2xx
      404: { schema: z.object({ code: z.literal("not_found") }), parse: "json" }, // exact 404
      "4xx": { schema: z.object({ message: z.string() }), parse: "json" }, // any other 4xx
      "5xx": { schema: z.object({ fatal: z.string() }), parse: "json" }, // any 5xx
    },
  },
);
```

Resolution order for an incoming status is: exact status, then the matching
`{class}xx` wildcard.

### Defaults When No Parser Matches

If no parser (specific or wildcard) covers a status:

- **2xx**: the body is discarded and `data` is `null`. Not declaring a parser for
  a success status is taken as "I don't want this payload", so it is never read
  into memory. Declare a `2xx` parser to keep it, with
  `{ schema: z.string(), parse: "text" }` for the raw text.
- **204 No Content**: always `data: null`, regardless of any parser.
- **4xx / 5xx**: `error` is the raw response text (typed as `string`).
- **3xx redirects**: never schema'd; you get `redirect_to` instead (see [Redirects](#redirects)).
- **1xx**: no envelope covers an informational status, so it is returned as an `UnexpectedError`
  with `context.operation === "parse_response"`. The same goes for a `status` of `0`, which a
  browser produces for an opaque response.

```typescript
const endpoint = new Endpoint({ method: "DELETE", pathname: "/users/:id" });

const result = await endpoint.parse_response(response);
if (result.ok && result.status === 204) {
  console.log(result.data); // null
}
if (!result.ok && result.status >= 400) {
  console.log(typeof result.error); // "string", raw text fallback
}
```

### Redirects

`fetch` follows redirects by default (`redirect: "follow"`), so a 3xx is consumed inside `fetch` and
the client sees the final response. A `RedirectMessage` therefore only reaches you when the
redirect could not be followed, or when you ask to see it with `redirect: "manual"` in the request
options:

```typescript
const result = await api.files.download({ params: { id: "1" }, redirect: "manual" });

if (!(result instanceof Error) && result.kind === "RedirectMessage") {
  console.log(result.status, result.redirect_to); // 302, the `Location` header or null
}
```

That works in Node, where `redirect: "manual"` surfaces the real 3xx response. In browsers the same
option yields an opaque response with `status: 0` and no headers, which the client returns as an
`UnexpectedError`. The body of a redirect is always discarded, so a 3xx never has a parser.

## Schema Transforms

Schemas can transform response data:

```typescript
const endpoint = new Endpoint(
  { method: "GET", pathname: "/users/:id" },
  {
    responses: {
      200: {
        schema: z.object({
          name: z.string().transform((s) => s.toUpperCase()),
          createdAt: z.string().transform((s) => new Date(s)),
        }),
        parse: "json",
      },
    },
  },
);

const result = await endpoint.parse_response(response);
if (result.ok) {
  console.log(result.data.name); // uppercase string
  console.log(result.data.createdAt); // Date object
}
```

## Parse Errors

If response parsing fails validation, a `ParseError` is returned:

```typescript
const result = await endpoint.parse_response(response);

if (result instanceof ParseError) {
  console.log(result.message); // "Response parsing failed"
  console.log(result.cause); // Schema validation issues
}
```

## Handling All Cases

Peel the errors off with a single `instanceof Error`, then narrow the response arms. Since a parser
is declared per status, `status` is what gets you the parsed shape for one code:

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
    // an undeclared status carries its class fallback: the wildcard parser's output when a
    // `2xx` / `4xx` / `5xx` is declared, otherwise `null` for a 2xx and the raw text for the rest
    console.warn("unhandled response", result.status);
}
```

Compare exact statuses. Relational comparisons such as `result.status >= 400` do not narrow a union
of numeric literals in TypeScript, so the redirect arm stays in the type and `result.error` remains
inaccessible.

When an endpoint declares a single success shape, `ok` says the same thing in two branches:

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

`ok` only tells you the response was a 2xx, so on an endpoint declaring several success codes `data`
stays the union of all of them and you end up checking `status` regardless. See
[Error Handling](./error-handling.md#checking-results) for the full comparison.
