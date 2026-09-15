import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  default_retry_condition,
  discard_body,
  merge_options,
  merge_headers,
  request_metadata,
  response_metadata,
  sleep,
} from "./utils.ts";
import { AbortedError, NetworkError, TimeoutError, UnexpectedError } from "./errors.ts";

describe("merge_headers", () => {
  test("basic header merging from plain object", () => {
    const result = merge_headers(
      { "Content-Type": "application/json" },
      { Authorization: "Bearer token" },
    );
    assert.equal(result.get("content-type"), "application/json");
    assert.equal(result.get("authorization"), "Bearer token");
  });

  test("header override - later sources win", () => {
    const result = merge_headers(
      { "Content-Type": "text/plain" },
      { "Content-Type": "application/json" },
    );
    assert.equal(result.get("content-type"), "application/json");
  });

  test("header case normalization", () => {
    const result = merge_headers(
      { "Content-Type": "application/json" },
      { "content-type": "text/html" },
      { "CONTENT-TYPE": "application/xml" },
    );
    assert.equal(result.get("content-type"), "application/xml");
    assert.equal(result.get("Content-Type"), "application/xml");
  });

  test("headers from Headers object", () => {
    const headers = new Headers();
    headers.set("X-Custom", "value1");
    headers.set("Authorization", "Bearer token");

    const result = merge_headers(headers, { "Content-Type": "application/json" });
    assert.equal(result.get("x-custom"), "value1");
    assert.equal(result.get("authorization"), "Bearer token");
    assert.equal(result.get("content-type"), "application/json");
  });

  test("headers from array format", () => {
    const result = merge_headers([
      ["Content-Type", "application/json"],
      ["Authorization", "Bearer token"],
    ] as [string, string][]);
    assert.equal(result.get("content-type"), "application/json");
    assert.equal(result.get("authorization"), "Bearer token");
  });

  test("header reducer function", () => {
    const result = merge_headers(
      { "X-Counter": "1" },
      { "X-Counter": (current) => String(Number(current) + 1) },
      { "X-Counter": (current) => String(Number(current) + 1) },
    );
    assert.equal(result.get("x-counter"), "3");
  });

  test("a null or undefined value deletes the header set by an earlier source", () => {
    const result = merge_headers(
      { "Content-Type": "application/json", "X-Trace": "abc", "X-Kept": "yes" },
      { "Content-Type": null, "X-Trace": undefined },
    );
    assert.equal(result.get("content-type"), null);
    assert.equal(result.get("x-trace"), null);
    assert.equal(result.get("x-kept"), "yes");
  });

  test("a reducer returning null or undefined deletes the header", () => {
    const result = merge_headers(
      { "X-Null": "value", "X-Undefined": "value" },
      { "X-Null": () => null, "X-Undefined": () => undefined },
    );
    assert.equal(result.get("x-null"), null);
    assert.equal(result.get("x-undefined"), null);
  });

  test("multiple source types mixed", () => {
    const headers = new Headers();
    headers.set("X-From-Headers", "value1");

    const result = merge_headers(headers, { "X-From-Object": "value2" }, [
      ["X-From-Array", "value3"],
    ] as [string, string][]);
    assert.equal(result.get("x-from-headers"), "value1");
    assert.equal(result.get("x-from-object"), "value2");
    assert.equal(result.get("x-from-array"), "value3");
  });

  test("a Headers instance overrides an object key spelled in another case", () => {
    const later = new Headers();
    later.set("content-type", "text/html");
    const result = merge_headers({ "Content-Type": "application/json", "X-Keep": "1" }, later);
    assert.equal(result.get("content-type"), "text/html");
    assert.equal(result.get("x-keep"), "1");
    assert.deepEqual([...result.keys()].sort(), ["content-type", "x-keep"]);
  });

  test("undefined sources", () => {
    const result = merge_headers(undefined, { "Content-Type": "application/json" }, undefined);
    assert.equal(result.get("content-type"), "application/json");
  });

  test("null values in source", () => {
    const result = merge_headers({
      "X-Present": "value",
      "X-Null": null,
      "X-Undefined": undefined,
    });
    assert.equal(result.get("x-present"), "value");
    assert.equal(result.get("x-null"), null);
    assert.equal(result.get("x-undefined"), null);
  });

  test("number and boolean header values", () => {
    const result = merge_headers({
      "X-Number": 42,
      "X-Boolean": true,
    });
    assert.equal(result.get("x-number"), "42");
    assert.equal(result.get("x-boolean"), "true");
  });

  test("reducer with undefined current value", () => {
    const result = merge_headers({
      "X-New": (current) => {
        assert.equal(current, undefined);
        return "new-value";
      },
    });
    assert.equal(result.get("x-new"), "new-value");
  });
});

