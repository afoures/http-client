import { describe, test, before, after, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fetch_endpoint_factory, http_client } from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import { MissingParamsError, PathnameError } from "./pathname.ts";
import { default_retry_condition } from "./utils.ts";
import {
  default_retry_condition as entry_point_retry_condition,
  MissingParamsError as entry_point_missing_params_error,
  PathnameError as entry_point_pathname_error,
} from "../index.ts";
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

/**
 * Wraps `fetch` so the request the client built can be asserted on after the call, instead of
 * inside an msw handler that silently never runs when the URL does not match. The clone keeps the
 * body readable after the real request has consumed it.
 */
function capturing_fetch() {
  const requests: Request[] = [];
  return {
    requests,
    last: () => {
      const request = requests.at(-1);
      assert.ok(request, "no request reached fetch");
      return request;
    },
    custom_fetch: (request: Request) => {
      requests.push(request.clone());
      return fetch(request);
    },
  };
}

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
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users/(:id)" },
      {
        responses: {
          200: {
            schema: z.object({ id: z.string(), name: z.string() }),
            parse: "json",
          },
        },
      },
    );

    server.use(
      http.get(`${API_BASE_URL}/users/:id`, ({ params }) => {
        return HttpResponse.json({ id: params.id, name: "John" });
      }),
    );

    const captured = capturing_fetch();
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: captured.custom_fetch,
    });

    const result = await fetch_endpoint({ params: { id: "123" } });

    assert.equal(captured.last().url, `${API_BASE_URL}/users/123`);
    assert.equal(captured.last().method, "GET");
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { id: "123", name: "John" });
  });

  test("an optional-group param passed as undefined drops its segment", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users(/:id)" });

    server.use(http.get(`${API_BASE_URL}/users`, () => HttpResponse.json({ users: [] })));

    const captured = capturing_fetch();
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: captured.custom_fetch,
    });

    const result = await fetch_endpoint({ params: { id: undefined } });

    assert.equal(captured.last().url, `${API_BASE_URL}/users`);
    assert.ok(!(result instanceof Error));
    assert.equal(result.status, 200);
  });

  test("request with query parameters", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        query: {
          schema: z.object({
            page: z.number().transform(String),
            limit: z.number().transform(String),
          }),
          serialize: "urlencoded",
        },
      },
    );

    server.use(http.get(`${API_BASE_URL}/users`, () => HttpResponse.json({ users: [] })));

    const captured = capturing_fetch();
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: captured.custom_fetch,
    });

    const result = await fetch_endpoint({ query: { page: 1, limit: 10 } });

    const url = new URL(captured.last().url);
    assert.equal(url.pathname, "/users");
    assert.equal(url.searchParams.get("page"), "1");
    assert.equal(url.searchParams.get("limit"), "10");
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
  });

  test("POST request with body serialize", async () => {
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/users" },
      {
        body: {
          schema: z.object({ name: z.string(), email: z.string() }),
          serialize: "json",
        },
      },
    );

    server.use(
      http.post(`${API_BASE_URL}/users`, () => HttpResponse.json({ id: "123" }, { status: 201 })),
    );

    const captured = capturing_fetch();
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: captured.custom_fetch,
    });

    const result = await fetch_endpoint({ body: { name: "John", email: "john@example.com" } });

    const sent = captured.last();
    assert.equal(sent.method, "POST");
    assert.equal(sent.headers.get("content-type"), "application/json");
    assert.deepEqual(await sent.json(), { name: "John", email: "john@example.com" });
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
    assert.equal(result.status, 201);
  });

  test("custom headers merging", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {},
      {
        headers: { "X-Default": "default-value" },
      },
    );

    server.use(http.get(`${API_BASE_URL}/users`, () => HttpResponse.json({})));

    const captured = capturing_fetch();
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: captured.custom_fetch,
    });

    const result = await fetch_endpoint({ headers: { "X-Custom": "custom-value" } });

    assert.equal(captured.last().headers.get("x-default"), "default-value");
    assert.equal(captured.last().headers.get("x-custom"), "custom-value");
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
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
        endpoint: new Endpoint({ method: "GET", pathname: "/users" }, {}, endpoint_options),
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
        // four attempts with 50ms delays would run past 150ms if the delays were unbounded
        assert.ok(elapsed < 400, `expected the call to end near 100ms, took ${elapsed}ms`);
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
        assert.equal(attempts(), 4, "the first request plus three retries");
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
        // twenty cut attempts at 30ms each would run past 600ms if the deadline did not end the call
        assert.ok(elapsed < 600, `expected the call to end near 200ms, took ${elapsed}ms`);
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
          `expected the fourth response, got ${result instanceof Error ? `${result.name}: ${result.message}` : "success"}`,
        );
        assert.equal(result.status, 503);
        assert.equal(attempts(), 4);
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

        assert.deepEqual(seen, ["TimeoutError", "TimeoutError", "TimeoutError", "TimeoutError"]);
        assert.equal(attempts(), 4);
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
        assert.equal(result.context.timing?.attempt, 1, "reports the attempt that just completed");
        assert.deepEqual(result.context.request?.timeout, undefined);
      });

      test("a caller-supplied timeout signal firing mid-fetch yields a TimeoutError", async () => {
        const attempts = serve_slow(200);
        const fetch_endpoint = make_client();

        const result = await fetch_endpoint({
          signal: AbortSignal.timeout(30),
          retry: { attempts: 3 },
        });

        assert.ok(
          result instanceof TimeoutError,
          `expected TimeoutError, got ${result instanceof Error ? result.name : "success"}`,
        );
        assert.doesNotMatch(result.message, /Call deadline/);
        assert.equal(result.context.operation, "fetch");
        assert.equal(attempts(), 1, "a caller signal is terminal, so nothing is retried");
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

      test("`Infinity` is rejected the same way, since it cannot become a timer", async () => {
        const attempts = serve_slow(200);
        const fetch_endpoint = make_client();

        const result = await fetch_endpoint({ timeout: { total: Number.POSITIVE_INFINITY } });

        assert.ok(result instanceof UnexpectedError);
        assert.equal(result.context.operation, "resolve_timeout");
        assert.match(result.message, /timeout\.total/);
        assert.equal(attempts(), 0);
      });

      test("the `attempt` key is validated too, and the error names it", async () => {
        const attempts = serve_slow(200);
        const fetch_endpoint = make_client();

        const result = await fetch_endpoint({ timeout: { attempt: Number.NaN } });

        assert.ok(result instanceof UnexpectedError);
        assert.equal(result.context.operation, "resolve_timeout");
        assert.match(result.message, /timeout\.attempt/);
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

  test("a signal already aborted before the call never reaches fetch", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });
    let fetch_calls = 0;

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: async () => {
        fetch_calls++;
        return HttpResponse.json({});
      },
    });

    const result = await fetch_endpoint({ signal: AbortSignal.abort() });

    assert.ok(result instanceof AbortedError);
    assert.equal(result.context.operation, "fetch");
    assert.equal(result.context.timing?.attempt, 0);
    assert.equal(fetch_calls, 0);
  });

  test("a signal aborted while fetch is in flight is an AbortedError naming the attempt", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });
    const controller = new AbortController();

    // Deterministic: the abort is raised from inside the fetch, once the request is in flight,
    // and the fetch rejects the way a real one does, with the signal's reason.
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: (request) =>
        new Promise<Response>((_, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason));
          controller.abort();
        }),
    });

    const result = await fetch_endpoint({ signal: controller.signal, retry: { attempts: 2 } });

    assert.ok(result instanceof AbortedError);
    assert.equal(result.context.operation, "fetch");
    assert.equal(result.context.timing?.attempt, 1, "a caller abort is terminal: no retry");
    assert.ok(result.cause instanceof DOMException);
    assert.equal(result.cause.name, "AbortError");
  });

  test("AbortSignal handling - after request", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/posts/:id" },
      {
        responses: {
          200: {
            schema: z.object({ id: z.number(), title: z.string() }),
            parse: "json",
          },
        },
      },
    );

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

  test("retry exhaustion - returns error", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });

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
    assert.equal(attemptCount, 3, "the first request plus two retries");
  });

  test("retry with custom condition", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });

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
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });

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
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });

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
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });

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
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });

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
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });

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
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });

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
      { method: "GET", pathname: "/users" },
      {},
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
      { method: "GET", pathname: "/users" },
      {},
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
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/users" },
      { body: { schema: z.object({ name: z.string() }), serialize: "json" } },
    );

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
      { method: "GET", pathname: "/users" },
      {},
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
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users/(:id)" },
      {
        params: {
          schema: z.object({ id: z.string().min(1) }),
        },
      },
    );

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
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/users" },
      {
        body: {
          schema: z.object({ name: z.string().min(1) }),
          serialize: "json",
        },
      },
    );

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

    assert.ok(result instanceof ParseError);
    assert.equal(result.context.operation, "parse_response");
    // The one read already happened, so the text `JSON.parse` choked on is reported from where it
    // was read rather than by going back to the body for a second look.
    assert.equal(result.context.response?.body, "invalid json {");
  });

  test("network error handling", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });

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
    assert.equal(result.context.operation, "fetch");
    assert.equal(result.context.request?.url, `${API_BASE_URL}/users`);
    assert.equal(result.context.request?.method, "GET");
    assert.equal(result.context.timing?.attempt, 1);
    assert.equal(typeof result.context.timing?.duration, "number");
    assert.ok(result.cause instanceof TypeError, "the fetch rejection is carried as the cause");
  });

  test("default options from get_default_options", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });

    server.use(http.get(`${API_BASE_URL}/users`, () => HttpResponse.json({})));

    const captured = capturing_fetch();
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: captured.custom_fetch,
      get_default_options: () => ({ headers: { "X-Default": "default-value" } }),
    });

    const result = await fetch_endpoint({});

    assert.equal(captured.last().headers.get("x-default"), "default-value");
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
  });

  test("no retry on success", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });

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

  test("an async get_default_options factory is awaited, and invoked once per call", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });
    let factory_calls = 0;

    server.use(http.get(`${API_BASE_URL}/users`, () => HttpResponse.json({})));

    const captured = capturing_fetch();
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: captured.custom_fetch,
      get_default_options: async () => {
        factory_calls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { headers: { "X-Async": `call-${factory_calls}` } };
      },
    });

    const first = await fetch_endpoint({});
    const second = await fetch_endpoint({});

    assert.ok(!(first instanceof Error));
    assert.ok(!(second instanceof Error));
    assert.equal(factory_calls, 2, "the factory is not cached across calls");
    assert.deepEqual(
      captured.requests.map((request) => request.headers.get("x-async")),
      ["call-1", "call-2"],
    );
  });

  test("DELETE request with body", async () => {
    const endpoint = new Endpoint(
      { method: "DELETE", pathname: "/users/(:id)" },
      {
        body: {
          schema: z.object({ reason: z.string() }),
          serialize: "json",
        },
      },
    );

    server.use(
      http.delete(`${API_BASE_URL}/users/:id`, () => new HttpResponse(null, { status: 204 })),
    );

    const captured = capturing_fetch();
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: captured.custom_fetch,
    });

    const result = await fetch_endpoint({
      params: { id: "123" },
      body: { reason: "inactive" },
    });

    assert.equal(captured.last().method, "DELETE");
    assert.deepEqual(await captured.last().json(), { reason: "inactive" });
    assert.ok(!(result instanceof Error));
    assert.equal(result.status, 204);
    assert.equal(result.data, null);
  });

  test("standard RequestInit options reach fetch on the built Request", async () => {
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {},
      { credentials: "include" },
    );

    server.use(http.get(`${API_BASE_URL}/users`, () => HttpResponse.json({})));

    const captured = capturing_fetch();
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: captured.custom_fetch,
    });

    const result = await fetch_endpoint({ cache: "no-store", redirect: "manual" });

    assert.ok(!(result instanceof Error));
    assert.equal(captured.last().credentials, "include", "from the endpoint options");
    assert.equal(captured.last().cache, "no-store", "from the call");
    assert.equal(captured.last().redirect, "manual");
  });

  test("retry with attempts as function", async () => {
    const endpoint = new Endpoint({ method: "GET", pathname: "/users" });

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
    const endpoint = new Endpoint(
      { method: "GET", pathname: "/users" },
      {
        responses: {
          404: {
            schema: z.object({ message: z.string() }),
            parse: "json",
          },
        },
      },
    );

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
      {},
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

    const endpoint = new Endpoint({ method: "GET", pathname: "/slow" }, {}, { timeout: 10 });

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
      {},
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
    const endpoint = new Endpoint(
      { method: "POST", pathname: "/upload" },
      {
        body: {
          schema: z.object({ data: z.string() }),
          serialize: (data) => ({
            body: data.data,
            content_type: "text/plain",
          }),
        },
      },
    );

    server.use(http.post(`${API_BASE_URL}/upload`, () => HttpResponse.json({})));

    const captured = capturing_fetch();
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: captured.custom_fetch,
    });

    const result = await fetch_endpoint({ body: { data: "test" } });

    assert.equal(captured.last().headers.get("content-type"), "text/plain");
    assert.equal(await captured.last().text(), "test");
    assert.ok(!(result instanceof Error));
    assert.equal(result.ok, true);
  });

  describe("Content-Type ownership", () => {
    const bodiless = new Endpoint(
      { method: "GET", pathname: "/x" },
      {},
      {
        headers: { "Content-Type": "application/vnd.endpoint" },
      },
    );
    const json_body = new Endpoint(
      { method: "POST", pathname: "/x" },
      { body: { schema: z.object({ a: z.number() }), serialize: "json" } },
      { headers: { "Content-Type": "application/vnd.endpoint" } },
    );

    function client_for(endpoint: typeof bodiless | typeof json_body) {
      const captured = capturing_fetch();
      const fetch_endpoint = fetch_endpoint_factory({
        base_url: API_BASE_URL,
        endpoint: endpoint as typeof json_body,
        custom_fetch: async (request) => {
          captured.requests.push(request.clone());
          return new Response(null, { status: 204 });
        },
        get_default_options: () => ({ headers: { "Content-Type": "application/vnd.client" } }),
      });
      return { fetch_endpoint, captured };
    }

    test("a request without a body sends no Content-Type, whatever the headers say", async () => {
      const { fetch_endpoint, captured } = client_for(bodiless);

      await fetch_endpoint({ headers: { "Content-Type": "application/vnd.call" } } as never);

      assert.equal(captured.last().headers.has("content-type"), false);
    });

    test("a request with a body sends the serializer's Content-Type over every layer", async () => {
      const { fetch_endpoint, captured } = client_for(json_body);

      await fetch_endpoint({
        body: { a: 1 },
        headers: { "Content-Type": "application/vnd.call" },
      });

      assert.equal(captured.last().headers.get("content-type"), "application/json");
    });

    test("a FormData body gets the runtime's Content-Type, boundary included", async () => {
      const upload = new Endpoint(
        { method: "POST", pathname: "/x" },
        {
          body: {
            schema: z.object({ name: z.string() }),
            serialize: (data) => {
              const form = new FormData();
              form.append("name", data.name);
              return { body: form };
            },
          },
        },
      );
      let sent: Request | undefined;
      const fetch_endpoint = fetch_endpoint_factory({
        base_url: API_BASE_URL,
        endpoint: upload,
        custom_fetch: async (request) => {
          sent = request;
          return new Response(null, { status: 204 });
        },
      });

      await fetch_endpoint({
        body: { name: "x" },
        headers: { "Content-Type": "multipart/form-data" },
      });

      assert.ok(sent);
      assert.match(sent.headers.get("content-type") ?? "", /^multipart\/form-data; boundary=/);
      assert.equal((await sent.formData()).get("name"), "x");
    });
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
      assert.equal(attempts(), 4);
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
      assert.equal(attempts(), 4);
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
        assert.equal(attempts(), 4);
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
      assert.equal(attempts(), 4);
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
      assert.equal(entry_point_retry_condition, default_retry_condition);
    });

    test("a per-call `when: undefined` inherits the client-level condition", async () => {
      let attempts = 0;
      server.use(
        http.get(`${API_BASE_URL}/users`, () => {
          attempts++;
          return HttpResponse.json({ error: "bad request" }, { status: 400 });
        }),
      );
      const fetch_endpoint = fetch_endpoint_factory({
        base_url: API_BASE_URL,
        endpoint: new Endpoint({ method: "GET", pathname: "/users" }),
        custom_fetch: fetch,
        get_default_options: () => ({ retry: { when: () => true, attempts: 2 } }),
      });

      await fetch_endpoint({});
      assert.equal(attempts, 3, "the client-level policy retries a 400 twice");

      attempts = 0;
      // The shape a wrapper forwarding an optional option produces: the key is present, its value
      // is not. It must read as "not set here", not as "reset to the default condition".
      await fetch_endpoint({ retry: { when: undefined, attempts: undefined } });
      assert.equal(attempts, 3);
    });

    test("a throwing `attempts` or `delay` callback ends the call without re-consulting `when`", async () => {
      for (const broken of ["attempts", "delay"] as const) {
        let attempts = 0;
        let when_calls = 0;
        server.use(
          http.get(`${API_BASE_URL}/users`, () => {
            attempts++;
            return HttpResponse.json({}, { status: 503 });
          }),
        );
        const fetch_endpoint = fetch_endpoint_factory({
          base_url: API_BASE_URL,
          endpoint: new Endpoint({ method: "GET", pathname: "/users" }),
          custom_fetch: fetch,
        });

        const result = await fetch_endpoint({
          retry: {
            when: () => {
              when_calls++;
              return true;
            },
            attempts:
              broken === "attempts"
                ? () => {
                    throw new Error("attempts blew up");
                  }
                : 3,
            delay:
              broken === "delay"
                ? () => {
                    throw new Error("delay blew up");
                  }
                : 0,
          },
        });

        assert.ok(result instanceof UnexpectedError, `${broken}: got ${String(result)}`);
        assert.equal(result.context.operation, "retry_policy");
        assert.equal((result.cause as Error).message, `${broken} blew up`);
        assert.equal(result.context.timing?.attempt, 1);
        assert.equal(attempts, 1, `${broken}: no second request`);
        assert.equal(when_calls, 1, `${broken}: \`when\` runs once, before the callback threw`);
      }
    });

    test("`when: () => true` retries a 200 too, and only the last response is parsed", async () => {
      let attempts = 0;
      let parse_calls = 0;
      const parsed_endpoint = new Endpoint(
        { method: "GET", pathname: "/users" },
        {
          responses: {
            200: {
              schema: z.object({ attempt: z.number() }),
              parse: async (body) => {
                parse_calls++;
                return new Response(body).json();
              },
            },
          },
        },
      );
      const fetch_endpoint = fetch_endpoint_factory({
        base_url: API_BASE_URL,
        endpoint: parsed_endpoint,
        custom_fetch: async () => {
          attempts++;
          return Response.json({ attempt: attempts });
        },
      });

      const result = await fetch_endpoint({ retry: { attempts: 2, when: () => true } });

      assert.ok(!(result instanceof Error), `got ${String(result)}`);
      assert.ok(result.ok);
      assert.equal(attempts, 3);
      assert.equal(parse_calls, 1, "a response retried away is never parsed");
      assert.deepEqual(result.data, { attempt: 3 });
    });
  });
});

