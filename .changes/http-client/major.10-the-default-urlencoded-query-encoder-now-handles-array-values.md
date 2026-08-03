- The default `"urlencoded"` query encoder now handles array values and entry lists correctly

  ```text
  { tags: ["a", "b"] }       was ?tags=a%2Cb                                    now ?tags=a&tags=b
  [["a", "1"], ["b", "2"]]   was ?0%5B0%5D=a&0%5B1%5D=1&1%5B0%5D=b&1%5B1%5D=2   now ?a=1&b=2
  ```

  A value it cannot express (a nested object, or an entry that isn't a `[key, value]` pair) now returns a `SerializationError` naming the key instead of writing `[object Object]`. `null` and `undefined` are still skipped. `serialize` also stays optional for more schemas: numbers, booleans and array values are urlencoded-compatible now, so the cast that used to be needed to reach the comma-join is gone.
