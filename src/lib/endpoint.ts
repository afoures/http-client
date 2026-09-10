import { ParseError, SerializationError, UnexpectedError } from "./errors.ts";
import {
  type ErrorMessage,
  type HTTPFetch,
  type HTTPMethod,
  type HTTPStatus,
  type Json,
  type Parser,
  type Pathname,
  type Pretty,
  type Schema,
  type Serializer,
} from "./types.ts";
import { type CompiledPathname, compile_pathname, generate_pathname } from "./pathname.ts";

const RESPONSE = {
  success(
    method: HTTPMethod.Any,
    data: any,
    raw_response: Response,
  ): HTTPFetch.SuccessfulResponse<any, any> {
    const response: HTTPFetch.SuccessfulResponse<any, any> = {
      kind: "SuccessfulResponse",
      ok: true,
      method,
      url: raw_response.url,
      status: raw_response.status as HTTPStatus.SuccessfulResponse,
      data,
      headers: raw_response.headers,
      raw_response,
    };
    Object.defineProperty(response, "raw_response", {
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return response;
  },
  redirect(method: HTTPMethod.Any, raw_response: Response): HTTPFetch.RedirectMessage {
    const redirect_to = raw_response.headers.get("Location") || null;
    const response: HTTPFetch.RedirectMessage = {
      kind: "RedirectMessage",
      ok: false,
      method,
      url: raw_response.url,
      status: raw_response.status as HTTPStatus.RedirectMessage,
      redirect_to,
      headers: raw_response.headers,
      raw_response,
    };
    Object.defineProperty(response, "raw_response", {
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return response;
  },
  client_error(
    method: HTTPMethod.Any,
    error: any,
    raw_response: Response,
  ): HTTPFetch.ClientErrorResponse<any, any> {
    const response: HTTPFetch.ClientErrorResponse<any, any> = {
      kind: "ClientErrorResponse",
      ok: false,
      method,
      url: raw_response.url,
      status: raw_response.status as HTTPStatus.ClientErrorResponse,
      error,
      headers: raw_response.headers,
      raw_response,
    };
    Object.defineProperty(response, "raw_response", {
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return response;
  },
  server_error(
    method: HTTPMethod.Any,
    error: any,
    raw_response: Response,
  ): HTTPFetch.ServerErrorResponse<any, any> {
    const response: HTTPFetch.ServerErrorResponse<any, any> = {
      kind: "ServerErrorResponse",
      ok: false,
      method,
      url: raw_response.url,
      status: raw_response.status as HTTPStatus.ServerErrorResponse,
      error,
      headers: raw_response.headers,
      raw_response,
    };
    Object.defineProperty(response, "raw_response", {
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return response;
  },
};

/** The first {@link Endpoint} argument: the route this endpoint addresses. */
export type EndpointRoute<
  http_method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
> = {
  method: http_method;
  pathname: Pathname.Validate<pathname>;
};

/**
 * The second {@link Endpoint} argument: the params/query/body serializers and the per-status
 * response parsers. Pass it as a plain object, or as a `(context) => definition` factory to build
 * it from the per-call context (annotate the parameter: the annotation is what declares the
 * endpoint's context type).
 *
 * `body` sits in the unconditional base object, and the diagnostic for a method that cannot carry
 * one is a sibling member contributing an optional {@link ErrorMessage} under the same key. An
 * optional {@link ErrorMessage} already permits the key's absence, so the arm that spelled out
 * `{ body?: never }` is not needed.
 *
 * Both conditionals here are keyed on the first argument (`http_method`, `pathname`), which is
 * fixed before this argument is checked, so neither delays a slot's schema and neither costs a
 * custom `serialize` its `data` type. That was not true of the previous layout, where the whole
 * definition arrived in one object literal. Moving `body` behind its conditional therefore also
 * types `data` correctly now, and was measured: it is 0.3% to 1% more instantiations on every
 * endpoint bench, so the base-object form stays.
 */
export type EndpointDefinition<
  http_method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
  params_schema extends Schema._,
  query_schema extends Schema._,
  body_schema extends Schema._,
  response_schemas extends Partial<Record<Parser.AllowedStatus, Schema._>>,
> = {
  query?: Serializer.QueryString<query_schema>;
  body?: Serializer.Body<body_schema>;
  responses?: Parser.ResponseBodyByStatus<response_schemas>;
} & (pathname extends Pathname.WithParams
  ? { params?: Serializer.Params<pathname, params_schema> }
  : [params_schema] extends [never]
    ? { params?: never }
    : { params?: ErrorMessage<"this url does not have dynamic params"> }) &
  (http_method extends HTTPMethod.WithBody
    ? {}
    : { body?: ErrorMessage<"this http method does not support body"> });

/**
 * The third {@link Endpoint} argument: default request options for every call, plus `context`,
 * the endpoint-level default context values. Defaulted context keys become optional at the call
 * site.
 *
 * `context` is only meaningful once the definition factory's parameter declares a context type, so
 * the sibling member below turns it into an {@link ErrorMessage} when nothing does. It sits in its
 * own conditional member rather than in the base so the base stays an inference site for
 * `context_defaults`.
 */
export type EndpointOptions<context_type, context_defaults> = HTTPFetch.OptionalRequestInit &
  HTTPFetch.DefaultRequestInit & {
    /** Endpoint-level default context, merged over any client-level context and under any per-call context. */
    context?: context_defaults & Partial<NoInfer<context_type>>;
  } & ([unknown] extends [context_type]
    ? {
        context?: ErrorMessage<"this endpoint declares no context; annotate the definition factory's parameter, e.g. `(context: MyContext) => ({ ... })`">;
      }
    : {});

/** The serializers and parsers of one resolved definition, normalized with their default `serialize`. */
export type ResolvedDefinition = {
  serializers: Record<"params" | "query" | "body", Serializer.Any | null>;
  parsers: Record<string, Parser.Any>;
};

type extract_outputs<map extends Partial<Record<string | number, Schema._>>> = {
  [key in keyof map]: map[key] extends Schema._ ? Schema.infer_output<map[key]> : never;
};

/**
 * A typed, reusable descriptor of a single HTTP endpoint: its route, and the schemas that serialize
 * the request and parse each response. Pass a tree of `Endpoint` instances to {@link http_client}
 * to get callable, typed fetch functions.
 *
 * The definition is a plain object, or a `(context) => definition` factory when it depends on the
 * per-call context. Annotating the factory's parameter is what declares the endpoint's context
 * type, and the context is then in scope by closure for every schema, `serialize` and `parse` the
 * definition contains.
 *
 * @example
 * const get_user = new Endpoint(
 *   { method: "GET", pathname: "/users/:id" },
 *   { responses: { 200: { schema: z.object({ id: z.string() }), parse: "json" } } },
 * );
 *
 * @example
 * // context-driven, with an endpoint-level default for `tz`
 * const get_time = new Endpoint(
 *   { method: "GET", pathname: "/time" },
 *   (context: { tz: string }) => ({
 *     responses: { 200: { schema: z.object({ tz: z.literal(context.tz) }), parse: "json" } },
 *   }),
 *   { context: { tz: "UTC" } },
 * );
 */
export class Endpoint<
  http_method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
  params_schema extends Schema._ = never,
  query_schema extends Schema._ = never,
  body_schema extends Schema._ = never,
  response_schemas extends Partial<Record<Parser.AllowedStatus, Schema._>> = {},
  context_type = unknown,
  const context_defaults = {},
> {
  #method: http_method;
  #pattern: CompiledPathname;
  #definition: definition_or_factory;
  /** The resolved definition of a static (non-factory) definition, normalized once at construction. */
  #static_definition: ResolvedDefinition | null;
  #options: HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit;
  #context_default: context_defaults;

  constructor(
    route: EndpointRoute<http_method, pathname>,
    definition?:
      | EndpointDefinition<
          http_method,
          pathname,
          params_schema,
          query_schema,
          body_schema,
          response_schemas
        >
      | ((
          context: context_type,
        ) => EndpointDefinition<
          http_method,
          pathname,
          params_schema,
          query_schema,
          body_schema,
          response_schemas
        >),
    options?: EndpointOptions<context_type, context_defaults>,
  ) {
    this.#method = route.method;
    // `Pathname.Validate` is a deferred conditional while `pathname` is generic, so it is not yet
    // known to be a string here even though every branch is one.
    this.#pattern = compile_pathname(route.pathname as string);
    this.#definition = definition as definition_or_factory;
    this.#static_definition =
      typeof this.#definition === "function" ? null : normalize_definition(this.#definition);

    // `context` carries the endpoint's default context values, so it is kept out of `#options`,
    // which is merged into the request init of every call.
    const { context, ...request_options } = (options ?? {}) as HTTPFetch.OptionalRequestInit &
      HTTPFetch.DefaultRequestInit & { context?: context_defaults };
    this.#options = request_options;
    this.#context_default = (context ?? {}) as context_defaults;
  }

  /**
   * Build the serializers and parsers for one call, running a definition factory with `context`.
   * Returns an {@link UnexpectedError} as a value when the factory throws.
   *
   * {@link http_client} calls this once per request and hands the result to `generate_url`,
   * `serialize_body` and `parse_response`, which is what makes a definition factory run exactly
   * once per request. Calling one of those three directly resolves the definition for that call.
   */
  resolve_definition(context?: context_type): ResolvedDefinition | UnexpectedError {
    // Only a factory definition leaves `#static_definition` empty, so what is left is a factory.
    if (this.#static_definition) return this.#static_definition;
    const factory = this.#definition as (context: context_type) => EndpointDefinitionValue;

    try {
      return normalize_definition(factory(context as context_type));
    } catch (cause) {
      return new UnexpectedError("Definition resolution failed", {
        cause,
        operation: "resolve_definition",
        request: { url: this.#pattern.source, method: this.#method },
      });
    }
  }

  /** The endpoint's HTTP method. */
  get method() {
    return this.#method;
  }

  /** The default request options passed to the constructor. */
  get options(): HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit {
    return this.#options;
  }

  /** Endpoint-level default context, merged over any client-level context and under any per-call context. */
  get context_default(): context_defaults {
    return this.#context_default;
  }

  /** Build the request URL from `base_url` plus typed params and query. `http_client` calls this internally; call it directly to produce a URL (e.g. for a link or prefetch) without sending a request. Returns a {@link SerializationError} as a value if validation or serialization fails, or an {@link UnexpectedError} if a definition factory throws. */
  async generate_url(
    init: Pretty<
      { base_url: string } & HTTPFetch.TypedParamsInit<pathname, params_schema> &
        HTTPFetch.TypedQueryInit<query_schema>
    >,
    context?: context_type,
    /** Definition already resolved for this call; omit it and the definition is resolved here. */
    resolved?: ResolvedDefinition,
  ): Promise<URL | SerializationError | UnexpectedError> {
    const definition = resolved ?? this.resolve_definition(context);
    if (definition instanceof Error) return definition;
    const { params: params_serializer, query: query_serializer } = definition.serializers;

    // Values are left unstringified: `generate_pathname` stringifies them itself, and needs to see
    // `null`/`undefined` to drop an optional segment rather than emit `"null"`/`"undefined"`.
    let pathname_params: Record<string, string | number | null | undefined> = {};

    if ("params" in init && init.params !== undefined) {
      if (params_serializer) {
        const result = await params_serializer.schema["~standard"].validate(init.params);

        if (result.issues !== undefined) {
          return new SerializationError("Params serialization failed", {
            operation: "generate_url",
            cause: result.issues,
            input: { params: init.params },
          });
        }

        const transformed_params = result.value;

        if (typeof params_serializer.serialize === "function") {
          try {
            pathname_params = params_serializer.serialize(transformed_params);
          } catch (cause) {
            return new SerializationError("Params serialization failed", {
              operation: "generate_url",
              cause,
              input: { params: init.params },
            });
          }
        } else {
          pathname_params = transformed_params as typeof pathname_params;
        }
      } else {
        pathname_params = init.params as typeof pathname_params;
      }
    }

    const pathname = generate_pathname(this.#pattern, pathname_params);

    let search_params = new URLSearchParams();

    if ("query" in init && init.query !== undefined && query_serializer) {
      const result = await query_serializer.schema["~standard"].validate(init.query);

      if (result.issues !== undefined) {
        return new SerializationError("Query serialization failed", {
          cause: result.issues,
          operation: "generate_url",
          input: { query: init.query },
        });
      }

      const transformed_query = result.value;

      if (typeof query_serializer.serialize === "function") {
        try {
          search_params = query_serializer.serialize(transformed_query);
        } catch (cause) {
          return new SerializationError("Query serialization failed", {
            cause,
            operation: "generate_url",
            input: { query: init.query },
          });
        }
      } else if (query_serializer.serialize === "urlencoded") {
        if (Array.isArray(transformed_query)) {
          for (const entry of transformed_query) {
            if (!Array.isArray(entry) || entry.length !== 2) {
              return new SerializationError("Query serialization failed", {
                cause: new Error(
                  "an array query must be a list of [key, value] entries; use a `serialize` function for any other shape",
                ),
                operation: "generate_url",
                input: { query: init.query },
              });
            }
            const [key, value] = entry;
            if (!append_query_value(search_params, String(key), value)) {
              return query_value_error(String(key), init.query);
            }
          }
        } else if (transformed_query !== null && typeof transformed_query === "object") {
          for (const [key, value] of Object.entries(transformed_query)) {
            if (!append_query_value(search_params, key, value)) {
              return query_value_error(key, init.query);
            }
          }
        }
      }
    }

    const url = new URL(pathname.startsWith("/") ? pathname.slice(1) : pathname, init.base_url);

    const query_string = search_params.toString();
    if (query_string) {
      url.search = query_string;
    }

    return url;
  }

  /** Validate and serialize the request body, returning the encoded body and its content type. Returns a {@link SerializationError} as a value on failure, or an {@link UnexpectedError} if a definition factory throws. */
  async serialize_body(
    init: Pretty<HTTPFetch.TypedBodyInit<body_schema>>,
    context?: context_type,
    /** Definition already resolved for this call; omit it and the definition is resolved here. */
    resolved?: ResolvedDefinition,
  ): Promise<
    | {
        body: BodyInit | null;
        content_type?: string;
      }
    | SerializationError
    | UnexpectedError
  > {
    if (!("body" in init) || init.body == undefined) {
      return { body: null, content_type: undefined };
    }

    const definition = resolved ?? this.resolve_definition(context);
    if (definition instanceof Error) return definition;
    const body_serializer = definition.serializers.body;

    if (!body_serializer) {
      return { body: null, content_type: undefined };
    }

    const result = await body_serializer.schema["~standard"].validate(init.body);

    if (result.issues !== undefined) {
      return new SerializationError("Body serialization failed", {
        operation: "serialize_body",
        cause: result.issues,
        input: { body: init.body },
      });
    }

    const transformed_content = result.value;

    if (typeof body_serializer.serialize === "function") {
      try {
        return body_serializer.serialize(transformed_content);
      } catch (cause) {
        return new SerializationError("Body serialization failed", {
          operation: "serialize_body",
          cause,
          input: { body: init.body },
        });
      }
    } else {
      return {
        body: JSON.stringify(transformed_content),
        content_type: "application/json",
      };
    }
  }

  /** Parse a raw `Response` into a typed response envelope, selecting the parser for its status (exact status, then `2xx`/`4xx`/`5xx` fallback). Returns a {@link ParseError} as a value on failure, or an {@link UnexpectedError} if a definition factory throws. */
  async parse_response(
    raw_response: Response,
    context?: context_type,
    /** Definition already resolved for this call; omit it and the definition is resolved here. */
    resolved?: ResolvedDefinition,
  ): Promise<
    HTTPFetch.AnyResponse<extract_outputs<response_schemas>> | ParseError | UnexpectedError
  > {
    const response = raw_response.clone();
    const status = raw_response.status;

    if (status >= 300 && status < 400) {
      return RESPONSE.redirect(this.#method, raw_response) as HTTPFetch.AnyResponse<
        extract_outputs<response_schemas>
      >;
    }

    const definition = resolved ?? this.resolve_definition(context);
    if (definition instanceof Error) return definition;

    const parser = get_parser_for(definition.parsers, status);

    const parse_response = async (parser: Parser.Any): Promise<unknown | ParseError> => {
      if (parser.parse == null) {
        return new ParseError("Response parsing failed", {
          cause: new Error("parser.parse is not defined"),
          operation: "parse_response",
          response: {
            status,
            headers: raw_response.headers,
          },
        });
      }
      let parsed;
      if (typeof parser.parse === "function") {
        try {
          parsed = await parser.parse(response.body);
        } catch (cause) {
          return new ParseError("Response parsing failed", {
            cause,
            operation: "parse_response",
            response: {
              status,
              headers: raw_response.headers,
            },
          });
        }
      } else if (parser.parse === "json") {
        parsed = await parse_as_json(response);
      } else if (parser.parse === "text") {
        parsed = await response.text();
      }

      const result = await parser.schema["~standard"].validate(parsed);

      if (result.issues !== undefined) {
        return new ParseError("Response parsing failed", {
          cause: result.issues,
          operation: "parse_response",
          response: {
            status,
            headers: raw_response.headers,
            body: parsed,
          },
        });
      }

      return result.value;
    };

    if (status >= 400 && status < 600) {
      let error: any;
      if (parser) {
        const parsed = await parse_response(parser);
        if (parsed instanceof ParseError) return parsed;
        error = parsed;
      } else {
        error = await response.text();
      }

      return (
        status < 500
          ? RESPONSE.client_error(this.#method, error, raw_response)
          : RESPONSE.server_error(this.#method, error, raw_response)
      ) as HTTPFetch.AnyResponse<extract_outputs<response_schemas>>;
    }

    if (status >= 200 && status < 300) {
      if (status === 204) {
        return RESPONSE.success(this.#method, null, raw_response) as HTTPFetch.AnyResponse<
          extract_outputs<response_schemas>
        >;
      }

      let data: any = null;
      if (parser) {
        const parsed = await parse_response(parser);
        if (parsed instanceof ParseError) return parsed;
        data = parsed;
      }

      return RESPONSE.success(this.#method, data, raw_response) as HTTPFetch.AnyResponse<
        extract_outputs<response_schemas>
      >;
    }

    throw new Error(`Unhandled status code: ${status}`);
  }
}

/** Any {@link Endpoint}, regardless of its type parameters. Useful for constraints and endpoint-tree types. */
export type AnyEndpoint = Endpoint<any, any, any, any, any, any, any, any>;

/** The definition as the runtime sees it: every slot optional, no type parameters left. */
type EndpointDefinitionValue = Partial<Record<"params" | "query" | "body", Serializer.Any>> & {
  responses?: Record<string, Parser.Any>;
};

type definition_or_factory =
  | EndpointDefinitionValue
  | ((context: any) => EndpointDefinitionValue)
  | undefined;

function normalize_definition(definition: EndpointDefinitionValue | undefined): ResolvedDefinition {
  return {
    serializers: {
      params: as_serializer(definition?.params),
      query: as_serializer(definition?.query, "urlencoded"),
      body: as_serializer(definition?.body, "json"),
    },
    parsers: Object.fromEntries(
      Object.entries(definition?.responses ?? {}).flatMap(([status, parser]) => {
        const resolved = as_parser(parser);
        return resolved ? [[status, resolved] as const] : [];
      }),
    ),
  };
}

function get_parser_for(
  parsers: ResolvedDefinition["parsers"],
  status: number,
): Parser.Any | undefined {
  return parsers[status] ?? parsers[`${Math.floor(status / 100)}xx`];
}

type urlencoded_leaf = string | number | boolean;

/**
 * Append `value` under `key`, expanding an array into one repeated key per item (`?tags=a&tags=b`).
 * `null` and `undefined` are skipped. Returns `false` for a value `"urlencoded"` cannot encode, so
 * the caller can surface it as a {@link SerializationError} instead of writing `[object Object]`.
 */
function append_query_value(target: URLSearchParams, key: string, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!append_query_value(target, key, item)) return false;
    }
    return true;
  }
  if (typeof value === "object") return false;
  target.append(key, String(value as urlencoded_leaf));
  return true;
}

function query_value_error(key: string, query: unknown): SerializationError {
  return new SerializationError("Query serialization failed", {
    cause: new Error(
      `the query value at \`${key}\` is not urlencoded-compatible; use a \`serialize\` function to encode it`,
    ),
    operation: "generate_url",
    input: { query },
  });
}

async function parse_as_json(response: Response): Promise<Json.Value | null> {
  const text = await response.text();
  try {
    if (text) return JSON.parse(text);
    return null;
  } catch (e) {
    throw new Error(
      `Failed to parse response as JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function as_serializer(
  serializer: Serializer.Any | undefined,
  default_serialize?: string,
): Serializer.Any | null {
  if (!serializer || typeof serializer !== "object" || !("schema" in serializer)) return null;

  if (default_serialize === undefined) return serializer;

  return { ...serializer, serialize: serializer.serialize ?? default_serialize };
}

function as_parser(parser: Parser.Any | undefined): Parser.Any | null {
  if (!parser || typeof parser !== "object" || !("schema" in parser)) return null;

  return parser;
}
