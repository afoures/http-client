import { bench } from "@arktype/attest";
import { http_client, type $infer } from "./http-client.ts";
import { Endpoint } from "./endpoint.ts";
import z from "zod";

const client = http_client(
  {
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
  { base_url: "https://api.example.com" },
);

bench("$infer.Query", () => {
  return {} as $infer.Query<typeof client.getUser>;
}).types([2906, "instantiations"]);

bench("$infer.Params", () => {
  return {} as $infer.Params<typeof client.getUser>;
}).types([2937, "instantiations"]);

bench("$infer.Body", () => {
  return {} as $infer.Body<typeof client.createUser>;
}).types([2853, "instantiations"]);

bench("$infer.Data", () => {
  return {} as $infer.Data<typeof client.getUser>;
}).types([5541, "instantiations"]);

bench("$infer.Error", () => {
  return {} as $infer.Error<typeof client.getUser>;
}).types([5716, "instantiations"]);

// Baselines left empty intentionally; run `pnpm bench:infer` to populate them.
bench("$infer.Input", () => {
  return {} as $infer.Input<typeof client.getUser>;
}).types([2819, "instantiations"]);

bench("$infer.Result", () => {
  return {} as $infer.Result<typeof client.getUser>;
}).types([5048, "instantiations"]);

bench("$infer.Response", () => {
  return {} as $infer.Response<typeof client.getUser>;
}).types([5177, "instantiations"]);
