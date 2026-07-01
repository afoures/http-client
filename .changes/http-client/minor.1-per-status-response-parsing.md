Replace the separate `data` and `error` parser definitions with a single `responses` map keyed by HTTP status code.

Each key is a status code (or a `2xx`/`4xx`/`5xx` wildcard) and each value is a `{ schema, parse }` parser. Parsed bodies are typed per status — landing on `data` for `2xx` responses and `error` for `4xx`/`5xx` responses — so `parse_response` returns a discriminated union you narrow on `ok` and `status`.

```typescript
const endpoint = new Endpoint({
  method: "GET",
  pathname: "/users/(:id)",
  responses: {
    200: { schema: z.object({ id: z.string(), name: z.string() }), parse: "json" },
    404: { schema: z.object({ message: z.string() }), parse: "json" },
    "5xx": { schema: z.object({ message: z.string() }), parse: "json" },
  },
});
```

Per-status parser resolution falls back from an exact status to its class wildcard (`200` → `2xx`, `404` → `4xx`, `503` → `5xx`). Statuses with no matching parser default to raw text so the body is never lost; `204` always yields `null` data regardless of any parser.
