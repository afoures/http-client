import { Endpoint, type AnyEndpoint } from "./endpoint.ts";
import {
  type HTTPFetch,
  type HTTPMethod,
  type MaybePromise,
  type Parser,
  type Pathname,
  type Pretty,
  type RetryPolicy,
  type Schema,
} from "./types.ts";
import { AbortedError, NetworkError, TimeoutError, UnexpectedError } from "./errors.ts";
import { extract_args, merge_options, remove_custom_options, sleep } from "./utils.ts";

/**
 * The value type for entries in an {@link EndpointMap}. Uses the real generic
 * bounds (notably `Pathname.Relative` for the pathname) rather than `any`, so
 * that inline `new Endpoint({...})` declarations keep their literal `pathname`
 * inferred — `any` in the contextual type would widen it to `string` and break
 * the dynamic-params discrimination in `EndpointDefinition`.
 */
type AnyEndpointValue = Endpoint<
  HTTPMethod.Any,
  Pathname.Relative,
  Schema.Any,
  Schema.Any,
  Schema.Any,
  any
>;

export interface EndpointMap {
  [name: string]: AnyEndpointValue | EndpointMap;
}

type CustomFetch = (request: Request) => Promise<Response>;

type Hooks = {
  on_request?: (request: Request) => void;
  on_response?: (response: Response) => void;
};

type map_to_fetch_endpoint_functions<endpoints extends EndpointMap> = Pretty<{
  -readonly [name in keyof endpoints]: endpoints[name] extends Endpoint<
    infer http_method,
    infer pathname,
    infer params_schema,
    infer query_schema,
    infer body_schema,
    infer responses
  >
    ? ReturnType<
        typeof fetch_endpoint_factory<
          http_method,
          pathname,
          params_schema,
          query_schema,
          body_schema,
          responses
        >
      >
    : endpoints[name] extends EndpointMap
      ? map_to_fetch_endpoint_functions<endpoints[name]>
      : never;
}>;

export function fetch_endpoint_factory<
  http_method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
  params_schema extends Schema._,
  query_schema extends Schema._,
  body_schema extends Schema._,
  responses extends Partial<Record<Parser.AllowedStatus, Schema._>>,