describe("merge_options", () => {
  test("basic options merging", () => {
    const result = merge_options(
      { headers: { "X-First": "value1" } },
      { headers: { "X-Second": "value2" } },
    );
    assert.equal(result.headers.get("x-first"), "value1");
    assert.equal(result.headers.get("x-second"), "value2");
  });

  test("signals from two sources are combined, and either one aborts the result with its reason", () => {
    const first = new AbortController();
    const second = new AbortController();

    const result = merge_options({ signal: first.signal }, { signal: second.signal });

    assert.ok(result.signal instanceof AbortSignal);
    assert.notEqual(result.signal, first.signal);
    assert.notEqual(result.signal, second.signal);
    assert.equal(result.signal.aborted, false);

    first.abort("reason1");
    assert.equal(result.signal.aborted, true);
    assert.equal(result.signal.reason, "reason1");
  });

  test("signals from three sources all reach the combined signal", () => {
    const controllers = [new AbortController(), new AbortController(), new AbortController()];
    const result = merge_options(
      { signal: controllers[0]!.signal },
      { signal: controllers[1]!.signal },
      { signal: controllers[2]!.signal },
    );
    controllers[2]!.abort("last");
    assert.equal(result.signal?.aborted, true);
    assert.equal(result.signal?.reason, "last");
  });

  test("signal from single source", () => {
    const controller = new AbortController();

    const result = merge_options({}, { signal: controller.signal });

    assert.equal(result.signal, controller.signal);
  });

  test("signal from first source only", () => {
    const controller = new AbortController();

    const result = merge_options({ signal: controller.signal }, {});

    assert.equal(result.signal, controller.signal);
  });

  test("no signal if none provided", () => {
    const result = merge_options({}, {});
    assert.equal(result.signal, undefined);
  });

  test("retry policy merging", () => {
    const result = merge_options(
      { retry: { attempts: 3, delay: 100 } },
      { retry: { attempts: 5 } },
    );
    assert.equal(result.retry?.attempts, 5);
    assert.equal(result.retry?.delay, 100);
  });

  test("retry policy from single source", () => {
    const result = merge_options({}, { retry: { attempts: 3, delay: 1000 } });
    assert.equal(result.retry?.attempts, 3);
    assert.equal(result.retry?.delay, 1000);
  });

  test("an explicit `undefined` retry key inherits the earlier value instead of clearing it", () => {
    const when = () => true;
    const result = merge_options(
      { retry: { when, attempts: 3 } },
      { retry: { when: undefined, attempts: undefined, delay: 10 } },
    );
    assert.equal(result.retry?.when, when);
    assert.equal(result.retry?.attempts, 3);
    assert.equal(result.retry?.delay, 10);
  });

  test("a whole `retry: undefined` source leaves the earlier policy untouched", () => {
    const result = merge_options({ retry: { attempts: 2 } }, { retry: undefined });
    assert.deepEqual(result.retry, { attempts: 2 });
  });

  test("timeout merging is per key, like retry", () => {
    const result = merge_options({ timeout: { attempt: 1000 } }, { timeout: { total: 5000 } });
    assert.deepEqual(result.timeout, { attempt: 1000, total: 5000 });
  });

  test("a later timeout key overrides an earlier one and leaves the rest", () => {
    const result = merge_options(
      { timeout: { total: 5000, attempt: 1000 } },
      { timeout: { attempt: 2000 } },
    );
    assert.deepEqual(result.timeout, { total: 5000, attempt: 2000 });
  });

  test("a bare number is normalized to `{ total }` before merging", () => {
    const result = merge_options({ timeout: 3000 }, { timeout: { attempt: 500 } });
    assert.deepEqual(result.timeout, { total: 3000, attempt: 500 });
  });

  test("no timeout anywhere stays undefined rather than an empty object", () => {
    const result = merge_options({ retry: { attempts: 1 } }, {});
    assert.equal(result.timeout, undefined);
  });

  test("timeout keys merge across client, endpoint and call sources in order", () => {
    const result = merge_options(
      { timeout: { attempt: 1000 } },
      { timeout: 8000 },
      { timeout: { total: 5000 } },
    );
    assert.deepEqual(result.timeout, { attempt: 1000, total: 5000 });
  });

  test("headers delegation to merge_headers", () => {
    const result = merge_options(
      { headers: { "Content-Type": "text/plain" } },
      { headers: { "Content-Type": "application/json" } },
    );
    assert.equal(result.headers.get("content-type"), "application/json");
  });

  test("empty sources", () => {
    const result = merge_options();
    assert.ok(result.headers instanceof Headers);
  });

  test("plain RequestInit keys pass through, later sources winning", () => {
    const result = merge_options(
      { credentials: "include", cache: "no-store" },
      { cache: "force-cache", redirect: "manual" },
    );
    assert.equal(result.credentials, "include");
    assert.equal(result.cache, "force-cache");
    assert.equal(result.redirect, "manual");
  });

  test("headers with reducer functions", () => {
    const result = merge_options(
      { headers: { "X-Custom": "initial" } },
      { headers: { "X-Custom": (current) => `${current}-modified` } },
    );
    assert.equal(result.headers.get("x-custom"), "initial-modified");
  });

  test("multiple sources with partial headers", () => {
    const result = merge_options(
      { headers: { "X-First": "value1" } },
      {},
      { headers: { "X-Third": "value3" } },
    );
    assert.equal(result.headers.get("x-first"), "value1");
    assert.equal(result.headers.get("x-third"), "value3");
  });
});

