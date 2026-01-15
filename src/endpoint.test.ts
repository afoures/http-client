import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Endpoint } from "./endpoint.ts";
import z from "zod";

describe("Endpoint.generate_url", () => {
  test("basic pathname without params or query", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });
    const url = await endpoint.generate_url({
      origin: "https://api.example.com",
    });
    assert.equal(url.toString(), "https://api.example.com/users");
    assert.equal(url.pathname, "/users");
    assert.equal(url.search, "");
  });

  test("with query string - array schema", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      query: {
        schema: z.array(z.tuple([z.literal("ok"), z.string()])),
      },
    });
    const url = await endpoint.generate_url({
      origin: "https://api.example.com",
      query: [["ok", "test"]],
    });
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/users");
    // Array schema with tuples should serialize to query string
    // Format depends on implementation, but should include the values
    assert.ok(url.search.length > 0, "Query string should not be empty");
  });

  test("with query string - object schema", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      query: {
        schema: z.object({
          search: z.string(),
          page: z.number().transform((n) => n.toString()),
        }),
      },
    });
    const url = await endpoint.generate_url({
      origin: "https://api.example.com",
      query: { search: "test", page: 1 },
    });
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/users");
    assert.equal(url.searchParams.get("search"), "test");
    assert.equal(url.searchParams.get("page"), "1");
  });

  test("with pathname params - without schema", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users/(:id)",
    });
    const url = await endpoint.generate_url({
      origin: "https://api.example.com",
      params: { id: 123 },
    });
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/users/123");
    assert.equal(url.search, "");
  });

  test("with pathname params - with schema", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users/(:id)",
      params: {
        schema: z.object({
          id: z.string().transform((s) => s.toUpperCase()),
        }),
      },
    });
    const url = await endpoint.generate_url({
      origin: "https://api.example.com",
      params: { id: "abc" },
    });
    assert.equal(url.origin, "https://api.example.com");
    // Schema should transform the param value
    assert.equal(url.pathname, "/users/ABC");
    assert.equal(url.search, "");
  });

  test("combined params and query string", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users/(:id)",
      query: {
        schema: z.object({
          include: z.string(),
        }),
      },
    });
    const url = await endpoint.generate_url({
      origin: "https://api.example.com",
      params: { id: "123" },
      query: { include: "posts" },
    });
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/users/123");
    assert.equal(url.searchParams.get("include"), "posts");
  });

  test("with pathname params - custom serialization", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users/(:id)",
      params: {
        schema: z.object({
          id: z.number(),
        }),
        serialization: (data) => {
          // Custom serialization: pad number with zeros to 6 digits
          return { id: String(data.id).padStart(6, "0") };
        },
      },
    });
    const url = await endpoint.generate_url({
      origin: "https://api.example.com",
      params: { id: 123 },
    });
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/users/000123");
    assert.equal(url.search, "");
  });

  test("with pathname params - custom serialization with schema transform", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users/(:id)",
      params: {
        schema: z.object({
          id: z.string().transform((s) => s.toUpperCase()),
        }),
        serialization: (data) => {
          // Custom serialization: add prefix
          return { id: `user-${data.id}` };
        },
      },
    });
    const url = await endpoint.generate_url({
      origin: "https://api.example.com",
      params: { id: "abc" },
    });
    assert.equal(url.origin, "https://api.example.com");
    // Schema transforms "abc" to "ABC", then custom serialization adds prefix
    assert.equal(url.pathname, "/users/user-ABC");
    assert.equal(url.search, "");
  });

  test("with query string - custom serialization function", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      query: {
        schema: z.object({
          tags: z.array(z.string()),
          limit: z.number(),
        }),
        serialization: (data) => {
          // Custom serialization: serialize array as comma-separated values
          const params = new URLSearchParams();
          params.set("tags", data.tags.join(","));
          params.set("limit", String(data.limit));
          return params;
        },
      },
    });
    const url = await endpoint.generate_url({
      origin: "https://api.example.com",
      query: { tags: ["react", "typescript"], limit: 10 },
    });
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/users");
    assert.equal(url.searchParams.get("tags"), "react,typescript");
    assert.equal(url.searchParams.get("limit"), "10");
  });

  test("with query string - custom serialization with schema transform", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/search",
      query: {
        schema: z.object({
          q: z.string().transform((s) => s.trim().toLowerCase()),
          page: z.number().transform((n) => n * 10),
        }),
        serialization: (data) => {
          // Custom serialization: encode query with special format
          const params = new URLSearchParams();
          params.set("query", encodeURIComponent(data.q));
          params.set("offset", String(data.page));
          return params;
        },
      },
    });
    const url = await endpoint.generate_url({
      origin: "https://api.example.com",
      query: { q: "  Hello World  ", page: 2 },
    });
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/search");
    // Schema transforms: "  Hello World  " -> "hello world", page 2 -> 20
    // Custom serialization: maps q -> query, page -> offset
    assert.equal(url.searchParams.get("query"), "hello%20world");
    assert.equal(url.searchParams.get("offset"), "20");
  });

  test("with query string - custom serialization for array schema", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/filters",
      query: {
        schema: z.array(z.tuple([z.string(), z.string()])),
        serialization: (data) => {
          // Custom serialization: serialize tuples as key=value pairs
          const params = new URLSearchParams();
          data.forEach(([key, value]) => {
            params.append(key, value);
          });
          return params;
        },
      },
    });
    const url = await endpoint.generate_url({
      origin: "https://api.example.com",
      query: [
        ["status", "active"],
        ["role", "admin"],
      ],
    });
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/filters");
    assert.equal(url.searchParams.get("status"), "active");
    assert.equal(url.searchParams.get("role"), "admin");
  });
});

describe("Endpoint.serialize_body", () => {
  // TODO: implement tests
});

describe("Endpoint.parse_response", () => {
  // TODO: implement tests
});
