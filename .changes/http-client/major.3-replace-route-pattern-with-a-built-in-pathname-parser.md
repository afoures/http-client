- Replace `@remix-run/route-pattern` with a built-in pathname parser

  The package now has no runtime dependencies. The supported syntax is unchanged: static text, `:param`, optional groups `(...)` that nest, and several params in one segment (`/v:major.:minor`).

  A dropped leading optional group no longer leaves a protocol-relative `//`. Given `/(:lang)/users` with no `lang`, the pathname is now `/users` rather than `//users`, which `new URL()` resolved as the host `users` and so sent the request to a different origin.

  A `?` or `#` in a `pathname` is now rejected, at the type level and when the pattern is compiled; search params are declared with `query`. Undocumented syntax inherited from the library is gone: wildcards (`*rest`), enums (`{a,b}`), and protocol, hostname, port and search patterns.

  `generate_url` and the `Endpoint` constructor throw `PathnameError` and `MissingParamsError`, exported from the package root, in place of the library's `CreateHrefError`.
