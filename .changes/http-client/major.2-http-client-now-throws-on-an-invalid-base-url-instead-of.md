- `http_client` now throws on an invalid `base_url` instead of returning an error per call

  An unparsable `base_url` is a static misconfiguration: it cannot depend on call input, so it was either always broken or never broken for a given client. It is now validated once in `http_client`, which throws a `TypeError`, rather than making every call return an `UnexpectedError` with `operation: "base_url_validation"`.

  ```ts
  // throws TypeError: Invalid base_url: /api. Expected an absolute URL parsable by `new URL()`.
  const api = http_client(endpoints, { base_url: "/api" });
  ```

  This is the only failure the client throws instead of returning as a value. Call sites that matched on `operation === "base_url_validation"` no longer need that branch.
