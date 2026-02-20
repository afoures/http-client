Built-in timeout support with AbortSignal integration.

```typescript
const result = await api.users.get({
  params: { id: '123' },
  timeout: 5000,
})

if (result instanceof TimeoutError) {
  console.log(result.kind)  // "TimeoutError"
}
```

Timeouts work alongside existing AbortSignal and can be set at endpoint level or per-request.
