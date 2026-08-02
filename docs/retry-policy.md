# Retry Policy

Configure automatic retries for failed requests.

## Configuration

```typescript
type RetryPolicy = {
  attempts?: number | ((ctx: { request: Request }) => number | Promise<number>);
  delay?:
    | number
    | ((ctx: {
        request: Request;
        response?: Response;
        error?: Error;
        attempt: number;
      }) => number | Promise<number>);
  when?: (ctx: {
    request: Request;
    response?: Response;
    error?: Error;
  }) => boolean | Promise<boolean>;
  recover?: (ctx: {
    request: Request;
    response?: Response;
    error?: Error;
    attempt: number;
    current: { headers: Headers };
  }) => { headers?: HeadersInit } | void | Promise<{ headers?: HeadersInit } | void>;
};
```

## Basic Usage

### Fixed Attempts and Delay

```typescript
const result = await api.users.get({
  params: { id: "123" },
  retry: {
    attempts: 3,
    delay: 1000, // 1 second
  },
});
```

### Conditional Retry

By default, retries transient failures only (see [Default Behavior](#default-behavior)). Customize with `when`:

```typescript
const result = await api.users.get({
  params: { id: "123" },
  retry: {
    attempts: 3,
    delay: 1000,
    when: ({ response, error }) => {
      // Retry on server errors or network failures
      if (error) return true;
      if (response && response.status >= 500) return true;
      return false;
    },
  },
});
```

### Retry on Specific Status

```typescript
const result = await api.users.get({
  params: { id: "123" },
  retry: {
    attempts: 5,
    delay: 2000,
    when: ({ response }) => {
      if (!response) return false;
      return response.status === 503; // Service Unavailable
    },
  },
});
```

## Exponential Backoff

Use a delay function for exponential backoff:

```typescript
const result = await api.users.get({
  params: { id: "123" },
  retry: {
    attempts: 5,
    delay: ({ attempt }) => Math.min(1000 * Math.pow(2, attempt), 30000),
    when: ({ error }) => !!error,
  },
});
```

## Retry on All GET Requests

```typescript
const endpoint = new Endpoint({
  method: "GET",
  pathname: "/users",
  retry: {
    attempts: 3,
    delay: 1000,
    when: ({ request }) => request.method === "GET",
  },
});
```

## Dynamic Attempts

Determine max attempts dynamically:

```typescript
const result = await api.users.get({
  params: { id: "123" },
  retry: {
    attempts: ({ request }) => {
      // Check custom header or metadata
      const priority = request.headers.get("X-Priority");
      return priority === "high" ? 5 : 2;
    },
    delay: 1000,
  },
});
```

## Context Information

The `when` and `delay` functions receive context about the request:

```typescript
retry: {
  when: ({ request, response, error }) => {
    // request: The Request object
    // response: The Response if received, undefined if network error
    // error: NetworkError, TimeoutError, etc. if occurred
    return true
  },
  delay: ({ request, response, error, attempt }) => {
    // attempt: Current attempt number (1-indexed)
    return attempt * 1000
  },
}
```

## Recovery

Use `recover` to rewrite the request between attempts, for example to refresh an expired auth token or recompute a per-attempt signature header. It runs once a retry has been decided (after `when` passes and while attempts remain), after any `delay`, and immediately before the next attempt:

```typescript
const result = await api.users.get({
  params: { id: "123" },
  headers: { authorization: "Bearer stale" },
  retry: {
    attempts: 2,
    when: ({ response }) => response?.status === 401,
    recover: async () => ({
      headers: { authorization: `Bearer ${await refresh_token()}` },
    }),
  },
});
```

### Scope and replace semantics

Only `headers` can be overridden. Returned fields **replace** the current ones wholesale (there is no merge), and omitted fields are kept unchanged. Returning `undefined` (or nothing) leaves the request as-is.

Because it is a replace, to keep the existing headers and change only one, start from the copy passed in as `current.headers`:

```typescript
recover: async ({ current }) => {
  const headers = new Headers(current.headers);
  headers.set("authorization", `Bearer ${await refresh_token()}`);
  return { headers };
},
```

`current.headers` is a copy, so mutating it in place has no effect; the next attempt uses only what you return.

The body serializer still owns `Content-Type`: it is re-applied after your header replacement, so you cannot change it through `recover`.

### Context

`recover` receives the just-completed attempt's `request`, its `response`/`error`, the 1-indexed `attempt` count, and `current.headers`:

```typescript
recover: ({ response, attempt, current }) => {
  const headers = new Headers(current.headers);
  headers.set("x-signature", sign({ attempt, nonce: response?.headers.get("x-nonce") }));
  return { headers };
},
```

If `recover` throws, the request fails with an `UnexpectedError` (`context.operation === "recover"`) and no further attempt is made.

### Layering

Like `when`, `delay`, and `attempts`, `recover` is resolved per key across client, endpoint, and per-call options: the most specific layer that defines it wins wholesale (per-call over endpoint over client). Recover functions do not chain or compose across layers.

## Default Behavior

Without a `when` condition, retries the failures a retry can plausibly fix: transient transport errors, and the status codes that ask you to come back later.

```typescript
const default_retry_condition: RetryPolicy.Condition = ({ response, error }) => {
  if (error) return error.kind === "NetworkError" || error.kind === "TimeoutError";
  if (!response) return false;
  return response.status === 408 || response.status === 429 || response.status >= 500;
};
```

So `408`, `429` and every `5xx` are retried, as are `NetworkError` and `TimeoutError`. Nothing else is: a `4xx` other than those two is a permanent client error, a `3xx` read under `redirect: "manual"` is a normal outcome, an `AbortedError` means the caller asked to stop, and an `UnexpectedError` comes from your own callback throwing (retrying just re-throws).

`attempts` defaults to `0`, so none of this happens until you ask for a retry.

The condition is exported from the package entry point, so you can compose with it instead of reimplementing it:

```typescript
import { default_retry_condition } from "@afoures/http-client";

const result = await api.users.get({
  params: { id: "123" },
  retry: {
    attempts: 3,
    // the default, plus one status this API uses for backpressure
    when: (ctx) => ctx.response?.status === 420 || default_retry_condition(ctx),
  },
});
```

### Idempotency is your call

The default is **not** method-aware: an explicit `retry: { attempts: 3 }` on a `POST` is honored, because silently ignoring what you asked for is more surprising than obeying it. A retried non-idempotent request can create the resource twice, so on a `POST` either send an idempotency key or opt out:

```typescript
retry: {
  attempts: 3,
  when: (ctx) => ctx.request.method !== "POST" && default_retry_condition(ctx),
}
```

## Endpoint-Level Retry

Set default retry on the endpoint:

```typescript
const endpoint = new Endpoint({
  method: "GET",
  pathname: "/users",
  retry: {
    attempts: 3,
    delay: 1000,
  },
});
```

Per-request retry overrides endpoint defaults.

## AbortSignal with Retry

Retries respect `AbortSignal`:

```typescript
const controller = new AbortController();

const result = await api.users.get({
  params: { id: "123" },
  signal: controller.signal,
  retry: { attempts: 10, delay: 1000 },
});

// Call controller.abort() to cancel retries
```

## Example: Resilient API Client

```typescript
const api = http_client(
  {
    users: new Endpoint({
      method: "GET",
      pathname: "/users",
      retry: {
        attempts: 3,
        delay: ({ attempt }) => Math.min(100 * Math.pow(2, attempt), 5000),
        when: ({ response, error }) => {
          if (error) return true;
          if (!response) return false;
          return response.status >= 500 || response.status === 429;
        },
      },
    }),
  },
  { base_url: "https://api.example.com" },
);
```
