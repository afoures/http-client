import * as assert from "node:assert/strict";
import { describe, test } from "node:test";

import { z } from "zod";
import { endpoint as create_endpoint } from "./http-endpoint.ts";

describe("endpoint.generate_url", () => {
  test("without params nor query string", () => {
    const endpoint = create_endpoint({
      method: "GET",
      pathname: "/foo/bar",
      data: {
        schema: z.void(),
      },
    });

    const url = endpoint.generate_url({ origin: "https://example.com" });
    assert.equal(url.toString(), "https://example.com/foo/bar");
  });

  test("with query string (array schema)", () => {
    const endpoint = create_endpoint({
      method: "GET",
      pathname: "/",
      query: {
        schema: z.array(z.tuple([z.string(), z.string()])),
      },
      data: {
        schema: z.void(),
      },
    });

    const url = endpoint.generate_url({
      origin: "https://example.com",
      query: [
        ["foo", "bar"],
        ["bar", "foo"],
      ],
    });
    assert.equal(url.toString(), "https://example.com/?foo=bar&bar=foo");
  });

  test("with query string (object schema)", () => {
    const endpoint = create_endpoint({
      method: "GET",
      pathname: "/",
      query: {
        schema: z
          .object({
            foo: z.string(),
            bar: z.string(),
          })
          .optional(),
      },
      data: {
        schema: z.void(),
      },
    });

    const url = endpoint.generate_url({
      origin: "https://example.com",
      query: { foo: "bar", bar: "foo" },
    });
    assert.equal(url.toString(), "https://example.com/?foo=bar&bar=foo");
  });

  test("with params (without schema)", () => {
    const endpoint = create_endpoint({
      method: "GET",
      pathname: "/:one/:two/:three",
      data: {
        schema: z.void(),
      },
    });

    const url = endpoint.generate_url({
      origin: "https://example.com",
      params: { one: 123456, two: "foo", three: "bar" },
    });
    assert.equal(url.toString(), "https://example.com/123456/foo/bar");
  });

  test("with params (with schema)", () => {
    const endpoint = create_endpoint({
      method: "GET",
      pathname: "/:one/:two/:three",
      params: {
        schema: z.object({
          one: z.boolean().transform((bool) => (bool ? "on" : "off")),
          two: z.number(),
          three: z.array(z.string()).transform((array) => array.join(" ")),
        }),
      },
      data: {
        schema: z.void(),
      },
    });

    const url = endpoint.generate_url({
      origin: "https://example.com",
      params: { one: false, two: 420, three: ["foo", "bar"] },
    });
    assert.equal(url.toString(), "https://example.com/off/420/foo%20bar");
  });
});
