- Reject a `"urlencoded"` query output that is not a record or an entry list

  A bare string, a number, a boolean or `null` produced no search string and no error. It now returns a `SerializationError`, like every other value the default encoder cannot turn into key/value pairs. Emitting nothing at all is the one failure a caller has no way to notice.

  `undefined` is unchanged and still means "send nothing", which stays the documented way to omit a query.
