import { describe, test } from "node:test";
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

describe("fetch_endpoint_factory", () => {
  test("successful request with JSON response", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users/(:id)",
      data: {
        schema: z.object({ id: z.string(), name: z.string() }),
      },
    });

    const mockFetch = async (request: Request) => {
      assert.equal(request.url, "https://api.example.com/users/123");
      assert.equal(request.method, "GET");
      return new Response(JSON.stringify({ id: "123", name: "John" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
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

    let capturedRequest: Request | undefined;
    const mockFetch = async (request: Request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    await fetch_endpoint({ params: { id: "456" } });

    assert.ok(capturedRequest);
    assert.equal(capturedRequest!.url, "https://api.example.com/users/456");
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

    let capturedRequest: Request | undefined;
    const mockFetch = async (request: Request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({ users: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    await fetch_endpoint({ query: { page: 1, limit: 10 } });

    assert.ok(capturedRequest);
    const url = new URL(capturedRequest!.url);
    assert.equal(url.pathname, "/users");
    assert.equal(url.searchParams.get("page"), "1");
    assert.equal(url.searchParams.get("limit"), "10");
  });

  test("POST request with body serialization", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({ name: z.string(), email: z.string() }),
      },
    });

    let capturedRequest: Request | undefined;
    const mockFetch = async (request: Request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({ id: "123" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    await fetch_endpoint({ body: { name: "John", email: "john@example.com" } });

    assert.ok(capturedRequest);
    assert.equal(capturedRequest!.method, "POST");
    assert.equal(capturedRequest!.headers.get("Content-Type"), "application/json");
    const body = await capturedRequest!.text();
    assert.deepEqual(JSON.parse(body), { name: "John", email: "john@example.com" });
  });

  test("custom headers merging", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      headers: { "X-Default": "default-value" },
    });

    let capturedRequest: Request | undefined;
    const mockFetch = async (request: Request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    await fetch_endpoint({ headers: { "X-Custom": "custom-value" } });

    assert.ok(capturedRequest);
    assert.equal(capturedRequest!.headers.get("x-default"), "default-value");
    assert.equal(capturedRequest!.headers.get("x-custom"), "custom-value");
  });

  test("timeout handling", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/slow",
    });

    const mockFetch = async (request: Request) => {
      await new Promise((resolve, reject) => {
        request.signal?.addEventListener("abort", () => {
          reject(new Error("AbortError"));
        });
        setTimeout(resolve, 100);
      });
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    const result = await fetch_endpoint({ timeout: 10 });

    assert.ok(result instanceof NetworkError);
  });

  test("AbortSignal handling", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    const mockFetch = async (request: Request) => {
      await new Promise((resolve, reject) => {
        request.signal?.addEventListener("abort", () => {
          const error = new Error("AbortError");
          error.name = "AbortError";
          reject(error);
        });
        setTimeout(resolve, 100);
      });
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort("User cancelled"), 10);

    const result = await fetch_endpoint({ signal: controller.signal });

    assert.ok(result instanceof AbortedError);
  });

  test("retry on failure - success on retry", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    let attemptCount = 0;
    const mockFetch = async (_request: Request) => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error("Network error");
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    const result = await fetch_endpoint({
      retry: { attempts: 3, delay: 10 },
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
    const mockFetch = async (_request: Request) => {
      attemptCount++;
      throw new Error("Network error");
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    const result = await fetch_endpoint({
      retry: { attempts: 2, delay: 10 },
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
    const mockFetch = async (_request: Request) => {
      attemptCount++;
      if (attemptCount === 1) {
        return new Response(JSON.stringify({ error: "Server error" }), { status: 500 });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
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

    const mockFetch = async (_request: Request) => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error("Network error");
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    await fetch_endpoint({
      retry: {
        attempts: 3,
        delay: ({ attempt }) => {
          delays.push(attempt);
          return 5;
        },
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

    const mockFetch = async (_request: Request) => {
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    const result = await fetch_endpoint({ params: { id: "" } });

    assert.ok(result instanceof SerializationError);
    assert.ok(result.message.includes("Params validation failed"));
  });

  test("body serialization error handling", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({ name: z.string().min(1) }),
      },
    });

    const mockFetch = async (_request: Request) => {
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    const result = await fetch_endpoint({ body: { name: "" } });

    assert.ok(result instanceof SerializationError);
    assert.ok(result.message.includes("Body validation failed"));
  });

  test("response parsing error handling", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      data: {
        schema: z.object({ id: z.number() }),
      },
    });

    const mockFetch = async (_request: Request) => {
      return new Response("invalid json {", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    const result = await fetch_endpoint({});

    assert.ok(result instanceof UnexpectedError);
    assert.ok(result.message.includes("Failed to parse response"));
  });

  test("network error handling", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    const mockFetch = async (_request: Request) => {
      throw new Error("Connection refused");
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    const result = await fetch_endpoint({});

    assert.ok(result instanceof NetworkError);
  });

  test("default options from get_default_options", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    let capturedRequest: Request | undefined;
    const mockFetch = async (request: Request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
      get_default_options: () => ({ headers: { "X-Default": "default-value" } }),
    });

    await fetch_endpoint({});

    assert.ok(capturedRequest);
    assert.equal(capturedRequest!.headers.get("x-default"), "default-value");
  });

  test("no retry on success", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    let attemptCount = 0;
    const mockFetch = async (_request: Request) => {
      attemptCount++;
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
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

    const requests: Request[] = [];
    const mockFetch = async (request: Request) => {
      requests.push(request);
      return new Response(JSON.stringify({ id: "123" }), { status: 201 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    await fetch_endpoint({
      body: { name: "John" },
      headers: { "X-Custom": "value" },
    });

    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(request.method, "POST");
    assert.ok(request.url.includes("/users"));
    assert.equal(request.headers.get("x-custom"), "value");
    assert.equal(request.headers.get("content-type"), "application/json");
  });

  test("async get_default_options", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    let capturedRequest: Request | undefined;
    const mockFetch = async (request: Request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
      get_default_options: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { headers: { "X-Async": "async-value" } };
      },
    });

    await fetch_endpoint({});

    assert.ok(capturedRequest);
    assert.equal(capturedRequest!.headers.get("x-async"), "async-value");
  });

  test("PUT request with body", async () => {
    const endpoint = new Endpoint({
      method: "PUT",
      pathname: "/users/(:id)",
      body: {
        schema: z.object({ name: z.string() }),
      },
    });

    let capturedRequest: Request | undefined;
    const mockFetch = async (request: Request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    await fetch_endpoint({
      params: { id: "123" },
      body: { name: "Updated" },
    });

    assert.ok(capturedRequest);
    assert.equal(capturedRequest!.method, "PUT");
  });

  test("PATCH request with body", async () => {
    const endpoint = new Endpoint({
      method: "PATCH",
      pathname: "/users/(:id)",
      body: {
        schema: z.object({ name: z.string() }),
      },
    });

    let capturedRequest: Request | undefined;
    const mockFetch = async (request: Request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    await fetch_endpoint({
      params: { id: "123" },
      body: { name: "Patched" },
    });

    assert.ok(capturedRequest);
    assert.equal(capturedRequest!.method, "PATCH");
  });

  test("DELETE request with body", async () => {
    const endpoint = new Endpoint({
      method: "DELETE",
      pathname: "/users/(:id)",
      body: {
        schema: z.object({ reason: z.string() }),
      },
    });

    let capturedRequest: Request | undefined;
    const mockFetch = async (request: Request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({}), { status: 204 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    await fetch_endpoint({
      params: { id: "123" },
      body: { reason: "inactive" },
    });

    assert.ok(capturedRequest);
    assert.equal(capturedRequest!.method, "DELETE");
  });

  test("endpoint options merged with request options", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
      headers: { "X-Endpoint": "endpoint-value" },
      timeout: 5000,
    });

    let capturedRequest: Request | undefined;
    const mockFetch = async (request: Request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    await fetch_endpoint({
      headers: { "X-Request": "request-value" },
    });

    assert.ok(capturedRequest);
    assert.equal(capturedRequest!.headers.get("x-endpoint"), "endpoint-value");
    assert.equal(capturedRequest!.headers.get("x-request"), "request-value");
  });

  test("retry with attempts as function", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    let attemptCount = 0;
    const attemptsCalled: number[] = [];

    const mockFetch = async (_request: Request) => {
      attemptCount++;
      if (attemptCount < 3) {
        throw new Error("Network error");
      }
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    await fetch_endpoint({
      retry: {
        attempts: () => {
          attemptsCalled.push(1);
          return 3;
        },
        delay: 5,
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
    const mockFetch = async (_request: Request) => {
      attemptCount++;
      return new Response(JSON.stringify({ message: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
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

    let capturedRequest: Request | undefined;
    const mockFetch = async (request: Request) => {
      capturedRequest = request;
      return new Response(JSON.stringify({}), { status: 200 });
    };

    const fetch_endpoint = fetch_endpoint_factory({
      origin: "https://api.example.com",
      endpoint,
      custom_fetch: mockFetch,
    });

    await fetch_endpoint({ body: { data: "test" } });

    assert.ok(capturedRequest);
    assert.equal(capturedRequest!.headers.get("content-type"), "text/plain");
  });
});
