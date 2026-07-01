Fix inline endpoints losing their inferred types in `http_client`.

`endpoints` was constrained with `EndpointMap` directly, which contextually widened inline `new Endpoint({...})` generics — collapsing every schema to `Schema.Any` and forcing a spurious `params: any`. The tree is now validated with a homomorphic mapped type, so inline endpoints keep their own inferred `pathname`, schema, and `responses` types.
