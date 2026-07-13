import { describe, test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { http_client } from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import { define_context } from "./endpoint.ts";
import { ParseError, SerializationError } from "./errors.ts";
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
        get: new Endpoint({
          method: "GET",
          pathname: "/user",
          context: define_context<{ expected_name: string }>(),
          responses: {
            200: {
              schema: (ctx) => z.object({ id: z.string(), name: z.literal(ctx.expected_name) }),
              parse: "json",
            },
          },
        }),
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
        put: new Endpoint({
          method: "PUT",
          pathname: "/blob",
          context: define_context<{ key: string }>(),
          body: {
            schema: () => z.object({ value: z.string() }),
            serialize: (value, ctx) => ({
              body: JSON.stringify({ value: value.value, key: ctx.key }),
              content_type: "application/json",
            }),
          },
          responses: {
            200: {
              schema: () => z.object({ value: z.string() }),
              parse: async (body, ctx) => {
                const text = await new Response(body).text();
                const parsed = JSON.parse(text) as { value: string; key: string };
                if (parsed.key !== ctx.key) throw new Error("key mismatch");
                return { value: parsed.value };
              },
            },
          },
        }),
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

  test("endpoint-level default context fills a key the call omits", async () => {
    const api = http_client(
      {
        get: new Endpoint({
          method: "GET",
          pathname: "/user",
          context: define_context<{ expected_name: string }>().with_defaults({
            expected_name: "John",
          }),
          responses: {
            200: {
              schema: (ctx) => z.object({ name: z.literal(ctx.expected_name) }),
              parse: "json",
            },
          },
        }),
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
          get: new Endpoint({
            method: "GET",
            pathname: "/echo",
            context: define_context<{ tenant: string }>(),
            responses: {
              200: {
                schema: (ctx) => z.object({ tenant: z.literal(ctx.tenant) }),
                parse: "json",
              },
            },
          }),
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
        post: new Endpoint({
          method: "POST",
          pathname: "/things",
          context: define_context<{ secret: string }>(),
          body: { schema: () => z.object({ name: z.string() }), serialize: "json" },
          responses: { 200: { schema: () => z.object({ ok: z.boolean() }), parse: "json" } },
        }),
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

  test("a throwing schema factory surfaces as SerializationError / ParseError", async () => {
    const request_side = new Endpoint({
      method: "POST",
      pathname: "/x",
      context: define_context<{ k: string }>(),
      body: {
        schema: (_ctx) => {
          throw new Error("boom-body");
        },
        serialize: "json",
      },
    });
    const serialized = await request_side.serialize_body({ body: { any: true } } as any, {
      k: "v",
    });
    assert.ok(serialized instanceof SerializationError);
    assert.equal(serialized.context.operation, "serialize_body");
    assert.equal((serialized.cause as Error)?.message, "boom-body");

    const response_side = new Endpoint({
      method: "GET",
      pathname: "/x",
      context: define_context<{ k: string }>(),
      responses: {
        200: {
          schema: (_ctx) => {
            throw new Error("boom-response");
          },
          parse: "json",
        },
      },
    });
    const parsed = await response_side.parse_response(
      new Response(JSON.stringify({ a: 1 }), { status: 200 }),
      { k: "v" },
    );
    assert.ok(parsed instanceof ParseError);
  });
});
