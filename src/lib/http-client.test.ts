import { describe, test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fetch_endpoint_factory, http_client } from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import { default_retry_condition } from "./utils.ts";
import { default_retry_condition as entry_point_retry_condition } from "../index.ts";
import {
  AbortedError,
  HttpClientError,
  NetworkError,
  ParseError,
  SerializationError,
  TimeoutError,
  UnexpectedError,
} from "./errors.ts";
import type { HTTPFetch } from "./types.ts";
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
      responses: {
        200: {
          schema: z.object({ id: z.string(), name: z.string() }),
          parse: "json",
        },
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
        serialize: "urlencoded",
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

  test("POST request with body serialize", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({ name: z.string(), email: z.string() }),
        serialize: "json",
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

  describe("timeout", () => {
    /** Answers instantly with `503`, so only the timeout config decides when the call ends. */
    function serve_instant_503() {
      let attempts = 0;
      server.use(
        http.get(`${API_BASE_URL}/users`, () => {
          attempts++;
          return HttpResponse.json({ message: "unavailable" }, { status: 503 });
        }),
      );
      return () => attempts;
    }

    /** Answers after `ms`, so an `attempt` bound shorter than `ms` always cuts the attempt. */
    function serve_slow(ms: number) {
      let attempts = 0;
      server.use(
        http.get(`${API_BASE_URL}/users`, async () => {
          attempts++;
          await delay(ms);
          return HttpResponse.json({});
        }),
      );
      return () => attempts;
    }

    function make_client(
      client_options?: HTTPFetch.OptionalRequestInit,
      endpoint_options?: HTTPFetch.OptionalRequestInit,
    ) {
      return fetch_endpoint_factory({
        base_url: API_BASE_URL,
        endpoint: new Endpoint({ method: "GET", pathname: "/users" }, endpoint_options),
        custom_fetch: fetch,
        get_default_options: () => client_options ?? {},
      });
    }

    describe("semantics", () => {
      test("`total` bounds the whole call, delays included", async () => {
        const attempts = serve_instant_503();
        const fetch_endpoint = make_client();
        const started = Date.now();

        const result = await fetch_endpoint({
          timeout: { total: 100 },
          retry: { attempts: 4, delay: 50 },
        });
        const elapsed = Date.now() - started;

        assert.ok(
          result instanceof TimeoutError,
          `expected TimeoutError, got ${result instanceof Error ? result.name : "success"}`,
        );
        assert.match(result.message, /Call deadline of 100ms exceeded/);
        assert.ok(elapsed < 250, `expected the call to end near 100ms, took ${elapsed}ms`);
        assert.ok(attempts() >= 2, `expected more than one attempt, got ${attempts()}`);
      });

      test("`attempt` bounds one try and leaves the rest of the budget alone", async () => {
        const attempts = serve_slow(60);
        const fetch_endpoint = make_client();

        const result = await fetch_endpoint({
          timeout: { attempt: 30 },
          retry: { attempts: 3 },
        });

        assert.ok(result instanceof TimeoutError);
        assert.equal(attempts(), 3);
      });

      test("`total` and `attempt` together: attempts are cut, the call ends on the deadline", async () => {
        const attempts = serve_slow(60);
        const fetch_endpoint = make_client();
        const started = Date.now();

        const result = await fetch_endpoint({
          timeout: { total: 200, attempt: 30 },
          retry: { attempts: 20 },
        });
        const elapsed = Date.now() - started;

        assert.ok(result instanceof TimeoutError);
        assert.match(result.message, /Call deadline of 200ms exceeded/);
        assert.ok(elapsed < 400, `expected the call to end near 200ms, took ${elapsed}ms`);
        assert.ok(attempts() >= 2, `expected several cut attempts, got ${attempts()}`);
      });

      test("a bare number is shorthand for `{ total }`", async () => {
        const attempts = serve_instant_503();
        const fetch_endpoint = make_client();

        const result = await fetch_endpoint({
          timeout: 100,
          retry: { attempts: 4, delay: 50 },
        });

        assert.ok(result instanceof TimeoutError);
        assert.match(result.message, /Call deadline of 100ms exceeded/);
        assert.deepEqual(result.context.request?.timeout, { total: 100 });
        assert.ok(attempts() >= 2);
      });

      test("regression: an `attempt` bound no longer fires during the retry delay", async () => {
        const attempts = serve_instant_503();
        const fetch_endpoint = make_client();

        const result = await fetch_endpoint({
          timeout: { attempt: 50 },
          retry: { attempts: 3, delay: 100 },
        });

        assert.ok(
          !(result instanceof Error),
          `expected the third response, got ${result instanceof Error ? `${result.name}: ${result.message}` : "success"}`,
        );
        assert.equal(result.status, 503);
        assert.equal(attempts(), 3);
      });
    });

    describe("terminal versus retryable", () => {
      test("a `total` expiry never reaches `when`", async () => {
        const attempts = serve_slow(200);
        const fetch_endpoint = make_client();
        const when_calls: number[] = [];

        const result = await fetch_endpoint({
          timeout: { total: 30 },
          retry: {
            attempts: 3,
            when: () => {
              when_calls.push(1);
              return true;
            },
          },
        });

        assert.ok(result instanceof TimeoutError);
        assert.equal(when_calls.length, 0, "a blown deadline was offered to the retry condition");
        assert.equal(attempts(), 1);
      });

      test("an `attempt` expiry reaches `when` and is retried by default", async () => {
        const attempts = serve_slow(200);
        const fetch_endpoint = make_client();
        const seen: Array<string | undefined> = [];

        await fetch_endpoint({
          timeout: { attempt: 20 },
          retry: {
            attempts: 3,
            when: (ctx) => {
              seen.push(ctx.error?.name);
              return default_retry_condition(ctx);
            },
          },
        });

        assert.deepEqual(seen, ["TimeoutError", "TimeoutError", "TimeoutError"]);
        assert.equal(attempts(), 3);
      });

      test("the two expiries are distinguishable by message", async () => {
        serve_slow(200);
        const fetch_endpoint = make_client();

        const deadline = await fetch_endpoint({ timeout: { total: 20 } });
        const per_attempt = await fetch_endpoint({ timeout: { attempt: 20 } });

        assert.ok(deadline instanceof TimeoutError);
        assert.ok(per_attempt instanceof TimeoutError);
        assert.match(deadline.message, /Call deadline of 20ms exceeded/);
        assert.doesNotMatch(per_attempt.message, /Call deadline/);
      });
    });

    describe("abort classification", () => {
      test("an abort mid-delay yields an AbortedError, not an UnexpectedError", async () => {
        serve_instant_503();
        const fetch_endpoint = make_client();
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 30);

        const result = await fetch_endpoint({
          signal: controller.signal,
          retry: { attempts: 3, delay: 200 },
        });

        assert.ok(
          result instanceof AbortedError,
          `expected AbortedError, got ${result instanceof Error ? `${result.name}: ${result.message}` : "success"}`,
        );
        assert.equal(result.context.operation, "retry_delay");
      });

      test("a non-Error abort reason is carried through as the cause", async () => {
        serve_instant_503();
        const fetch_endpoint = make_client();
        const controller = new AbortController();
        setTimeout(() => controller.abort("gone"), 30);

        const result = await fetch_endpoint({
          signal: controller.signal,
          retry: { attempts: 3, delay: 200 },
        });

        assert.ok(result instanceof AbortedError);
        assert.equal(result.cause, "gone");
        assert.equal(result.message, "The operation was aborted");
      });

      test("a caller-supplied timeout signal firing mid-delay yields a TimeoutError", async () => {
        serve_instant_503();
        const fetch_endpoint = make_client();

        const result = await fetch_endpoint({
          signal: AbortSignal.timeout(30),
          retry: { attempts: 3, delay: 200 },
        });

        assert.ok(
          result instanceof TimeoutError,
          `expected TimeoutError, got ${result instanceof Error ? result.name : "success"}`,
        );
        assert.doesNotMatch(result.message, /Call deadline/);
      });

      test("a delay abort reports the attempt that just completed", async () => {
        serve_instant_503();
        const fetch_endpoint = make_client();
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 30);

        const result = await fetch_endpoint({
          signal: controller.signal,
          retry: { attempts: 3, delay: 200 },
        });

        assert.ok(result instanceof AbortedError);
        assert.equal(result.context.timing?.attempt, 1);
      });
    });

    describe("normalization", () => {
      test("a fractional value is floored instead of throwing a RangeError", async () => {
        serve_slow(200);
        const fetch_endpoint = make_client();

        const result = await fetch_endpoint({ timeout: { total: 1.5 } });

        assert.ok(result instanceof TimeoutError);
        assert.deepEqual(result.context.request?.timeout, { total: 1 });
      });

      test("a negative value is an exhausted budget, not a RangeError", async () => {
        const attempts = serve_slow(200);
        const fetch_endpoint = make_client();

        const result = await fetch_endpoint({ timeout: { total: -1 } });

        assert.ok(result instanceof TimeoutError);
        assert.deepEqual(result.context.request?.timeout, { total: 0 });
        assert.equal(attempts(), 0);
      });

      test("`0` means immediately, not never", async () => {
        const attempts = serve_slow(200);
        const fetch_endpoint = make_client();

        const result = await fetch_endpoint({ timeout: { total: 0 } });

        assert.ok(
          result instanceof TimeoutError,
          `expected TimeoutError, got ${result instanceof Error ? result.name : "success"}`,
        );
        assert.match(result.message, /Call deadline of 0ms exceeded/);
        assert.equal(attempts(), 0);
      });

      test("a non-finite value is a caller error naming the key", async () => {
        const attempts = serve_slow(200);
        const fetch_endpoint = make_client();

        const result = await fetch_endpoint({ timeout: { total: Number.NaN } });

        assert.ok(
          result instanceof UnexpectedError,
          `expected UnexpectedError, got ${result instanceof Error ? result.name : "success"}`,
        );
        assert.equal(result.context.operation, "resolve_timeout");
        assert.match(result.message, /timeout\.total/);
        assert.equal(attempts(), 0);
      });

      test("an explicit `undefined` leaves the call unbounded", async () => {
        serve_slow(50);
        const fetch_endpoint = make_client();

        const result = await fetch_endpoint({ timeout: undefined });

        assert.ok(!(result instanceof Error));
        assert.equal(result.ok, true);
      });
    });

    describe("merging", () => {
      test("client-level `attempt` survives a per-call `total`", async () => {
        serve_slow(200);
        const fetch_endpoint = make_client({ timeout: { attempt: 1000 } });

        const result = await fetch_endpoint({ timeout: { total: 20 } });

        assert.ok(result instanceof TimeoutError);
        assert.deepEqual(result.context.request?.timeout, { attempt: 1000, total: 20 });
      });

      test("a per-call `attempt` overrides the client-level one and keeps `total`", async () => {
        serve_slow(200);
        const fetch_endpoint = make_client({ timeout: { total: 20, attempt: 1000 } });

        const result = await fetch_endpoint({ timeout: { attempt: 2000 } });

        assert.ok(result instanceof TimeoutError);
        assert.deepEqual(result.context.request?.timeout, { total: 20, attempt: 2000 });
      });

      test("a client-level bare number merges with a per-call `attempt`", async () => {
        serve_slow(200);
        const fetch_endpoint = make_client({ timeout: 3000 }, { timeout: { total: 20 } });

        const result = await fetch_endpoint({ timeout: { attempt: 500 } });

        assert.ok(result instanceof TimeoutError);
        assert.deepEqual(result.context.request?.timeout, { total: 20, attempt: 500 });
      });
    });
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

  test("AbortSignal handling - after request", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/posts/:id",
      responses: {
        200: {
          schema: z.object({ id: z.number(), title: z.string() }),
          parse: "json",
        },
      },
    });

    const controller = new AbortController();

    /**
     * The abort has to land once `parse_response` has the body, which is the only way into the
     * `AbortedError` branch of the parse catch: an abort raised any earlier is caught by the
     * terminal abort check right after the fetch. Driving it from the body's `pull` makes that
     * ordering deterministic, with two requirements. `highWaterMark: 0`, so nothing is pulled until
     * a consumer asks for a chunk rather than eagerly at construction; and a stream built here
     * rather than in an `msw` handler, since `msw` pumps a handler's stream while delivering the
     * response, before `fetch` even resolves.
     */
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: (request) => {
        const body = new ReadableStream(
          {
            pull(stream_controller) {
              controller.abort();
              // what a real `fetch` body does when the caller's signal aborts mid-read
              stream_controller.error(request.signal.reason);
            },
          },
          { highWaterMark: 0 },
        );
        return Promise.resolve(
          new Response(body, { headers: { "Content-Type": "application/json" } }),
        );
      },
    });

    const result = await fetch_endpoint({ params: { id: 1 }, signal: controller.signal });

    assert.ok(result instanceof AbortedError);
    assert.equal(result.context.operation, "parse_response");
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

  test("retry recover - refreshes auth header before retry", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    const seen_auth: Array<string | null> = [];

    server.use(
      http.get(`${API_BASE_URL}/users`, ({ request }) => {
        seen_auth.push(request.headers.get("authorization"));
        if (seen_auth.length === 1) {
          return HttpResponse.json({ error: "unauthorized" }, { status: 401 });
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
      headers: { authorization: "Bearer stale" },
      retry: {
        attempts: 2,
        delay: 0,
        when: ({ response }) => response?.status === 401,
        recover: async () => ({ headers: { authorization: "Bearer fresh" } }),
      },
    });

    assert.ok(!(result instanceof Error));
    assert.deepEqual(seen_auth, ["Bearer stale", "Bearer fresh"]);
  });

  test("retry recover - returning nothing leaves headers unchanged", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    const seen_auth: Array<string | null> = [];

    server.use(
      http.get(`${API_BASE_URL}/users`, ({ request }) => {
        seen_auth.push(request.headers.get("authorization"));
        if (seen_auth.length < 2) {
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

    const result = await fetch_endpoint({
      headers: { authorization: "Bearer keep" },
      retry: {
        attempts: 2,
        delay: 0,
        when: (ctx) => !!ctx.error,
        recover: () => undefined,
      },
    });

    assert.ok(!(result instanceof Error));
    assert.deepEqual(seen_auth, ["Bearer keep", "Bearer keep"]);
  });

  test("retry recover - not called when no retry happens", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    let recover_calls = 0;

    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
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
        delay: 0,
        when: () => false,
        recover: () => {
          recover_calls++;
          return undefined;
        },
      },
    });

    assert.ok(!(result instanceof Error));
    assert.equal(recover_calls, 0);
  });

  test("retry recover - runs after the delay", async () => {
    const endpoint = new Endpoint({
      method: "GET",
      pathname: "/users",
    });

    const events: string[] = [];
    let attemptCount = 0;

    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
        attemptCount++;
        if (attemptCount < 2) {
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
        attempts: 2,
        delay: () => {
          events.push("delay");
          return 0;
        },
        when: (ctx) => !!ctx.error,
        recover: () => {
          events.push("recover");
          return undefined;
        },
      },
    });

    assert.deepEqual(events, ["delay", "recover"]);
  });

  test("retry recover - throwing surfaces as UnexpectedError", async () => {
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
      retry: {
        attempts: 3,
        delay: 0,
        when: (ctx) => !!ctx.error,
        recover: () => {
          throw new Error("token endpoint down");
        },
      },
    });

    assert.ok(result instanceof UnexpectedError);
    assert.equal(result.context.operation, "recover");
    assert.equal(attemptCount, 1);
  });

  test("retry recover - replace drops headers not returned", async () => {
    const endpoint = new Endpoint(
      {
        method: "GET",
        pathname: "/users",
      },
      {
        headers: { "x-default": "default-value" },
      },
    );

    const seen_default: Array<string | null> = [];

    server.use(
      http.get(`${API_BASE_URL}/users`, ({ request }) => {
        seen_default.push(request.headers.get("x-default"));
        if (seen_default.length < 2) {
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
        attempts: 2,
        delay: 0,
        when: (ctx) => !!ctx.error,
        recover: () => ({ headers: { "x-other": "value" } }),
      },
    });

    assert.deepEqual(seen_default, ["default-value", null]);
  });

  test("retry recover - keeps other headers via current.headers copy", async () => {
    const endpoint = new Endpoint(
      {
        method: "GET",
        pathname: "/users",
      },
      {
        headers: { "x-default": "default-value" },
      },
    );

    const requests: Array<{ auth: string | null; def: string | null }> = [];

    server.use(
      http.get(`${API_BASE_URL}/users`, ({ request }) => {
        requests.push({
          auth: request.headers.get("authorization"),
          def: request.headers.get("x-default"),
        });
        if (requests.length < 2) {
          return HttpResponse.json({}, { status: 401 });
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
        attempts: 2,
        delay: 0,
        when: ({ response }) => response?.status === 401,
        recover: ({ current }) => {
          const headers = new Headers(current.headers);
          headers.set("authorization", "Bearer fresh");
          return { headers };
        },
      },
    });

    assert.deepEqual(requests, [
      { auth: null, def: "default-value" },
      { auth: "Bearer fresh", def: "default-value" },
    ]);
  });

  test("retry recover - preserves serializer Content-Type after replace", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: { schema: z.object({ name: z.string() }), serialize: "json" },
    });

    const seen_content_type: Array<string | null> = [];

    server.use(
      http.post(`${API_BASE_URL}/users`, ({ request }) => {
        seen_content_type.push(request.headers.get("content-type"));
        if (seen_content_type.length < 2) {
          return HttpResponse.json({}, { status: 401 });
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
      body: { name: "Ada" },
      retry: {
        attempts: 2,
        delay: 0,
        when: ({ response }) => response?.status === 401,
        recover: () => ({ headers: { authorization: "Bearer fresh" } }),
      },
    });

    assert.deepEqual(seen_content_type, ["application/json", "application/json"]);
  });

  test("retry recover - per-call recover replaces endpoint-level recover", async () => {
    const endpoint = new Endpoint(
      {
        method: "GET",
        pathname: "/users",
      },
      {
        retry: {
          attempts: 2,
          delay: 0,
          when: ({ response }) => response?.status === 401,
          recover: () => ({ headers: { authorization: "Bearer endpoint" } }),
        },
      },
    );

    const seen_auth: Array<string | null> = [];

    server.use(
      http.get(`${API_BASE_URL}/users`, ({ request }) => {
        seen_auth.push(request.headers.get("authorization"));
        if (seen_auth.length < 2) {
          return HttpResponse.json({}, { status: 401 });
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
        recover: () => ({ headers: { authorization: "Bearer call" } }),
      },
    });

    assert.deepEqual(seen_auth, [null, "Bearer call"]);
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

  test("body serialize error handling", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({ name: z.string().min(1) }),
        serialize: "json",
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
      responses: {
        200: {
          schema: z.object({ id: z.number() }),
          parse: "json",
        },
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
        serialize: "json",
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
        serialize: "json",
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
        serialize: "json",
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
        serialize: "json",
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
      responses: {
        404: {
          schema: z.object({ message: z.string() }),
          parse: "json",
        },
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

  test("retry from endpoint defaults applies when no per-call retry", async () => {
    let attemptCount = 0;
    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
        attemptCount++;
        if (attemptCount < 3) return HttpResponse.error();
        return HttpResponse.json({});
      }),
    );

    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      { retry: { attempts: 3, delay: 5, when: (ctx) => !!ctx.error } },
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({});

    assert.ok(
      !(result instanceof Error),
      `expected endpoint-default retry to recover, got ${result instanceof Error ? result.name : "unexpected non-error"}`,
    );
    assert.equal(attemptCount, 3);
  });

  test("retry from client defaults applies when no per-call retry", async () => {
    let attemptCount = 0;
    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
        attemptCount++;
        if (attemptCount < 3) return HttpResponse.error();
        return HttpResponse.json({});
      }),
    );

    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
      get_default_options: () => ({
        retry: { attempts: 3, delay: 5, when: (ctx) => !!ctx.error },
      }),
    });

    const result = await fetch_endpoint({});

    assert.ok(
      !(result instanceof Error),
      `expected client-default retry to recover, got ${result instanceof Error ? result.name : "unexpected non-error"}`,
    );
    assert.equal(attemptCount, 3);
  });

  test("timeout from endpoint defaults applies when no per-call timeout", async () => {
    server.use(
      http.get(`${API_BASE_URL}/slow`, async () => {
        await delay(200);
        return HttpResponse.json({});
      }),
    );

    const endpoint = new Endpoint({ method: "GET", pathname: "/slow" }, { timeout: 10 });

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({});

    assert.ok(
      result instanceof TimeoutError,
      `expected TimeoutError from endpoint-default timeout, got ${result instanceof Error ? result.name : "success"}`,
    );
  });

  test("signal from endpoint defaults applies when no per-call signal", async () => {
    const controller = new AbortController();
    controller.abort();

    server.use(http.get(`${API_BASE_URL}/users`, () => HttpResponse.json({})));

    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      { signal: controller.signal },
    );

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    const result = await fetch_endpoint({});

    assert.ok(
      result instanceof AbortedError,
      `expected AbortedError from endpoint-default signal, got ${result instanceof Error ? result.name : "success"}`,
    );
  });

  test("retry context does not carry stale response after a network error", async () => {
    let attemptCount = 0;
    server.use(
      http.get(`${API_BASE_URL}/users`, () => {
        attemptCount++;
        if (attemptCount === 1) return HttpResponse.json({}, { status: 503 });
        return HttpResponse.error();
      }),
    );

    const contexts: Array<{ hasResponse: boolean; hasError: boolean }> = [];

    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: fetch,
    });

    await fetch_endpoint({
      retry: {
        attempts: 3,
        delay: 5,
        when: (ctx) => {
          contexts.push({ hasResponse: !!ctx.response, hasError: !!ctx.error });
          return true;
        },
      },
    });

    assert.ok(contexts.length >= 2, `expected >= 2 retry checks, got ${contexts.length}`);
    assert.deepEqual(
      contexts[1],
      { hasResponse: false, hasError: true },
      "stale response leaked into retry context after network error",
    );
  });

  test("Content-Type header override", async () => {
    const endpoint = new Endpoint({
      method: "POST",
      pathname: "/upload",
      body: {
        schema: z.object({ data: z.string() }),
        serialize: (data) => ({
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

  describe("default retry condition", () => {
    function setup(respond: () => Response | Promise<Response>) {
      let attempts = 0;

      server.use(
        http.get(`${API_BASE_URL}/users`, () => {
          attempts++;
          return respond();
        }),
      );

      const fetch_endpoint = fetch_endpoint_factory({
        base_url: API_BASE_URL,
        endpoint: new Endpoint({ method: "GET", pathname: "/users" }),
        custom_fetch: fetch,
      });

      return { fetch_endpoint, attempts: () => attempts };
    }

    test("a network error is retried", async () => {
      const { fetch_endpoint, attempts } = setup(() => HttpResponse.error());

      const result = await fetch_endpoint({ retry: { attempts: 3 } });

      assert.ok(
        result instanceof NetworkError,
        `expected NetworkError, got ${result instanceof Error ? result.name : "success"}`,
      );
      assert.equal(attempts(), 3);
    });

    test("an attempt timeout is retried", async () => {
      const { fetch_endpoint, attempts } = setup(async () => {
        await delay(200);
        return HttpResponse.json({});
      });

      const result = await fetch_endpoint({
        timeout: { attempt: 20 },
        retry: { attempts: 3 },
      });

      assert.ok(
        result instanceof TimeoutError,
        `expected TimeoutError, got ${result instanceof Error ? result.name : "success"}`,
      );
      assert.equal(attempts(), 3);
    });

    test("an aborted request is not retried", async () => {
      const controller = new AbortController();
      const { fetch_endpoint, attempts } = setup(async () => {
        controller.abort();
        await delay(200);
        return HttpResponse.json({});
      });

      const result = await fetch_endpoint({
        signal: controller.signal,
        retry: { attempts: 3 },
      });

      assert.ok(
        result instanceof AbortedError,
        `expected AbortedError, got ${result instanceof Error ? result.name : "success"}`,
      );
      assert.equal(attempts(), 1);
    });

    for (const status of [408, 429, 500, 503]) {
      test(`${status} is retried`, async () => {
        const { fetch_endpoint, attempts } = setup(() =>
          HttpResponse.json({ error: "nope" }, { status }),
        );

        const result = await fetch_endpoint({ retry: { attempts: 3 } });

        assert.ok(!(result instanceof Error));
        assert.equal(result.status, status);
        assert.equal(attempts(), 3);
      });
    }

    test("400 is not retried", async () => {
      const { fetch_endpoint, attempts } = setup(() =>
        HttpResponse.json({ error: "bad request" }, { status: 400 }),
      );

      const result = await fetch_endpoint({ retry: { attempts: 3 } });

      assert.ok(!(result instanceof Error));
      assert.equal(result.status, 400);
      assert.equal(attempts(), 1);
    });

    test("a 302 read with redirect: manual is not retried", async () => {
      const { fetch_endpoint, attempts } = setup(
        () =>
          new Response(null, {
            status: 302,
            headers: { Location: `${API_BASE_URL}/elsewhere` },
          }),
      );

      const result = await fetch_endpoint({ redirect: "manual", retry: { attempts: 3 } });

      assert.ok(!(result instanceof Error));
      assert.equal(result.status, 302);
      assert.equal(attempts(), 1);
    });

    test("an explicit when overrides the default", async () => {
      const { fetch_endpoint, attempts } = setup(() =>
        HttpResponse.json({ error: "bad request" }, { status: 400 }),
      );

      const result = await fetch_endpoint({
        retry: { attempts: 3, when: ({ response }) => response?.status === 400 },
      });

      assert.ok(!(result instanceof Error));
      assert.equal(attempts(), 3);
    });

    test("a success is not retried", async () => {
      const { fetch_endpoint, attempts } = setup(() => HttpResponse.json({ ok: true }));

      const result = await fetch_endpoint({ retry: { attempts: 3 } });

      assert.ok(!(result instanceof Error));
      assert.equal(attempts(), 1);
    });

    test("attempts defaults to 0, so nothing is retried without an explicit policy", async () => {
      const { fetch_endpoint, attempts } = setup(() =>
        HttpResponse.json({ error: "nope" }, { status: 503 }),
      );

      const result = await fetch_endpoint({});

      assert.ok(!(result instanceof Error));
      assert.equal(result.status, 503);
      assert.equal(attempts(), 1);
    });

    test("is exported from the package entry point", () => {
      assert.equal(typeof entry_point_retry_condition, "function");
      assert.equal(entry_point_retry_condition, default_retry_condition);
      assert.equal(
        entry_point_retry_condition({
          request: new Request(`${API_BASE_URL}/users`),
          response: new Response(null, { status: 503 }),
          error: undefined,
        }),
        true,
      );
    });
  });
});

describe("error kind discriminant", () => {
  const context = { operation: "fetch" };

  const cases = [
    { error: new HttpClientError("x", context), kind: "HttpClientError" },
    { error: new TimeoutError("x", context), kind: "TimeoutError" },
    { error: new AbortedError("x", context), kind: "AbortedError" },
    { error: new SerializationError("x", context), kind: "SerializationError" },
    { error: new ParseError("x", context), kind: "ParseError" },
    { error: new NetworkError("x", context), kind: "NetworkError" },
    { error: new UnexpectedError("x", context), kind: "UnexpectedError" },
  ] as const;

  for (const { error, kind } of cases) {
    test(`${error.name} carries kind "${kind}"`, () => {
      // a subclass field initializer must win over the base class default
      assert.equal(error.kind, kind);
    });
  }

  test("kinds are unique across the error classes", () => {
    const kinds = cases.map(({ kind }) => kind);
    assert.equal(new Set(kinds).size, kinds.length);
  });

  test("kind survives a spread, unlike a prototype check", () => {
    const error = new TimeoutError("x", context);
    const copy = { ...error };
    assert.equal(copy.kind, "TimeoutError");
    assert.equal(copy instanceof TimeoutError, false);
  });
});

describe("http_client base_url validation", () => {
  const endpoints = { users: { list: new Endpoint({ method: "GET", pathname: "/users" }) } };

  test("throws a TypeError at construction when base_url is not absolute", () => {
    assert.throws(() => http_client(endpoints, { base_url: "/api" }), {
      name: "TypeError",
      message: /Invalid base_url: \/api/,
    });
  });

  test("throws before any endpoint function is built", () => {
    let built = 0;
    const counting_endpoints = {
      get counted() {
        built++;
        return new Endpoint({ method: "GET", pathname: "/users" });
      },
    };

    assert.throws(() => http_client(counting_endpoints, { base_url: "not a url" }), TypeError);
    assert.equal(built, 0);
  });

  test("accepts a valid base_url", () => {
    const api = http_client(endpoints, { base_url: API_BASE_URL });
    assert.equal(typeof api.users.list, "function");
  });
});
