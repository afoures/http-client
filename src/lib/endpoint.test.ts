import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Endpoint } from "./endpoint.ts";
import z from "zod";
import { ParseError, SerializationError, UnexpectedError } from "./errors.ts";
import { MissingParamsError, PathnameError } from "./pathname.ts";

describe("Endpoint.generate_url", () => {
  test("basic pathname without params or query", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
    });
    assert.ok(url instanceof URL);
    assert.equal(url.toString(), "https://api.example.com/users");
    assert.equal(url.pathname, "/users");
    assert.equal(url.search, "");
  });

  test("with query string - object schema", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        query: {
          schema: z.object({
            search: z.string(),
            page: z.number().transform((n) => n.toString()),
          }),
        },
      },
    );
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

  test("with query string - entry list becomes one key per pair", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        query: {
          schema: z.array(z.tuple([z.string(), z.string()])),
        },
      },
    );
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
      query: [
        ["a", "1"],
        ["b", "2"],
      ],
    });
    assert.ok(url instanceof URL, "expected URL, got SerializationError");
    assert.equal(url.search, "?a=1&b=2");
  });

  test("with query string - an array value repeats the key", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        query: {
          schema: z.object({ tags: z.array(z.string()) }),
        },
      },
    );
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
      query: { tags: ["a", "b"] },
    });
    assert.ok(url instanceof URL, "expected URL, got SerializationError");
    assert.equal(url.search, "?tags=a&tags=b");
    assert.deepEqual(url.searchParams.getAll("tags"), ["a", "b"]);
  });

  test("with query string - numbers and booleans are stringified", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        query: {
          schema: z.object({ page: z.number(), active: z.boolean() }),
        },
      },
    );
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
      query: { page: 1, active: true },
    });
    assert.ok(url instanceof URL, "expected URL, got SerializationError");
    assert.equal(url.search, "?page=1&active=true");
  });

  test("with query string - null and undefined values are skipped", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        query: {
          schema: z.object({
            a: z.string().nullable(),
            b: z.string().optional(),
            c: z.string(),
          }),
        },
      },
    );
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
      query: { a: null, b: undefined, c: "x" },
    });
    assert.ok(url instanceof URL, "expected URL, got SerializationError");
    assert.equal(url.search, "?c=x");
  });

  test("with query string - an empty array value emits nothing", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        query: {
          schema: z.object({ a: z.array(z.string()) }),
        },
      },
    );
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
      query: { a: [] },
    });
    assert.ok(url instanceof URL, "expected URL, got SerializationError");
    assert.equal(url.search, "");
  });

  test("with query string - values are percent-encoded and round-trip", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        query: {
          schema: z.object({ q: z.string() }),
        },
      },
    );
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
      query: { q: "a b&c" },
    });
    assert.ok(url instanceof URL, "expected URL, got SerializationError");
    assert.equal(url.search, "?q=a+b%26c");
    assert.equal(url.searchParams.get("q"), "a b&c");
  });

  test("with query string - a nested object value returns a SerializationError naming the key", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        query: {
          schema: z.object({ a: z.object({ nested: z.number() }) }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          serialize: "urlencoded" as any,
        },
      },
    );
    const result = await endpoint.generate_url({
      base_url: "https://api.example.com",
      query: { a: { nested: 1 } },
    });
    assert.ok(result instanceof SerializationError);
    assert.equal(result.context.operation, "generate_url");
    assert.match((result.cause as Error).message, /`a`/);
  });

  test("with query string - a non-pair array entry returns a SerializationError", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        query: {
          schema: z.array(z.array(z.string())),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          serialize: "urlencoded" as any,
        },
      },
    );
    const result = await endpoint.generate_url({
      base_url: "https://api.example.com",
      query: [["a", "1", "extra"]],
    });
    assert.ok(result instanceof SerializationError);
    assert.equal(result.context.operation, "generate_url");
    assert.match((result.cause as Error).message, /\[key, value\] entries/);
  });

  test("with pathname params - without schema", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users/(:id)" });
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
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users/(:id)" },
      {
        params: {
          schema: z.object({
            id: z.string().transform((s) => s.toUpperCase()),
          }),
        },
      },
    );
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
      params: { id: "abc" },
    });
    assert.ok(url instanceof URL);
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/users/ABC");
    assert.equal(url.search, "");
  });

  test("combined params and query string", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users/(:id)" },
      {
        query: {
          schema: z.object({
            include: z.string(),
          }),
        },
      },
    );
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
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users/(:id)" },
      {
        params: {
          schema: z.object({
            id: z.number(),
          }),
          serialize: (data) => {
            return { id: String(data.id).padStart(6, "0") };
          },
        },
      },
    );
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
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users/(:id)" },
      {
        params: {
          schema: z.object({
            id: z.string().transform((s) => s.toUpperCase()),
          }),
          serialize: (data) => {
            return { id: `user-${data.id}` };
          },
        },
      },
    );
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
      params: { id: "abc" },
    });
    assert.ok(url instanceof URL);
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/users/user-ABC");
    assert.equal(url.search, "");
  });

  test("with query string - custom serialize function", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        query: {
          schema: z.object({
            tags: z.array(z.string()),
            limit: z.number(),
          }),
          serialize: (data) => {
            const params = new URLSearchParams();
            params.set("tags", data.tags.join(","));
            params.set("limit", String(data.limit));
            return params;
          },
        },
      },
    );
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
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/search" },
      {
        query: {
          schema: z.object({
            q: z.string().transform((s) => s.trim().toLowerCase()),
            page: z.number().transform((n) => n * 10),
          }),
          serialize: (data) => {
            const params = new URLSearchParams();
            params.set("query", encodeURIComponent(data.q));
            params.set("offset", String(data.page));
            return params;
          },
        },
      },
    );
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com",
      query: { q: "  Hello World  ", page: 2 },
    });
    assert.ok(url instanceof URL);
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/search");
    assert.equal(url.searchParams.get("query"), "hello%20world");
    assert.equal(url.searchParams.get("offset"), "20");
  });

  test("with query string - custom serialize for array schema", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/filters" },
      {
        query: {
          schema: z.array(z.tuple([z.string(), z.string()])),
          serialize: (data) => {
            const params = new URLSearchParams();
            data.forEach(([key, value]) => {
              params.append(key, value);
            });
            return params;
          },
        },
      },
    );
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

  test("base_url with a trailing slash keeps its path prefix", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users/:id" });
    const url = await endpoint.generate_url({
      base_url: "https://api.example.com/api/",
      params: { id: 123 },
    });
    assert.ok(url instanceof URL);
    assert.equal(url.origin, "https://api.example.com");
    assert.equal(url.pathname, "/api/users/123");
    assert.equal(url.search, "");
  });

  test("base_url without a trailing slash drops its last segment, per URL resolution", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });
    const url = await endpoint.generate_url({ base_url: "https://api.example.com/v1" });
    assert.ok(url instanceof URL);
    assert.equal(url.href, "https://api.example.com/users");
  });

  test("a params schema whose output is undefined drops the optional group", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users(/:id)" },
      {
        params: {
          schema: z.object({ id: z.string() }).optional(),
          // not reached for an undefined output, which is the point of the test
          serialize: (data) => ({ id: data?.id }),
        },
      },
    );
    const without = await endpoint.generate_url({
      base_url: "https://api.example.com",
      params: undefined,
    });
    assert.ok(without instanceof URL, "expected URL, got SerializationError");
    assert.equal(without.pathname, "/users");

    const with_id = await endpoint.generate_url({
      base_url: "https://api.example.com",
      params: { id: "7" },
    });
    assert.ok(with_id instanceof URL, "expected URL, got SerializationError");
    assert.equal(with_id.pathname, "/users/7");
  });

  test("query serializer with explicit `serialize: undefined` falls back to urlencoded default", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/u" },
      {
        query: {
          schema: z.object({ x: z.number().transform(String) }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          serialize: undefined as any,
        },
      },
    );
    const url = await endpoint.generate_url({
      base_url: "https://example.com",
      query: { x: 1 },
    });
    assert.ok(url instanceof URL, "expected URL, got SerializationError");
    assert.equal(url.searchParams.get("x"), "1");
  });

  test("a throwing definition factory returns UnexpectedError", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/x" },
      (_context: { key: string }) => {
        throw new Error("boom");
      },
    );
    const result = await endpoint.generate_url(
      { base_url: "https://api.example.com" },
      { key: "value" },
    );
    assert.ok(result instanceof UnexpectedError);
    assert.equal(result.context.operation, "resolve_definition");
    assert.equal((result.cause as Error)?.message, "boom");
  });
});

