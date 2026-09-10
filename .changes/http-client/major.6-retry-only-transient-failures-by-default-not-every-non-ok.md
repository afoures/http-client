- Retry only transient failures by default, not every non-ok response

  ```ts
  // before: ({ response }) => response?.ok === false
  // after:  retry NetworkError / TimeoutError, and 408, 429, 5xx
  ```
