import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Endpoint } from "./endpoint.ts";
import z from "zod";
import { ParseError, SerializationError } from "./errors.ts";

describe("Endpoint.generate_url", () => {
  test("basic pathname without params or query", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
    });
    assert.ok(url instanceof URL);
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
      base_url: "https://api.example.com",
      query: [["ok", "test"]],
    });
    assert.ok(url instanceof URL);
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
      base_url: "https://api.example.com",
      query: { search: "test", page: 1 },
    });
    assert.ok(url instanceof URL);
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
      base_url: "https://api.example.com",
      params: { id: 123 },
    });
    assert.ok(url instanceof URL);
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
      base_url: "https://api.example.com",
      params: { id: "abc" },
    });
    assert.ok(url instanceof URL);
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
      base_url: "https://api.example.com",
      params: { id: "123" },
      query: { include: "posts" },
    });
    assert.ok(url instanceof URL);
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/users/123");
    assert.equal(url.searchParams.get("include"), "posts");
  });

  test("with pathname params - custom serialize", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users/(:id)",
      params: {
        schema: z.object({
          id: z.number(),
        }),
        serialize: (data) => {
          // Custom serialize: pad number with zeros to 6 digits
          return { id: String(data.id).padStart(6, "0") };
        },
      },
    });
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
      params: { id: 123 },
    });
    assert.ok(url instanceof URL);
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/users/000123");
    assert.equal(url.search, "");
  });

  test("with pathname params - custom serialize with schema transform", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users/(:id)",
      params: {
        schema: z.object({
          id: z.string().transform((s) => s.toUpperCase()),
        }),
        serialize: (data) => {
          // Custom serialize: add prefix
          return { id: `user-${data.id}` };
        },
      },
    });
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
      params: { id: "abc" },
    });
    assert.ok(url instanceof URL);
    assert.equal(url.origin, "https://api.example.com");
    // Schema transforms "abc" to "ABC", then custom serialize adds prefix
    assert.equal(url.pathname, "/users/user-ABC");
    assert.equal(url.search, "");
  });

  test("with query string - custom serialize function", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      query: {
        schema: z.object({
          tags: z.array(z.string()),
          limit: z.number(),
        }),
        serialize: (data) => {
          // Custom serialize: serialize array as comma-separated values
          const params = new URLSearchParams();
          params.set("tags", data.tags.join(","));
          params.set("limit", String(data.limit));
          return params;
        },
      },
    });
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
      query: { tags: ["react", "typescript"], limit: 10 },
    });
    assert.ok(url instanceof URL);
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/users");
    assert.equal(url.searchParams.get("tags"), "react,typescript");
    assert.equal(url.searchParams.get("limit"), "10");
  });

  test("with query string - custom serialize with schema transform", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/search",
      query: {
        schema: z.object({
          q: z.string().transform((s) => s.trim().toLowerCase()),
          page: z.number().transform((n) => n * 10),
        }),
        serialize: (data) => {
          // Custom serialize: encode query with special format
          const params = new URLSearchParams();
          params.set("query", encodeURIComponent(data.q));
          params.set("offset", String(data.page));
          return params;
        },
      },
    });
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
      query: { q: "  Hello World  ", page: 2 },
    });
    assert.ok(url instanceof URL);
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/search");
    // Schema transforms: "  Hello World  " -> "hello world", page 2 -> 20
    // Custom serialize: maps q -> query, page -> offset
    assert.equal(url.searchParams.get("query"), "hello%20world");
    assert.equal(url.searchParams.get("offset"), "20");
  });

  test("with query string - custom serialize for array schema", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/filters",
      query: {
        schema: z.array(z.tuple([z.string(), z.string()])),
        serialize: (data) => {
          // Custom serialize: serialize tuples as key=value pairs
          const params = new URLSearchParams();
          data.forEach(([key, value]) => {
            params.append(key, value);
          });
          return params;
        },
      },
    });
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
      query: [
        ["status", "active"],
        ["role", "admin"],
      ],
    });
    assert.ok(url instanceof URL);
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/filters");
    assert.equal(url.searchParams.get("status"), "active");
    assert.equal(url.searchParams.get("role"), "admin");
  });

  test("base_url with relative pathname", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users/:id",
    });
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com/api/",
      params: { id: 123 },
    });
    assert.ok(url instanceof URL);
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/api/users/123");
    assert.equal(url.search, "");
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
      body: undefined as never,
    });
    assert.ok(!(result instanceof SerializationError));
    assert.equal(result.body, null);
    assert.equal(result.content_type, undefined);
  });

  test("POST request without body schema returns null", async () => {
    // TypeScript requires body for POST, but we test runtime behavior
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: undefined,
    });
    const result = await endpoint.serialize_body({
      body: undefined as never,
    });
    assert.ok(!(result instanceof SerializationError));
    assert.equal(result.body, null);
    assert.equal(result.content_type, undefined);
  });

  test("POST request with JSON serialize - object schema", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({ name: z.string() }),
        serialize: "json",
      },
    });
    const result = await endpoint.serialize_body({ body: { name: "John" } });
    assert.ok(!(result instanceof SerializationError));
    assert.equal(result.body, JSON.stringify({ name: "John" }));
    assert.equal(result.content_type, "application/json");
  });

  test("POST request with JSON serialize - array schema", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.array(z.object({ id: z.number() })),
        serialize: "json",
      },
    });
    const result = await endpoint.serialize_body({
      body: [{ id: 1 }, { id: 2 }],
    });
    assert.ok(!(result instanceof SerializationError));
    assert.equal(result.body, JSON.stringify([{ id: 1 }, { id: 2 }]));
    assert.equal(result.content_type, "application/json");
  });

  test("POST request with JSON serialize - schema transformations", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({
          name: z.string().transform((s) => s.toUpperCase()),
          age: z.number().transform((n) => n * 2),
        }),
        serialize: "json",
      },
    });
    const result = await endpoint.serialize_body({
      body: { name: "john", age: 25 },
    });
    // Schema should transform: name -> "JOHN", age -> 50
    assert.ok(!(result instanceof SerializationError));
    assert.equal(result.body, JSON.stringify({ name: "JOHN", age: 50 }));
    assert.equal(result.content_type, "application/json");
  });

  test("PUT request with JSON serialize", async () => {
    const endpoint = new Endpoint({
      method: "PUT",
      pathname: "/users/(:id)",
      body: {
        schema: z.object({ name: z.string() }),
        serialize: "json",
      },
    });
    const result = await endpoint.serialize_body({ body: { name: "Jane" } });
    assert.ok(!(result instanceof SerializationError));
    assert.equal(result.body, JSON.stringify({ name: "Jane" }));
    assert.equal(result.content_type, "application/json");
  });

  test("PATCH request with JSON serialize", async () => {
    const endpoint = new Endpoint({
      method: "PATCH",
      pathname: "/users/(:id)",
      body: {
        schema: z.object({ name: z.string() }),
        serialize: "json",
      },
    });
    const result = await endpoint.serialize_body({ body: { name: "Bob" } });
    assert.ok(!(result instanceof SerializationError));
    assert.equal(result.body, JSON.stringify({ name: "Bob" }));
    assert.equal(result.content_type, "application/json");
  });

  test("DELETE request with JSON serialize", async () => {
    const endpoint = new Endpoint({
      method: "DELETE",
      pathname: "/users/(:id)",
      body: {
        schema: z.object({ reason: z.string() }),
        serialize: "json",
      },
    });
    const result = await endpoint.serialize_body({
      body: { reason: "inactive" },
    });
    assert.ok(!(result instanceof SerializationError));
    assert.equal(result.body, JSON.stringify({ reason: "inactive" }));
    assert.equal(result.content_type, "application/json");
  });

  test("POST request with custom serialize - FormData", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/upload",
      body: {
        schema: z.object({
          name: z.string(),
          file: z.string(),
        }),
        serialize: (data) => {
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
      body: { name: "test.txt", file: "file content" },
    });
    assert.ok(!(result instanceof SerializationError));
    assert.ok(result.body instanceof FormData);
    assert.equal(result.content_type, "multipart/form-data");
  });

  test("POST request with custom serialize - URLSearchParams", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/submit",
      body: {
        schema: z.object({
          username: z.string(),
          password: z.string(),
        }),
        serialize: (data) => {
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
      body: { username: "user123", password: "secret" },
    });
    assert.ok(!(result instanceof SerializationError));
    assert.ok(result.body instanceof URLSearchParams);
    assert.equal(result.content_type, "application/x-www-form-urlencoded");
    const params = result.body as URLSearchParams;
    assert.equal(params.get("username"), "user123");
    assert.equal(params.get("password"), "secret");
  });

  test("POST request with custom serialize - string", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/text",
      body: {
        schema: z.object({
          message: z.string(),
        }),
        serialize: (data) => {
          return {
            body: data.message,
            content_type: "text/plain",
          };
        },
      },
    });
    const result = await endpoint.serialize_body({
      body: { message: "Hello, World!" },
    });
    assert.ok(!(result instanceof SerializationError));
    assert.equal(result.body, "Hello, World!");
    assert.equal(result.content_type, "text/plain");
  });

  test("POST request with custom serialize - null body", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/empty",
      body: {
        schema: z.object({
          action: z.string(),
        }),
        serialize: () => {
          return {
            body: null,
            content_type: "application/json",
          };
        },
      },
    });
    const result = await endpoint.serialize_body({
      body: { action: "delete" },
    });
    assert.ok(!(result instanceof SerializationError));
    assert.equal(result.body, null);
    assert.equal(result.content_type, "application/json");
  });

  test("POST request with custom serialize - schema transformations", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/transform",
      body: {
        schema: z.object({
          value: z.string().transform((s) => s.toUpperCase()),
          count: z.number().transform((n) => n * 2),
        }),
        serialize: (data) => {
          // Custom serialize receives transformed data
          return {
            body: `${data.value}:${data.count}`,
            content_type: "text/plain",
          };
        },
      },
    });
    const result = await endpoint.serialize_body({
      body: { value: "hello", count: 5 },
    });
    // Schema transforms: "hello" -> "HELLO", 5 -> 10
    // Custom serialize formats as "HELLO:10"
    assert.ok(!(result instanceof SerializationError));
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
        serialize: "json",
      },
    });

    const result = await endpoint.serialize_body({
      body: { name: "ab", age: -1 },
    });
    assert.ok(result instanceof SerializationError);
    assert.equal(result.context.operation, "serialize_body");
  });

  test("POST request with invalid content type - validation error", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({
          name: z.string(),
        }),
        serialize: "json",
      },
    });
    const result = await endpoint.serialize_body({
      // @ts-expect-error - wrong type
      body: { name: 123 },
    });
    assert.ok(result instanceof SerializationError);
    assert.equal(result.context.operation, "serialize_body");
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
        serialize: "json",
      },
    });
    const result = await endpoint.serialize_body({
      // @ts-expect-error - missing email
      body: { name: "John" },
    });
    assert.ok(result instanceof SerializationError);
    assert.equal(result.context.operation, "serialize_body");
  });
});

