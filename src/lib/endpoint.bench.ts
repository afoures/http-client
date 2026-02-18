import { bench } from "@arktype/attest";
import { Endpoint } from "./endpoint.ts";
import z from "zod";

bench("Endpoint - minimal GET", () => {
  const endpoint = new Endpoint({
    method: "GET",
    pathname: "/users",
  });
  return {} as typeof endpoint;
}).types([227, "instantiations"]);

bench("Endpoint - minimal POST", () => {
  const endpoint = new Endpoint({
    method: "POST",
    pathname: "/users",
  });
  return {} as typeof endpoint;
}).types([225, "instantiations"]);

bench("Endpoint - with pathname params", () => {
  const endpoint = new Endpoint({
    method: "GET",
    pathname: "/users/:id",
  });
  return {} as typeof endpoint;
}).types([225, "instantiations"]);

bench("Endpoint - with query schema", () => {
  const endpoint = new Endpoint({
    method: "GET",
    pathname: "/users",
    query: {
      schema: z.object({
        page: z.string(),
        limit: z.string(),
      }),
    },
  });
  return {} as typeof endpoint;
}).types([1336, "instantiations"]);

bench("Endpoint - with body schema", () => {
  const endpoint = new Endpoint({
    method: "POST",
    pathname: "/users",
    body: {
      schema: z.object({
        name: z.string(),
        email: z.string(),
      }),
    },
  });
  return {} as typeof endpoint;
}).types([1347, "instantiations"]);

bench("Endpoint - with data schema", () => {
  const endpoint = new Endpoint({
    method: "GET",
    pathname: "/users/:id",
    data: {
      schema: z.object({
        id: z.string(),
        name: z.string(),
      }),
    },
  });
  return {} as typeof endpoint;
}).types([1426, "instantiations"]);

bench("Endpoint - with error schema", () => {
  const endpoint = new Endpoint({
    method: "GET",
    pathname: "/users",
    error: {
      schema: z.object({
        message: z.string(),
        code: z.number(),
      }),
      deserialization: "json",
    },
  });
  return {} as typeof endpoint;
}).types([1461, "instantiations"]);

bench("Endpoint - full schema (all generics)", () => {
  const endpoint = new Endpoint({
    method: "POST",
    pathname: "/users/:id",
    params: {
      schema: z.object({ id: z.string() }),
    },
    query: {
      schema: z.object({ include: z.string() }),
    },
    body: {
      schema: z.object({ name: z.string(), email: z.string() }),
    },
    data: {
      schema: z.object({ id: z.string(), name: z.string() }),
    },
    error: {
      schema: z.string(),
      deserialization: "text",
    },
  });
  return {} as typeof endpoint;
}).types([3850, "instantiations"]);

bench("Endpoint - nested object schema", () => {
  const endpoint = new Endpoint({
    method: "POST",
    pathname: "/users",
    body: {
      schema: z.object({
        user: z.object({
          profile: z.object({
            name: z.string(),
            address: z.object({
              street: z.string(),
              city: z.string(),
              country: z.string(),
            }),
          }),
        }),
      }),
    },
  });
  return {} as typeof endpoint;
}).types([1797, "instantiations"]);

bench("Endpoint - array schema", () => {
  const endpoint = new Endpoint({
    method: "POST",
    pathname: "/users/batch",
    body: {
      schema: z.array(
        z.object({
          name: z.string(),
          email: z.string(),
        }),
      ),
    },
    data: {
      schema: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
        }),
      ),
    },
  });
  return {} as typeof endpoint;
}).types([1735, "instantiations"]);

bench("Endpoint - multiple pathname params", () => {
  const endpoint = new Endpoint({
    method: "GET",
    pathname: "/users/:userId/posts/:postId/comments/:commentId",
    params: {
      schema: z.object({
        userId: z.string(),
        postId: z.string(),
        commentId: z.string(),
      }),
    },
  });
  return {} as typeof endpoint;
}).types([6026, "instantiations"]);

bench("Endpoint - with custom serialization", () => {
  const endpoint = new Endpoint({
    method: "POST",
    pathname: "/users",
    body: {
      schema: z.object({ data: z.string() }),
      serialization: (data) => ({
        body: data.data,
        content_type: "text/plain",
      }),
    },
    query: {
      schema: z.object({ tags: z.array(z.string()) }),
      serialization: (data) => {
        const params = new URLSearchParams();
        params.set("tags", data.tags.join(","));
        return params;
      },
    },
  });
  return {} as typeof endpoint;
}).types([2057, "instantiations"]);

bench("Endpoint - with custom deserialization", () => {
  const endpoint = new Endpoint({
    method: "GET",
    pathname: "/users/:id",
    data: {
      schema: z.object({ value: z.string() }),
      deserialization: async (body) => {
        const text = await new Response(body).text();
        return JSON.parse(text);
      },
    },
    error: {
      schema: z.object({ errors: z.array(z.string()) }),
      deserialization: async (body) => {
        const text = await new Response(body).text();
        return { errors: text.split(",") };
      },
    },
  });
  return {} as typeof endpoint;
}).types([2341, "instantiations"]);

bench("Endpoint - union types in schema", () => {
  const endpoint = new Endpoint({
    method: "POST",
    pathname: "/users",
    body: {
      schema: z.object({
        role: z.union([
          z.literal("admin"),
          z.literal("user"),
          z.literal("guest"),
        ]),
        status: z.enum(["active", "inactive", "pending"]),
        metadata: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean()]),
        ),
      }),
    },
  });
  return {} as typeof endpoint;
}).types([2334, "instantiations"]);
