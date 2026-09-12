Make `retry.attempts` count retries, not requests

`attempts: 1` now allows one retry after the first request, so two requests at most; it used to mean one request in total, the same as `attempts: 0`. The default of `0` is unchanged and still means a single request, so a `when` condition on its own never retries.

```ts
await api.users.get({ retry: { attempts: 3 } }); // was 3 requests at most, now 4
```
