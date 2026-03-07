import { describe, test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetch_endpoint_factory } from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import {
  AbortedError,
  NetworkError,
  SerializationError,
  TimeoutError,
  UnexpectedError,
} from "./errors.ts";
import z from "zod";
import { setupServer } from "msw/node";
import { delay, http, HttpResponse } from "msw";

const API_BASE_URL = "https://api.example.com";

const server = setupServer();

describe("fetch_endpoint_factory", () => {
  before(() => {
    server.listen({ onUnhandledRequest: "bypass" });
  });

  after(() => {
    server.close();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  test("successful request with JSON response", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users/(:id)",
      data: {
        schema: z.object({ id: z.string(), name: z.string() }),
      },
    });

    server.use(
      http.get(`${API_BASE_URL}/users/:id`, ({ request, params }) => {
        assert.equal(request.url, `${API_BASE_URL}/users/123`);
        assert.equal(request.method, "GET");
        return HttpResponse.json({ id: params.id, name: "John" });
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({ params: { id: "123" } });

    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { id: "123", name: "John" });
  });

  test("request with pathname parameters", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users/(:id)",
    });

    server.use(
      http.get(`${API_BASE_URL}/users/:id`, ({ params }) => {
        return HttpResponse.json({ id: params.id });
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({ params: { id: "456" } });

    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
  });

  test("request with query parameters", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      query: {
        schema: z.object({
          page: z.number().transform(String),
          limit: z.number().transform(String),
        }),
        serialization: "urlencoded",
      },
    });

    server.use(
      http.get(`${API_BASE_URL}/users`, ({ request }) => {
        const url = new URL(request.url);
        assert.equal(url.pathname, "/users");
        assert.equal(url.searchParams.get("page"), "1");
        assert.equal(url.searchParams.get("limit"), "10");
        return HttpResponse.json({ users: [] });
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({ query: { page: 1, limit: 10 } });

    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
  });

  test("POST request with body serialization", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({ name: z.string(), email: z.string() }),
      },
    });

    server.use(
      http.post(`${API_BASE_URL}/users`, async ({ request }) => {
        assert.equal(request.method, "POST");
        assert.equal(request.headers.get("Content-Type"), "application/json");
        const body = await request.json();
        assert.deepEqual(body, { name: "John", email: "john@example.com" });
        return HttpResponse.json({ id: "123" }, { status: 201 });
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({ body: { name: "John", email: "john@example.com" } });

    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
    assert.equal(result.status, 201);
  });

  test("custom headers merging", async () => {
    const endpoint = new Endpoint(
      {
        method: "GET",
        pathname: "/users",
      },
      {
        headers: { "X-Default": "default-value" },
      },
    );

    server.use(
      http.get(`${API_BASE_URL}/users`, ({ request }) => {
        assert.equal(request.headers.get("x-default"), "default-value");
        assert.equal(request.headers.get("x-custom"), "custom-value");
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({ headers: { "X-Custom": "custom-value" } });

    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
  });

  test("timeout handling", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/slow",
    });

    server.use(
      http.get(`${API_BASE_URL}/slow`, async () => {
        await delay(100);
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({ timeout: 10 });

    assert.ok(result instanceof TimeoutError);
  });

  test("AbortSignal handling - before request starts", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    const controller = new AbortController();
    server.use(
      http.get(`${API_BASE_URL}/users`, async () => {
        await delay(100);
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    controller.abort();
    const result = await fetch_endpoint({ signal: controller.signal });

    assert.ok(result instanceof AbortedError);
  });

  test("AbortSignal handling - during request", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    const controller = new AbortController();
    server.use(
      http.get(`${API_BASE_URL}/users`, async () => {
        await delay(10);
        controller.abort();
        await delay(20);
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({ signal: controller.signal });

    assert.ok(result instanceof AbortedError);
  });

  test.skip("AbortSignal handling - after request", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/posts/:id",
      data: {
        schema: z.object({ id: z.number(), title: z.string() }),
      },
    });

    server.use(
      http.get(`${API_BASE_URL}/posts/:id`, async () => {
        return HttpResponse.json({ id: 1, title: "Post 1" });
      }),
    );

    const controller = new AbortController();
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
      hooks: {
        on_response() {
          controller.abort();
        },
      },
    });

    const result = await fetch_endpoint({ params: { id: 1 }, signal: controller.signal });

    assert.ok(result instanceof AbortedError);
  });

  test("retry on failure - success on retry", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    let attemptCount = 0;

    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
        attemptCount++;
        if (attemptCount < 3) {
          return HttpResponse.error();
        }
        return HttpResponse.json({ success: true });
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({
      retry: { attempts: 3, delay: 10, when: (ctx) => !!ctx.error },
    });

    assert.ok(!(result instanceof Error));
    assert.equal(attemptCount, 3);
  });

  test("retry exhaustion - returns error", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    let attemptCount = 0;

    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
        attemptCount++;
        return HttpResponse.error();
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({
      retry: { attempts: 2, delay: 10, when: (ctx) => !!ctx.error },
    });

    assert.ok(result instanceof NetworkError);
    assert.equal(attemptCount, 2);
  });

  test("retry with custom condition", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    let attemptCount = 0;

    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
        attemptCount++;
        if (attemptCount === 1) {
          return HttpResponse.json({ error: "Server error" }, { status: 500 });
        }
        return HttpResponse.json({ success: true });
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({
      retry: {
        attempts: 3,
        delay: 10,
        when: ({ response }) => response?.status === 500,
      },
    });

    assert.ok(!(result instanceof Error));
    assert.equal(attemptCount, 2);
  });

  test("retry delay function", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    const delays: number[] = [];
    let attemptCount = 0;

    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
        attemptCount++;
        if (attemptCount < 3) {
          return HttpResponse.error();
        }
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    await fetch_endpoint({
      retry: {
        attempts: 3,
        delay: ({ attempt }) => {
          delays.push(attempt);
          return 5;
        },
        when: (ctx) => !!ctx.error,
      },
    });

    assert.deepEqual(delays, [1, 2]);
  });

  test("URL generation error handling", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users/(:id)",
      params: {
        schema: z.object({ id: z.string().min(1) }),
      },
    });

    server.use(
      http.get(`${API_BASE_URL}/users/:id`, () => {
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({ params: { id: "" } });

    assert.ok(result instanceof SerializationError);
    assert.equal(result.context.operation, "generate_url");
  });

  test("body serialization error handling", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({ name: z.string().min(1) }),
      },
    });

    server.use(
      http.post(`${API_BASE_URL}/users`, () => {
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({ body: { name: "" } });

    assert.ok(result instanceof SerializationError);
    assert.equal(result.context.operation, "serialize_body");
  });

  test("response parsing error handling", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      data: {
        schema: z.object({ id: z.number() }),
      },
    });

    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
        return new HttpResponse("invalid json {", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({});

    assert.ok(result instanceof UnexpectedError);
    assert.equal(result.context.operation, "parse_response");
  });

  test("network error handling", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
        return HttpResponse.error();
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({});

    assert.ok(result instanceof NetworkError);
  });

  test("default options from get_default_options", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    server.use(
      http.get(`${API_BASE_URL}/users`, ({ request }) => {
        assert.equal(request.headers.get("x-default"), "default-value");
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
      get_default_options: () => ({ headers: { "X-Default": "default-value" } }),
    });

    const result = await fetch_endpoint({});

    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
  });

  test("no retry on success", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    let attemptCount = 0;

    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
        attemptCount++;
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    await fetch_endpoint({
      retry: { attempts: 3, delay: 10 },
    });

    assert.equal(attemptCount, 1);
  });

  test("request object creation", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({ name: z.string() }),
      },
    });

    server.use(
      http.post(`${API_BASE_URL}/users`, async ({ request }) => {
        assert.equal(request.method, "POST");
        const url = new URL(request.url);
        assert.equal(url.pathname, "/users");
        assert.equal(request.headers.get("x-custom"), "value");
        assert.equal(request.headers.get("content-type"), "application/json");
        const body = await request.json();
        assert.deepEqual(body, { name: "John" });
        return HttpResponse.json({ id: "123" }, { status: 201 });
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({
      body: { name: "John" },
      headers: { "X-Custom": "value" },
    });

    assert.ok(!(result instanceof Error));
    assert.equal(result.status, 201);
  });

  test("async get_default_options", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    server.use(
      http.get(`${API_BASE_URL}/users`, ({ request }) => {
        assert.equal(request.headers.get("x-async"), "async-value");
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
      get_default_options: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { headers: { "X-Async": "async-value" } };
      },
    });

    const result = await fetch_endpoint({});

    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
  });

  test("PUT request with body", async () => {
    const endpoint = new Endpoint({
      method: "PUT",
      pathname: "/users/(:id)",
      body: {
        schema: z.object({ name: z.string() }),
      },
    });

    server.use(
      http.put(`${API_BASE_URL}/users/:id`, ({ request }) => {
        assert.equal(request.method, "PUT");
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({
      params: { id: "123" },
      body: { name: "Updated" },
    });

    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
  });

  test("PATCH request with body", async () => {
    const endpoint = new Endpoint({
      method: "PATCH",
      pathname: "/users/(:id)",
      body: {
        schema: z.object({ name: z.string() }),
      },
    });

    server.use(
      http.patch(`${API_BASE_URL}/users/:id`, ({ request }) => {
        assert.equal(request.method, "PATCH");
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({
      params: { id: "123" },
      body: { name: "Patched" },
    });

    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
  });

  test("DELETE request with body", async () => {
    const endpoint = new Endpoint({
      method: "DELETE",
      pathname: "/users/(:id)",
      body: {
        schema: z.object({ reason: z.string() }),
      },
    });

    server.use(
      http.delete(`${API_BASE_URL}/users/:id`, async ({ request }) => {
        assert.equal(request.method, "DELETE");
        const body = await request.json();
        assert.deepEqual(body, { reason: "inactive" });
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({
      params: { id: "123" },
      body: { reason: "inactive" },
    });

    assert.ok(!(result instanceof Error));
    assert.equal(result.status, 204);
  });

  test("endpoint options merged with request options", async () => {
    const endpoint = new Endpoint(
      {
        method: "GET",
        pathname: "/users",
      },
      {
        headers: { "X-Endpoint": "endpoint-value" },
        timeout: 5000,
      },
    );

    server.use(
      http.get(`${API_BASE_URL}/users`, ({ request }) => {
        assert.equal(request.headers.get("x-endpoint"), "endpoint-value");
        assert.equal(request.headers.get("x-request"), "request-value");
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({
      headers: { "X-Request": "request-value" },
    });

    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
  });

  test("retry with attempts as function", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    let attemptCount = 0;
    const attemptsCalled: number[] = [];

    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
        attemptCount++;
        if (attemptCount < 3) {
          return HttpResponse.error();
        }
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    await fetch_endpoint({
      retry: {
        attempts: () => {
          attemptsCalled.push(1);
          return 3;
        },
        delay: 5,
        when: (ctx) => !!ctx.error,
      },
    });

    assert.equal(attemptCount, 3);
    assert.equal(attemptsCalled.length, 2);
  });

  test("error response without retry", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      error: {
        schema: z.object({ message: z.string() }),
        deserialization: "json",
      },
    });

    let attemptCount = 0;

    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
        attemptCount++;
        return HttpResponse.json({ message: "Not found" }, { status: 404 });
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({});

    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(attemptCount, 1);
  });

  test("Content-Type header override", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/upload",
      body: {
        schema: z.object({ data: z.string() }),
        serialization: (data) => ({
          body: data.data,
          content_type: "text/plain",
        }),
      },
    });

    server.use(
      http.post(`${API_BASE_URL}/upload`, async ({ request }) => {
        assert.equal(request.headers.get("content-type"), "text/plain");
        const body = await request.text();
        assert.equal(body, "test");
        return HttpResponse.json({});
      }),
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({ body: { data: "test" } });

    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
  });
});