>({
  base_url,
  endpoint,
  custom_fetch,
  get_default_options = () => ({}),
  hooks = {},
}: {
  base_url: string;
  endpoint: Endpoint<http_method, pathname, params_schema, query_schema, body_schema, responses>;
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
    let start_time = Date.now();

    if (!URL.canParse(base_url)) {
      return new UnexpectedError(`Invalid base_url: ${base_url}`, {
        operation: "base_url_validation",
        request: { url: base_url, method: endpoint.method, baseUrl: base_url },
        timing: { startTime: start_time },
      });
    }

    const { args, options } = extract_args(input);

    const { headers, ...merged_options } = merge_options(
      await get_default_options(),
      endpoint.options,
      options,
    );

    const url = await endpoint
      .generate_url({
        base_url,
        params: args.params,
        query: args.query,
      } as any)
      .catch(
        (error) =>
          new UnexpectedError("Failed to generate URL", {
            cause: error,
            operation: "generate_url",
            request: {
              url: base_url,
              method: endpoint.method,
              baseUrl: base_url,
            },
            input: {
              params: args.params,
              query: args.query,
            },

            timing: { startTime: start_time },
          }),
      );
    if (url instanceof Error) return url;

    const serialized = await endpoint
      .serialize_body({
        body: args.body,
      } as any)
      .catch(
        (error) =>
          new UnexpectedError("Failed to serialize body", {
            cause: error,
            operation: "serialize_body",
            request: {
              url: url instanceof URL ? url.toString() : base_url,
              method: endpoint.method,
              baseUrl: base_url,
            },
            input: {
              body: args.body,
            },

            timing: { startTime: start_time },
          }),
      );
    if (serialized instanceof Error) return serialized;

    headers.delete("Content-Type");
    if (serialized.content_type) headers.set("Content-Type", serialized.content_type);

    const retry_policy: Required<RetryPolicy.Configuration> = {
      when: merged_options.retry?.when ?? ((ctx) => ctx.response?.ok === false),
      attempts: merged_options.retry?.attempts ?? 0,
      delay: merged_options.retry?.delay ?? 0,
    };

    let attempt = 0;
    let request: Request;
    let response: Response | undefined;
    let error: UnexpectedError | NetworkError | TimeoutError | AbortedError | undefined;

    do {
      response = undefined;
      const signals: Array<AbortSignal> = [];
      if (merged_options.signal) signals.push(merged_options.signal);
      if (merged_options.timeout) signals.push(AbortSignal.timeout(merged_options.timeout));
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
        error = new UnexpectedError("Failed to create request", {
          cause: local_error,
          operation: "create_request",
          request: {
            url: url instanceof URL ? url.toString() : base_url,
            method: endpoint.method,
            headers,
            timeout: merged_options.timeout,
            baseUrl: base_url,
          },
          timing: { startTime: start_time, attempt: 1 },
        });
        break; // no retry
      }

      try {
        attempt++;
        hooks.on_request?.(request);
        response = await custom_fetch(request);
        error = undefined; // clear any previous error on success
      } catch (local_error) {
        const duration = Date.now() - start_time;
        if (local_error instanceof Error && local_error.name === "TimeoutError") {
          error = new TimeoutError(local_error.message, {
            cause: local_error,
            operation: "fetch",
            request: {
              url: request.url,
              method: request.method,
              timeout: merged_options.timeout,
            },
            timing: {
              startTime: start_time,
              duration,
              attempt,
            },
          });
        } else if (local_error instanceof Error && local_error.name === "AbortError") {
          error = new AbortedError(local_error.message, {
            cause: local_error,
            operation: "fetch",
            request: {
              url: request.url,
              method: request.method,
              timeout: merged_options.timeout,
            },
            timing: {
              startTime: start_time,
              duration,
              attempt,
            },
          });
        } else {
          error = new NetworkError("Network error", {
            cause: local_error,
            operation: "fetch",
            request: {
              url: request.url,
              method: request.method,
              timeout: merged_options.timeout,
            },
            timing: {
              startTime: start_time,
              duration,
              attempt,
            },
          });
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
        error = new UnexpectedError("Failed to check retry policy", {
          cause: local_error,
          operation: "retry_policy",
          request: {
            url: url instanceof URL ? url.toString() : base_url,
            method: endpoint.method,
            timeout: merged_options.timeout,
            baseUrl: base_url,
          },
          timing: {
            startTime: start_time,
            attempt,
            maxAttempts:
              typeof retry_policy.attempts === "function" ? undefined : retry_policy.attempts,
          },
        });
        break; // no retry
      }
      // oxlint-disable-next-line no-constant-condition
    } while (true);

    if (error) return error;
    if (!response) {
      return new UnexpectedError("No response received", {
        cause: "No response received",
        operation: "parse_response",
        request: {
          url: url instanceof URL ? url.toString() : base_url,
          method: endpoint.method,
          timeout: merged_options.timeout,
          baseUrl: base_url,
        },
        timing: { startTime: start_time, attempt },
      });
    }
    hooks.on_response?.(response);
    const result = await endpoint.parse_response(response).catch(async (error) => {
      const response_body = await response
        .clone()
        .text()
        .catch(() => undefined);

      if (error instanceof Error && error.name === "AbortError") {
        return new AbortedError(error.message, {
          cause: error,
          operation: "parse_response",
          request: {
            url: response.url,
            method: request?.method,
          },
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
            body: response_body,
          },
          timing: { startTime: start_time, attempt },
        });
      }
      return new UnexpectedError("Failed to parse response", {
        cause: error,
        operation: "parse_response",
        request: {
          url: response.url,
          method: request?.method,
          timeout: merged_options.timeout,
          baseUrl: base_url,
        },
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          body: response_body,
        },
        timing: { startTime: start_time, attempt },
      });
    });

    return result;
  }

  return fetch_endpoint;
}

