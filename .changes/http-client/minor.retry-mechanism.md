Configurable automatic retries for failed requests.

```typescript
const result = await api.users.get({
  params: { id: '123' },
  retry: {
    attempts: 3,
    delay: 1000,
    when: ({ response, error }) => response?.status >= 500,
  },
})
```

Supports exponential backoff via delay functions, dynamic attempts, conditional retry, and endpoint-level defaults. Retries respect AbortSignal.
