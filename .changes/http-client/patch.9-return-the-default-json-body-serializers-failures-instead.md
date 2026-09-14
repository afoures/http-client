- Return the default `"json"` body serializer's failures instead of throwing them

  `serialize_body` documents that it returns a `SerializationError` as a value, and the custom `serialize` path was wrapped to honor that, but the built-in `"json"` path was not. A circular structure or a `BigInt` made `JSON.stringify` throw straight out of the method. It now comes back as a `SerializationError` whose `cause` is the `TypeError`, like every other serialization failure.

  A body that stringifies to `undefined` (a function or a symbol, which JSON has no representation for) is reported the same way. It was previously sent as no body at all, under a `Content-Type` still announcing JSON.

  `"json"` is unchanged for every value JSON can represent, an `any` schema output included: a string, a number, `null` and an array all encode as before, and a schema output of `undefined` still means no body.
