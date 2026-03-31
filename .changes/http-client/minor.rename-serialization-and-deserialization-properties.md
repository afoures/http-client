Rename `serialization` to `serialize` on all serializer definitions and `deserialization` to `parse` on all parser definitions. `DeserializationError` has been renamed to `ParseError`.

```typescript
// Before
body: {
  schema: z.object({ name: z.string() }),
  serialization: 'json',
}
data: {
  schema: z.object({ id: z.string() }),
  deserialization: 'json',
}

// After
body: {
  schema: z.object({ name: z.string() }),
  serialize: 'json',
}
data: {
  schema: z.object({ id: z.string() }),
  parse: 'json',
}
```
