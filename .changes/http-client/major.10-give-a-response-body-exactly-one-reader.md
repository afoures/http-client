- Give a response body exactly one reader

  A body can only be read once, so the `parse` declared for a status is now the only thing handed one. Nothing else receives a `Response`, and a body no parser asked for is released rather than left dangling.

  `raw_response` is gone from the four response envelopes, which carry the details themselves and now always set `url` alongside `status`, `ok`, `method` and `headers`.

  ```ts
  // before
  console.log(result.raw_response.status, result.raw_response.headers);
  // after
  console.log(result.status, result.headers);
  ```

  To reach a body the client would otherwise not read, or to stream one, return it from `parse` as the parsed value, which makes the caller its reader: `200: { schema: z.instanceof(ReadableStream), parse: async (body) => body! }`.

  `when`, `delay`, `attempts` and `recover` receive `HTTPFetch.RequestMetadata` (`url`, `method`, `headers`) and `HTTPFetch.ResponseMetadata` (`status`, `ok`, `url`, `headers`) in place of the `Request` and `Response`. Conditions on `status`, `headers` or `error` are unaffected. A custom `parse` receives that same response metadata as a second argument, so a wildcard parser can tell its statuses apart; one-argument parsers keep working.

  `ErrorContext.response` no longer carries `statusText`, and `context.response.body` is set only where parsing had already read the body. Malformed JSON is one such case, and is now a `ParseError` carrying the offending text instead of an `UnexpectedError`. A `1xx` response is returned as an `UnexpectedError` rather than thrown.
