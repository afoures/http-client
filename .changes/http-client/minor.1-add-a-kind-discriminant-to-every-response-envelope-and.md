- Add a `kind` discriminant to every response envelope and error class

  Each arm of a call result now carries a `kind` literal named after its own type or class, exported
  as `HTTPFetch.ResponseKind` and `ErrorKind`. Its everyday use is telling the redirect arm apart
  from the error responses, which `ok: false` alone does not:

  ```ts
  if (result instanceof Error) return console.error(result.message, result.context);

  if (result.ok) console.log(result.data);
  else if (result.kind === "RedirectMessage") console.warn(result.redirect_to);
  else console.error(result.error);
  ```

  Because the error classes carry it too, `kind` can also narrow the whole union in one `switch` with
  no `instanceof` and no value import. That form is for when a prototype check cannot be trusted:
  after a spread, a clone or a serialization round-trip, or when two copies of this package end up
  installed.

  Reading a result is unaffected, since `kind` is an added field. Code that builds an envelope by
  hand, such as a test fixture or a mock, has to add the matching `kind` for it to satisfy the type.
