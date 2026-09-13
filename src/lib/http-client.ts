import { Endpoint, type AnyEndpoint } from "./endpoint.ts";
import {
  type ErrorMessage,
  type HTTPFetch,
  type HTTPMethod,
  type MaybePromise,
  type Parser,
  type Pathname,
  type Pretty,
  type RetryPolicy,
  type Schema,
} from "./types.ts";
import {
  AbortedError,
  NetworkError,
  TimeoutError,
  UnexpectedError,
  type ErrorContext,
} from "./errors.ts";
import {
  default_retry_condition,
  discard_body,
  extract_args,
  merge_context,
  merge_options,
  remove_custom_options,
  request_metadata,
  response_metadata,
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

/**
 * Floor and clamp both keys, collapsing an empty result to `undefined`. Normalization is required
 * rather than defensive: `AbortSignal.timeout` throws a `RangeError` on a fractional or negative
 * delay, and `timeout: budget_remaining / 2` reaches both. Clamping lands on the right semantics
 * too, since a negative budget is an exhausted budget.
 *
 * `NaN` and `Infinity` have no sensible reading, so they come back as an {@link UnexpectedError}
 * naming the key. An error rather than a throw: unlike `base_url`, a timeout can be computed from
 * runtime state, so a bad one is a call outcome, not a construction mistake.
 */
function resolve_timeout(
  value: number | HTTPFetch.TimeoutConfig | undefined,
  context: Partial<ErrorContext>,
): HTTPFetch.TimeoutConfig | undefined | UnexpectedError {
  const config = typeof value === "number" ? { total: value } : value;
  const resolved: HTTPFetch.TimeoutConfig = {};

  for (const key of ["total", "attempt"] as const) {
    const raw = config?.[key];
    if (raw === undefined) continue;
    if (!Number.isFinite(raw)) {
      return new UnexpectedError(
        `Invalid timeout.${key}: ${raw}. Expected a finite number of milliseconds.`,
        { cause: raw, operation: "resolve_timeout", ...context },
      );
    }
    resolved[key] = Math.max(0, Math.floor(raw));
  }

  return resolved.total === undefined && resolved.attempt === undefined ? undefined : resolved;
}

/**
 * A budget of `0` is exhausted from the outset, but `AbortSignal.timeout(0)` fires on a timer, so
 * it would still let one attempt start. Abort synchronously instead, keeping the reason shaped like
 * the runtime's so both paths classify identically. Serves the `total` deadline and the `attempt`
 * bound alike.
 */
function timeout_signal_for(milliseconds: number): AbortSignal {
  return milliseconds === 0
    ? AbortSignal.abort(
        new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      )
    : AbortSignal.timeout(milliseconds);
}

/** `undefined` for no signals, the signal itself for one, `AbortSignal.any` beyond that. */
function combine(...signals: Array<AbortSignal | null | undefined>): AbortSignal | undefined {
  const present = signals.filter((signal) => signal != null);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return AbortSignal.any(present);
}

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

/** The union of every declared type for `key` across the endpoint tree's contexts. */
type context_value<union, key extends PropertyKey> = union extends unknown
  ? key extends keyof union
    ? union[key]
    : never
  : never;

/**
 * `false` for any member whose type for `key` is not mutually assignable with the union of every
 * member's type for `key`. Distributes, so the result is `true | false` when any member disagrees.
 * Members that do not declare `key` at all yield `true`: an endpoint that ignores a key cannot
 * conflict over it.
 */
type member_matches<union, key extends PropertyKey, all> = union extends unknown
  ? key extends keyof union
    ? [union[key]] extends [all]
      ? [all] extends [union[key]]
        ? true
        : false
      : false
    : true
  : never;

/**
 * Whether every endpoint declaring `key` declares it with the same type. Mutual assignability
 * rather than union cardinality, so `boolean` (which is `true | false`) and a single endpoint's
 * `string | number` are both consistent.
 */
type is_consistent<union, key extends PropertyKey> =
  false extends member_matches<union, key, context_value<union, key>> ? false : true;

/**
 * The shape accepted by the client-level `context` of {@link HttpClientConfig}: the merged context
 * of every endpoint in the tree, with all keys optional. Use it to constrain a wrapper's own
 * context type parameter.
 *
 * A key that several endpoints declare with conflicting types resolves to an {@link ErrorMessage}
 * rather than a usable type: the key stays optional, so a tree containing such a key is fine as
 * long as no client-level default is set for it, and setting one is a compile error. Without the
 * check, the default would be accepted and would then make the key *optional* at a call site whose
 * endpoint cannot accept its type.
 *
 * @example
 * const endpoints = { users: { get: get_user_endpoint } };
 * function create_client<const default_context extends ClientContext<typeof endpoints> = never>(
 *   config: HttpClientConfig<typeof endpoints, default_context>,
 * ) {
 *   return http_client(endpoints, config);
 * }
 */
export type ClientContext<endpoints> = [ContextUnion<endpoints>] extends [infer union]
  ? {
      [key in ContextKeys<union>]?: is_consistent<union, key> extends true
        ? context_value<union, key>
        : ErrorMessage<`context key '${key extends string
            ? key
            : "<symbol>"}' is declared with conflicting types across endpoints; give it the same type in every endpoint, or use separate clients`>;
    }
  : never;

/**
 * Keys covered by client-level defaults. `never` marks a config that declares no defaults, and must
 * short-circuit: `keyof never` is `string | number | symbol`, which would make every context key
 * optional at the call site instead of none. A wrapper forwards the marker as `undefined` (a
 * `context?: never` field read back), which needs no arm of its own: `keyof undefined` is `never`.
 */
type client_default_keys<default_context> = [default_context] extends [never]
  ? never
  : keyof default_context;

export function fetch_endpoint_factory<
  http_method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
  params_schema extends Schema._,
  query_schema extends Schema._,
  body_schema extends Schema._,
  responses extends Partial<Record<Parser.AllowedStatus, Schema._>>,
  context_type = unknown,
  context_defaults extends Partial<NoInfer<context_type>> = {},
  default_context = never,
>({
  base_url,
  endpoint,
  custom_fetch,
  get_default_options = () => ({}),
  client_context,
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
}) {
  async function fetch_endpoint(
    input: HTTPFetch.TypedParamsInit<pathname, params_schema> &
      HTTPFetch.TypedQueryInit<query_schema> &
      HTTPFetch.TypedBodyInit<body_schema> &
      HTTPFetch.TypedContextInit<
        context_type,
        keyof context_defaults | client_default_keys<default_context>
      > &
      HTTPFetch.OptionalRequestInit &
      HTTPFetch.DefaultRequestInit,
  ) {
    let start_time = Date.now();

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

    const resolved_timeout = resolve_timeout(merged_options.timeout, {
      request: { url: base_url, method: endpoint.method, baseUrl: base_url },
      timing: { startTime: start_time },
    });
    if (resolved_timeout instanceof Error) return resolved_timeout;
    const timeout = resolved_timeout;

    /**
     * Built once, as early as the call can: `total` is only known once the client-level `options()`
     * factory has resolved, so the time that factory took is subtracted from the budget here and the
     * deadline is measured from `start_time` like everything else. From this point on it covers URL
     * generation, body serialization, every attempt, every inter-attempt delay, and response
     * parsing. `call_signal` governs the sleep as well as every attempt, which is why no other
     * remaining-budget arithmetic is needed below.
     */
    const deadline_signal =
      timeout?.total !== undefined
        ? timeout_signal_for(Math.max(0, timeout.total - (Date.now() - start_time)))
        : undefined;
    const call_signal = combine(merged_options.signal, deadline_signal);

    // Resolved once here and handed to all three methods below, so a definition factory runs
    // exactly once per request rather than once per method that needs it. It sits after the
    // deadline signal so a slow factory counts against `timeout.total` like everything else.
    const definition = endpoint.resolve_definition(context as any);
    if (definition instanceof Error) return definition;

    const url = await endpoint
      .generate_url(
        {
          base_url,
          params: args.params,
          query: args.query,
        } as any,
        context as any,
        definition,
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
        definition,
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

    // The serializer owns `Content-Type`: a header-level value is dropped, and the serializer's is
    // re-applied after every `recover` replacement below.
    const body_content_type = serialized.content_type;
    request_headers.delete("Content-Type");
    if (body_content_type) request_headers.set("Content-Type", body_content_type);

    const retry_policy = {
      when: merged_options.retry?.when ?? default_retry_condition,
      attempts: merged_options.retry?.attempts ?? 0,
      delay: merged_options.retry?.delay ?? 0,
      recover: merged_options.retry?.recover,
    } satisfies RetryPolicy.Configuration;

    type AttemptError = UnexpectedError | NetworkError | TimeoutError | AbortedError;

    let attempt = 0;
    let request: Request;
    let response: Response | undefined;
    let error: AttemptError | undefined;

    const request_context = () =>
      ({
        url: url.toString(),
        method: endpoint.method,
        timeout,
        baseUrl: base_url,
      }) satisfies ErrorContext["request"];

    /**
     * A `total` expiry is reported against the deadline it blew rather than by inspecting `reason`,
     * so the message names the configured budget and the two timeouts stay distinguishable in the
     * error with no extra field. Anything else is classified from the reason, which may be any
     * value at all since `AbortController.abort(reason)` accepts one: a caller passing
     * `AbortSignal.timeout(n)` gets a `TimeoutError`, a plain `abort()` an `AbortedError`.
     */
    function classify_abort(reason: unknown, operation: string, extra: Partial<ErrorContext> = {}) {
      const context = {
        operation,
        request: request_context(),
        timing: { startTime: start_time, duration: Date.now() - start_time, attempt },
        ...extra,
      } satisfies Partial<ErrorContext>;

      if (deadline_signal?.aborted) {
        return new TimeoutError(`Call deadline of ${timeout?.total}ms exceeded`, {
          cause: deadline_signal.reason,
          ...context,
        });
      }

      const message = reason instanceof Error ? reason.message : "The operation was aborted";
      return reason instanceof Error && reason.name === "TimeoutError"
        ? new TimeoutError(message, { cause: reason, ...context })
        : new AbortedError(message, { cause: reason, ...context });
    }

    /**
     * A `total` expiry must never reach `when`: the budget is gone, so retrying is incoherent, and
     * `default_retry_condition` retries `TimeoutError`, which would otherwise loop until attempts
     * run out. The two timeouts are told apart by checking the deadline signal directly rather than
     * by inspecting the error, since an `attempt` expiry produces an identical `TimeoutError`.
     */
    function terminal_abort(operation: string, extra?: Partial<ErrorContext>) {
      if (deadline_signal?.aborted) return classify_abort(deadline_signal.reason, operation, extra);
      if (merged_options.signal?.aborted) {
        return classify_abort(merged_options.signal.reason, operation, extra);
      }
      return undefined;
    }

    /**
     * `when`, then `attempts`, then `delay`, for the attempt that just settled. `attempts` counts
     * retries, so it is compared against the retries already made (`attempt - 1`) rather than the
     * requests sent: `attempts: 1` allows a second request, `0` none. A throwing callback ends the
     * call with an `UnexpectedError` naming `retry_policy`.
     */
    async function decide_retry(
      attempt_request: HTTPFetch.RequestMetadata,
      attempt_response: HTTPFetch.ResponseMetadata | undefined,
      attempt_error: AttemptError | undefined,
    ): Promise<{ retry: false } | { retry: true; delay: number } | UnexpectedError> {
      try {
        const should_retry = await retry_policy.when({
          request: attempt_request,
          response: attempt_response,
          error: attempt_error,
        });
        if (!should_retry) return { retry: false };

        const max_retries =
          typeof retry_policy.attempts === "function"
            ? await retry_policy.attempts({ request: attempt_request })
            : retry_policy.attempts;
        if (attempt - 1 >= max_retries) return { retry: false };

        const delay =
          typeof retry_policy.delay === "function"
            ? await retry_policy.delay({
                request: attempt_request,
                response: attempt_response,
                error: attempt_error,
                attempt,
              })
            : retry_policy.delay;
        return { retry: true, delay };
      } catch (local_error) {
        return new UnexpectedError("Failed to check retry policy", {
          cause: local_error,
          operation: "retry_policy",
          request: request_context(),
          timing: {
            startTime: start_time,
            attempt,
            maxAttempts:
              typeof retry_policy.attempts === "function" ? undefined : retry_policy.attempts,
          },
        });
      }
    }

    /**
     * The wait, then `recover`, once a retry has been decided. `sleep` only ever rejects on abort,
     * and it is classified here rather than routed through the retry-policy catch, which would
     * launder the abort into "Failed to check retry policy". Header overrides replace the set
     * wholesale, except `Content-Type`, which the serializer owns.
     */
    async function prepare_retry(
      delay: number,
      attempt_request: HTTPFetch.RequestMetadata,
      attempt_response: HTTPFetch.ResponseMetadata | undefined,
      attempt_error: AttemptError | undefined,
    ): Promise<AttemptError | undefined> {
      if (delay > 0) {
        try {
          await sleep(delay, call_signal);
        } catch (reason) {
          return classify_abort(reason, "retry_delay");
        }
      }

      if (!retry_policy.recover) return undefined;

      let overrides: RetryPolicy.Overrides | void;
      try {
        overrides = await retry_policy.recover({
          request: attempt_request,
          response: attempt_response,
          error: attempt_error,
          attempt,
          current: { headers: new Headers(request_headers) },
        });
      } catch (local_error) {
        return new UnexpectedError("Failed to recover request", {
          cause: local_error,
          operation: "recover",
          request: request_context(),
          timing: { startTime: start_time, attempt },
        });
      }

      if (overrides && "headers" in overrides && overrides.headers !== undefined) {
        request_headers = new Headers(overrides.headers);
        request_headers.delete("Content-Type");
        if (body_content_type) request_headers.set("Content-Type", body_content_type);
      }
      return undefined;
    }

    do {
      // Reached only when the previous attempt is being retried, so its response is spent: nothing
      // will ever read that body, and cancelling it hands the connection back now rather than
      // whenever the dangling stream is collected.
      discard_body(response);
      response = undefined;

      /**
       * Catches a deadline or caller abort that landed before this attempt: during URL generation,
       * during a `when` / `attempts` / `recover` callback, or on a `total` of `0`. Without it the
       * loop would start an attempt whose signal is already aborted, which works but wastes a trip
       * through `fetch`.
       */
      const pending_abort = terminal_abort("fetch");
      if (pending_abort) {
        error = pending_abort;
        break;
      }

      const attempt_signal = combine(
        call_signal,
        timeout?.attempt !== undefined ? timeout_signal_for(timeout.attempt) : undefined,
      );

      try {
        request = new Request(url, {
          ...remove_custom_options(merged_options),
          method: endpoint.method,
          body: serialized.body,
          headers: request_headers,
          signal: attempt_signal,
          // Required by `fetch` for a `ReadableStream` body. Harmless on every other request: a
          // runtime that does not know `duplex` drops it during WebIDL dictionary conversion, and
          // one that does ignores it when there is no stream to send.
          // oxlint-disable-next-line unicorn/no-useless-spread
          ...{ duplex: "half" },
        });
      } catch (local_error) {
        error = new UnexpectedError("Failed to create request", {
          cause: local_error,
          operation: "create_request",
          request: { ...request_context(), headers },
          timing: { startTime: start_time, attempt: attempt + 1 },
        });
        break;
      }

      attempt++;

      if (attempt_signal?.aborted) {
        /**
         * `terminal_abort` just ruled out the deadline and the caller's signal, so only the
         * `attempt` bound can be aborted here: an `attempt` of `0` is already expired. The fetch
         * is skipped rather than trusted to notice, so the outcome does not depend on the fetch
         * implementation honoring its signal, and the expiry goes through `when` like any other.
         */
        error = classify_abort(attempt_signal.reason, "fetch");
      } else {
        try {
          response = await custom_fetch(request);
          error = undefined;
        } catch (local_error) {
          const duration = Date.now() - start_time;
          const context = {
            operation: "fetch",
            request: { url: request.url, method: request.method, timeout },
            timing: { startTime: start_time, duration, attempt },
          } satisfies Partial<ErrorContext>;
          if (local_error instanceof Error && local_error.name === "TimeoutError") {
            error = new TimeoutError(local_error.message, { cause: local_error, ...context });
          } else if (local_error instanceof Error && local_error.name === "AbortError") {
            error = new AbortedError(local_error.message, { cause: local_error, ...context });
          } else {
            error = new NetworkError("Network error", { cause: local_error, ...context });
          }
        }
      }

      const settled_abort = terminal_abort("fetch");
      if (settled_abort) {
        error = settled_abort;
        break;
      }

      /**
       * The retry callbacks see metadata, never the request or response themselves: the body of the
       * response they are deciding about still has to be read by the parser (or cancelled here), and
       * a callback that consumed it would leave the call with nothing to parse. Built once per
       * attempt and shared by all of them.
       */
      const attempt_request = request_metadata(request);
      const attempt_response = response ? response_metadata(response) : undefined;

      if (response) {
        // Decided on metadata before the body is read, so a response that is retried away never
        // has its body read into memory.
        const decision = await decide_retry(attempt_request, attempt_response, undefined);
        if (decision instanceof Error) {
          error = decision;
          break;
        }
        if (decision.retry) {
          const failure = await prepare_retry(
            decision.delay,
            attempt_request,
            attempt_response,
            undefined,
          );
          if (failure) {
            error = failure;
            break;
          }
          continue;
        }

        /**
         * `parse_response` returns its failures, so a rejection here is a body read that broke under
         * it (an abort landing mid-stream) or a broken invariant. Neither can report the body: it is
         * the thing that failed, there is no second copy, and reading one is what this whole design
         * is built to prevent. `discard_body` releases whatever is left of it.
         *
         * The `attempt` bound covers the body read too, and an expiry there is the one rejection
         * that is retried: the connection hung after the headers arrived, which is exactly what the
         * bound exists to recover from. The response is gone with its body, so the retry decision
         * below sees its metadata alongside the error.
         */
        const settled = response;
        const outcome = await endpoint.parse_response(settled, context as any, definition).then(
          (parsed) => ({ parsed }),
          (thrown: unknown) => ({ thrown }),
        );
        if ("parsed" in outcome) return outcome.parsed;

        discard_body(settled);
        const response_context = {
          response: { status: settled.status, headers: settled.headers },
        } satisfies Partial<ErrorContext>;

        const terminal = terminal_abort("parse_response", response_context);
        if (terminal) return terminal;

        const reason = outcome.thrown;
        const timing = { startTime: start_time, duration: Date.now() - start_time, attempt };
        if (reason instanceof Error && reason.name === "TimeoutError") {
          error = new TimeoutError(reason.message, {
            cause: reason,
            operation: "parse_response",
            request: request_context(),
            ...response_context,
            timing,
          });
          response = undefined;
        } else if (reason instanceof Error && reason.name === "AbortError") {
          return new AbortedError(reason.message, {
            cause: reason,
            operation: "parse_response",
            request: request_context(),
            ...response_context,
            timing,
          });
        } else {
          return new UnexpectedError("Failed to parse response", {
            cause: reason,
            operation: "parse_response",
            request: request_context(),
            ...response_context,
            timing,
          });
        }
      }

      // A failed attempt: the fetch threw, the `attempt` bound was already expired, or the body
      // read timed out. `attempt_response` is set in the last case only.
      const decision = await decide_retry(attempt_request, attempt_response, error);
      if (decision instanceof Error) {
        error = decision;
        break;
      }
      if (!decision.retry) break;

      const failure = await prepare_retry(decision.delay, attempt_request, attempt_response, error);
      if (failure) {
        error = failure;
        break;
      }
      // oxlint-disable-next-line no-constant-condition
    } while (true);

    // A response can be in hand even on the error paths (an abort or a throwing retry callback
    // after the attempt settled), and it is never parsed from here, so its body is spent too.
    if (error) {
      discard_body(response);
      return error;
    }

    // Every exit from the loop either returned a parsed result or set `error`, so this is an
    // invariant check rather than a reachable outcome.
    return new UnexpectedError("No response received", {
      cause: "No response received",
      operation: "parse_response",
      request: request_context(),
      timing: { startTime: start_time, attempt },
    });
  }

  return fetch_endpoint;
}

/**
 * Configuration for {@link http_client}, parameterized by the endpoint tree it is used with so the
 * client-level `context` is derived from the endpoints instead of being spelled out by hand.
 *
 * @example
 * // accept client-level defaults by threading `default_context`: the keys the caller actually
 * // passes become optional at the call site, the rest stay required
 * const endpoints = { users: { get: get_user_endpoint } };
 * function create_client<const default_context extends ClientContext<typeof endpoints> = never>(
 *   config: HttpClientConfig<typeof endpoints, default_context>,
 * ) {
 *   return http_client(endpoints, config);
 * }
 *
 * @example
 * // without `default_context`, the config declares no client-level defaults: `context` is rejected
 * // and every declared context key stays required at the call site
 * export type MyClientConfig = HttpClientConfig<typeof endpoints>;
 */
export type HttpClientConfig<
  endpoints = {},
  /**
   * The client-level defaults this config carries. Defaults to `never`: no defaults, so `context`
   * is rejected and every declared context key stays required at the call site. `undefined` is part
   * of the constraint so a forwarded `context?: never` stays a valid inference candidate instead of
   * falling back to the whole {@link ClientContext} shape.
   */
  default_context extends ClientContext<endpoints> | undefined = never,
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
   *
   * Must be absolute: {@link http_client} throws a `TypeError` at construction if it is not parsable.
   */
  base_url: string;
  /** Default request options applied to every call; may be a value or a (possibly async) factory. */
  options?:
    | (HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit)
    | (() => MaybePromise<HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit>);
  /** Client-level default context, merged under every endpoint's context; defaulted keys become optional at the call site. Absent unless `default_context` is threaded through. */
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
 *
 * @throws {TypeError} When `base_url` is not an absolute, parsable URL. This is the one failure the
 * client throws instead of returning: it is a static misconfiguration, so it cannot depend on call
 * input and is worth surfacing once at startup rather than from every call.
 */
export function http_client<
  const endpoints,
  const default_context extends ClientContext<endpoints> | undefined = never,
>(
  all_endpoints: ValidateEndpointMap<endpoints>,
  {
    base_url,
    options,
    context,
    fetch: custom_fetch = fetch,
  }: HttpClientConfig<endpoints, default_context>,
): map_to_fetch_endpoint_functions<endpoints, default_context> {
  if (!URL.canParse(base_url)) {
    throw new TypeError(
      `Invalid base_url: ${base_url}. Expected an absolute URL parsable by \`new URL()\`.`,
    );
  }

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
            // A raw `Endpoint` has no client in front of it, so no client-level defaults: `never`,
            // like `http_client` without `default_context`. `any` here would read as "every key
            // defaulted" and make the whole context optional in `$infer.Context` and `$infer.Input`.
            never
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
