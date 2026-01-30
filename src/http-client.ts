import { Endpoint, type AnyEndpoint } from "./endpoint.ts";
import {
  type HTTPFetch,
  type HTTPMethod,
  type MaybePromise,
  type Pathname,
  type Pretty,
  type Schema,
} from "./types.ts";
import { AbortedError, SerializationError, TimeoutError } from "./errors.ts";
import { extract_args, merge_options, remove_custom_options } from "./utils.ts";

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
  params_schema extends Schema._,
  query_schema extends Schema._,
  body_schema extends Schema._,
  data_schema extends Schema._,
  error_schema extends Schema._,
>({
  origin,
  endpoint,
  custom_fetch,
  get_default_options = () => ({}),
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
  get_default_options?: () => MaybePromise<
    HTTPFetch.DefaultRequestInit & HTTPFetch.OptionalRequestInit
  >;
}) {
  async function fetch_endpoint(
    input: Pretty<
      HTTPFetch.TypedParamsInit<pathname, params_schema> &
        HTTPFetch.TypedQueryInit<query_schema> &
        HTTPFetch.TypedBodyInit<body_schema> &
        HTTPFetch.DefaultRequestInit &
        HTTPFetch.OptionalRequestInit
    >,
  ) {
    const { args, options } = extract_args(input);

    const { headers, ...merged_options } = merge_options(
      await get_default_options(),
      endpoint.options,
      options,
    );

    const url = await endpoint.generate_url({
      origin,
      params: args.params,
      query: args.query,
    } as any);
    if (url instanceof SerializationError) return url;

    const serialized = await endpoint.serialize_body({
      body: args.body,
    } as any);
    if (serialized instanceof SerializationError) return serialized;

    headers.delete("Content-Type");
    if (serialized.content_type) headers.set("Content-Type", serialized.content_type);

    // let attempts = 0;
    do {
      try {
        // attempts++;

        const signals: Array<AbortSignal> = [];
        if (options.timeout) signals.push(AbortSignal.timeout(options.timeout));
        if (options.signal) signals.push(options.signal);

        const response = await custom_fetch(url, {
          ...remove_custom_options(merged_options),
          method: endpoint.method,
          body: serialized.body,
          headers,
          signal: signals.length > 0 ? AbortSignal.any(signals) : undefined,
        });

        const result = await endpoint.parse_response(response);

        return result;
      } catch (error) {
        if (error instanceof Error && error.name === "TimeoutError") {
          return new TimeoutError(error.message);
        }
        if (error instanceof Error && error.name === "AbortError") {
          return new AbortedError(error.message);
        }
        throw error;
      }
      // oxlint-disable-next-line no-constant-condition
    } while (true);
  }

  return fetch_endpoint;
}

export type HttpClientOptions<endpoints extends EndpointDefinitions> = {
  origin: string;
  endpoints: endpoints;
  options?: () => MaybePromise<
    Omit<HTTPFetch.DefaultRequestInit & HTTPFetch.OptionalRequestInit, "signal">
  >;
  fetch?: CustomFetch;
};

export function http_client<const endpoints extends EndpointDefinitions>({
  origin,
  endpoints: all_endpoints,
  options,
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
              get_default_options: options,
            }),
          ];
        }
        return [key, map(endpoint_or_object)];
      }),
    );
  }

  return map(all_endpoints);
}

// const get_user = new Endpoint({
//   method: "GET",
//   pathname: "/users/:id",
//   data: {
//     schema: z.object({
//       id: z.string(),
//     }),
//   },
// });

// const call2 = fetch_endpoint_factory({
//   endpoint: get_user,
//   origin: "https://ok.com",
//   custom_fetch: fetch,
// });

// const result2 = await call2({
//   params: {
//     id: "1",
//   },
// });

// const client = http_client({
//   origin: "https://ok.com",
//   endpoints: {
//     get_user,
//   },
// });

// const result3 = await client.get_user({
//   params: {
//     id: "1",
//   },
// });
