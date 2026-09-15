- Add a `kind` discriminant to every response envelope and error class

  Each arm of a call result carries a `kind` literal named after its own type or class, exported as
  `HTTPFetch.ResponseKind` and `ErrorKind`. It tells the redirect arm apart from the error
  responses, which `ok: false` alone does not:

  ```ts
  if (result instanceof Error) return console.error(result.message, result.context);

  if (result.ok) console.log(result.data);
  else if (result.kind === "RedirectMessage") console.warn(result.redirect_to);
  else console.error(result.error);
  ```

  It also narrows the whole union in one `switch` with no `instanceof`, for when a prototype check
  cannot be trusted: after a spread, a clone, or two copies of the package being installed. Reading
  a result is unaffected, but code that builds an envelope by hand, such as a test fixture, has to
  add the matching `kind`.
