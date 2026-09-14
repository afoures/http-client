- Throw when an endpoint-tree leaf is not an `Endpoint`

  `http_client` recursed into anything that was not an `Endpoint`, so a leaf it could not recognize became `{}` and only failed at the call site with "is not a function". A leaf that is neither an `Endpoint` nor a plain object of endpoints now throws a `TypeError` at construction, naming its path.

  ```ts
  http_client({ users: { get: "/users/:id" } }, { base_url: "https://api.example.com" });
  // TypeError: Invalid endpoint at `users.get`: expected an Endpoint or a plain object of
  // endpoints, received a string.
  ```

  This is what surfaces a duplicate install. An `Endpoint` from a second copy of the package fails `instanceof`, and the error says so instead of handing back an endpoint-shaped empty object. Note that only a plain object counts as a branch now, so a class instance used as a namespace is rejected too.
