- Give a response body exactly one reader

  The `parse` declared for a status is the only thing handed the body; nothing else receives a
  `Response`, and an unread body is released. `raw_response` is gone from the response envelopes,
  which carry `status`, `ok`, `url`, `method` and `headers` themselves, and the retry callbacks
  receive that same metadata in place of the `Request` and `Response`. To reach or stream a body
  the client would not otherwise read, return it from `parse`.

  A schema whose input is `any`, `unknown`, `void` or `never` now requires a `parse` function,
  since the client cannot know how to decode for it. The undeclared-2xx fallback is typed `null`
  instead of `void`, which is what it already yielded at runtime and what `204` yields. Malformed
  JSON is now a `ParseError` carrying the offending text, and a `1xx` response is returned as an
  `UnexpectedError` rather than thrown.