describe("Endpoint.serialize_body", () => {
  test("GET request without body schema returns null", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });
    const result = await endpoint.serialize_body({
      body: undefined as never,
    });
    assert.ok(!(result instanceof Error));
    assert.equal(result.body, null);
    assert.equal(result.content_type, undefined);
  });

  test("POST request without body schema returns null", async () => {
    const endpoint = new Endpoint({ method: "POST", pathname: "/users" }, { body: undefined });
    const result = await endpoint.serialize_body({
      body: undefined as never,
    });
    assert.ok(!(result instanceof Error));
    assert.equal(result.body, null);
    assert.equal(result.content_type, undefined);
  });

  test("POST request with JSON serialize - object schema", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/users" },
      {
        body: {
          schema: z.object({ name: z.string() }),
          serialize: "json",
        },
      },
    );
    const result = await endpoint.serialize_body({ body: { name: "John" } });
    assert.ok(!(result instanceof Error));
    assert.equal(result.body, JSON.stringify({ name: "John" }));
    assert.equal(result.content_type, "application/json");
  });

  test("POST request with JSON serialize - schema transformations", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/users" },
      {
        body: {
          schema: z.object({
            name: z.string().transform((s) => s.toUpperCase()),
            age: z.number().transform((n) => n * 2),
          }),
          serialize: "json",
        },
      },
    );
    const result = await endpoint.serialize_body({
      body: { name: "john", age: 25 },
    });
    assert.ok(!(result instanceof Error));
    assert.equal(result.body, JSON.stringify({ name: "JOHN", age: 50 }));
    assert.equal(result.content_type, "application/json");
  });

  test("POST request with custom serialize - FormData", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/upload" },
      {
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
            };
          },
        },
      },
    );
    const result = await endpoint.serialize_body({
      body: { name: "test.txt", file: "file content" },
    });
    assert.ok(!(result instanceof Error));
    assert.ok(result.body instanceof FormData);
    // the runtime derives the media type, boundary included, from the body itself
    assert.equal(result.content_type, undefined);
    const sent = new Request("https://api.example.com/upload", {
      method: "POST",
      body: result.body,
    });
    assert.match(sent.headers.get("content-type") ?? "", /^multipart\/form-data; boundary=/);
    assert.equal((await sent.formData()).get("name"), "test.txt");
  });

  test("POST request with custom serialize - URLSearchParams", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/submit" },
      {
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
            };
          },
        },
      },
    );
    const result = await endpoint.serialize_body({
      body: { username: "user123", password: "secret" },
    });
    assert.ok(!(result instanceof Error));
    assert.ok(result.body instanceof URLSearchParams);
    assert.equal(result.content_type, undefined);
    const sent = new Request("https://api.example.com/submit", {
      method: "POST",
      body: result.body,
    });
    assert.match(sent.headers.get("content-type") ?? "", /^application\/x-www-form-urlencoded/);
    const params = result.body as URLSearchParams;
    assert.equal(params.get("username"), "user123");
    assert.equal(params.get("password"), "secret");
  });

  test("POST request with custom serialize - string", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/text" },
      {
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
      },
    );
    const result = await endpoint.serialize_body({
      body: { message: "Hello, World!" },
    });
    assert.ok(!(result instanceof Error));
    assert.equal(result.body, "Hello, World!");
    assert.equal(result.content_type, "text/plain");
  });

  test("POST request with custom serialize - null body", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/empty" },
      {
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
      },
    );
    const result = await endpoint.serialize_body({
      body: { action: "delete" },
    });
    assert.ok(!(result instanceof Error));
    assert.equal(result.body, null);
    assert.equal(result.content_type, "application/json");
  });

  test("a body the schema rejects is a SerializationError carrying the issues and the input", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/users" },
      {
        body: {
          schema: z.object({
            name: z.string().min(3),
            age: z.number().positive(),
          }),
          serialize: "json",
        },
      },
    );

    const input = { name: "ab", age: -1 };
    const result = await endpoint.serialize_body({ body: input });
    assert.ok(result instanceof SerializationError);
    assert.equal(result.context.operation, "serialize_body");
    assert.deepEqual(result.context.input, { body: input });
    assert.ok(Array.isArray(result.cause), "cause should be the schema's issues");
    assert.deepEqual(
      (result.cause as Array<{ path?: ReadonlyArray<PropertyKey> }>)
        .map((issue) => issue.path?.join("."))
        .sort(),
      ["age", "name"],
    );
  });

  test("a custom serialize that throws is a SerializationError with the thrown cause", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/users" },
      {
        body: {
          schema: z.object({ name: z.string() }),
          serialize: () => {
            throw new Error("cannot encode");
          },
        },
      },
    );
    const result = await endpoint.serialize_body({ body: { name: "John" } });
    assert.ok(result instanceof SerializationError);
    assert.equal(result.context.operation, "serialize_body");
    assert.equal((result.cause as Error).message, "cannot encode");
    assert.deepEqual(result.context.input, { body: { name: "John" } });
  });

  test("a throwing definition factory returns UnexpectedError", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/x" },
      (_context: { key: string }) => {
        throw new Error("boom");
      },
    );
    const result = await endpoint.serialize_body({ body: { name: "John" } }, { key: "value" });
    assert.ok(result instanceof UnexpectedError);
    assert.equal(result.context.operation, "resolve_definition");
    assert.equal((result.cause as Error)?.message, "boom");
  });
});

