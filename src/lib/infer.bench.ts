import { bench } from "@arktype/attest";
import { http_client, type $infer } from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import z from "zod";

const client = http_client({
  base_url: "https://api.example.com",
  endpoints: {
    getUser: new Endpoint({
      method: "GET",
      pathname: "/users/:id",
      params: {
        schema: z.object({ id: z.string() }),
      },
      query: {
        schema: z.object({ include: z.string(), page: z.string() }),
      },
      responses: {
        200: {
          schema: z.object({ id: z.string(), name: z.string() }),
          parse: "json",
        },
        404: {
          schema: z.object({ message: z.string(), code: z.number() }),
          parse: "json",
        },
      },
    }),
    createUser: new Endpoint({
      method: "POST",
      pathname: "/users",
      body: {
        schema: z.object({ name: z.string(), email: z.string() }),
        serialize: "json",
      },
      responses: {
        201: {
          schema: z.object({ id: z.string(), name: z.string() }),
          parse: "json",
        },
        400: {
          schema: z.object({ errors: z.array(z.string()) }),
          parse: "json",
        },
      },
    }),
  },
});

bench("$infer.Query", () => {
  return {} as $infer.Query<typeof client.getUser>;
}).types([2378, "instantiations"]);

bench("$infer.Params", () => {
  return {} as $infer.Params<typeof client.getUser>;
}).types([2409, "instantiations"]);

bench("$infer.Body", () => {
  return {} as $infer.Body<typeof client.createUser>;
}).types([2723, "instantiations"]);

bench("$infer.Data", () => {
  return {} as $infer.Data<typeof client.getUser>;
}).types([4811, "instantiations"]);

bench("$infer.Error", () => {
  return {} as $infer.Error<typeof client.getUser>;
}).types([4831, "instantiations"]);
