Expand the `$infer` namespace.

- All `$infer.*` helpers now accept either an `Endpoint` instance or a bound fetch function.
- `$infer.Data` and `$infer.Error` take an optional second `status` type parameter to extract the body for a specific status or status class, e.g. `$infer.Data<typeof endpoint, 200>`.
- Add `$infer.Input` (the full request argument), `$infer.Result` (everything `fetch` can return, including transport errors), and `$infer.Response` (the HTTP response union only, narrowable on `ok`/`status`).