describe("sleep", () => {
  test("rejects synchronously when the signal is already aborted, before any timer fires", async () => {
    const signal = AbortSignal.abort("preset-reason");
    // Order rather than wall-clock: an already-rejected promise settles before a 0ms timer does.
    const winner = await Promise.race([
      sleep(100, signal).then(
        () => "resolved",
        (reason: unknown) => `rejected:${String(reason)}`,
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve("timer"), 0)),
    ]);
    assert.equal(winner, "rejected:preset-reason");
  });

  test("rejects with the abort reason when the signal fires mid-sleep", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort("mid-sleep"), 5);
    await assert.rejects(
      () => sleep(5_000, controller.signal),
      (reason: unknown) => reason === "mid-sleep",
    );
  });

  test("resolves once the delay has elapsed when nothing aborts it", async () => {
    let settled = false;
    const pending = sleep(5).then(() => {
      settled = true;
    });
    assert.equal(settled, false);
    await pending;
    assert.equal(settled, true);
  });
});

/**
 * A body that stays open after its chunk, so cancelling it actually reaches the underlying source.
 * A closed stream ignores `cancel()`, which would make every assertion here vacuous.
 */
function open_body(content = "chunk") {
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

describe("discard_body", () => {
  test("cancels a body nobody read", () => {
    const { body, was_cancelled } = open_body();
    discard_body(new Response(body));
    assert.equal(was_cancelled(), true);
  });

  test("leaves an already read body alone", async () => {
    const response = new Response("done");
    assert.equal(await response.text(), "done");
    discard_body(response);
    assert.equal(response.bodyUsed, true);
  });

  test("leaves a locked but undisturbed body to its reader", async () => {
    const { body, was_cancelled } = open_body("held");
    const response = new Response(body);
    const reader = response.body!.getReader();

    // The case only `locked` catches: a parser holding a reader has not made the body `bodyUsed`,
    // and cancelling under it would both throw and steal the stream it is about to read.
    discard_body(response);

    assert.equal(was_cancelled(), false);
    const { value } = await reader.read();
    assert.equal(new TextDecoder().decode(value), "held");
  });

  test("tolerates a missing response, a null body and a failing cancel", () => {
    discard_body(undefined);
    discard_body(new Response(null));
    discard_body(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1]));
          },
          cancel() {
            throw new Error("teardown blew up");
          },
        }),
      ),
    );
    // Reaching here without an unhandled rejection is the assertion: a body torn down mid-flight is
    // what this function is for, not something to report.
  });
});

