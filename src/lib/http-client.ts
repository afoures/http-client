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
import {
  extract_args,
  merge_context,
  merge_options,
  remove_custom_options,
  sleep,
} from "./utils.ts";

/** A possibly-nested tree of {@link Endpoint} instances, keyed by name, accepted by {@link http_client}. */
interface EndpointMap {
  [name: string]: AnyEndpoint | EndpointMap;
}

type ValidateEndpointMap<endpoints> = {
  [name in keyof endpoints]: endpoints[name] extends AnyEndpoint
    ? endpoints[name]
    : endpoints[name] extends object
      ? ValidateEndpointMap<endpoints[name]>
      : never;
};

type CustomFetch = (request: Request) => Promise<Response>;

type Hooks = {
  on_request?: (request: Request) => void;
  on_response?: (response: Response) => void;
};

type map_to_fetch_endpoint_functions<endpoints, default_context = {}> = Pretty<{
  -readonly [name in keyof endpoints]: endpoints[name] extends Endpoint<
    infer http_method,
    infer pathname,
    infer params_schema,
    infer query_schema,
    infer body_schema,
    infer responses,
    infer context_type,
    infer context_defaults
  >
    ? ReturnType<
        typeof fetch_endpoint_factory<
          http_method,
          pathname,
          params_schema,
          query_schema,
          body_schema,
          responses,
          context_type,
          context_defaults,
          default_context
        >
      >
    : endpoints[name] extends EndpointMap
      ? map_to_fetch_endpoint_functions<endpoints[name], default_context>
      : never;
}>;

type ContextUnion<endpoints> = {
  [name in keyof endpoints]: endpoints[name] extends Endpoint<
    any,
    any,
    any,
    any,
    any,
    any,
    infer context_type,
    any
  >
    ? unknown extends context_type
      ? never
      : context_type
    : endpoints[name] extends EndpointMap
      ? ContextUnion<endpoints[name]>
      : never;
}[keyof endpoints];

type ContextKeys<union> = union extends unknown ? keyof union : never;

/**
 * The shape accepted by the client-level `context` of {@link HttpClientConfig}: the merged context
 * of every endpoint in the tree, with all keys optional. Use it to constrain a wrapper's own
 * context type parameter.
 *
 * @example
 * const endpoints = { users: { get: get_user_endpoint } };
 * function create_client<const default_context extends ClientContext<typeof endpoints>>(
 *   config: HttpClientConfig<typeof endpoints, default_context>,
 * ) {
 *   return http_client(endpoints, config);
 * }
 */
export type ClientContext<endpoints> = {
  [key in ContextKeys<ContextUnion<endpoints>>]?: ContextUnion<endpoints> extends infer member
    ? member extends unknown
      ? key extends keyof member
        ? member[key]
        : never
      : never
    : never;
};

export function fetch_endpoint_factory<
  http_method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
  params_schema extends Schema._,
  query_schema extends Schema._,
  body_schema extends Schema._,
  responses extends Partial<Record<Parser.AllowedStatus, Schema._>>,
  context_type = unknown,
  context_defaults = {},
  default_context = {},
