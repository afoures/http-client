# Response Parsing

Endpoints parse HTTP responses into typed results based on status code. The
result is a discriminated union you narrow on `kind`, `ok` or `status`; each
status carries the body type declared for it in the endpoint's `responses` map.

> A response `schema` may also be a `(context) => schema` factory, and each `parse` function
> receives the per-call context as a second argument. See [Dynamic Context](./dynamic-context.md).

## Response Types

### Successful Response (20x)

```typescript
type SuccessfulResponse<Data> = {
  kind: "SuccessfulResponse";
  ok: true;
  status: 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;
  data: Data;
  headers: Headers;
  raw_response: Response;
};
```

### Redirect (30x)

```typescript
type RedirectMessage = {
  kind: "RedirectMessage";
  ok: false;
  status: 300 | 301 | 302 | 303 | 304 | 307 | 308;
  redirect_to: string | null;
  headers: Headers;
  raw_response: Response;
};
```

### Client Error (40x)

```typescript
type ClientErrorResponse<Error> = {
  kind: "ClientErrorResponse"
  ok: false
  status: 400 | 401 | 402 | 403 | 404 | /* ... */
  error: Error
  headers: Headers
  raw_response: Response
}
```

### Server Error (50x)

```typescript
type ServerErrorResponse<Error> = {
  kind: "ServerErrorResponse"
  ok: false
  status: 500 | 501 | 502 | 503 | 504 | /* ... */
  error: Error
  headers: Headers
  raw_response: Response
}
```

## Defining Responses

Responses are declared with a single `responses` map. Each key is a status code
and each value is a `{ schema, parse }` parser. The parsed body lands on `data`
for successful (`2xx`) statuses and on `error` for error (`4xx`/`5xx`) statuses,
typed per status:

```typescript
const endpoint = new Endpoint({
  method: "GET",
  pathname: "/users/:id",
  responses: {
    200: { schema: z.object({ id: z.string(), name: z.string() }), parse: "json" },
    404: { schema: z.object({ message: z.string() }), parse: "json" },
  },
});

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

- `"json"`: parse the body as JSON. Required/allowed for object (non-string) schemas; the compiler rejects `"json"` on a string schema.
- `"text"`: read the body as text. Required/allowed for string-input schemas; the compiler rejects `"text"` on an object schema.
- A function: custom deserialization from the raw `Response["body"]` stream, allowed for any schema.

```typescript
const endpoint = new Endpoint({
  method: "GET",
  pathname: "/data",
  responses: {
    // text body
    200: { schema: z.string(), parse: "text" },
    // custom deserialization
    "2xx": {
      schema: z.object({ value: z.number() }),
      parse: async (body) => {
        const text = await new Response(body).text();
        return JSON.parse(text);
      },
    },
  },
});
```

### Status Wildcards

Use `"2xx"`, `"4xx"`, or `"5xx"` as a class default that applies to every status
in that class. A specific status always takes precedence over its wildcard:

```typescript
const endpoint = new Endpoint({
  method: "GET",
  pathname: "/users/:id",
  responses: {
    200: { schema: z.object({ id: z.string() }), parse: "json" }, // exact 200
    "2xx": { schema: z.object({ ok: z.boolean() }), parse: "json" }, // any other 2xx
    404: { schema: z.object({ code: z.literal("not_found") }), parse: "json" }, // exact 404
    "4xx": { schema: z.object({ message: z.string() }), parse: "json" }, // any other 4xx
    "5xx": { schema: z.object({ fatal: z.string() }), parse: "json" }, // any 5xx
  },
});
```

Resolution order for an incoming status is: exact status, then the matching
`{class}xx` wildcard.

### Defaults When No Parser Matches

If no parser (specific or wildcard) covers a status, the body is still never
lost:

- **2xx**: `data` is `null` at runtime (typed as `void`).
- **204 No Content**: always `data: null`, regardless of any parser.
- **4xx / 5xx**: `error` is the raw response text (typed as `string`).
- **3xx redirects**: never schema'd; you get `redirect_to` instead (see above).

```typescript
const endpoint = new Endpoint({
  method: "DELETE",
  pathname: "/users/:id",
});

const result = await endpoint.parse_response(response);
if (result.ok && result.status === 204) {
  console.log(result.data); // null
}
if (!result.ok && result.status >= 400) {
  console.log(typeof result.error); // "string", raw text fallback
}
```

## Schema Transforms

Schemas can transform response data:

```typescript
const endpoint = new Endpoint({
  method: "GET",
  pathname: "/users/:id",
  responses: {
    200: {
      schema: z.object({
        name: z.string().transform((s) => s.toUpperCase()),
        createdAt: z.string().transform((s) => new Date(s)),
      }),
      parse: "json",
    },
  },
});

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
    // an undeclared status is parsed by the `2xx` / `4xx` / `5xx` fallback, never a schema
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
