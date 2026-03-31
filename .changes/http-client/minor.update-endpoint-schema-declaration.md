`serialize` is now required on body definitions and `parse` is now required on data and error parser definitions.

Previously these were optional and defaulted to `"json"` when the schema type was JSON-compatible. You must now always explicitly specify the serialization/parse strategy.

```typescript
body: {
  schema: z.object({ name: z.string() }),
  serialize: 'json', // was optional, now required
}

data: {
  schema: z.object({ id: z.string() }),
  parse: 'json', // was optional, now required
}
```