describe("response body ownership", () => {
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

  const endpoint = new Endpoint({ method: "GET", pathname: "/users" });

  test("cancels the body of an attempt it retries away", async () => {
    const first = open_body("first attempt, never read");
    let attempts = 0;

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: () => {
        attempts++;
        return Promise.resolve(
          attempts === 1
            ? new Response(first.body, { status: 503 })
            : new Response("ok", { status: 200 }),
        );
      },
    });

    const result = await fetch_endpoint({ retry: { attempts: 2 } });

    assert.ok(!(result instanceof Error));
    assert.equal(attempts, 2);
    assert.equal(first.was_cancelled(), true);
  });

  test("cancels the body of a response abandoned to an error", async () => {
    const { body, was_cancelled } = open_body("never parsed");

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: () => Promise.resolve(new Response(body, { status: 500 })),
    });

    const result = await fetch_endpoint({
      retry: {
        when: () => {
          throw new Error("policy blew up");
        },
      },
    });

    assert.ok(result instanceof UnexpectedError);
    assert.equal(result.context.operation, "retry_policy");
    assert.equal(was_cancelled(), true);
  });

  test("hands the retry callbacks metadata, never the request or the response", async () => {
    const seen: Array<Record<string, unknown>> = [];
    let attempts = 0;

    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch: () => {
        attempts++;
        return Promise.resolve(new Response("body", { status: attempts === 1 ? 503 : 200 }));
      },
    });

    const result = await fetch_endpoint({
      retry: {
        attempts: 1,
        when: ({ request, response }) => {
          seen.push(request, response as Record<string, unknown>);
          return true;
        },
        delay: ({ request, response }) => {
          seen.push(request, response as Record<string, unknown>);
          return 0;
        },
        recover: ({ request, response }) => {
          seen.push(request, response as Record<string, unknown>);
        },
      },
    });

    assert.ok(!(result instanceof Error));
    assert.equal(attempts, 2);
    // Plain objects: no `Request`, no `Response`, and so no way to reach a body from a callback.
    for (const value of seen) {
      assert.equal(value instanceof Request, false);
      assert.equal(value instanceof Response, false);
      assert.equal("body" in value, false);
      assert.equal("json" in value, false);
    }
    // `when` twice, `delay` and `recover` once each (the single retry allowed is spent before they
    // run again), two values apiece.
    assert.equal(seen.length, 8);
  });
});

