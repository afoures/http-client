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
    serialize: "json",
  },
  responses: {
    200: {
      schema: z.object({ id: z.string(), name: z.string() }),
      parse: "json",
    },
  },
});

bench("http_client - single endpoint", () => {
  const client = http_client(
    {
      users: basicEndpoint,
    },
    { base_url: "https://api.example.com" },
  );
  return {} as typeof client;
}).types([11753, "instantiations"]);

bench("http_client - two endpoints", () => {
  const client = http_client(
    {
      users: basicEndpoint,
      posts: new Endpoint({ method: "GET", pathname: "/posts" }),
    },
    { base_url: "https://api.example.com" },
  );
  return {} as typeof client;
}).types([11865, "instantiations"]);

bench("http_client - three endpoints", () => {
  const client = http_client(
    {
      users: basicEndpoint,
      posts: new Endpoint({ method: "GET", pathname: "/posts" }),
      comments: new Endpoint({ method: "GET", pathname: "/comments" }),
    },
    { base_url: "https://api.example.com" },
  );
  return {} as typeof client;
}).types([11976, "instantiations"]);

bench("http_client - five endpoints", () => {
  const client = http_client(
    {
      users: basicEndpoint,
      posts: new Endpoint({ method: "GET", pathname: "/posts" }),
      comments: new Endpoint({ method: "GET", pathname: "/comments" }),
      tags: new Endpoint({ method: "GET", pathname: "/tags" }),
      categories: new Endpoint({ method: "GET", pathname: "/categories" }),
    },
    { base_url: "https://api.example.com" },
  );
  return {} as typeof client;
}).types([12198, "instantiations"]);

bench("http_client - ten endpoints", () => {
  const client = http_client(
    {
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
    { base_url: "https://api.example.com" },
  );
  return {} as typeof client;
}).types([12753, "instantiations"]);

bench("http_client - nested structure (2 levels)", () => {
  const client = http_client(
    {
      api: {
        v1: {
          users: basicEndpoint,
          posts: new Endpoint({ method: "GET", pathname: "/posts" }),
        },
      },
    },
    { base_url: "https://api.example.com" },
  );
  return {} as typeof client;
}).types([12093, "instantiations"]);

bench("http_client - nested structure (3 levels)", () => {
  const client = http_client(
    {
      api: {
        v1: {
          public: {
            users: basicEndpoint,
            posts: new Endpoint({ method: "GET", pathname: "/posts" }),
          },
        },
      },
    },
    { base_url: "https://api.example.com" },
  );
  return {} as typeof client;
}).types([12209, "instantiations"]);

bench("http_client - with options callback", () => {
  const client = http_client(
    {
      users: basicEndpoint,
    },
    {
      base_url: "https://api.example.com",
      options: () => ({
        headers: { "X-Custom": "value" },
      }),
    },
  );
  return {} as typeof client;
}).types([11821, "instantiations"]);

bench("http_client - with complex endpoints", () => {
  const client = http_client(
    {
      users: endpointWithSchema,
      posts: new Endpoint({
        method: "POST",
        pathname: "/posts",
        body: {
          schema: z.object({ title: z.string(), content: z.string() }),
          serialize: "json",
        },
        responses: {
          200: {
            schema: z.object({ id: z.string(), title: z.string() }),
            parse: "json",
          },
        },
      }),
    },
    { base_url: "https://api.example.com" },
  );
  return {} as typeof client;
}).types([13691, "instantiations"]);

bench("http_client - mixed nesting levels", () => {
  const client = http_client(
    {
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
    { base_url: "https://api.example.com" },
  );
  return {} as typeof client;
}).types([12428, "instantiations"]);
