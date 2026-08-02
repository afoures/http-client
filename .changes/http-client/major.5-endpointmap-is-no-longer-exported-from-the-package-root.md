- `EndpointMap` is no longer exported from the package root

  It only described the shape of the endpoint tree, and annotating a tree with it erased the per-endpoint context types that `HttpClientConfig<endpoints, default_context>` and `ClientContext<endpoints>` now read.

  Use `typeof endpoints` instead. `http_client` validates the tree it is given on its own, so an annotation is no longer what enforces the shape:

  ```ts
  const endpoints = { rooms };

  // before
  function create_my_client(all_endpoints: EndpointMap, config: HttpClientConfig) {
    return http_client(all_endpoints, config);
  }

  // after
  function create_my_client(config: HttpClientConfig<typeof endpoints>) {
    return http_client(endpoints, config);
  }
  ```