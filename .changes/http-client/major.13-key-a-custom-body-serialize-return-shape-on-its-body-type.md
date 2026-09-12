Key a custom body `serialize` return shape on its body type, and let the serializer own `Content-Type`

`FormData` and `URLSearchParams` no longer accept a `content_type`: the runtime derives it from the body, with the multipart boundary a hand-written value was missing. `BufferSource` and `ReadableStream` bodies require one, since raw bytes carry no type; `Blob`, `string` and `null` may set one.

```ts
// before
serialize: (data) => ({ body: to_form_data(data), content_type: "multipart/form-data" });
// after
serialize: (data) => ({ body: to_form_data(data) });
```

A `Content-Type` set through `headers` at any level is dropped in favor of the serializer's, so a JSON body under a vendor media type is the `"json"` serializer written out: `({ body: JSON.stringify(data), content_type: "application/vnd.api+json" })`.

Stream bodies are sent with `duplex: "half"`, which `fetch` requires. A stream is consumed by the first attempt, so a retry cannot re-send it and fails with an `UnexpectedError` carrying `operation: "create_request"`.
