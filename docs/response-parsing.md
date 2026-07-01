# Response Parsing

Endpoints parse HTTP responses into typed results based on status code. The
result is a discriminated union you narrow on `ok` and `status`; each status
carries the body type declared for it in the endpoint's `responses` map.

## Response Types

### Successful Response (20x)

```typescript
type SuccessfulResponse<Data> = {
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

Each parser's `parse` controls how the raw body is read before validation:

- `"json"` — parse the body as JSON (the default suggestion for object schemas).
- `"text"` — read the body as text (the default suggestion for string schemas).
- A function — custom deserialization from the raw `Response["body"]` stream.

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

- **2xx** — `data` is `null` at runtime (typed as `void`).
- **204 No Content** — always `data: null`, regardless of any parser.
- **4xx / 5xx** — `error` is the raw response text (typed as `string`).
- **3xx redirects** — never schema'd; you get `redirect_to` instead (see above).

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
  console.log(typeof result.error); // "string" — raw text fallback
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

```typescript
const result = await api.users.get({ params: { id: "123" } });

if (result instanceof Error) {
  // UnexpectedError, NetworkError, TimeoutError, etc.
  console.log(result.message);
  return;
}

if (result.ok) {
  // 20x success
  console.log(result.data);
} else if (result.status >= 300 && result.status < 400) {
  // Redirect
  console.log(result.redirect_to);
} else if (result.status >= 400 && result.status < 500) {
  // Client error
  console.log(result.error);
} else {
  // Server error
  console.log(result.error);
}
```
