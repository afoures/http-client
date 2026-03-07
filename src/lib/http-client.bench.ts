import { bench } from "@arktype/attest";
import { http_client } from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import z from "zod";

const basicEndpoint = new Endpoint({
  method: "GET",
  pathname: "/users",
});

const endpointWithSchema = new Endpoint({
  method: "POST",
  pathname: "/users",
  body: {
    schema: z.object({ name: z.string(), email: z.string() }),
  },
  data: {
    schema: z.object({ id: z.string(), name: z.string() }),
  },
});

bench("http_client - single endpoint", () => {
  const client = http_client({
    base_url: "https://api.example.com",
    endpoints: {
      users: basicEndpoint,
    },
  });
  return {} as typeof client;
}).types([7723, "instantiations"]);

bench("http_client - two endpoints", () => {
  const client = http_client({
    base_url: "https://api.example.com",
    endpoints: {
      users: basicEndpoint,
      posts: new Endpoint({ method: "GET", pathname: "/posts" }),
    },
  });
  return {} as typeof client;
}).types([7837, "instantiations"]);

bench("http_client - three endpoints", () => {
  const client = http_client({
    base_url: "https://api.example.com",
    endpoints: {
      users: basicEndpoint,
      posts: new Endpoint({ method: "GET", pathname: "/posts" }),
      comments: new Endpoint({ method: "GET", pathname: "/comments" }),
    },
  });
  return {} as typeof client;
}).types([7871, "instantiations"]);

bench("http_client - five endpoints", () => {
  const client = http_client({
    base_url: "https://api.example.com",
    endpoints: {
      users: basicEndpoint,
      posts: new Endpoint({ method: "GET", pathname: "/posts" }),
      comments: new Endpoint({ method: "GET", pathname: "/comments" }),
      tags: new Endpoint({ method: "GET", pathname: "/tags" }),
      categories: new Endpoint({ method: "GET", pathname: "/categories" }),
    },
  });
  return {} as typeof client;
}).types([7939, "instantiations"]);

bench("http_client - ten endpoints", () => {
  const client = http_client({
    base_url: "https://api.example.com",
    endpoints: {
      users: basicEndpoint,
      posts: new Endpoint({ method: "GET", pathname: "/posts" }),
      comments: new Endpoint({ method: "GET", pathname: "/comments" }),
      tags: new Endpoint({ method: "GET", pathname: "/tags" }),
      categories: new Endpoint({ method: "GET", pathname: "/categories" }),
      authors: new Endpoint({ method: "GET", pathname: "/authors" }),
      reviews: new Endpoint({ method: "GET", pathname: "/reviews" }),
      likes: new Endpoint({ method: "GET", pathname: "/likes" }),
      shares: new Endpoint({ method: "GET", pathname: "/shares" }),
      bookmarks: new Endpoint({ method: "GET", pathname: "/bookmarks" }),
    },
  });
  return {} as typeof client;
}).types([8109, "instantiations"]);

bench("http_client - nested structure (2 levels)", () => {
  const client = http_client({
    base_url: "https://api.example.com",
    endpoints: {
      api: {
        v1: {
          users: basicEndpoint,
          posts: new Endpoint({ method: "GET", pathname: "/posts" }),
        },
      },
    },
  });
  return {} as typeof client;
}).types([7856, "instantiations"]);

bench("http_client - nested structure (3 levels)", () => {
  const client = http_client({
    base_url: "https://api.example.com",
    endpoints: {
      api: {
        v1: {
          public: {
            users: basicEndpoint,
            posts: new Endpoint({ method: "GET", pathname: "/posts" }),
          },
        },
      },
    },
  });
  return {} as typeof client;
}).types([7856, "instantiations"]);

bench("http_client - with options callback", () => {
  const client = http_client({
    base_url: "https://api.example.com",
    endpoints: {
      users: basicEndpoint,
    },
    options: () => ({
      headers: { "X-Custom": "value" },
    }),
  });
  return {} as typeof client;
}).types([7783, "instantiations"]);

bench("http_client - with complex endpoints", () => {
  const client = http_client({
    base_url: "https://api.example.com",
    endpoints: {
      users: endpointWithSchema,
      posts: new Endpoint({
        method: "POST",
        pathname: "/posts",
        body: {
          schema: z.object({ title: z.string(), content: z.string() }),
        },
        data: {
          schema: z.object({ id: z.string(), title: z.string() }),
        },
      }),
    },
  });
  return {} as typeof client;
}).types([9188, "instantiations"]);

bench("http_client - mixed nesting levels", () => {
  const client = http_client({
    base_url: "https://api.example.com",
    endpoints: {
      public: {
        users: basicEndpoint,
        posts: new Endpoint({ method: "GET", pathname: "/posts" }),
      },
      admin: {
        users: new Endpoint({ method: "GET", pathname: "/admin/users" }),
        stats: new Endpoint({ method: "GET", pathname: "/admin/stats" }),
      },
      health: new Endpoint({ method: "GET", pathname: "/health" }),
    },
  });
  return {} as typeof client;
}).types([7958, "instantiations"]);
