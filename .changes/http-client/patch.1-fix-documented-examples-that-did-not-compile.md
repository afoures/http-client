- Fix documented examples that did not compile

  `docs/error-handling.md` showed `result.kind` in five places, a field that did not exist on the error classes until this release.

  The "handle every case" examples in `docs/response-parsing.md` and `docs/http-client.md` did not typecheck either. The first narrowed with relational status comparisons (`result.status >= 400`), which do not narrow a union of numeric literals in TypeScript, leaving `result.error` inaccessible. The second read `result.error` from the `else` of an `ok` check, a branch that also contains the redirect arm, which has no `error` field.

  Both are rewritten as `kind` switches, with the `status`-based form shown separately using exact comparisons after an `instanceof Error` peel.
