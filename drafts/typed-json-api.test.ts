/* eslint-disable no-unused-vars, @typescript-eslint/no-explicit-any, unused-imports/no-unused-vars,@typescript-eslint/no-unused-vars */
import { test, expect } from "bun:test";

// eslint-disable-next-line no-restricted-imports
import { z } from "zod";

import { createTypedJsonApi, override } from "./typed-json-api";

test("should generate an url with the right origin + pathname", async () => {
  const api = createTypedJsonApi({
    origin: "https://example.com",
    endpoints: {
      "/api": {
        GET: {
          output: z.string(),
        },
      },
    },
    fetch: (url, init) => {
      expect(url.toString()).toBe("https://example.com/api");
      return {} as any;
    },
  });

  await api.get("/api");
});

test("should add default request init", async () => {
  const api = createTypedJsonApi({
    origin: "https://example.com",
    defaultRequestInit: {
      headers: {
        "x-default-header": "foo",
      },
      cache: "reload",
      credentials: "same-origin",
    },
    endpoints: {
      "/api": {
        GET: {
          output: z.string(),
        },
      },
    },
    fetch: (url, init) => {
      expect(init.headers).toBeInstanceOf(Headers);
      expect((init.headers as Headers).get("x-default-header")).toBe("foo");
      expect(init.cache).toBe("reload");
      expect(init.credentials).toBe("same-origin");
      return {} as any;
    },
  });

  await api.get("/api");
});

test("should replace string param in url", async () => {
  const api = createTypedJsonApi({
    origin: "https://example.com",
    endpoints: {
      "/:id": {
        GET: {
          output: z.string(),
        },
      },
    },
    fetch: (url, init) => {
      expect(url.toString()).toBe("https://example.com/string");
      return {} as any;
    },
  });

  await api.get("/:id", { params: { id: "string" } });
});

test("should replace string that ends with space param in url", async () => {
  const api = createTypedJsonApi({
    origin: "https://example.com",
    endpoints: {
      "/:id": {
        GET: {
          output: z.string(),
        },
      },
    },
    fetch: (url, init) => {
      expect(url.toString()).toBe("https://example.com/string%20");
      return {} as any;
    },
  });

  await api.get("/:id", { params: { id: "string " } });
});

test("should replace number param in url", async () => {
  const api = createTypedJsonApi({
    origin: "https://example.com",
    endpoints: {
      "/:id": {
        GET: {
          output: z.string(),
        },
      },
    },
    fetch: (url, init) => {
      expect(url.toString()).toBe("https://example.com/45");
      return {} as any;
    },
  });

  await api.get("/:id", { params: { id: 45 } });
});

test("should error when empty string params", async () => {
  const api = createTypedJsonApi({
    origin: "https://example.com",
    endpoints: {
      "/:id": {
        GET: {
          output: z.string(),
        },
      },
    },
  });

  expect(() => api.get("/:id", { params: { id: "" } })).toThrow();
});

test("should convert body to string based on schema", async () => {
  const api = createTypedJsonApi({
    origin: "https://example.com",
    endpoints: {
      "/api": {
        POST: {
          body: z.object({ name: z.string() }),
          output: z.string(),
        },
      },
    },
    fetch: (url, init) => {
      expect(init.body).toBe('{"name":"antoine"}');
      return {} as any;
    },
  });

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  await api.post("/api", { body: { name: "antoine", other: 123 } });
});

test("should append search params to url based on schema", async () => {
  const api = createTypedJsonApi({
    origin: "https://example.com",
    endpoints: {
      "/api": {
        GET: {
          searchParams: z.object({ q: z.string() }),
          output: z.string(),
        },
      },
    },
    fetch: (url, init) => {
      expect(url.toString()).toBe("https://example.com/api?q=query");
      return {} as any;
    },
  });

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  await api.get("/api", { searchParams: { q: "query", other: 123 } });
});

test("should parse response body based on schema", async () => {
  const api = createTypedJsonApi({
    origin: "https://example.com",
    endpoints: {
      "/api": {
        GET: {
          output: z.object({ id: z.string() }),
        },
      },
    },
    fetch: async (url, init) => {
      return new Response(JSON.stringify({ id: "123456789", remove: "this" }));
    },
  });

  const response = await api.get("/api");
  expect(await response.json()).toEqual({ id: "123456789" });
});

test("should throw when fetching unknown enpoint", async () => {
  const api = createTypedJsonApi({
    origin: "https://example.com",
    endpoints: {
      "/api": {
        GET: {
          output: z.string(),
        },
      },
    },
  });

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  expect(() => api.get("/api/other")).toThrowError(
    'url "/api/other" with "GET" method does not match any endpoint definition on this api'
  );
});

test("should throw if response body does not match schema", async () => {
  const api = createTypedJsonApi({
    origin: "https://example.com",
    endpoints: {
      "/api": {
        GET: {
          output: z.object({ id: z.string() }),
        },
      },
    },
    fetch: async () => {
      return new Response(JSON.stringify({}));
    },
  });

  const response = await api.get("/api");
  expect(() => response.json()).toThrowError(
    'parsing of "output" of "/api" failed'
  );
});

test("should allow override of response in fetch injection", async () => {
  const api = createTypedJsonApi({
    origin: "https://example.com",
    endpoints: {
      "/api": {
        GET: {
          output: z.object({ id: z.string(), name: z.string() }),
        },
      },
    },
    fetch: async () => {
      const response = new Response(
        JSON.stringify({ id: "abc", name: "nobody" }),
        {
          headers: {
            "x-id": "123",
          },
        }
      );
      return override(response, {
        json: () => () =>
          response
            .json()
            .then((json) => ({ ...json, id: response.headers.get("x-id") })),
      });
    },
  });

  const response = await api.get("/api");
  expect(await response.json()).toEqual({ id: "123", name: "nobody" });
});

test("should work as a response when calling something else that json()", async () => {
  const api = createTypedJsonApi({
    origin: "https://example.com",
    endpoints: {
      "/api": {
        GET: {
          output: z.object({ id: z.string() }),
        },
      },
    },
    fetch: async () => {
      return new Response(JSON.stringify({ id: "abc" }));
    },
  });

  const response = await api.get("/api");
  expect(await response.text()).toBe('{"id":"abc"}');
});

test("should return an instance of response", async () => {
  const api = createTypedJsonApi({
    origin: "https://example.com",
    endpoints: {
      "/api": {
        GET: {
          output: z.object({ id: z.string() }),
        },
      },
    },
    fetch: async () => {
      return new Response(JSON.stringify({ id: "abc" }));
    },
  });

  const response = await api.get("/api");
  expect(response).toBeInstanceOf(Response);
});
