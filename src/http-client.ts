import { z } from "zod";
import { Endpoint, type AnyEndpoint } from "./endpoint.ts";
import {
  type HTTPFetch,
  type HTTPMethod,
  type Pathname,
  type Pretty,
  type Schema,
} from "./types.ts";
import { AbortedError, SerializationError, TimeoutError } from "./errors.ts";

interface EndpointDefinitions {
  [name: string]: AnyEndpoint | EndpointDefinitions;
}

type CustomFetch = (
  url: URL,
  init: Omit<RequestInit, "headers"> & { headers: Headers },
) => Promise<Response>;

type map_to_fetch_endpoint_functions<endpoints extends EndpointDefinitions> = Pretty<{
  -readonly [name in keyof endpoints]: endpoints[name] extends Endpoint<
    infer http_method,
    infer pathname,
    infer params_schema,
    infer query_schema,
    infer body_schema,
    infer data_schema,
    infer error_schema
  >
    ? ReturnType<
        typeof fetch_endpoint_factory<
          http_method,
          pathname,
          params_schema,
          query_schema,
          body_schema,
          data_schema,
          error_schema
        >
      >
    : endpoints[name] extends EndpointDefinitions
      ? map_to_fetch_endpoint_functions<endpoints[name]>
      : never;
}>;

function fetch_endpoint_factory<
  http_method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
  params_schema extends Schema._ = never,
  query_schema extends Schema._ = never,
  body_schema extends Schema._ = never,
  data_schema extends Schema._ = never,
  error_schema extends Schema._ = never,
>({
  origin,
  endpoint,
  custom_fetch,
}: {
  origin: string;
  endpoint: Endpoint<
    http_method,
    pathname,
    params_schema,
    query_schema,
    body_schema,
    data_schema,
    error_schema
  >;
  custom_fetch: CustomFetch;
}) {
  async function fetch_endpoint(
    request_init: Pretty<
      HTTPFetch.TypedParamsInit<pathname, params_schema> &
        HTTPFetch.TypedQueryInit<query_schema> &
        HTTPFetch.TypedBodyInit<body_schema> &
        HTTPFetch.PartialRequestInit
    >,
  ) {
    const headers = new Headers();

    const url = await endpoint.generate_url({
      origin,
      params: "params" in request_init ? request_init.params : undefined,
      query: "query" in request_init ? request_init.query : undefined,
    } as any);
    if (url instanceof SerializationError) return url;

    const serialized = await endpoint.serialize_body({
      body: "body" in request_init ? request_init.body : undefined,
    } as any);
    if (serialized instanceof SerializationError) return serialized;

    if (serialized.content_type) headers.set("Content-Type", serialized.content_type);

    const response = await custom_fetch(url, {
      method: endpoint.method,
      body: serialized.body,
      headers,
    });

    if (Math.random() > 3) {
      return new AbortedError();
    }

    if (Math.random() > 3) {
      return new TimeoutError();
    }

    const result = await endpoint.parse_response(response);

    return result;
  }

  return fetch_endpoint;
}

export type HttpClientOptions<endpoints extends EndpointDefinitions> = {
  origin: string;
  defaults?: { headers?: HeadersInit };
  endpoints: endpoints;
  fetch?: CustomFetch;
};

export function http_client<const endpoints extends EndpointDefinitions>({
  origin,
  endpoints: all_endpoints,
  defaults = {},
  fetch: custom_fetch = fetch,
}: HttpClientOptions<endpoints>) {
  function map<endpoints extends EndpointDefinitions>(
    endpoints: endpoints,
  ): map_to_fetch_endpoint_functions<endpoints> {
    return Object.fromEntries(
      Object.entries(endpoints).map(([key, endpoint_or_object]) => {
        if (endpoint_or_object instanceof Endpoint) {
          return [
            key,
            fetch_endpoint_factory({
              endpoint: endpoint_or_object,
              origin,
              custom_fetch,
            }),
          ];
        }
        return [key, map(endpoint_or_object)];
      }),
    );
  }

  return map(all_endpoints);
}

const get_user = new Endpoint({
  method: "GET",
  pathname: "/users/:id",
  data: {
    schema: z.object({
      id: z.string(),
    }),
  },
});

const call2 = fetch_endpoint_factory({
  endpoint: get_user,
  origin: "https://ok.com",
  custom_fetch: fetch,
});

const result2 = await call2({
  params: {
    id: "1",
  },
});

const client = http_client({
  origin: "https://ok.com",
  endpoints: {
    get_user,
  },
});

const result3 = await client.get_user({
  params: {
    id: "1",
  },
});
