New error type hierarchy for better error handling:

- `HttpClientError` - Base class for all HTTP client errors
- `TimeoutError` - Request exceeded timeout
- `AbortedError` - Request was aborted via AbortSignal
- `NetworkError` - Network-level failure
- `SerializationError` - Failed to serialize params, query, or body
- `DeserializationError` - Failed to parse response body
- `UnexpectedError` - Unexpected failure during request lifecycle

All errors include a `context` property with the operation that failed.

# Example

```typescript
const result = await api.users.get({ params: { id: '123' }, timeout: 5000 })

if (result instanceof TimeoutError) {
  console.log(result.kind)  // "TimeoutError"
  console.log(result.context.operation)  // "fetch"
}
```
