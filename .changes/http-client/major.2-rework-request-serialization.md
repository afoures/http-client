- Rework request serialization

  A declared `params`, `query` or `body` schema always runs, an omitted slot included, so defaults
  and `preprocess` apply where they used to be skipped; a schema output of `undefined` means send
  nothing. A custom body `serialize` owns `Content-Type` and its return shape is keyed on the body
  type: `FormData` and `URLSearchParams` reject one, `BufferSource` and `ReadableStream` require
  one, and a `Content-Type` from `headers` is dropped in favor of the serializer's. A query or
  params schema whose output is `any` now requires a `serialize` function.

  The `"urlencoded"` encoder repeats array values (`?tags=a&tags=b`) and handles entry lists, and
  returns a `SerializationError` for anything it cannot express instead of silently emitting
  `[object Object]` or nothing at all. The `"json"` body serializer returns its failures the same
  way rather than throwing them out of the call.