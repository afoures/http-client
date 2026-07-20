- Add a `recover` step to the retry policy for rewriting requests between attempts.

  The retry policy now accepts a `recover` callback that overrides request headers before the
  next attempt, for example to refresh an expired auth token or recompute a per-attempt
  signature. It runs once a retry has been decided (after `when` passes and while attempts
  remain), after any `delay`, and immediately before the next attempt. Returned headers replace
  the current set (no merge); `current.headers` is passed as a copy to start from. Available at
  the client, endpoint, and per-call layers with the same last-wins resolution as the other
  retry keys.

  ```typescript
  const result = await api.users.get({
    params: { id: "123" },
    headers: { authorization: "Bearer stale" },
    retry: {
      attempts: 2,
      when: ({ response }) => response?.status === 401,
      recover: async () => ({
        headers: { authorization: `Bearer ${await refresh_token()}` },
      }),
    },
  });
  ```
