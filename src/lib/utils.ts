import type { HeadersInitWithReducer, HTTPFetch, Pathname, RetryPolicy, Schema } from "./types";

function get_entries(source: HeadersInitWithReducer) {
  if (source instanceof Headers) {
    return source.entries();
  }
  if (Array.isArray(source)) {
    return source;
  }
  return Object.entries(source);
}

export function merge_headers(...sources: Array<HeadersInitWithReducer | undefined>) {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;

    for (const [raw_key, value_or_reducer] of get_entries(source)) {
      const key = raw_key.toLowerCase();
      if (typeof value_or_reducer === "function") {
        const new_value = value_or_reducer(headers.get(key) ?? undefined);
        if (new_value != null) {
          headers.set(key, new_value);
        } else {
          headers.delete(key);
        }
      } else if (value_or_reducer == null) {
        headers.delete(key);
      } else {
        headers.set(key, value_or_reducer.toString());
      }
    }
  }

  return headers;
}

type arg_value<init, key extends PropertyKey> = key extends keyof init ? init[key] : undefined;

export function extract_args<
  pathname extends Pathname.Relative,
  params_schema extends Schema._,
  query_schema extends Schema._,
  body_schema extends Schema._,
  context_type = unknown,
>(
  input: HTTPFetch.TypedParamsInit<pathname, params_schema> &
    HTTPFetch.TypedQueryInit<query_schema> &
    HTTPFetch.TypedBodyInit<body_schema> &
    HTTPFetch.OptionalRequestInit &
    HTTPFetch.DefaultRequestInit & { context?: context_type },
) {
  const { params, query, body, context, ...rest } = input as {
    params?: arg_value<HTTPFetch.TypedParamsInit<pathname, params_schema>, "params">;
    query?: arg_value<HTTPFetch.TypedQueryInit<query_schema>, "query">;
    body?: arg_value<HTTPFetch.TypedBodyInit<body_schema>, "body">;
    context?: context_type;
  } & HTTPFetch.OptionalRequestInit &
    HTTPFetch.DefaultRequestInit;
  return {
    options: rest,
    args: { params, query, body },
    context,
  };
}

export function merge_context(
  ...sources: Array<Record<string, unknown> | undefined | null>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) result[key] = value;
    }
  }
  return result;
}

export function remove_custom_options(
  options: HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit,
) {
  const { timeout: _timeout, headers: _headers, signal: _signal, retry: _retry, ...rest } = options;
  return rest;
}

function to_timeout_config(
  value: number | HTTPFetch.TimeoutConfig | undefined,
): HTTPFetch.TimeoutConfig {
  return typeof value === "number" ? { total: value } : (value ?? {});
}

/**
 * Merge `timeout` per key, like `retry`, so a client-level `{ attempt }` survives a per-call
 * `{ total }` instead of being replaced wholesale. An empty result collapses back to `undefined`
 * so `ErrorContext` never carries a meaningless `{}`. Shape only: validation belongs to the caller,
 * since this is a synchronous util with nowhere to put an error.
 */
function merge_timeout(
  left: number | HTTPFetch.TimeoutConfig | undefined,
  right: number | HTTPFetch.TimeoutConfig | undefined,
): HTTPFetch.TimeoutConfig | undefined {
  const merged = { ...to_timeout_config(left), ...to_timeout_config(right) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** The result of {@link merge_options}: the two custom keys resolved, and `headers` always present. */
export type MergedOptions = Omit<
  HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit,
  "timeout"
> & {
  timeout?: HTTPFetch.TimeoutConfig;
};

export function merge_options(
  ...sources: Array<HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit>
): MergedOptions & { headers: Headers } {
  return {
    ...sources.reduce<MergedOptions>((acc, source) => {
      return {
        ...acc,
        ...source,
        signal: acc.signal
          ? source.signal
            ? AbortSignal.any([acc.signal, source.signal])
            : acc.signal
          : source.signal,
        retry: { ...acc.retry, ...source.retry },
        timeout: merge_timeout(acc.timeout, source.timeout),
      };
    }, {}),
    headers: merge_headers(...sources.map((source) => source.headers)),
  };
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    signal?.addEventListener("abort", on_abort, { once: true });

    const token = setTimeout(() => {
      signal?.removeEventListener("abort", on_abort);
      resolve();
    }, ms);

    function on_abort() {
      clearTimeout(token);
      reject(signal!.reason);
    }
  });
}

/**
 * Default {@link RetryPolicy.Condition}: retry transient transport failures and the status codes
 * that indicate a retry may succeed. Aborts are never retried (the caller asked to stop), and
 * neither is `UnexpectedError` (user code threw, so retrying re-throws).
 */
export const default_retry_condition: RetryPolicy.Condition = ({ response, error }) => {
  if (error) return error.kind === "NetworkError" || error.kind === "TimeoutError";
  if (!response) return false;
  return response.status === 408 || response.status === 429 || response.status >= 500;
};