describe("Endpoint.parse_response", () => {
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

  test("200 OK with JSON body and data schema", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        responses: {
          200: {
            schema: z.object({
              id: z.number(),
              name: z.string(),
            }),
            parse: "json",
          },
        },
      },
    );
    const response = new Response(JSON.stringify({ id: 1, name: "Test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { id: 1, name: "Test" });
    assert.ok(result.headers instanceof Headers);
  });

  test("201 Created with JSON body", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/users" },
      {
        body: undefined,
        responses: {
          201: {
            schema: z.object({
              id: z.number(),
              name: z.string(),
            }),
            parse: "json",
          },
        },
      },
    );
    const response = new Response(JSON.stringify({ id: 2, name: "Created" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
    assert.equal(result.status, 201);
    assert.deepEqual(result.data, { id: 2, name: "Created" });
  });

  test("204 No Content (no body)", async () => {
    const endpoint = new Endpoint(
      { method: "DELETE", pathname: "/users/(:id)" },
      {
        responses: {
          // @ts-expect-error - 204 cannot be expressed here
          204: {
            schema: z.object({
              id: z.number(),
            }),
            parse: "json",
          },
        },
      },
    );
    const response = new Response(null, {
      status: 204,
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
    assert.equal(result.status, 204);
    assert.equal(result.data, null);
  });

  test("204 No Content without data schema", async () => {
    const endpoint = new Endpoint({ method: "DELETE", pathname: "/users/(:id)" });
    const response = new Response(null, {
      status: 204,
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
    assert.equal(result.status, 204);
    assert.equal(result.data, null);
  });

  test("200 OK with no parser declared yields data: null (the body is discarded, see body ownership)", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });
    const response = new Response(JSON.stringify({ id: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.data, null);
  });

  test("200 OK with custom parse", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        responses: {
          200: {
            schema: z.object({
              value: z.string(),
            }),
            parse: async (body) => {
              const text = await readStream(body);
              return JSON.parse(text);
            },
          },
        },
      },
    );
    const response = new Response(JSON.stringify({ value: "custom" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { value: "custom" });
  });

  test("200 OK with schema transformations", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        responses: {
          200: {
            schema: z.object({
              name: z.string().transform((s) => s.toUpperCase()),
              age: z.number().transform((n) => n * 2),
            }),
            parse: "json",
          },
        },
      },
    );
    const response = new Response(JSON.stringify({ name: "john", age: 25 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { name: "JOHN", age: 50 });
  });

  test("a 3xx is a RedirectMessage exposing the Location header", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/old" });
    const response = new Response(null, {
      status: 301,
      headers: { Location: "https://example.com/new" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.kind, "RedirectMessage");
    assert.equal(result.ok, false);
    assert.equal(result.status, 301);
    assert.equal(result.redirect_to, "https://example.com/new");
  });

  test("a 3xx without a Location header has redirect_to: null", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/cached" });
    const result = await endpoint.parse_response(new Response(null, { status: 304 }));
    assert.ok(!(result instanceof Error));
    assert.equal(result.kind, "RedirectMessage");
    assert.equal(result.status, 304);
    assert.equal(result.redirect_to, null);
  });

  test("400 Bad Request with error schema", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/users" },
      {
        responses: {
          400: {
            schema: z.object({
              message: z.string(),
            }),
            parse: "json",
          },
        },
      },
    );
    const response = new Response(JSON.stringify({ message: "Invalid input" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.deepEqual(result.error, { message: "Invalid input" });
  });

  test("404 Not Found with text error", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users/(:id)" },
      {
        responses: {
          404: {
            schema: z.string(),
            parse: "text",
          },
        },
      },
    );
    const response = new Response("Not Found", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(result.error, "Not Found");
  });

  test("422 Unprocessable Entity with custom error parse", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/users" },
      {
        responses: {
          422: {
            schema: z.object({
              errors: z.array(z.string()),
            }),
            parse: async (body) => {
              const text = await readStream(body);
              return { errors: text.split(",") };
            },
          },
        },
      },
    );
    const response = new Response("error1,error2,error3", {
      status: 422,
      headers: { "Content-Type": "text/plain" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, false);
    assert.equal(result.status, 422);
    assert.deepEqual(result.error, {
      errors: ["error1", "error2", "error3"],
    });
  });

  test("400 Bad Request without error schema (defaults to string)", async () => {
    const endpoint = new Endpoint({ method: "POST", pathname: "/users" });
    const response = new Response("Error message", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.error, "Error message");
  });

  test("500 Internal Server Error with error schema", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        responses: {
          500: {
            schema: z.object({
              message: z.string(),
              code: z.string(),
            }),
            parse: "json",
          },
        },
      },
    );
    const response = new Response(JSON.stringify({ message: "Internal error", code: "ERR_500" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, false);
    assert.equal(result.status, 500);
    assert.deepEqual(result.error, {
      message: "Internal error",
      code: "ERR_500",
    });
  });

  test("400 Bad Request with no body", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/users" },
      {
        responses: {
          400: {
            schema: z.string(),
            parse: "text",
          },
        },
      },
    );
    const response = new Response(null, {
      status: 400,
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.error, "");
  });

  test("a 2xx body the schema rejects is a ParseError carrying the decoded payload", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        responses: {
          200: {
            schema: z.object({
              id: z.number(),
              name: z.string(),
            }),
            parse: "json",
          },
        },
      },
    );
    const response = new Response(JSON.stringify({ id: "invalid" }), {
      status: 200,
      headers: { "Content-Type": "application/json", "x-trace": "abc" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(result instanceof ParseError);
    assert.equal(result.context.operation, "parse_response");
    assert.equal(result.context.response?.status, 200);
    assert.equal(result.context.response?.headers?.get("x-trace"), "abc");
    assert.deepEqual(result.context.response?.body, { id: "invalid" });
    assert.ok(Array.isArray(result.cause), "cause should be the schema's issues");
  });

  test("a 4xx body its declared parser rejects is a ParseError, not an error envelope", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/users" },
      {
        responses: {
          400: {
            schema: z.object({
              message: z.string(),
              code: z.number(),
            }),
            parse: "json",
          },
        },
      },
    );
    const payload = { message: "Error", code: "not-a-number" };
    const response = new Response(JSON.stringify(payload), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(result instanceof ParseError);
    assert.equal(result.context.operation, "parse_response");
    assert.equal(result.context.response?.status, 400);
    assert.deepEqual(result.context.response?.body, payload);
  });

  test("the envelope exposes the response metadata, and no response", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        responses: {
          200: {
            schema: z.object({ id: z.number() }),
            parse: "json",
          },
        },
      },
    );
    const response = new Response(JSON.stringify({ id: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await endpoint.parse_response(response);
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
    assert.equal(result.url, response.url);
    assert.equal(result.headers, response.headers);
    assert.ok(!Object.hasOwn(result, "raw_response"));
    assert.equal(response.bodyUsed, true);
  });

  test("distinct schemas per status code", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/users" },
      {
        responses: {
          200: { schema: z.object({ id: z.number() }), parse: "json" },
          201: { schema: z.object({ created: z.boolean() }), parse: "json" },
        },
      },
    );

    const ok = await endpoint.parse_response(
      new Response(JSON.stringify({ id: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    assert.ok(!(ok instanceof Error));
    assert.equal(ok.status, 200);
    if (ok.status === 200) assert.deepEqual(ok.data, { id: 1 });

    const created = await endpoint.parse_response(
      new Response(JSON.stringify({ created: true }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    assert.ok(!(created instanceof Error));
    assert.equal(created.status, 201);
    if (created.status === 201) assert.deepEqual(created.data, { created: true });
  });

  test("class token applies to every status in the class", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        responses: {
          "5xx": { schema: z.object({ message: z.string() }), parse: "json" },
        },
      },
    );

    for (const status of [500, 502, 503]) {
      const result = await endpoint.parse_response(
        new Response(JSON.stringify({ message: "boom" }), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
      assert.ok(!(result instanceof Error));
      assert.equal(result.ok, false);
      assert.equal(result.status, status);
      assert.ok("error" in result);
      assert.deepEqual(result.error, { message: "boom" });
    }
  });

  test("exact code overrides class token", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users/(:id)" },
      {
        responses: {
          "4xx": { schema: z.object({ message: z.string() }), parse: "json" },
          404: { schema: z.object({ resource: z.string() }), parse: "json" },
        },
      },
    );

    const not_found = await endpoint.parse_response(
      new Response(JSON.stringify({ resource: "user" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
    assert.ok(!(not_found instanceof Error));
    assert.equal(not_found.status, 404);
    if (not_found.status === 404) assert.deepEqual(not_found.error, { resource: "user" });

    const forbidden = await endpoint.parse_response(
      new Response(JSON.stringify({ message: "nope" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    assert.ok(!(forbidden instanceof Error));
    assert.equal(forbidden.status, 403);
    if (forbidden.status === 403) assert.deepEqual(forbidden.error, { message: "nope" });
  });

  test("unlisted 2xx falls back to data: null", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        responses: {
          200: { schema: z.object({ id: z.number() }), parse: "json" },
        },
      },
    );
    const result = await endpoint.parse_response(
      new Response(JSON.stringify({ anything: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      }),
    );
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
    assert.equal(result.status, 202);
    assert.equal(result.data, null);
  });

  test("unlisted error falls back to the raw text body", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        responses: {
          400: { schema: z.object({ message: z.string() }), parse: "json" },
        },
      },
    );
    const result = await endpoint.parse_response(
      new Response("upstream exploded", {
        status: 503,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.error, "upstream exploded");
  });

  test("a shared parser const can cover several keys", async () => {
    const ApiError = { schema: z.object({ message: z.string() }), parse: "json" } as const;
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        responses: {
          "4xx": ApiError,
          "5xx": ApiError,
        },
      },
    );

    for (const status of [400, 500]) {
      const result = await endpoint.parse_response(
        new Response(JSON.stringify({ message: "shared" }), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
      assert.ok(!(result instanceof Error));
      assert.equal(result.status, status);
      assert.ok("error" in result);
      assert.deepEqual(result.error, { message: "shared" });
    }
  });

  test("204 is always null even when covered by a token or explicit entry", async () => {
    const tokened = new Endpoint(
      { method: "DELETE", pathname: "/users/(:id)" },
      {
        responses: {
          "2xx": { schema: z.object({ id: z.number() }), parse: "json" },
        },
      },
    );
    const a = await tokened.parse_response(new Response(null, { status: 204 }));
    assert.ok(!(a instanceof Error));
    assert.equal(a.status, 204);
    assert.equal(a.data, null);

    const explicit = new Endpoint(
      { method: "DELETE", pathname: "/users/(:id)" },
      {
        responses: {
          // @ts-expect-error - 204 cannot be expressed here
          204: { schema: z.object({ id: z.number() }), parse: "json" },
        },
      },
    );
    const b = await explicit.parse_response(new Response(null, { status: 204 }));
    assert.ok(!(b instanceof Error));
    assert.equal(b.status, 204);
    assert.equal(b.data, null);
  });

  test("a throwing definition factory returns UnexpectedError", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/x" },
      (_context: { key: string }) => {
        throw new Error("boom");
      },
    );
    const result = await endpoint.parse_response(
      new Response(JSON.stringify({ id: 1 }), { status: 200 }),
      { key: "value" },
    );
    assert.ok(result instanceof UnexpectedError);
    assert.equal(result.context.operation, "resolve_definition");
    assert.equal((result.cause as Error)?.message, "boom");
  });
});

describe("Endpoint.parse_response body ownership", () => {
  /** A body that stays open after its chunk, so a `cancel()` reaches the underlying source. */
  function open_body(content: string) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(content));
      },
      cancel() {
        cancelled = true;
      },
    });
    return { body, was_cancelled: () => cancelled };
  }

  const cancelled_cases = [
    {
      name: "a redirect",
      endpoint: new Endpoint({ method: "GET", pathname: "/x" }),
      status: 302,
    },
    {
      name: "a 2xx with no parser for it",
      endpoint: new Endpoint(
        { method: "GET", pathname: "/x" },
        { responses: { 201: { schema: z.string(), parse: "text" } } },
      ),
      status: 200,
    },
  ] as const;

  for (const { name, endpoint, status } of cancelled_cases) {
    test(`cancels the body of ${name}`, async () => {
      const { body, was_cancelled } = open_body("never read");
      await endpoint.parse_response(new Response(body, { status }));
      assert.equal(was_cancelled(), true);
    });
  }

  test("a status no envelope covers comes back as an error, and its body is cancelled", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/x" });
    const { body, was_cancelled } = open_body("informational");
    // `new Response` refuses a 1xx status, and `fetch` never surfaces one either: the branch is
    // defensive, so reaching it takes a response-shaped stand-in.
    const informational = {
      status: 103,
      ok: false,
      url: "https://api.example.com/x",
      headers: new Headers(),
      body,
      bodyUsed: false,
    } as Response;

    const result = await endpoint.parse_response(informational);

    assert.ok(result instanceof UnexpectedError);
    assert.equal(result.context.operation, "parse_response");
    assert.equal(result.context.response?.status, 103);
    assert.equal(was_cancelled(), true);
  });

  test("leaves the body a successful parse forwarded as its value", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/download" },
      {
        responses: {
          200: {
            schema: z.instanceof(ReadableStream),
            // The streaming case: `parse` hands the stream on as the parsed value instead of
            // reading it, so the caller is the reader and nothing may cancel it here.
            parse: async (body) => body!,
          },
        },
      },
    );
    const { body, was_cancelled } = open_body("streamed");
    const result = await endpoint.parse_response(new Response(body, { status: 200 }));

    assert.ok(!(result instanceof Error));
    assert.equal(was_cancelled(), false);
    assert.ok(result.ok);
    const reader = (result.data as ReadableStream<Uint8Array>).getReader();
    const { value } = await reader.read();
    assert.equal(new TextDecoder().decode(value), "streamed");
  });

  test("leaves alone a body a failing parse had locked, since cancelling under a reader would throw", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/x" },
      {
        responses: {
          200: {
            schema: z.string(),
            parse: async (body) => {
              body!.getReader();
              throw new Error("locked then gave up");
            },
          },
        },
      },
    );
    const { body, was_cancelled } = open_body("held");
    const result = await endpoint.parse_response(new Response(body, { status: 200 }));

    assert.ok(result instanceof ParseError);
    assert.equal((result.cause as Error).message, "locked then gave up");
    assert.equal(was_cancelled(), false);
  });

  test("hands an exact-status custom parse the response metadata too", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/x" },
      {
        responses: {
          404: {
            schema: z.object({ status: z.number(), url: z.string(), ok: z.boolean() }),
            parse: async (body, metadata) => {
              await new Response(body).text();
              return { status: metadata.status, url: metadata.url, ok: metadata.ok };
            },
          },
        },
      },
    );

    const result = await endpoint.parse_response(new Response("missing", { status: 404 }));

    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    if (result.status === 404) assert.deepEqual(result.error, { status: 404, url: "", ok: false });
  });

  test("cancels the body a failing parse left untouched", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/x" },
      {
        responses: {
          200: {
            schema: z.string(),
            parse: async () => {
              throw new Error("parser blew up");
            },
          },
        },
      },
    );
    const { body, was_cancelled } = open_body("never read");
    const result = await endpoint.parse_response(new Response(body, { status: 200 }));

    assert.ok(result instanceof ParseError);
    assert.equal(was_cancelled(), true);
  });

  test("hands a custom parse the response metadata alongside the body", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/x" },
      {
        responses: {
          "2xx": {
            schema: z.object({ status: z.number(), content_type: z.string(), text: z.string() }),
            parse: async (body, metadata) => ({
              status: metadata.status,
              content_type: metadata.headers.get("content-type") ?? "",
              text: await new Response(body).text(),
            }),
          },
        },
      },
    );

    const result = await endpoint.parse_response(
      new Response("payload", { status: 202, headers: { "content-type": "text/plain" } }),
    );

    assert.ok(!(result instanceof Error));
    assert.ok(result.ok);
    assert.deepEqual(result.data, {
      status: 202,
      content_type: "text/plain",
      text: "payload",
    });
  });

  test("reports malformed JSON as a ParseError carrying the text it read", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/x" },
      { responses: { 200: { schema: z.object({ id: z.number() }), parse: "json" } } },
    );

    const result = await endpoint.parse_response(new Response("{ nope", { status: 200 }));

    assert.ok(result instanceof ParseError);
    assert.equal(result.context.response?.body, "{ nope");
  });
});

