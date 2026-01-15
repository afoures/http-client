import { type StandardSchemaV1 } from "@standard-schema/spec";
import { HTTPEndpoint } from "./http-endpoint.ts";
import { type HTTPFetchApi, type Pretty } from "../src/types.ts";

export type AnyEndpoint = HTTPEndpoint<any, any, any, any, any, any, any>;

interface EndpointDefinitions {
  [name: string]: AnyEndpoint | EndpointDefinitions;
}

type Fetcher<
  def extends {
    params: unknown;
    query: unknown;
    body: unknown;
    data: unknown;
    error: unknown;
  }
> = (
  args: HTTPFetchApi.TypedRequestInit<{
    params: def["params"];
    query: def["query"];
    body: def["body"];
  }>
) => Promise<HTTPFetchApi.TypedResponse<def["data"], def["error"]>>;

type AnyFetcher = Fetcher<{
  params: any;
  query: any;
  body: any;
  data: any;
  error: any;
}>;

type HTTPFetchers<endpoints extends EndpointDefinitions> = Pretty<{
  -readonly [name in keyof endpoints]: endpoints[name] extends HTTPEndpoint<
    any,
    any,
    infer params_schema,
    infer query_schema,
    infer body_schema,
    infer data_schema,
    infer error_schema
  >
    ? Fetcher<{
        params: StandardSchemaV1.InferInput<params_schema>;
        query: StandardSchemaV1.InferInput<query_schema>;
        body: StandardSchemaV1.InferInput<body_schema>;
        data: StandardSchemaV1.InferOutput<data_schema>;
        error: StandardSchemaV1.InferOutput<error_schema>;
      }>
    : endpoints[name] extends EndpointDefinitions
    ? HTTPFetchers<endpoints[name]>
    : never;
}>;

export type HttpClientOptions<endpoints extends EndpointDefinitions> = {
  origin: string;
  defaults?: { headers?: HeadersInit };
  endpoints: endpoints;
  fetch?: (
    url: URL,
    init: Omit<RequestInit, "headers"> & { headers: Headers }
  ) => Promise<Response>;
};

export function http_client<const endpoints extends EndpointDefinitions>({
  origin,
  endpoints,
  defaults = {},
  fetch: custom_fetch = fetch,
}: HttpClientOptions<endpoints>) {
  function map_to_fetcher<defs extends EndpointDefinitions>(
    definition: defs
  ): HTTPFetchers<defs> {
    return Object.fromEntries(
      Object.entries(definition).map(([key, endpoint_or_object]) => {
        if (endpoint_or_object instanceof HTTPEndpoint) {
          const endpoint = endpoint_or_object;

          const fetcher: AnyFetcher = async ({
            query: unprocessed_query,
            params: unprocessed_params,
            body: unprocessed_body,
            headers: compute_headers = (h) => h,
            ...rest
          }) => {
            const headers = new Headers(defaults.headers ?? {});

            const url = endpoint.generate_url({
              origin,
              params: unprocessed_params,
              query: unprocessed_query,
            });

            const { body, content_type } =
              endpoint.serialize_body(unprocessed_body);
            if (content_type) headers.set("Content-Type", content_type);

            const response = await custom_fetch(url, {
              ...defaults,
              ...rest,
              method: endpoint.method,
              body: body,
              headers: compute_headers(headers),
            });

            const output = await endpoint.parse_response(response);
            return output;
          };

          return [key, fetcher];
        }

        return [key, map_to_fetcher(endpoint_or_object)];
      })
    ) as HTTPFetchers<defs>;
  }

  return map_to_fetcher(endpoints);
}