>({
  base_url,
  endpoint,
  custom_fetch,
  get_default_options = () => ({}),
  client_context,
  hooks = {},
}: {
  base_url: string;
  endpoint: Endpoint<
    http_method,
    pathname,
    params_schema,
    query_schema,
    body_schema,
    responses,
    context_type,
    context_defaults
  >;
  custom_fetch: CustomFetch;
  get_default_options?: () => MaybePromise<
    HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit
  >;
  client_context?: default_context;
  hooks?: Hooks;
}) {
  async function fetch_endpoint(
    input: HTTPFetch.TypedParamsInit<pathname, params_schema> &
      HTTPFetch.TypedQueryInit<query_schema> &
      HTTPFetch.TypedBodyInit<body_schema> &
      HTTPFetch.TypedContextInit<context_type, keyof context_defaults | keyof default_context> &
      HTTPFetch.OptionalRequestInit &
      HTTPFetch.DefaultRequestInit,
  ) {
    let start_time = Date.now();

    if (!URL.canParse(base_url)) {
      return new UnexpectedError(`Invalid base_url: ${base_url}`, {
        operation: "base_url_validation",
        request: { url: base_url, method: endpoint.method, baseUrl: base_url },
        timing: { startTime: start_time },
      });
    }

    const { args, options, context: call_context } = extract_args(input);

    const context = merge_context(
      client_context as Record<string, unknown> | undefined,
      endpoint.context_default as Record<string, unknown> | undefined,
      call_context as Record<string, unknown> | undefined,
    );

    const { headers, ...merged_options } = merge_options(
      await get_default_options(),
      endpoint.options,
      options,
    );

    let request_headers = headers;

    const url = await endpoint
      .generate_url(
        {
          base_url,
          params: args.params,
          query: args.query,
        } as any,
        context as any,
      )
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
      .serialize_body(
        {
          body: args.body,
        } as any,
        context as any,
      )
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

    request_headers.delete("Content-Type");
    if (serialized.content_type) request_headers.set("Content-Type", serialized.content_type);

    const retry_policy = {
      when: merged_options.retry?.when ?? ((ctx) => ctx.response?.ok === false),
      attempts: merged_options.retry?.attempts ?? 0,
      delay: merged_options.retry?.delay ?? 0,
      recover: merged_options.retry?.recover,
    } satisfies RetryPolicy.Configuration;

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
          headers: request_headers,
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
        break;
      }

      try {
        attempt++;
        hooks.on_request?.(request);
        response = await custom_fetch(request);
        error = undefined;
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
        const should_retry = await retry_policy.when({
          request,
          response,
          error,
        });
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
        break;
      }

      if (retry_policy.recover) {
        let overrides: RetryPolicy.Overrides | void;
        try {
          overrides = await retry_policy.recover({
            request,
            response,
            error,
            attempt,
            current: { headers: new Headers(request_headers) },
          });
        } catch (local_error) {
          error = new UnexpectedError("Failed to recover request", {
            cause: local_error,
            operation: "recover",
            request: {
              url: url instanceof URL ? url.toString() : base_url,
              method: endpoint.method,
              timeout: merged_options.timeout,
              baseUrl: base_url,
            },
            timing: { startTime: start_time, attempt },
          });
          break;
        }

        if (overrides && "headers" in overrides) {
          request_headers = new Headers(overrides.headers);
          request_headers.delete("Content-Type");
          if (serialized.content_type) request_headers.set("Content-Type", serialized.content_type);
        }
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
    const result = await endpoint.parse_response(response, context as any).catch(async (error) => {
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

/**
 * Configuration for {@link http_client}, parameterized by the endpoint tree it is used with so the
 * client-level `context` is derived from the endpoints instead of being spelled out by hand.
 *
 * @example
 * // annotate a wrapper's config (every context key stays optional at the call site)
 * const endpoints = { users: { get: get_user_endpoint } };
 * export type MyClientConfig = HttpClientConfig<typeof endpoints>;
 *
 * @example
 * // keep track of which defaults were actually provided by threading `default_context`
 * function create_client<const default_context extends ClientContext<typeof endpoints>>(
 *   config: HttpClientConfig<typeof endpoints, default_context>,
 * ) {
 *   return http_client(endpoints, config);
 * }
 */
export type HttpClientConfig<
  endpoints = {},
  default_context extends ClientContext<endpoints> = ClientContext<endpoints>,
> = {
  /**
   * Base URL every endpoint's pathname is resolved against, following standard `URL` resolution.
   * To keep a path prefix, the base must end with a trailing slash, otherwise its last segment is
   * replaced by the pathname.
   *
   * @example
   * // basic
   * base_url: "https://api.example.com"        // + "/users" -> https://api.example.com/users
   *
   * @example
   * // with path prefix (note the trailing slash)
   * base_url: "https://api.example.com/v1/"    // + "/users" -> https://api.example.com/v1/users
   * base_url: "https://api.example.com/v1"     // + "/users" -> https://api.example.com/users (prefix dropped)
   */
  base_url: string;
  /** Default request options applied to every call; may be a value or a (possibly async) factory. */
  options?:
    | (HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit)
    | (() => MaybePromise<HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit>);
  /** Client-level default context, merged under every endpoint's context; defaulted keys become optional at the call site. */
  context?: default_context;
  /** Custom `fetch` implementation; defaults to the global `fetch`. */
  fetch?: CustomFetch;
};

/**
 * Turn a (possibly nested) tree of {@link Endpoint} instances into a mirror-shaped object of
 * typed fetch functions. Each function validates input, performs the request with retries, and
 * returns a typed response envelope or an error instance (errors are returned, never thrown).
 *
 * @example
 * const api = http_client(
 *   { users: { get: get_user_endpoint } },
 *   { base_url: "https://api.example.com" },
 * );
 * const result = await api.users.get({ params: { id: "1" } });
 */
export function http_client<
  const endpoints,
  const default_context extends ClientContext<endpoints> = {},
>(
  all_endpoints: ValidateEndpointMap<endpoints>,
  {
    base_url,
    options,
    context,
    fetch: custom_fetch = fetch,
  }: HttpClientConfig<endpoints, default_context>,
): map_to_fetch_endpoint_functions<endpoints, default_context> {
  function map(endpoints: EndpointMap): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(endpoints).map(([key, endpoint_or_object]) => {
        if (endpoint_or_object instanceof Endpoint) {
          return [
            key,
            fetch_endpoint_factory({
              endpoint: endpoint_or_object,
              base_url,
              custom_fetch,
              get_default_options: typeof options === "function" ? options : () => options ?? {},
              client_context: context,
            }),
          ];
        }
        return [key, map(endpoint_or_object)];
      }),
    );
  }

  return map(all_endpoints as EndpointMap) as map_to_fetch_endpoint_functions<
    endpoints,
    default_context
  >;
}

type AnyFactoryFn = ReturnType<
  typeof fetch_endpoint_factory<any, any, any, any, any, any, any, any, any>
>;

type AnyFetchEndpointFunction = AnyFactoryFn extends (input: infer input) => infer result
  ? (input: input & { context: any }) => result
  : never;

/**
 * Type-level helpers that extract input and output types from an {@link Endpoint} instance or a
 * bound fetch function. Use them to derive types for your own code (function signatures, variables,
 * component props) from an endpoint definition instead of re-declaring them by hand, so the types
 * stay in sync with the endpoint's schemas.
 *
 * @example
 * function build_query(q: $infer.Query<typeof api.users.list>) { ... }
 */
export namespace $infer {
  type as_fetch_endpoint<endpoint> = endpoint extends AnyFetchEndpointFunction
    ? endpoint
    : endpoint extends Endpoint<
          infer http_method,
          infer pathname,
          infer params_schema,
          infer query_schema,
          infer body_schema,
          infer responses,
          infer context_type,
          infer context_defaults
        >
      ? ReturnType<
          typeof fetch_endpoint_factory<
            http_method,
            pathname,
            params_schema,
            query_schema,
            body_schema,
            responses,
            context_type,
            context_defaults,
            any
          >
        >
      : never;

  type fetch_input<endpoint> = Parameters<as_fetch_endpoint<endpoint>>[0];
  type fetch_output<endpoint> = Awaited<ReturnType<as_fetch_endpoint<endpoint>>>;

  type infer_init<endpoint, key extends PropertyKey> = key extends keyof fetch_input<endpoint>
    ? fetch_input<endpoint>[key]
    : never;

  type AnyEndpointInput = AnyFetchEndpointFunction | AnyEndpoint;

  /** The endpoint's path-params argument type. Use it to type a value you pass as `params`. */
  export type Params<endpoint extends AnyEndpointInput> = infer_init<endpoint, "params">;

  /** The endpoint's query argument type. Use it to type a value you pass as `query`. */
  export type Query<endpoint extends AnyEndpointInput> = infer_init<endpoint, "query">;

  /** The endpoint's request-body argument type. Use it to type a value you pass as `body`. */
  export type Body<endpoint extends AnyEndpointInput> = infer_init<endpoint, "body">;

  /** The endpoint's per-call `context` argument type (`never` when it declares no context). Use it to type context you pass in. */
  export type Context<endpoint extends AnyEndpointInput> = infer_init<endpoint, "context">;

  /** The endpoint's full request argument (params + query + body + context + request init). Use it to accept a whole call payload in one parameter. */
  export type Input<endpoint extends AnyEndpointInput> = fetch_input<endpoint>;

  /** Everything a call can resolve to: the response envelopes plus the transport error classes. Use it to type a variable holding an awaited call result before you narrow it. */
  export type Result<endpoint extends AnyEndpointInput> = fetch_output<endpoint>;

  /** The HTTP response union only (successful | redirect | client error | server error), narrowable on `ok`/`status`. Use it when you have already excluded the transport errors and want just the HTTP outcomes. */
  export type Response<endpoint extends AnyEndpointInput> = Extract<
    fetch_output<endpoint>,
    { ok: boolean }
  >;

  /**
   * The success `data` type, optionally narrowed to a specific status or status class. Use it to
   * type the payload you extract from a successful response.
   *
   * @example
   * type Ok = $infer.Data<typeof api.users.get, 200>;
   */
  export type Data<endpoint extends AnyEndpointInput, status extends number = number> =
    fetch_output<endpoint> extends infer response
      ? response extends {
          ok: true;
          status: infer member_status extends number;
          data: infer data;
        }
        ? [Extract<member_status, status>] extends [never]
          ? never
          : data
        : never
      : never;

  /**
   * The error-response `error` type, optionally narrowed to a specific status or status class. Use
   * it to type the payload you extract from a failed HTTP response.
   *
   * @example
   * type NotFound = $infer.Error<typeof api.users.get, 404>;
   */
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