describe("response kind discriminant", () => {
  const endpoint = new Endpoint(
    { method: "GET", pathname: "/thing" },
    {
      responses: {
        200: { schema: z.object({ id: z.string() }), parse: "json" },
      },
    },
  );

  const cases = [
    { status: 200, body: JSON.stringify({ id: "1" }), kind: "SuccessfulResponse" },
    { status: 204, body: null, kind: "SuccessfulResponse" },
    { status: 301, body: null, kind: "RedirectMessage" },
    { status: 304, body: null, kind: "RedirectMessage" },
    { status: 404, body: "missing", kind: "ClientErrorResponse" },
    { status: 503, body: "down", kind: "ServerErrorResponse" },
  ] as const;

  for (const { status, body, kind } of cases) {
    test(`${status} carries kind "${kind}"`, async () => {
      const result = await endpoint.parse_response(
        new Response(body, { status, headers: { "Content-Type": "application/json" } }),
      );
      assert.ok(!(result instanceof Error));
      assert.equal(result.kind, kind);
    });
  }

  test("kind survives a spread, unlike a prototype check", async () => {
    const result = await endpoint.parse_response(
      new Response(JSON.stringify({ id: "1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    assert.ok(!(result instanceof Error));
    const { kind, ok, status } = { ...result };
    assert.deepEqual({ kind, ok, status }, { kind: "SuccessfulResponse", ok: true, status: 200 });
  });
});

describe("Endpoint.generate_url pathname failures", () => {
  const endpoint = new Endpoint({ method: "GET", pathname: "/users/:id/posts" });
  const base_url = "https://api.example.com";

  test("an empty param is a returned SerializationError whose cause is the PathnameError", async () => {
    const result = await endpoint.generate_url({ base_url, params: { id: "" } });
    assert.ok(result instanceof SerializationError);
    assert.equal(result.context.operation, "generate_url");
    assert.ok(result.cause instanceof PathnameError);
    assert.deepEqual(result.context.input, { params: { id: "" } });
  });

  test("a missing param is a returned SerializationError whose cause lists the missing names", async () => {
    const result = await endpoint.generate_url({
      base_url,
      params: { id: undefined as unknown as string },
    });
    assert.ok(result instanceof SerializationError);
    assert.ok(result.cause instanceof MissingParamsError);
    assert.deepEqual(result.cause.missing_params, ["id"]);
  });

  test("'.' and '..' are rejected rather than collapsed by URL resolution", async () => {
    for (const id of [".", ".."]) {
      const result = await endpoint.generate_url({ base_url: `${base_url}/v1/`, params: { id } });
      assert.ok(result instanceof SerializationError, `'${id}' produced ${String(result)}`);
      assert.ok(result.cause instanceof PathnameError);
    }
  });

  test("dots inside a longer value and pre-encoded dot segments survive URL resolution", async () => {
    const cases = [
      { id: "a..b", pathname: "/v1/users/a..b/posts" },
      { id: "...", pathname: "/v1/users/.../posts" },
      { id: "%2E%2E", pathname: "/v1/users/%252E%252E/posts" },
    ];
    for (const { id, pathname } of cases) {
      const result = await endpoint.generate_url({ base_url: `${base_url}/v1/`, params: { id } });
      assert.ok(result instanceof URL, `'${id}' produced ${String(result)}`);
      assert.equal(result.pathname, pathname);
    }
  });
});

describe("Endpoint: a declared serializer always validates", () => {
  const base_url = "https://api.example.com";

  test("an omitted query still runs the schema, so defaults apply", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/items" },
      {
        query: {
          schema: z.preprocess((value) => value ?? {}, z.object({ page: z.number().default(1) })),
        },
      },
    );
    const omitted = await endpoint.generate_url({ base_url });
    const explicit = await endpoint.generate_url({ base_url, query: {} });
    assert.ok(omitted instanceof URL && explicit instanceof URL);
    assert.equal(omitted.href, `${base_url}/items?page=1`);
    assert.equal(explicit.href, omitted.href);
  });

  test("an undefined query output adds no search string", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/items" },
      { query: { schema: z.object({ q: z.string() }).optional() } },
    );
    const result = await endpoint.generate_url({ base_url });
    assert.ok(result instanceof URL);
    assert.equal(result.href, `${base_url}/items`);
  });

  test("an omitted query against a schema that rejects undefined is a SerializationError", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/items" },
      { query: { schema: z.object({ q: z.string() }) } },
    );
    const result = await endpoint.generate_url({ base_url } as never);
    assert.ok(result instanceof SerializationError);
    assert.equal(result.context.operation, "generate_url");
  });

  test("an omitted body still runs the schema, so defaults are serialized", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/items" },
      {
        body: {
          schema: z.preprocess(
            (value) => value ?? {},
            z.object({ visibility: z.string().default("private") }),
          ),
          serialize: "json",
        },
      },
    );
    const result = await endpoint.serialize_body({});
    assert.ok(!(result instanceof Error));
    assert.equal(result.body, JSON.stringify({ visibility: "private" }));
    assert.equal(result.content_type, "application/json");
  });

  test("an undefined body output sends no body and skips `serialize`", async () => {
    let serialize_calls = 0;
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/items" },
      {
        body: {
          schema: z.object({ name: z.string() }).optional(),
          serialize: (data) => {
            serialize_calls++;
            return { body: JSON.stringify(data), content_type: "application/json" };
          },
        },
      },
    );
    const result = await endpoint.serialize_body({});
    assert.ok(!(result instanceof Error));
    assert.deepEqual(result, { body: null, content_type: undefined });
    assert.equal(serialize_calls, 0);
  });
});

describe("Endpoint.parse_response with an empty body under parse: 'json'", () => {
  test("validates null, so an object schema is a ParseError carrying the null body", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/x" },
      { responses: { 200: { schema: z.object({ a: z.number() }), parse: "json" } } },
    );
    const result = await endpoint.parse_response(new Response("", { status: 200 }));
    assert.ok(result instanceof ParseError);
    assert.equal(result.context.response?.body, null);
  });

  test("a nullable schema accepts it", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/x" },
      { responses: { 200: { schema: z.object({ a: z.number() }).nullable(), parse: "json" } } },
    );
    const result = await endpoint.parse_response(new Response("", { status: 200 }));
    assert.ok(!(result instanceof Error));
    assert.equal(result.status, 200);
    assert.equal(result.data, null);
  });
});