describe("Endpoint.parse_response", () => {
  // Helper function to read response body stream
  async function readStream(stream: ReadableStream | null): Promise<string> {
    if (!stream) return "";
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;
      if (value) chunks.push(value);
    }
    const allBytes = new Uint8Array(
      chunks.reduce((acc, chunk) => [...acc, ...Array.from(chunk)], [] as number[]),
    );
    return new TextDecoder().decode(allBytes);
  }

  // 1. Successful Responses (20x)

  test("200 OK with JSON body and data schema", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      data: {
        schema: z.object({
          id: z.number(),
          name: z.string(),
        }),
        parse: "json",
      },
    });
    const response = new Response(JSON.stringify({ id: 1, name: "Test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { id: 1, name: "Test" });
    assert.ok(result.headers instanceof Headers);
    assert.equal(result.raw_response, response);
  });

  test("201 Created with JSON body", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: undefined,
      data: {
        schema: z.object({
          id: z.number(),
          name: z.string(),
        }),
        parse: "json",
      },
    });
    const response = new Response(JSON.stringify({ id: 2, name: "Created" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, true);
    assert.equal(result.status, 201);
    assert.deepEqual(result.data, { id: 2, name: "Created" });
  });

  test("204 No Content (no body)", async () => {
    const endpoint = new Endpoint({
      method: "DELETE",
      pathname: "/users/(:id)",
      data: {
        schema: z.object({
          id: z.number(),
        }),
        parse: "json",
      },
    });
    const response = new Response(null, {
      status: 204,
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, true);
    assert.equal(result.status, 204);
    assert.equal(result.data, null);
  });

  test("204 No Content without data schema", async () => {
    const endpoint = new Endpoint({
      method: "DELETE",
      pathname: "/users/(:id)",
    });
    const response = new Response(null, {
      status: 204,
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, true);
    assert.equal(result.status, 204);
    assert.equal(result.data, null);
  });

  test("200 OK with no data schema (void)", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });
    const response = new Response(JSON.stringify({ id: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.data, null);
  });

  test("200 OK with custom parse", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      data: {
        schema: z.object({
          value: z.string(),
        }),
        parse: async (body) => {
          const text = await readStream(body);
          return JSON.parse(text);
        },
      },
    });
    const response = new Response(JSON.stringify({ value: "custom" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { value: "custom" });
  });

  test("200 OK with schema transformations", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      data: {
        schema: z.object({
          name: z.string().transform((s) => s.toUpperCase()),
          age: z.number().transform((n) => n * 2),
        }),
        parse: "json",
      },
    });
    const response = new Response(JSON.stringify({ name: "john", age: 25 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { name: "JOHN", age: 50 });
  });

  // 2. Redirect Responses (30x)

  test("301 Moved Permanently", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/old",
    });
    const response = new Response(null, {
      status: 301,
      headers: { Location: "https://example.com/new" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, false);
    assert.equal(result.status, 301);
    assert.equal(result.redirect_to, "https://example.com/new");
  });

  test("302 Found", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/redirect",
    });
    const response = new Response(null, {
      status: 302,
      headers: { Location: "https://example.com/target" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, false);
    assert.equal(result.status, 302);
    assert.equal(result.redirect_to, "https://example.com/target");
  });

  test("308 Permanent Redirect", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/redirect",
    });
    const response = new Response(null, {
      status: 308,
      headers: { Location: "https://example.com/permanent" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, false);
    assert.equal(result.status, 308);
    assert.equal(result.redirect_to, "https://example.com/permanent");
  });

  // 3. Client Error Responses (40x)

  test("400 Bad Request with error schema", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      error: {
        schema: z.object({
          message: z.string(),
        }),
        parse: "json",
      },
    });
    const response = new Response(JSON.stringify({ message: "Invalid input" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.deepEqual(result.error, { message: "Invalid input" });
  });

  test("404 Not Found with text error", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users/(:id)",
      error: {
        schema: z.string(),
        parse: "text",
      },
    });
    const response = new Response("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(result.error, "Not Found");
  });

  test("422 Unprocessable Entity with custom error parse", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      error: {
        schema: z.object({
          errors: z.array(z.string()),
        }),
        parse: async (body) => {
          const text = await readStream(body);
          return { errors: text.split(",") };
        },
      },
    });
    const response = new Response("error1,error2,error3", {
      status: 422,
      headers: { "Content-Type": "text/plain" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, false);
    assert.equal(result.status, 422);
    assert.deepEqual(result.error, {
      errors: ["error1", "error2", "error3"],
    });
  });

  test("400 Bad Request without error schema (defaults to string)", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
    });
    const response = new Response("Error message", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.error, "Error message");
  });

  test("401 Unauthorized with JSON error body", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/protected",
      error: {
        schema: z.object({
          code: z.string(),
        }),
        parse: "json",
      },
    });
    const response = new Response(JSON.stringify({ code: "UNAUTHORIZED" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.deepEqual(result.error, { code: "UNAUTHORIZED" });
  });

  // 4. Server Error Responses (50x)

  test("500 Internal Server Error with error schema", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      error: {
        schema: z.object({
          message: z.string(),
          code: z.string(),
        }),
        parse: "json",
      },
    });
    const response = new Response(JSON.stringify({ message: "Internal error", code: "ERR_500" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, false);
    assert.equal(result.status, 500);
    assert.deepEqual(result.error, {
      message: "Internal error",
      code: "ERR_500",
    });
  });

  test("503 Service Unavailable with text error", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      error: {
        schema: z.string(),
        parse: "text",
      },
    });
    const response = new Response("Service unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.error, "Service unavailable");
  });

  test("502 Bad Gateway with custom error parse", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/proxy",
      error: {
        schema: z.object({
          upstream: z.string(),
        }),
        parse: async (body) => {
          const text = await readStream(body);
          return { upstream: `gateway-${text}` };
        },
      },
    });
    const response = new Response("error", {
      status: 502,
      headers: { "Content-Type": "text/plain" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, false);
    assert.equal(result.status, 502);
    assert.deepEqual(result.error, { upstream: "gateway-error" });
  });

  // 5. No Body Scenarios

  test("200 OK with empty body", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/empty",
      data: {
        schema: z.object({
          id: z.number(),
        }),
        parse: "json",
      },
    });
    const response = new Response("", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(result instanceof ParseError);
  });

  test("400 Bad Request with no body", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      error: {
        schema: z.string(),
        parse: "text",
      },
    });
    const response = new Response(null, {
      status: 400,
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.error, "");
  });

  // 6. Validation Errors

  test("200 OK with invalid JSON (doesn't match schema)", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      data: {
        schema: z.object({
          id: z.number(),
          name: z.string(),
        }),
        parse: "json",
      },
    });
    const response = new Response(JSON.stringify({ id: "invalid" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(result instanceof ParseError);
  });

  test("400 Bad Request with invalid error format", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      error: {
        schema: z.object({
          message: z.string(),
          code: z.number(),
        }),
        parse: "json",
      },
    });
    const response = new Response(JSON.stringify({ message: "Error", code: "not-a-number" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(result instanceof ParseError);
    assert.equal(result.context.operation, "parse_response");
  });

  // 7. Response Metadata

  test("headers preserved", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      data: {
        schema: z.object({ id: z.number() }),
        parse: "json",
      },
    });
    const headers = new Headers();
    headers.set("X-Custom-Header", "test-value");
    headers.set("Content-Type", "application/json");
    const response = new Response(JSON.stringify({ id: 1 }), {
      status: 200,
      headers,
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, true);
    assert.equal(result.headers.get("X-Custom-Header"), "test-value");
    assert.equal(result.headers.get("Content-Type"), "application/json");
  });

  test("raw response preserved", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      data: {
        schema: z.object({ id: z.number() }),
        parse: "json",
      },
    });
    const response = new Response(JSON.stringify({ id: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof ParseError));
    assert.equal(result.ok, true);
    assert.equal(result.raw_response, response);
  });
});
