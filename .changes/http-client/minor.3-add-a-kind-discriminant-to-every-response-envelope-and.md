- Add a `kind` discriminant to every response envelope and error class

  Each arm of a call result now carries a `kind` literal named after its own type or class, so the whole union narrows in one flat `switch`, with no `instanceof` and no value import:

  ```ts
  switch (result.kind) {
    case "SuccessfulResponse":
      return result.data;
    case "RedirectMessage":
      return log(result.redirect_to);
    case "ClientErrorResponse":
    case "ServerErrorResponse":
      return handle(result.error);
    case "TimeoutError":
    case "NetworkError":
      return retry();
    default:
      return report(result.context);
  }
  ```

  The values are exported as `HTTPFetch.ResponseKind` and `ErrorKind`. Adding a `default` branch that calls a `(value: never) => never` helper turns an unhandled arm into a compile error.

  Unlike `ok` and `status`, `kind` needs no prior `instanceof Error` check, because the error classes carry it too. It also survives a spread, a clone or a serialization round-trip, and keeps working when two copies of this package end up installed, all of which defeat `instanceof`.

  For the error classes the value matches `name`, which already held the same string at runtime. The difference is that `Error` types `name` as `string`, so only `kind` can discriminate a union.

  This is breaking for code that builds response envelopes by hand, such as test fixtures and mocks, which must now include `kind`.