export type HttpClientOptions<endpoints extends EndpointMap> = {
  base_url: string;
  endpoints: endpoints;
  options?: () => MaybePromise<HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit>;
  fetch?: CustomFetch;
};

export function http_client<const endpoints extends EndpointMap>({
  base_url,
  endpoints: all_endpoints,
  options,
  fetch: custom_fetch = fetch,
}: HttpClientOptions<endpoints>) {
  function map<endpoints extends EndpointMap>(
    endpoints: endpoints,
  ): map_to_fetch_endpoint_functions<endpoints> {
    return Object.fromEntries(
      Object.entries(endpoints).map(([key, endpoint_or_object]) => {
        if (endpoint_or_object instanceof Endpoint) {
          return [
            key,
            fetch_endpoint_factory({
              endpoint: endpoint_or_object,
              base_url,
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

type AnyFetchEndpointFunction = ReturnType<
  typeof fetch_endpoint_factory<any, any, any, any, any, any>
>;

export namespace $infer {
  /** Normalize an `Endpoint` instance or a bound fetch function to the fetch-function type. */
  type as_fetch_endpoint<endpoint> = endpoint extends AnyFetchEndpointFunction
    ? endpoint
    : endpoint extends Endpoint<
          infer http_method,
          infer pathname,
          infer params_schema,
          infer query_schema,
          infer body_schema,
          infer responses
        >
      ? ReturnType<
          typeof fetch_endpoint_factory<
            http_method,
            pathname,
            params_schema,
            query_schema,
            body_schema,
            responses
          >
        >
      : never;

  type fetch_input<endpoint> = Parameters<as_fetch_endpoint<endpoint>>[0];
  type fetch_output<endpoint> = Awaited<ReturnType<as_fetch_endpoint<endpoint>>>;

  /** Read an input key, yielding `never` only when the key genuinely does not exist. */
  type infer_init<endpoint, key extends PropertyKey> = key extends keyof fetch_input<endpoint>
    ? fetch_input<endpoint>[key]
    : never;

  type AnyEndpointInput = AnyFetchEndpointFunction | AnyEndpoint;

  export type Params<endpoint extends AnyEndpointInput> = infer_init<endpoint, "params">;

  export type Query<endpoint extends AnyEndpointInput> = infer_init<endpoint, "query">;

  export type Body<endpoint extends AnyEndpointInput> = infer_init<endpoint, "body">;

  /** The full request argument (params + query + body + request init). */
  export type Input<endpoint extends AnyEndpointInput> = fetch_input<endpoint>;

  /** Everything `fetch` can return: HTTP response envelopes PLUS the transport error classes. */
  export type Result<endpoint extends AnyEndpointInput> = fetch_output<endpoint>;

  /**
   * The discriminated HTTP response union only — Successful | Redirect | ClientError | ServerError.
   * Drops the thrown transport errors (UnexpectedError/NetworkError/TimeoutError/AbortedError/ParseError);
   * stays narrowable on `ok`/`status`.
   */
  export type Response<endpoint extends AnyEndpointInput> = Extract<
    fetch_output<endpoint>,
    { ok: boolean }
  >;

  export type Data<endpoint extends AnyEndpointInput, status extends number = number> =
    fetch_output<endpoint> extends infer response
      ? response extends { ok: true; status: infer member_status extends number; data: infer data }
        ? // a wildcard arm covers a whole class (e.g. `2xx`), so its `status` is a union;
          // match when the requested `status` overlaps that union, not just when it equals it.
          [Extract<member_status, status>] extends [never]
          ? never
          : data
        : never
      : never;

  export type Error<endpoint extends AnyEndpointInput, status extends number = number> =
    fetch_output<endpoint> extends infer response
      ? response extends {
          ok: false;
          status: infer member_status extends number;
          error: infer error;
        }
        ? [Extract<member_status, status>] extends [never]
          ? never
          : error
        : never
      : never;
}
