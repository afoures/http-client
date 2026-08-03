import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { default_retry_condition, merge_options, merge_headers, sleep } from "./utils.ts";
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

  test("header deletion via null", () => {
    const result = merge_headers({ "Content-Type": "application/json" }, { "Content-Type": null });
    assert.equal(result.get("content-type"), null);
  });

  test("header deletion via undefined", () => {
    const result = merge_headers(
      { "Content-Type": "application/json" },
      { "Content-Type": undefined },
    );
    assert.equal(result.get("content-type"), null);
  });

  test("reducer returning null deletes header", () => {
    const result = merge_headers({ "X-Custom": "value" }, { "X-Custom": () => null });
    assert.equal(result.get("x-custom"), null);
  });

  test("reducer returning undefined deletes header", () => {
    const result = merge_headers({ "X-Custom": "value" }, { "X-Custom": () => undefined });
    assert.equal(result.get("x-custom"), null);
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

  test("empty sources", () => {
    const result = merge_headers();
    assert.equal(result.get("content-type"), null);
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

  test("signal combining with AbortSignal.any()", async () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();

    const result = merge_options({ signal: controller1.signal }, { signal: controller2.signal });

    assert.ok(result.signal instanceof AbortSignal);

    controller1.abort("reason1");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(result.signal?.aborted);
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

  test("complex options with all features", () => {
    const controller = new AbortController();

    const result = merge_options(
      { headers: { "X-Default": "value1" }, retry: { attempts: 1 } },
      { headers: { "X-Override": "value2" }, timeout: 5000 },
      { signal: controller.signal, retry: { attempts: 3, delay: 100 } },
    );

    assert.equal(result.headers.get("x-default"), "value1");
    assert.equal(result.headers.get("x-override"), "value2");
    assert.ok(result.signal instanceof AbortSignal);
    assert.deepEqual(result.timeout, { total: 5000 });
    assert.equal(result.retry?.attempts, 3);
    assert.equal(result.retry?.delay, 100);
  });

  test("retry with function values", () => {
    const whenFn = () => true;
    const delayFn = () => 100;
    const attemptsFn = () => 5;

    const result = merge_options(
      { retry: { when: whenFn, attempts: 3, delay: 50 } },
      { retry: { attempts: attemptsFn, delay: delayFn } },
    );

    assert.equal(result.retry?.when, whenFn);
    assert.equal(result.retry?.attempts, attemptsFn);
    assert.equal(result.retry?.delay, delayFn);
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
  test("rejects immediately when signal is already aborted", async () => {
    const signal = AbortSignal.abort("preset-reason");
    const started = Date.now();
    await assert.rejects(
      () => sleep(100, signal),
      (err: unknown) => err === "preset-reason",
    );
    assert.ok(
      Date.now() - started < 50,
      "sleep should have rejected immediately, not waited for the timeout",
    );
  });

  test("rejects when signal is aborted during sleep", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort("mid-sleep"), 5);
    await assert.rejects(
      () => sleep(500, controller.signal),
      (err: unknown) => err === "mid-sleep",
    );
  });
});

describe("default_retry_condition", () => {
  const request = new Request("https://api.example.com/users");
  const context = { operation: "fetch" } as const;

  const error_cases = [
    { error: new NetworkError("x", context), retried: true },
    { error: new TimeoutError("x", context), retried: true },
    { error: new AbortedError("x", context), retried: false },
    { error: new UnexpectedError("x", context), retried: false },
  ] as const;

  for (const { error, retried } of error_cases) {
    test(`${error.kind} is ${retried ? "" : "not "}retried`, () => {
      assert.equal(default_retry_condition({ request, response: undefined, error }), retried);
    });
  }

  test("an error wins over a response left from an earlier attempt", () => {
    assert.equal(
      default_retry_condition({
        request,
        response: new Response(null, { status: 200 }),
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
      const response = new Response(null, { status });
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
