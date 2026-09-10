import { describe, test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { http_client } from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import { ParseError, SerializationError, UnexpectedError } from "./errors.ts";
import z from "zod";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const API_BASE_URL = "https://api.example.com";
const server = setupServer();

describe("dynamic (context-driven) schemas", () => {
  before(() => server.listen({ onUnhandledRequest: "bypass" }));
  after(() => server.close());
  afterEach(() => server.resetHandlers());

  test("response schema factory receives the per-call context", async () => {
    const api = http_client(
      {
        get: new Endpoint(
          { method: "GET", pathname: "/user" },
          (ctx: { expected_name: string }) => ({
            responses: {
              200: {
                schema: z.object({ id: z.string(), name: z.literal(ctx.expected_name) }),
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
        put: new Endpoint({ method: "PUT", pathname: "/blob" }, (ctx: { key: string }) => ({
          body: {
            schema: z.object({ value: z.string() }),
            serialize: (value) => ({
              body: JSON.stringify({ value: value.value, key: ctx.key }),
              content_type: "application/json",
            }),
          },
          responses: {
            200: {
              schema: z.object({ value: z.string() }),
              parse: async (body) => {
                const text = await new Response(body).text();
                const parsed = JSON.parse(text) as { value: string; key: string };
                if (parsed.key !== ctx.key) throw new Error("key mismatch");
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
          (ctx: { tenant: string; locale: string }) => ({
            params: { schema: z.object({ tenant: z.literal(ctx.tenant) }) },
            query: { schema: z.object({ locale: z.literal(ctx.locale) }) },
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
          (ctx: { tenant: string; page_size: number }) => ({
            params: {
              schema: z.object({ tenant: z.literal(ctx.tenant) }),
              serialize: (data) => ({ tenant: `${data.tenant}-${ctx.tenant}` }),
            },
            query: {
              schema: z.object({ q: z.string() }),
              serialize: (data) => new URLSearchParams({ q: data.q, size: String(ctx.page_size) }),
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
          (ctx: { expected_name: string }) => ({
            responses: {
              200: {
                schema: z.object({ name: z.literal(ctx.expected_name) }),
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
    const make = (perCall?: { tenant?: string }) =>
      http_client(
        {
          get: new Endpoint({ method: "GET", pathname: "/echo" }, (ctx: { tenant: string }) => ({
            responses: {
              200: {
                schema: z.object({ tenant: z.literal(ctx.tenant) }),
                parse: "json",
              },
            },
          })),
        },
        { base_url: API_BASE_URL, context: { tenant: "client" } },
      ).get(perCall ? { context: perCall } : {});

    server.use(
      http.get(`${API_BASE_URL}/echo`, ({ request }) => {
        return HttpResponse.json({
          tenant: new URL(request.url).searchParams.get("t") ?? "client",
        });
      }),
    );

    const fromClient = await make();
    assert.ok(!(fromClient instanceof Error) && fromClient.ok);

    const fromCall = await make({ tenant: "other" });
    assert.ok(fromCall instanceof ParseError);
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

  test("a throwing definition factory surfaces as UnexpectedError from every method", async () => {
    const endpoint = new Endpoint({ method: "POST", pathname: "/x" }, (_context: { k: string }) => {
      throw new Error("boom");
    });

    const serialized = await endpoint.serialize_body({ body: { any: true } } as any, { k: "v" });
    assert.ok(serialized instanceof UnexpectedError);
    assert.equal(serialized.context.operation, "resolve_definition");
    assert.equal((serialized.cause as Error)?.message, "boom");

    const url = await endpoint.generate_url({ base_url: API_BASE_URL } as any, { k: "v" });
    assert.ok(url instanceof UnexpectedError);
    assert.equal(url.context.operation, "resolve_definition");

    const parsed = await endpoint.parse_response(
      new Response(JSON.stringify({ a: 1 }), { status: 200 }),
      { k: "v" },
    );
    assert.ok(parsed instanceof UnexpectedError);
    assert.equal(parsed.context.operation, "resolve_definition");
  });

  test("a throwing definition factory surfaces as UnexpectedError through the client", async () => {
    const api = http_client(
      {
        get: new Endpoint({ method: "GET", pathname: "/x" }, (_context: { k: string }) => {
          throw new Error("boom");
        }),
      },
      { base_url: API_BASE_URL },
    );

    const result = await api.get({ context: { k: "v" } });
    assert.ok(result instanceof UnexpectedError);
    assert.equal(result.context.operation, "resolve_definition");
    assert.equal((result.cause as Error)?.message, "boom");
  });

  test("the definition factory runs once per request", async () => {
    let calls = 0;
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
      { base_url: API_BASE_URL },
    );

    server.use(http.post(`${API_BASE_URL}/things`, () => HttpResponse.json({ ok: true })));

    const ok = await api.post({
      query: { tag: "a" },
      body: { name: "widget" },
      context: { tag: "a" },
    });
    assert.ok(!(ok instanceof Error));
    assert.equal(calls, 1);
  });
});
