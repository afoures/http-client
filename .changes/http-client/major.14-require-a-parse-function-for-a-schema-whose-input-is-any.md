- Require a `parse` function for a schema whose input is `any`, `unknown`, `void` or `never`

  Such a schema accepts whatever the body decodes to, so the client cannot know how to decode it. `"json"` and `"text"` are rejected for it at the type level (`z.any()` used to be forced to `"text"`, and `z.unknown()` allowed `"json"`); decoding is the consumer's job.

  ```ts
  // before
  { schema: z.unknown(), parse: "json" }
  // after
  { schema: z.unknown(), parse: async (body) => new Response(body).json() }
  ```

  A concrete schema such as `z.record(z.string(), z.unknown())` still takes `"json"`.
