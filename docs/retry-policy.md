# Retry Policy

Configure automatic retries for failed requests.

## Configuration

```typescript
type RetryPolicy = {
  attempts?: number | ((ctx: { request: Request }) => number | Promise<number>)
  delay?: number | ((ctx: { request: Request; response?: Response; error?: Error; attempt: number }) => number | Promise<number>)
  when?: (ctx: { request: Request; response?: Response; error?: Error }) => boolean | Promise<boolean>
}
```

## Basic Usage

### Fixed Attempts and Delay

```typescript
const result = await api.users.get({
  params: { id: '123' },
  retry: {
    attempts: 3,
    delay: 1000, // 1 second
  },
})
```

### Conditional Retry

By default, retries on non-OK responses. Customize with `when`:

```typescript
const result = await api.users.get({
  params: { id: '123' },
  retry: {
    attempts: 3,
    delay: 1000,
    when: ({ response, error }) => {
      // Retry on server errors or network failures
      if (error) return true
      if (response && response.status >= 500) return true
      return false
    },
  },
})
```

### Retry on Specific Status

```typescript
const result = await api.users.get({
  params: { id: '123' },
  retry: {
    attempts: 5,
    delay: 2000,
    when: ({ response }) => {
      if (!response) return false
      return response.status === 503 // Service Unavailable
    },
  },
})
```

## Exponential Backoff

Use a delay function for exponential backoff:

```typescript
const result = await api.users.get({
  params: { id: '123' },
  retry: {
    attempts: 5,
    delay: ({ attempt }) => Math.min(1000 * Math.pow(2, attempt), 30000),
    when: ({ error }) => !!error,
  },
})
```

## Retry on All GET Requests

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users',
  retry: {
    attempts: 3,
    delay: 1000,
    when: ({ request }) => request.method === 'GET',
  },
})
```

## Dynamic Attempts

Determine max attempts dynamically:

```typescript
const result = await api.users.get({
  params: { id: '123' },
  retry: {
    attempts: ({ request }) => {
      // Check custom header or metadata
      const priority = request.headers.get('X-Priority')
      return priority === 'high' ? 5 : 2
    },
    delay: 1000,
  },
})
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

## Default Behavior

Without a `when` condition, retries on non-OK responses:

```typescript
retry: {
  attempts: 3,
  delay: 0,
  // when: defaults to ({ response }) => response?.ok === false
}
```

## Endpoint-Level Retry

Set default retry on the endpoint:

```typescript
const endpoint = new Endpoint({
  method: 'GET',
  pathname: '/users',
  retry: {
    attempts: 3,
    delay: 1000,
  },
})
```

Per-request retry overrides endpoint defaults.

## AbortSignal with Retry

Retries respect `AbortSignal`:

```typescript
const controller = new AbortController()

const result = await api.users.get({
  params: { id: '123' },
  signal: controller.signal,
  retry: { attempts: 10, delay: 1000 },
})

// Call controller.abort() to cancel retries
```

## Example: Resilient API Client

```typescript
const api = http_client({
  base_url: 'https://api.example.com',
  endpoints: {
    users: new Endpoint({
      method: 'GET',
      pathname: '/users',
      retry: {
        attempts: 3,
        delay: ({ attempt }) => Math.min(100 * Math.pow(2, attempt), 5000),
        when: ({ response, error }) => {
          if (error) return true
          if (!response) return false
          return response.status >= 500 || response.status === 429
        },
      },
    }),
  },
})
```
