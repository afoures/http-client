import type { HeadersInitWithReducer, HTTPFetch, Pathname, Pretty, Schema } from "./types";

function get_entries(source: HeadersInitWithReducer) {
  if (source instanceof Headers) {
    return source.entries();
  }
  if (Array.isArray(source)) {
    return source;
  }
  return Object.entries(source);
}

function merge_headers(...sources: Array<HeadersInitWithReducer | undefined>) {
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

export function extract_args<
  pathname extends Pathname.Relative,
  params_schema extends Schema._,
  query_schema extends Schema._,
  body_schema extends Schema._,
>(
  input: Pretty<
    HTTPFetch.TypedParamsInit<pathname, params_schema> &
      HTTPFetch.TypedQueryInit<query_schema> &
      HTTPFetch.TypedBodyInit<body_schema> &
      HTTPFetch.DefaultRequestInit &
      HTTPFetch.OptionalRequestInit
  >,
) {
  const { params, query, body, ...rest } = input as any;
  return {
    options: rest as HTTPFetch.DefaultRequestInit & HTTPFetch.OptionalRequestInit,
    args: {
      params,
      query,
      body,
    },
  };
}

export function remove_custom_options(
  options: HTTPFetch.DefaultRequestInit & HTTPFetch.OptionalRequestInit,
) {
  const { timeout: _timeout, headers: _headers, signal: _signal, ...rest } = options;
  return rest;
}

export function merge_options(
  ...sources: Array<HTTPFetch.DefaultRequestInit & HTTPFetch.OptionalRequestInit>
) {
  const headers = merge_headers(...sources.map((source) => source.headers));
  return {
    ...sources.reduce((acc, source) => ({ ...acc, ...source }), {}),
    headers,
  };
}
