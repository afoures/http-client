- Keep declared context keys required in `$infer.Context` and `$infer.Input` of a raw `Endpoint`

  Applied to an `Endpoint` instance rather than a bound client function, the helpers treated every context key as covered by a client-level default and made the whole `context` optional. A raw endpoint has no client in front of it, so only its own endpoint-level defaults make a key optional now, matching the bound form of a client that declares no defaults.