describe("response_metadata / request_metadata", () => {
  test("carry everything but the body", () => {
    const response = new Response("body", {
      status: 201,
      headers: { "x-trace": "abc" },
    });
    const metadata = response_metadata(response);

    assert.deepEqual(Object.keys(metadata).sort(), ["headers", "ok", "status", "url"]);
    assert.equal(metadata.status, 201);
    assert.equal(metadata.ok, true);
    assert.equal(metadata.headers.get("x-trace"), "abc");
    assert.equal(response.bodyUsed, false);
  });

  test("request metadata keeps the sent headers", () => {
    const metadata = request_metadata(
      new Request("https://api.example.com/users", {
        method: "POST",
        body: "payload",
        headers: { authorization: "Bearer token" },
      }),
    );

    assert.deepEqual(Object.keys(metadata).sort(), ["headers", "method", "url"]);
    assert.equal(metadata.method, "POST");
    assert.equal(metadata.url, "https://api.example.com/users");
    assert.equal(metadata.headers.get("authorization"), "Bearer token");
  });
});

describe("default_retry_condition", () => {
  const request = request_metadata(new Request("https://api.example.com/users"));
  const context = { operation: "fetch" } as const;

  const error_cases = [
    { error: new NetworkError("x", context), retried: true },
    { error: new TimeoutError("x", context), retried: true },
    { error: new AbortedError("x", context), retried: false },
  ] as const;

  for (const { error, retried } of error_cases) {
    test(`${error.kind} is ${retried ? "" : "not "}retried`, () => {
      assert.equal(default_retry_condition({ request, response: undefined, error }), retried);
    });
  }

  // The client never hands one to a condition, so `RetryPolicy.AttemptError` leaves it out and the
  // cast is what reaching this branch takes. The guard stays anyway: the condition is exported, so
  // it can be called with whatever a composing caller has in hand.
  test("UnexpectedError is not retried", () => {
    const error = new UnexpectedError("x", context) as unknown as NetworkError;
    assert.equal(default_retry_condition({ request, response: undefined, error }), false);
  });

  test("an error wins over a response left from an earlier attempt", () => {
    assert.equal(
      default_retry_condition({
        request,
        response: response_metadata(new Response(null, { status: 200 })),
        error: new NetworkError("x", context),
      }),
      true,
    );
  });

  const status_cases = [
    { status: 200, retried: false },
    { status: 204, retried: false },
    { status: 302, retried: false },
    { status: 304, retried: false },
    { status: 400, retried: false },
    { status: 401, retried: false },
    { status: 404, retried: false },
    { status: 409, retried: false },
    { status: 408, retried: true },
    { status: 429, retried: true },
    { status: 500, retried: true },
    { status: 503, retried: true },
    { status: 599, retried: true },
  ] as const;

  for (const { status, retried } of status_cases) {
    test(`${status} is ${retried ? "" : "not "}retried`, () => {
      const response = response_metadata(new Response(null, { status }));
      assert.equal(default_retry_condition({ request, response, error: undefined }), retried);
    });
  }

  test("no response and no error is not retried", () => {
    assert.equal(
      default_retry_condition({ request, response: undefined, error: undefined }),
      false,
    );
  });
});
