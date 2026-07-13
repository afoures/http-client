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

export interface EndpointMap {
  [name: string]: AnyEndpoint | EndpointMap;
}

/**
 * Structural validator for the endpoints tree, used as the type of the
 * `endpoints` option instead of constraining the type parameter with
 * {@link EndpointMap} directly.
 *
 * It is a *homomorphic* mapped type over `endpoints` (`[name in keyof endpoints]`),
 * which makes it transparent when used as a contextual type: an inline
 * `new Endpoint({...})` keeps its own inferred generics (`pathname`, the schema
 * type params, the `responses` map) instead of being widened to a constraint's
 * value type. Constraining the type parameter with `EndpointMap` instead would
 * contextually widen those generics — collapsing every schema to `Schema.Any`
 * and forcing a spurious `params: any` on inline endpoints. Each leaf must be an
 * `Endpoint`; nested objects recurse.
 */
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

type map_to_fetch_endpoint_functions<endpoints, client_context = {}> = Pretty<{
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
          client_context
        >
      >
    : endpoints[name] extends EndpointMap
      ? map_to_fetch_endpoint_functions<endpoints[name], client_context>
      : never;
}>;

/** Union of every endpoint's declared context type in the tree (endpoints without a context —
 * i.e. `unknown` — contribute nothing). */
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

/** All keys across a union of context objects (distributive `keyof`). */
type ContextKeys<union> = union extends unknown ? keyof union : never;

/**
 * The shape of the client-level `context` option: an all-optional merge of every endpoint's
 * declared context. Written as a plain mapped type — deliberately NOT via `UnionToIntersection`
 * or a top-level `extends [never] ? …` conditional — because those are deferred types the editor
 * won't evaluate for completions. As a plain mapped type it resolves eagerly, so when it is used
 * as the `client_context` constraint the editor proposes its keys (and rejects unknown/mistyped
 * ones), while the concrete value is still inferred for call-site relaxation. When no endpoint
 * declares a context, `ContextKeys` is `never` and this is `{}`.
 */
type ClientContextShape<endpoints> = {
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
  client_context = {},
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
  client_context?: client_context;
  hooks?: Hooks;
}) {
  async function fetch_endpoint(
    input: HTTPFetch.TypedParamsInit<pathname, params_schema> &
      HTTPFetch.TypedQueryInit<query_schema> &
      HTTPFetch.TypedBodyInit<body_schema> &
      HTTPFetch.TypedContextInit<context_type, keyof context_defaults | keyof client_context> &
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

export type HttpClientConfig<client_context = {}> = {
  base_url: string;
  options?:
    | (HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit)
    | (() => MaybePromise<HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit>);
  /**
   * Client-level default context, merged under every endpoint's context. Keys it provides
   * (that exist in a given endpoint's context type) become optional at that call site.
   * Constrained to the merged shape of every endpoint's declared context, so unknown/mistyped
   * keys are rejected.
   */
  context?: client_context;
  fetch?: CustomFetch;
};

export function http_client<
  const endpoints,
  const client_context extends ClientContextShape<endpoints> = {},
>(
  all_endpoints: ValidateEndpointMap<endpoints>,
  { base_url, options, context, fetch: custom_fetch = fetch }: HttpClientConfig<client_context>,
): map_to_fetch_endpoint_functions<endpoints, client_context> {
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
    client_context
  >;
}

type AnyFactoryFn = ReturnType<
  typeof fetch_endpoint_factory<any, any, any, any, any, any, any, any, any>
>;

/**
 * Structural supertype of every bound fetch function — used to tell a bound endpoint function
 * apart from an `Endpoint` instance in {@link $infer.as_fetch_endpoint}. Derived from the
 * factory return, but with `context` forced to a **required** `any`: an endpoint that declares a
 * required context produces an input whose `context` is required, and a required property is not
 * assignable to the *optional* `context` of the factory-`any` input (contravariant parameter
 * check). Forcing a present `context: any` makes every concrete input assignable while still
 * excluding non-callable `Endpoint` instances, so routing stays correct.
 */
type AnyFetchEndpointFunction = AnyFactoryFn extends (input: infer input) => infer result
  ? (input: input & { context: any }) => result
  : never;

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

  /** Read an input key, yielding `never` only when the key genuinely does not exist. */
  type infer_init<endpoint, key extends PropertyKey> = key extends keyof fetch_input<endpoint>
    ? fetch_input<endpoint>[key]
    : never;

  type AnyEndpointInput = AnyFetchEndpointFunction | AnyEndpoint;

  export type Params<endpoint extends AnyEndpointInput> = infer_init<endpoint, "params">;

  export type Query<endpoint extends AnyEndpointInput> = infer_init<endpoint, "query">;

  export type Body<endpoint extends AnyEndpointInput> = infer_init<endpoint, "body">;

  /** The per-call out-of-band `context` argument (never present when the endpoint declares none). */
  export type Context<endpoint extends AnyEndpointInput> = infer_init<endpoint, "context">;

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
      ? response extends {
          ok: true;
          status: infer member_status extends number;
          data: infer data;
        }
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