describe("audit follow-ups", () => {
  const endpoint = new Endpoint({ method: "GET", pathname: "/x" });

  function client_for(
    custom_fetch: (request: Request) => Promise<Response>,
    get_default_options?: () => Promise<HTTPFetch.OptionalRequestInit>,
  ) {
    return fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint,
      custom_fetch,
      get_default_options,
    });
  }

  /** A fetch that honors its signal and otherwise answers `204` after `ms`. */
  function slow_fetch(ms: number) {
    return (request: Request) =>
      new Promise<Response>((resolve, reject) => {
        const token = setTimeout(() => resolve(new Response(null, { status: 204 })), ms);
        request.signal.addEventListener("abort", () => {
          clearTimeout(token);
          reject(request.signal.reason);
        });
      });
  }

  describe("a timeout during the body read", () => {
    /**
     * The first request gets its headers and half a JSON body, then the connection is held open;
     * every later request completes. `msw` cannot stall mid-body, hence a real server.
     */
    let server: Server;
    let base_url: string;
    let requests = 0;

    before(async () => {
      server = createServer((_, response) => {
        requests++;
        response.writeHead(200, { "content-type": "application/json" });
        if (requests === 1) response.write('{"a":');
        else response.end('{"a":1}');
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      base_url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    after(() => {
      server.closeAllConnections();
      server.close();
    });

    beforeEach(() => {
      requests = 0;
    });

    const json_endpoint = new Endpoint(
      { method: "GET", pathname: "/slow" },
      { responses: { 200: { schema: z.record(z.string(), z.unknown()), parse: "json" } } },
    );

    function stalled_client() {
      return fetch_endpoint_factory({ base_url, endpoint: json_endpoint, custom_fetch: fetch });
    }

    test("a `total` expiry is a terminal TimeoutError naming the deadline", async () => {
      const seen: Array<string | undefined> = [];
      const result = await stalled_client()({
        timeout: { total: 50 },
        retry: {
          attempts: 3,
          when: ({ error }) => {
            seen.push(error?.kind);
            return error !== undefined;
          },
        },
      });

      assert.ok(result instanceof TimeoutError, `got ${String(result)}`);
      assert.match(result.message, /Call deadline of 50ms exceeded/);
      assert.equal(result.context.operation, "parse_response");
      assert.equal(result.context.response?.status, 200);
      // `when` saw the 200 before its body was read, and never the blown deadline
      assert.deepEqual(seen, [undefined]);
      assert.equal(requests, 1);
    });

    test("an `attempt` expiry is offered to `when` with the response metadata, and retried", async () => {
      const seen: Array<{ status: number | undefined; error: string | undefined }> = [];
      const result = await stalled_client()({
        timeout: { attempt: 50 },
        retry: {
          attempts: 2,
          when: (ctx) => {
            seen.push({ status: ctx.response?.status, error: ctx.error?.kind });
            return default_retry_condition(ctx);
          },
        },
      });

      assert.ok(!(result instanceof Error), `got ${String(result)}`);
      assert.ok(result.ok);
      assert.deepEqual(result.data, { a: 1 });
      assert.equal(requests, 2);
      // `when` runs on the 200's metadata before the body is read (so a retried response is never
      // read), then again once the body read timed out, with the lost response alongside the
      // error, then on the completed 200
      assert.deepEqual(seen, [
        { status: 200, error: undefined },
        { status: 200, error: "TimeoutError" },
        { status: 200, error: undefined },
      ]);
    });

    test("an `attempt` expiry with no retries left is a TimeoutError with `parse_response`", async () => {
      const result = await stalled_client()({ timeout: { attempt: 50 } });

      assert.ok(result instanceof TimeoutError, `got ${String(result)}`);
      assert.doesNotMatch(result.message, /Call deadline/);
      assert.equal(result.context.operation, "parse_response");
      assert.equal(result.context.response?.status, 200);
      assert.equal(requests, 1);
    });

    test("a caller abort mid-body is an AbortedError", async () => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 50);
      const result = await stalled_client()({ signal: controller.signal, retry: { attempts: 2 } });

      assert.ok(result instanceof AbortedError, `got ${String(result)}`);
      assert.equal(result.context.operation, "parse_response");
      assert.equal(requests, 1);
    });
  });

  test("a schema ParseError is never offered to `when`", async () => {
    let calls = 0;
    let when_calls = 0;
    const typed = new Endpoint(
      { method: "GET", pathname: "/x" },
      { responses: { 200: { schema: z.object({ a: z.number() }), parse: "json" } } },
    );
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint: typed,
      custom_fetch: async () => {
        calls++;
        return Response.json({ a: "not a number" });
      },
    });

    const result = await fetch_endpoint({
      retry: {
        attempts: 2,
        when: ({ error }) => {
          when_calls++;
          return error !== undefined;
        },
      },
    });

    assert.ok(result instanceof ParseError);
    assert.equal(calls, 1);
    assert.equal(when_calls, 1, "`when` runs once, on the response, before parsing");
  });

  test("`attempt: 0` is already expired, even for a fetch that ignores its signal", async () => {
    let calls = 0;
    const seen: Array<string | undefined> = [];
    const fetch_endpoint = client_for(async () => {
      calls++;
      return new Response(null, { status: 204 });
    });

    const result = await fetch_endpoint({
      timeout: { attempt: 0 },
      retry: {
        attempts: 2,
        when: (ctx) => {
          seen.push(ctx.error?.kind);
          return default_retry_condition(ctx);
        },
      },
    });

    assert.ok(result instanceof TimeoutError, `got ${String(result)}`);
    assert.doesNotMatch(result.message, /Call deadline/);
    assert.equal(result.context.operation, "fetch");
    assert.equal(calls, 0, "an expired attempt must not reach fetch");
    assert.deepEqual(seen, ["TimeoutError", "TimeoutError", "TimeoutError"]);
  });

  test("an async `options()` factory counts against `total`", async () => {
    let calls = 0;
    const fetch_endpoint = client_for(
      async () => {
        calls++;
        return new Response(null, { status: 204 });
      },
      () => new Promise((resolve) => setTimeout(() => resolve({}), 60)),
    );
    const started = Date.now();

    const result = await fetch_endpoint({ timeout: 10 });

    assert.ok(result instanceof TimeoutError, `got ${String(result)}`);
    assert.match(result.message, /Call deadline of 10ms exceeded/);
    assert.equal(calls, 0);
    assert.ok(Date.now() - started < 200);
  });

  test("the deadline is measured from before the `options()` factory ran", async () => {
    /**
     * The factory eats 100ms of a 120ms budget. Measured from the start of the call, the deadline
     * fires about 20ms into the fetch (near 120ms in total); measured after the factory it would
     * fire at 220ms. The 200ms cutoff sits between the two, so a regression fails.
     */
    const fetch_endpoint = client_for(
      slow_fetch(500),
      () => new Promise((resolve) => setTimeout(() => resolve({}), 100)),
    );
    const started = Date.now();

    const result = await fetch_endpoint({ timeout: { total: 120 } });
    const elapsed = Date.now() - started;

    assert.ok(result instanceof TimeoutError, `got ${String(result)}`);
    assert.match(result.message, /Call deadline of 120ms exceeded/);
    assert.ok(elapsed < 200, `expected the call to end near 120ms, took ${elapsed}ms`);
  });

  test("`attempts` counts retries after the first request", async () => {
    let calls = 0;
    const fetch_endpoint = client_for(async () => {
      calls++;
      return new Response("", { status: 500 });
    });

    calls = 0;
    await fetch_endpoint({ retry: { attempts: 0 } });
    assert.equal(calls, 1, "attempts: 0 is a single request");

    calls = 0;
    await fetch_endpoint({ retry: { attempts: 1 } });
    assert.equal(calls, 2, "attempts: 1 is the request plus one retry");

    calls = 0;
    await fetch_endpoint({ retry: { when: () => true } });
    assert.equal(calls, 1, "`when` alone never retries, since attempts defaults to 0");
  });

  test("`recover` returning `{ headers: undefined }` keeps the current headers", async () => {
    const authorization_per_attempt: Array<string | null> = [];
    const fetch_endpoint = client_for(async (request) => {
      authorization_per_attempt.push(request.headers.get("authorization"));
      return new Response("", { status: authorization_per_attempt.length === 1 ? 500 : 200 });
    });

    await fetch_endpoint({
      headers: { authorization: "Bearer token" },
      retry: { attempts: 1, recover: () => ({ headers: undefined }) },
    });

    assert.deepEqual(authorization_per_attempt, ["Bearer token", "Bearer token"]);
  });

  describe("a ReadableStream body", () => {
    const upload = new Endpoint(
      { method: "POST", pathname: "/x" },
      {
        body: {
          schema: z.object({ a: z.number() }),
          serialize: (data) => ({
            body: new Blob([JSON.stringify(data)]).stream(),
            content_type: "application/json",
          }),
        },
      },
    );

    test("is sent", async () => {
      let received: string | undefined;
      const fetch_endpoint = fetch_endpoint_factory({
        base_url: API_BASE_URL,
        endpoint: upload,
        custom_fetch: async (request) => {
          received = await request.text();
          return new Response(null, { status: 204 });
        },
      });

      const result = await fetch_endpoint({ body: { a: 1 } });

      assert.ok(!(result instanceof Error), `got ${String(result)}`);
      assert.equal(received, '{"a":1}');
    });

    test("cannot be retried: the stream is spent by the first attempt", async () => {
      let calls = 0;
      const fetch_endpoint = fetch_endpoint_factory({
        base_url: API_BASE_URL,
        endpoint: upload,
        custom_fetch: async (request) => {
          calls++;
          await request.text();
          return new Response("", { status: 500 });
        },
      });

      const result = await fetch_endpoint({ body: { a: 1 }, retry: { attempts: 1 } });

      assert.ok(result instanceof UnexpectedError, `got ${String(result)}`);
      assert.equal(result.context.operation, "create_request");
      assert.equal(calls, 1);
    });
  });

  test("a missing or empty param is a SerializationError, not an UnexpectedError", async () => {
    const with_param = new Endpoint({ method: "GET", pathname: "/users/:id" });
    const fetch_endpoint = fetch_endpoint_factory({
      base_url: API_BASE_URL,
      endpoint: with_param,
      custom_fetch: async () => new Response(null, { status: 204 }),
    });

    const empty = await fetch_endpoint({ params: { id: "" } });
    assert.ok(empty instanceof SerializationError, `got ${String(empty)}`);
    assert.equal(empty.context.operation, "generate_url");
    assert.ok(empty.cause instanceof PathnameError);

    const missing = await fetch_endpoint({ params: { id: undefined as unknown as string } });
    assert.ok(missing instanceof SerializationError, `got ${String(missing)}`);
    assert.ok(missing.cause instanceof MissingParamsError);
    assert.deepEqual(missing.cause.missing_params, ["id"]);

    const dotted = await fetch_endpoint({ params: { id: ".." } });
    assert.ok(dotted instanceof SerializationError, `got ${String(dotted)}`);
    assert.ok(dotted.cause instanceof PathnameError);
  });

  test("PathnameError and MissingParamsError are exported from the package entry point", () => {
    assert.equal(entry_point_pathname_error, PathnameError);
    assert.equal(entry_point_missing_params_error, MissingParamsError);
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

describe("http_client endpoint tree", () => {
  test("a nested tree mirrors its shape, and a leaf two levels down calls through", async () => {
    const seen_urls: string[] = [];
    const api = http_client(
      {
        posts: {
          comments: {
            list: new Endpoint(
              { method: "GET", pathname: "/posts/:post_id/comments" },
              { responses: { 200: { schema: z.array(z.string()), parse: "json" } } },
            ),
          },
          get: new Endpoint({ method: "GET", pathname: "/posts/:id" }),
        },
      },
      {
        base_url: API_BASE_URL,
        fetch: async (request) => {
          seen_urls.push(request.url);
          return Response.json(["first"]);
        },
      },
    );

    const comments = await api.posts.comments.list({ params: { post_id: "7" } });
    const post = await api.posts.get({ params: { id: "7" } });

    assert.ok(!(comments instanceof Error));
    assert.ok(comments.ok);
    assert.deepEqual(comments.data, ["first"]);
    assert.ok(!(post instanceof Error));
    assert.equal(post.status, 200);
    assert.deepEqual(seen_urls, [`${API_BASE_URL}/posts/7/comments`, `${API_BASE_URL}/posts/7`]);
  });

  test("a 1xx response is an UnexpectedError, since no envelope covers it", async () => {
    // `new Response()` refuses a 1xx status, so the status is overridden on the instance the way a
    // proxied or hand-rolled fetch could hand one over.
    const informational = new Response(null, { status: 200 });
    Object.defineProperty(informational, "status", { value: 101 });

    const api = http_client(
      { probe: new Endpoint({ method: "GET", pathname: "/x" }) },
      { base_url: API_BASE_URL, fetch: async () => informational },
    );

    const result = await api.probe({});

    assert.ok(result instanceof UnexpectedError, `got ${String(result)}`);
    assert.equal(result.context.operation, "parse_response");
    assert.equal(result.context.response?.status, 101);
    assert.match(result.message, /Unhandled status code: 101/);
  });

  test("a redirect without a Location header has `redirect_to: null`", async () => {
    const api = http_client(
      { probe: new Endpoint({ method: "GET", pathname: "/x" }) },
      { base_url: API_BASE_URL, fetch: async () => new Response(null, { status: 304 }) },
    );

    const result = await api.probe({});

    assert.ok(!(result instanceof Error));
    assert.equal(result.kind, "RedirectMessage");
    assert.equal(result.status, 304);
    assert.equal(result.ok, false);
    assert.equal(result.redirect_to, null);
  });

  test("a client-level signal and a per-call signal both abort an in-flight request", async () => {
    /** A fetch that aborts `to_abort` once the request is in flight, then rejects like a real one. */
    function api_aborting(to_abort: AbortController, client_signal: AbortSignal) {
      return http_client(
        { probe: new Endpoint({ method: "GET", pathname: "/x" }) },
        {
          base_url: API_BASE_URL,
          options: { signal: client_signal },
          fetch: (request) =>
            new Promise<Response>((_, reject) => {
              request.signal.addEventListener("abort", () => reject(request.signal.reason));
              to_abort.abort();
            }),
        },
      );
    }

    const client_controller = new AbortController();
    const call_controller = new AbortController();
    const from_call = await api_aborting(call_controller, client_controller.signal).probe({
      signal: call_controller.signal,
    });
    assert.ok(from_call instanceof AbortedError, "the per-call signal aborts");
    assert.equal(from_call.context.operation, "fetch");
    assert.equal(client_controller.signal.aborted, false, "without touching the client's");

    const other_client_controller = new AbortController();
    const other_call_controller = new AbortController();
    const from_client = await api_aborting(
      other_client_controller,
      other_client_controller.signal,
    ).probe({ signal: other_call_controller.signal });
    assert.ok(from_client instanceof AbortedError, "the client-level signal aborts too");
    assert.equal(other_call_controller.signal.aborted, false, "without touching the caller's");
  });
});

describe("dynamic (context-driven) schemas", () => {
  before(() => server.listen({ onUnhandledRequest: "bypass" }));
  after(() => server.close());
  afterEach(() => server.resetHandlers());

  test("response schema factory receives the per-call context", async () => {
    const api = http_client(
      {
        get: new Endpoint(
          { method: "GET", pathname: "/user" },
          (context: { expected_name: string }) => ({
            responses: {
              200: {
                schema: z.object({ id: z.string(), name: z.literal(context.expected_name) }),
                parse: "json",
              },
            },
          }),
        ),
      },
      { base_url: API_BASE_URL },
    );

    server.use(
      http.get(`${API_BASE_URL}/user`, () => HttpResponse.json({ id: "1", name: "John" })),
    );

    const ok = await api.get({ context: { expected_name: "John" } });
    assert.ok(!(ok instanceof Error));
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.data, { id: "1", name: "John" });

    const bad = await api.get({ context: { expected_name: "Jane" } });
    assert.ok(bad instanceof ParseError);
  });

  test("body serialize + response parse round-trip through context (out-of-band key)", async () => {
    const api = http_client(
      {
        put: new Endpoint({ method: "PUT", pathname: "/blob" }, (context: { key: string }) => ({
          body: {
            schema: z.object({ value: z.string() }),
            serialize: (value) => ({
              body: JSON.stringify({ value: value.value, key: context.key }),
              content_type: "application/json",
            }),
          },
          responses: {
            200: {
              schema: z.object({ value: z.string() }),
              parse: async (body) => {
                const text = await new Response(body).text();
                const parsed = JSON.parse(text) as { value: string; key: string };
                if (parsed.key !== context.key) throw new Error("key mismatch");
                return { value: parsed.value };
              },
            },
          },
        })),
      },
      { base_url: API_BASE_URL },
    );

    server.use(
      http.put(`${API_BASE_URL}/blob`, async ({ request }) => {
        const sent = (await request.json()) as { value: string; key: string };
        assert.equal(sent.key, "s3cr3t");
        return HttpResponse.json(sent);
      }),
    );

    const ok = await api.put({ body: { value: "hi" }, context: { key: "s3cr3t" } });
    assert.ok(!(ok instanceof Error));
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.data, { value: "hi" });
  });

  test("params and query schema factories receive the per-call context", async () => {
    const api = http_client(
      {
        get: new Endpoint(
          { method: "GET", pathname: "/tenants/:tenant/items" },
          (context: { tenant: string; locale: string }) => ({
            params: { schema: z.object({ tenant: z.literal(context.tenant) }) },
            query: { schema: z.object({ locale: z.literal(context.locale) }) },
            responses: { 200: { schema: z.object({ ok: z.boolean() }), parse: "json" } },
          }),
        ),
      },
      { base_url: API_BASE_URL },
    );

    server.use(
      http.get(`${API_BASE_URL}/tenants/acme/items`, () => HttpResponse.json({ ok: true })),
    );

    const ok = await api.get({
      params: { tenant: "acme" },
      query: { locale: "fr" },
      context: { tenant: "acme", locale: "fr" },
    });
    assert.ok(!(ok instanceof Error));
    assert.equal(ok.ok, true);

    // the context-built params schema rejects a value the context disagrees with
    const bad_params = await api.get({
      params: { tenant: "acme" },
      query: { locale: "fr" },
      context: { tenant: "other", locale: "fr" },
    });
    assert.ok(bad_params instanceof SerializationError);
    assert.equal(bad_params.context.operation, "generate_url");

    // and so does the context-built query schema
    const bad_query = await api.get({
      params: { tenant: "acme" },
      query: { locale: "fr" },
      context: { tenant: "acme", locale: "en" },
    });
    assert.ok(bad_query instanceof SerializationError);
    assert.equal(bad_query.context.operation, "generate_url");
  });

  test("a params/query serialize function receives the validated data and the context", async () => {
    let seen_url = "";
    const api = http_client(
      {
        get: new Endpoint(
          { method: "GET", pathname: "/tenants/:tenant/items" },
          (context: { tenant: string; page_size: number }) => ({
            params: {
              schema: z.object({ tenant: z.literal(context.tenant) }),
              serialize: (data) => ({ tenant: `${data.tenant}-${context.tenant}` }),
            },
            query: {
              schema: z.object({ q: z.string() }),
              serialize: (data) =>
                new URLSearchParams({ q: data.q, size: String(context.page_size) }),
            },
            responses: { 200: { schema: z.object({ ok: z.boolean() }), parse: "json" } },
          }),
        ),
      },
      { base_url: API_BASE_URL },
    );

    server.use(
      http.get(`${API_BASE_URL}/tenants/acme-acme/items`, ({ request }) => {
        seen_url = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );

    const ok = await api.get({
      params: { tenant: "acme" },
      query: { q: "socks" },
      context: { tenant: "acme", page_size: 25 },
    });
    assert.ok(!(ok instanceof Error));
    assert.equal(ok.ok, true);

    const url = new URL(seen_url);
    assert.equal(url.pathname, "/tenants/acme-acme/items");
    assert.equal(url.searchParams.get("q"), "socks");
    assert.equal(url.searchParams.get("size"), "25");
  });

  test("endpoint-level default context fills a key the call omits", async () => {
    const api = http_client(
      {
        get: new Endpoint(
          { method: "GET", pathname: "/user" },
          (context: { expected_name: string }) => ({
            responses: {
              200: {
                schema: z.object({ name: z.literal(context.expected_name) }),
                parse: "json",
              },
            },
          }),
          {
            context: {
              expected_name: "John",
            },
          },
        ),
      },
      { base_url: API_BASE_URL },
    );

    server.use(http.get(`${API_BASE_URL}/user`, () => HttpResponse.json({ name: "John" })));

    const ok = await api.get({});
    assert.ok(!(ok instanceof Error));
    assert.equal(ok.ok, true);
  });

  test("client-level default context applies, endpoint and per-call override it", async () => {
    const make = (per_call?: { tenant?: string }) =>
      http_client(
        {
          get: new Endpoint(
            { method: "GET", pathname: "/echo" },
            (context: { tenant: string }) => ({
              responses: {
                200: {
                  schema: z.object({ tenant: z.literal(context.tenant) }),
                  parse: "json",
                },
              },
            }),
          ),
        },
        { base_url: API_BASE_URL, context: { tenant: "client" } },
      ).get(per_call ? { context: per_call } : {});

    server.use(
      http.get(`${API_BASE_URL}/echo`, ({ request }) => {
        return HttpResponse.json({
          tenant: new URL(request.url).searchParams.get("t") ?? "client",
        });
      }),
    );

    const from_client = await make();
    assert.ok(!(from_client instanceof Error) && from_client.ok);

    const from_call = await make({ tenant: "other" });
    assert.ok(from_call instanceof ParseError);
  });

  test("context is never serialized into the outgoing request", async () => {
    let seen_url = "";
    let seen_body: string | null = null;
    const api = http_client(
      {
        post: new Endpoint(
          { method: "POST", pathname: "/things" },
          (_context: { secret: string }) => ({
            body: { schema: z.object({ name: z.string() }), serialize: "json" },
            responses: { 200: { schema: z.object({ ok: z.boolean() }), parse: "json" } },
          }),
        ),
      },
      { base_url: API_BASE_URL },
    );

    server.use(
      http.post(`${API_BASE_URL}/things`, async ({ request }) => {
        seen_url = request.url;
        seen_body = await request.text();
        return HttpResponse.json({ ok: true });
      }),
    );

    await api.post({ body: { name: "widget" }, context: { secret: "do-not-leak" } });
    assert.ok(!seen_url.includes("do-not-leak"), "context must not appear in the URL");
    assert.ok(!(seen_body ?? "").includes("do-not-leak"), "context must not appear in the body");
    assert.deepEqual(JSON.parse(seen_body ?? "{}"), { name: "widget" });
  });

  test("a throwing definition factory surfaces as UnexpectedError through the client", async () => {
    const api = http_client(
      {
        get: new Endpoint({ method: "GET", pathname: "/x" }, (_context: { key: string }) => {
          throw new Error("boom");
        }),
      },
      { base_url: API_BASE_URL },
    );

    const result = await api.get({ context: { key: "value" } });
    assert.ok(result instanceof UnexpectedError);
    assert.equal(result.context.operation, "resolve_definition");
    assert.equal((result.cause as Error)?.message, "boom");
  });

  test("the definition factory runs once per request, retries included", async () => {
    let calls = 0;
    let requests = 0;
    const api = http_client(
      {
        post: new Endpoint({ method: "POST", pathname: "/things" }, (context: { tag: string }) => {
          calls++;
          return {
            query: { schema: z.object({ tag: z.literal(context.tag) }) },
            body: { schema: z.object({ name: z.string() }), serialize: "json" as const },
            responses: { 200: { schema: z.object({ ok: z.boolean() }), parse: "json" as const } },
          };
        }),
      },
      {
        base_url: API_BASE_URL,
        fetch: async () => {
          requests++;
          return requests === 1 ? new Response(null, { status: 503 }) : Response.json({ ok: true });
        },
      },
    );

    const ok = await api.post({
      query: { tag: "a" },
      body: { name: "widget" },
      context: { tag: "a" },
      retry: { attempts: 1 },
    });
    assert.ok(!(ok instanceof Error));
    assert.equal(requests, 2);
    assert.equal(calls, 1, "the definition is resolved once, not once per attempt");
  });

  test("an endpoint-level context default wins over the client-level one", async () => {
    const api = http_client(
      {
        get: new Endpoint(
          { method: "GET", pathname: "/echo" },
          (context: { tenant: string }) => ({
            responses: {
              200: { schema: z.object({ tenant: z.literal(context.tenant) }), parse: "json" },
            },
          }),
          { context: { tenant: "endpoint" } },
        ),
      },
      {
        base_url: API_BASE_URL,
        context: { tenant: "client" },
        fetch: async () => Response.json({ tenant: "endpoint" }),
      },
    );

    const defaulted = await api.get({});
    assert.ok(!(defaulted instanceof Error), `got ${String(defaulted)}`);
    assert.ok(defaulted.ok);
    assert.deepEqual(defaulted.data, { tenant: "endpoint" });

    // an explicit `undefined` at the call site is "not set here", so the endpoint default holds
    const explicit_undefined = await api.get({ context: { tenant: undefined } });
    assert.ok(!(explicit_undefined instanceof Error), `got ${String(explicit_undefined)}`);
    assert.ok(explicit_undefined.ok);
    assert.deepEqual(explicit_undefined.data, { tenant: "endpoint" });

    const overridden = await api.get({ context: { tenant: "call" } });
    assert.ok(overridden instanceof ParseError, "the per-call value replaced the default");
  });
});
