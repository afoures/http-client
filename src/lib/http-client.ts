import { Endpoint, type AnyEndpoint } from "./endpoint.ts";
import {
  type HTTPFetch,
  type HTTPMethod,
  type MaybePromise,
  type Pathname,
  type Pretty,
  type RetryPolicy,
  type Schema,
} from "./types.ts";
import { AbortedError, NetworkError, TimeoutError, UnexpectedError } from "./errors.ts";
import { extract_args, merge_options, remove_custom_options, sleep } from "./utils.ts";

interface EndpointDefinitions {
  [name: string]: AnyEndpoint | EndpointDefinitions;
}

type CustomFetch = (request: Request) => Promise<Response>;

type Hooks = {
  on_request?: (request: Request) => void;
  on_response?: (response: Response) => void;
};

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

export function fetch_endpoint_factory<
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
  hooks = {},
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
    HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit
  >;
  hooks?: Hooks;
}) {
  async function fetch_endpoint(
    input: Pretty<
      HTTPFetch.TypedParamsInit<pathname, params_schema> &
        HTTPFetch.TypedQueryInit<query_schema> &
        HTTPFetch.TypedBodyInit<body_schema> &
        HTTPFetch.OptionalRequestInit &
        HTTPFetch.DefaultRequestInit
    >,
  ) {
    const { args, options } = extract_args(input);

    const { headers, ...merged_options } = merge_options(
      await get_default_options(),
      endpoint.options,
      options,
    );

    const url = await endpoint
      .generate_url({
        origin,
        params: args.params,
        query: args.query,
      } as any)
      .catch((error) => new UnexpectedError("Failed to generate URL", { cause: error }));
    if (url instanceof Error) return url;

    const serialized = await endpoint
      .serialize_body({
        body: args.body,
      } as any)
      .catch((error) => new UnexpectedError("Failed to serialize body", { cause: error }));
    if (serialized instanceof Error) return serialized;

    headers.delete("Content-Type");
    if (serialized.content_type) headers.set("Content-Type", serialized.content_type);

    const retry_policy: Required<RetryPolicy.Configuration> = {
      when: options.retry?.when ?? ((ctx) => ctx.response?.ok === false),
      attempts: options.retry?.attempts ?? 0,
      delay: options.retry?.delay ?? 0,
    };

    let attempt = 0;
    let request: Request;
    let response: Response | undefined;
    let error: UnexpectedError | NetworkError | TimeoutError | AbortedError | undefined;

    do {
      const signals: Array<AbortSignal> = [];
      if (options.signal) signals.push(options.signal);
      if (options.timeout) signals.push(AbortSignal.timeout(options.timeout));
      const abort_signal = signals.length > 0 ? AbortSignal.any(signals) : undefined;

      try {
        request = new Request(url, {
          ...remove_custom_options(merged_options),
          method: endpoint.method,
          body: serialized.body,
          headers,
          signal: abort_signal,
        });
      } catch (local_error) {
        error = new UnexpectedError("Failed to create request", { cause: local_error });
        break; // no retry
      }

      try {
        attempt++;
        hooks.on_request?.(request);
        response = await custom_fetch(request);
        error = undefined; // clear any previous error on success
      } catch (local_error) {
        if (local_error instanceof Error && local_error.name === "TimeoutError") {
          error = new TimeoutError(local_error.message);
        } else if (local_error instanceof Error && local_error.name === "AbortError") {
          error = new AbortedError(local_error.message);
        } else {
          error = new NetworkError("Network error", { cause: local_error });
        }
      }

      try {
        const should_retry = await retry_policy.when({ request, response, error });
        if (!should_retry) break;

        const max_attempts =
          typeof retry_policy.attempts === "function"
            ? await retry_policy.attempts({ request })
            : retry_policy.attempts;
        if (attempt >= max_attempts) break;

        const delay =
          typeof retry_policy.delay === "function"
            ? await retry_policy.delay({ request, response, error, attempt })
            : retry_policy.delay;
        if (delay > 0) {
          await sleep(delay, abort_signal);
        }
      } catch (local_error) {
        error = new UnexpectedError("Failed to check retry policy", { cause: local_error });
        break; // no retry
      }
      // oxlint-disable-next-line no-constant-condition
    } while (true);

    if (error) return error;
    if (!response) {
      return new UnexpectedError("", { cause: "No response received" });
    }
    hooks.on_response?.(response);
    const result = await endpoint.parse_response(response).catch((error) => {
      if (error instanceof Error && error.name === "AbortError") {
        return new AbortedError(error.message);
      }
      return new UnexpectedError("Failed to parse response", { cause: error });
    });

    return result;
  }

  return fetch_endpoint;
}

export type HttpClientOptions<endpoints extends EndpointDefinitions> = {
  origin: string;
  endpoints: endpoints;
  options?: () => MaybePromise<HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit>;
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
