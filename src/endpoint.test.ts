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
  test("GET request without body schema returns null", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });
    // For GET requests, content should be never/undefined
    const result = await endpoint.serialize_body({
      content: undefined as never,
    });
    assert.equal(result.body, null);
    assert.equal(result.content_type, undefined);
  });

  test("POST request without body schema returns null", async () => {
    // TypeScript requires body for POST, but we test runtime behavior
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: undefined as any,
    } as any);
    const result = await endpoint.serialize_body({
      content: undefined as never,
    });
    assert.equal(result.body, null);
    assert.equal(result.content_type, undefined);
  });

  test("POST request with JSON serialization - object schema", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({ name: z.string() }),
      },
    });
    const result = await endpoint.serialize_body({ content: { name: "John" } });
    assert.equal(result.body, JSON.stringify({ name: "John" }));
    assert.equal(result.content_type, "application/json");
  });

  test("POST request with JSON serialization - array schema", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.array(z.object({ id: z.number() })),
      },
    });
    const result = await endpoint.serialize_body({
      content: [{ id: 1 }, { id: 2 }],
    });
    assert.equal(result.body, JSON.stringify([{ id: 1 }, { id: 2 }]));
    assert.equal(result.content_type, "application/json");
  });

  test("POST request with JSON serialization - schema transformations", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({
          name: z.string().transform((s) => s.toUpperCase()),
          age: z.number().transform((n) => n * 2),
        }),
      },
    });
    const result = await endpoint.serialize_body({
      content: { name: "john", age: 25 },
    });
    // Schema should transform: name -> "JOHN", age -> 50
    assert.equal(result.body, JSON.stringify({ name: "JOHN", age: 50 }));
    assert.equal(result.content_type, "application/json");
  });

  test("PUT request with JSON serialization", async () => {
    const endpoint = new Endpoint({
      method: "PUT",
      pathname: "/users/(:id)",
      body: {
        schema: z.object({ name: z.string() }),
      },
    });
    const result = await endpoint.serialize_body({ content: { name: "Jane" } });
    assert.equal(result.body, JSON.stringify({ name: "Jane" }));
    assert.equal(result.content_type, "application/json");
  });

  test("PATCH request with JSON serialization", async () => {
    const endpoint = new Endpoint({
      method: "PATCH",
      pathname: "/users/(:id)",
      body: {
        schema: z.object({ name: z.string() }),
      },
    });
    const result = await endpoint.serialize_body({ content: { name: "Bob" } });
    assert.equal(result.body, JSON.stringify({ name: "Bob" }));
    assert.equal(result.content_type, "application/json");
  });

  test("DELETE request with JSON serialization", async () => {
    const endpoint = new Endpoint({
      method: "DELETE",
      pathname: "/users/(:id)",
      body: {
        schema: z.object({ reason: z.string() }),
      },
    });
    const result = await endpoint.serialize_body({
      content: { reason: "inactive" },
    });
    assert.equal(result.body, JSON.stringify({ reason: "inactive" }));
    assert.equal(result.content_type, "application/json");
  });

  test("POST request with custom serialization - FormData", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/upload",
      body: {
        schema: z.object({
          name: z.string(),
          file: z.string(),
        }),
        serialization: (data) => {
          const formData = new FormData();
          formData.append("name", data.name);
          formData.append("file", data.file);
          return {
            body: formData,
            content_type: "multipart/form-data",
          };
        },
      },
    });
    const result = await endpoint.serialize_body({
      content: { name: "test.txt", file: "file content" },
    });
    assert.ok(result.body instanceof FormData);
    assert.equal(result.content_type, "multipart/form-data");
  });

  test("POST request with custom serialization - URLSearchParams", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/submit",
      body: {
        schema: z.object({
          username: z.string(),
          password: z.string(),
        }),
        serialization: (data) => {
          const params = new URLSearchParams();
          params.set("username", data.username);
          params.set("password", data.password);
          return {
            body: params,
            content_type: "application/x-www-form-urlencoded",
          };
        },
      },
    });
    const result = await endpoint.serialize_body({
      content: { username: "user123", password: "secret" },
    });
    assert.ok(result.body instanceof URLSearchParams);
    assert.equal(result.content_type, "application/x-www-form-urlencoded");
    const params = result.body as URLSearchParams;
    assert.equal(params.get("username"), "user123");
    assert.equal(params.get("password"), "secret");
  });

  test("POST request with custom serialization - string", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/text",
      body: {
        schema: z.object({
          message: z.string(),
        }),
        serialization: (data) => {
          return {
            body: data.message,
            content_type: "text/plain",
          };
        },
      },
    });
    const result = await endpoint.serialize_body({
      content: { message: "Hello, World!" },
    });
    assert.equal(result.body, "Hello, World!");
    assert.equal(result.content_type, "text/plain");
  });

  test("POST request with custom serialization - null body", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/empty",
      body: {
        schema: z.object({
          action: z.string(),
        }),
        serialization: () => {
          return {
            body: null,
            content_type: "application/json",
          };
        },
      },
    });
    const result = await endpoint.serialize_body({
      content: { action: "delete" },
    });
    assert.equal(result.body, null);
    assert.equal(result.content_type, "application/json");
  });

  test("POST request with custom serialization - schema transformations", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/transform",
      body: {
        schema: z.object({
          value: z.string().transform((s) => s.toUpperCase()),
          count: z.number().transform((n) => n * 2),
        }),
        serialization: (data) => {
          // Custom serialization receives transformed data
          return {
            body: `${data.value}:${data.count}`,
            content_type: "text/plain",
          };
        },
      },
    });
    const result = await endpoint.serialize_body({
      content: { value: "hello", count: 5 },
    });
    // Schema transforms: "hello" -> "HELLO", 5 -> 10
    // Custom serialization formats as "HELLO:10"
    assert.equal(result.body, "HELLO:10");
    assert.equal(result.content_type, "text/plain");
  });

  test("POST request with invalid content - validation error", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({
          name: z.string().min(3),
          age: z.number().positive(),
        }),
      },
    });
    await assert.rejects(
      async () => {
        await endpoint.serialize_body({
          content: { name: "ab", age: -1 } as any,
        });
      },
      (error: Error) => {
        assert.ok(
          error.message.includes("validation failed") ||
            error.message.includes("issues")
        );
        return true;
      }
    );
  });

  test("POST request with invalid content type - validation error", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({
          name: z.string(),
        }),
      },
    });
    await assert.rejects(
      async () => {
        await endpoint.serialize_body({
          content: { name: 123 } as any, // wrong type
        });
      },
      (error: Error) => {
        assert.ok(
          error.message.includes("validation failed") ||
            error.message.includes("issues")
        );
        return true;
      }
    );
  });

  test("POST request with missing required fields - validation error", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({
          name: z.string(),
          email: z.string().email(),
        }),
      },
    });
    await assert.rejects(
      async () => {
        await endpoint.serialize_body({
          content: { name: "John" } as any, // missing email
        });
      },
      (error: Error) => {
        assert.ok(
          error.message.includes("validation failed") ||
            error.message.includes("issues")
        );
        return true;
      }
    );
  });
});

describe("Endpoint.parse_response", () => {
  // TODO: implement tests
});
