- Replace `@remix-run/route-pattern` with a built-in pathname parser

  The client no longer depends on `@remix-run/route-pattern`. Pathname patterns are parsed in-house, which leaves the package with no runtime dependencies. The supported syntax is unchanged: static text, `:param`, optional groups `(...)` that nest, and several params in one segment (`/v:major.:minor`). Param names keep the JavaScript identifier charset, `[a-zA-Z_$][a-zA-Z_$0-9]*`.

  Percent-encoding of param values, dropping an optional group whose param is `undefined` or `null`, and reporting every missing required param rather than the first all behave as before.

  A leading optional group that is dropped no longer leaves a protocol-relative `//`. Given `/(:lang)/users` with no `lang`, the generated pathname is now `/users` rather than `//users`, which `new URL()` resolved as the host `users` and so sent the request to a different origin.

  A `?` or `#` in a `pathname` is now rejected, at the type level on the endpoint definition and at runtime when the pattern is compiled. Search params are declared with `query`; previously a `?` was parsed as a search-constraint pattern and a `#` was emitted as path text that `new URL()` then reinterpreted as a fragment.

  Undocumented pattern syntax that came from the library is gone: wildcards (`*rest`), enums (`{a,b}`), and protocol, hostname, port or search patterns. Only pathnames are supported.

  `generate_url` and the `Endpoint` constructor now throw `PathnameError` and `MissingParamsError`, exported from the package root, in place of the library's `CreateHrefError`.
