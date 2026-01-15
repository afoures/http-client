import * as assert from "node:assert/strict";
import { describe, test } from "node:test";

import { z } from "zod";
import { http_client } from "./http-client.ts";
import { endpoint } from "./http-endpoint.ts";

test("test", async () => {
  const delete_user = endpoint({
    method: "POST",
    pathname: "/users/:id",
    params: {
      schema: z.object({
        id: z.boolean().transform((bool) => (bool ? "on" : "off")),
      }),
    },
    query: {
      schema: z.object({ x: z.string() }),
    },
    data: {
      schema: z.void(),
    },
    body: {
      schema: z.object({ test: z.string().transform((str) => str.length) }),
    },
  });

  const get_user = endpoint({
    method: "GET",
    pathname: "/users/:id",
    /* params: {
    schema: z.object({ id: z.boolean().transform((bool) => (bool ? "on" : "off")) }),
  },*/
    data: {
      schema: z.object({
        id: z.string(),
        username: z.string(),
        age: z.number().min(0),
      }),
    },
  });

  const api = http_client({
    origin: "https://example.com",
    endpoints: {
      users: {
        get: get_user,
        delete: delete_user,
      },
    },
  });

  const x = await api.users.get({ params: { id: 33 } });
  const y = await api.users.delete({
    params: { id: true },
    query: { x: "foo" },
    body: { test: "anything" },
  });

  if (x.ok) {
    x.data;
  }

  assert.equal(1, 1);
});
