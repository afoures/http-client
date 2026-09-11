- Type the 2xx fallback as `null` instead of `void`

  An undeclared 2xx status already yielded `null` at runtime, since its body is discarded rather than read, but the envelope typed it as `void`. The fallback is now `null`, which is also what `204` yields, so both collapse into one arm.

  ```ts
  // before
  result.data; // void | { id: string; created_at: string } | null
  // after
  result.data; // { id: string; created_at: string } | null
  ```

  Code that discriminated a success arm on `data: void`, or that spelled `void` out in an `$infer.Data` union, has to say `null` instead. To get an unlisted body back rather than dropping it, declare a `2xx` parser.
