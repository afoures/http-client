- Require a `serialize` function for a query or params schema whose output is `any`

  `any` satisfies every compatibility check, so `{ query: { schema: z.any() } }` compiled and quietly took the default `"urlencoded"` encoder. It then had every non-record value dropped from the query string with no error at all.

  ```ts
  // both now a compile error: `any` says nothing about the encoding
  new Endpoint({ method: "GET", pathname: "/s" }, { query: { schema: z.any() } });
  new Endpoint({ method: "GET", pathname: "/u/:id" }, { params: { schema: z.any() } });
  ```

  The output-side mirror of the rule `parse` already follows for a schema whose input is `any`. `unknown` was already handled and is unchanged, as is every concrete output. Add a `serialize` function to the slots this now rejects.
