- The default retry condition now retries transient failures instead of every non-ok response.

  ```typescript
  // before: ({ response }) => response?.ok === false
  // after:  retry NetworkError / TimeoutError, and 408, 429, 5xx
  ```
