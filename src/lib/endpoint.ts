import { ParseError, SerializationError } from "./errors.ts";
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
import { RoutePattern } from "@remix-run/route-pattern";

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

/** Type-carrying marker for an endpoint's out-of-band `context`, produced by {@link define_context}. Only `defaults` exists at runtime. */
export interface ContextMarker<context_type = unknown, defaults = {}> {
  readonly __context_type__: (context: context_type) => void;
  readonly defaults: defaults;
  /** Set endpoint-level default context values; defaulted keys become optional at the call site. */
  with_defaults<const next_defaults extends Partial<context_type>>(
    defaults: next_defaults,
  ): ContextMarker<context_type, next_defaults>;
}

/**
 * Declare an endpoint's out-of-band `context` type. Context is passed per call, is never
 * serialized into the request, and is threaded into schema factories and custom
 * `serialize`/`parse` functions. Chain `.with_defaults(...)` for endpoint-level defaults.
 *
 * @example
 * new Endpoint({
 *   method: "GET",
 *   pathname: "/users/:id",
 *   context: define_context<{ tz: string }>().with_defaults({ tz: "UTC" }),
 *   responses: { 200: { schema: (ctx) => schemaFor(ctx.tz), parse: "json" } },
 * });
 */
export function define_context<context_type = unknown>(): ContextMarker<context_type, {}> {
  function make<defaults>(defaults: defaults): ContextMarker<context_type, defaults> {
    return {
      defaults,
      with_defaults(next: unknown) {
        return make(next);
      },
    } as unknown as ContextMarker<context_type, defaults>;
  }
  return make({});
}

/** The object accepted by the {@link Endpoint} constructor: HTTP method, pathname, optional context, and params/query/body serializers plus per-status response parsers. */
export type EndpointDefinition<
  http_method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
  params_schema extends Schema._,
  query_schema extends Schema._,
  body_schema extends Schema._,
  response_schemas extends Partial<Record<Parser.AllowedStatus, Schema._>>,
  context_type = unknown,
  context_defaults = {},
> = {
  method: http_method;
  pathname: pathname;
  context?: ContextMarker<context_type, context_defaults>;
  query?: Serializer.QueryString<query_schema, context_type>;
  responses?: Parser.ResponseBodyByStatus<response_schemas, context_type>;
} & (pathname extends Pathname.WithParams
  ? { params?: Serializer.Params<pathname, params_schema, context_type> }
  : [params_schema] extends [never]
    ? { params?: never }
    : { params?: ErrorMessage<"this url does not have dynamic params"> }) &
  (http_method extends HTTPMethod.WithBody
    ? { body?: Serializer.Body<body_schema, context_type> }
    : [body_schema] extends [never]
      ? { body?: never }
      : { body?: ErrorMessage<"this http method does not support body"> });

type extract_outputs<map extends Partial<Record<string | number, Schema._>>> = {
  [key in keyof map]: map[key] extends Schema._ ? Schema.infer_output<map[key]> : never;
};

/**
 * A typed, reusable descriptor of a single HTTP endpoint: its method, pathname, and the
 * schemas that serialize the request and parse each response. Pass a tree of `Endpoint`
 * instances to {@link http_client} to get callable, typed fetch functions.
 *
 * @example
 * const get_user = new Endpoint({
 *   method: "GET",
 *   pathname: "/users/:id",
 *   responses: { 200: { schema: z.object({ id: z.string() }), parse: "json" } },
 * });
 */
export class Endpoint<
  http_method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
  params_schema extends Schema._ = never,
  query_schema extends Schema._ = never,
  body_schema extends Schema._ = never,
  response_schemas extends Partial<Record<Parser.AllowedStatus, Schema._>> = {},
  context_type = unknown,
  context_defaults = {},
> {
  #method: http_method;
  #pattern: RoutePattern<pathname>;
  #serializers: {
    params: Required<Serializer.Params<any, params_schema, context_type>> | null;
    query: Required<Serializer.QueryString<query_schema, context_type>> | null;
    body: Required<Serializer.Body<body_schema, context_type>> | null;
  };
  #parsers: Parser.ResponseBodyByStatus<response_schemas, context_type>;
  #options: HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit;
  #context_default: context_defaults;

  constructor(
    definition: EndpointDefinition<
      http_method,
      pathname,
      params_schema,
      query_schema,
      body_schema,
      response_schemas,
      context_type,
      context_defaults
    >,
    options?: HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit,
  ) {
    this.#method = definition.method;
    this.#pattern = new RoutePattern(definition.pathname, {
      ignoreCase: false,
    });
    this.#serializers = {
      params: as_serializer(definition.params),
      query: as_serializer(definition.query, "urlencoded"),
      body: as_serializer(definition.body, "json"),
    };
    this.#parsers = Object.fromEntries(
      Object.entries(definition.responses ?? {}).map(([key, schema]) => [key, as_parser(schema)]),
    ) as Parser.ResponseBodyByStatus<response_schemas, context_type>;
    this.#options = options ?? {};
    this.#context_default = (definition.context?.defaults ?? {}) as context_defaults;
  }

  #get_parser_for(status: number): Required<Parser.Any> | undefined {
    return (this.#parsers[status as Parser.AllowedStatus] ??
      this.#parsers[`${Math.floor(status / 100)}xx` as Parser.AllowedStatus]) as
      | Required<Parser.Any>
      | undefined;
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

  /** Build the request URL from `base_url` plus typed params and query. `http_client` calls this internally; call it directly to produce a URL (e.g. for a link or prefetch) without sending a request. Returns a {@link SerializationError} as a value if validation or serialization fails. */
  async generate_url(
    init: Pretty<
      { base_url: string } & HTTPFetch.TypedParamsInit<pathname, params_schema> &
        HTTPFetch.TypedQueryInit<query_schema>
    >,
    context?: context_type,
  ): Promise<URL | SerializationError> {
    let pathname_params: Record<string, string> = {};

    if ("params" in init && init.params !== undefined) {
      if (this.#serializers.params) {
        let schema: Schema.Any;
        try {
          schema = resolve_schema(this.#serializers.params.schema, context);
        } catch (cause) {
          return new SerializationError("Params serialization failed", {
            operation: "generate_url",
            cause,
            input: { params: init.params },
          });
        }
        const result = await schema["~standard"].validate(init.params);

        if (result.issues !== undefined) {
          return new SerializationError("Params serialization failed", {
            operation: "generate_url",
            cause: result.issues,
            input: { params: init.params },
          });
        }

        const transformed_params = result.value;

        if (this.#serializers.params.serialize) {
          try {
            pathname_params = this.#serializers.params.serialize(
              transformed_params as any,
              context as context_type,
            );
          } catch (cause) {
            return new SerializationError("Params serialization failed", {
              operation: "generate_url",
              cause,
              input: { params: init.params },
            });
          }
        } else {
          pathname_params = Object.fromEntries(
            Object.entries(transformed_params as any).map(([key, value]) => [key, String(value)]),
          );
        }
      } else {
        pathname_params = Object.fromEntries(
          Object.entries(init.params as Record<string, unknown>).map(([key, value]) => [
            key,
            String(value),
          ]),
        );
      }
    }

    const pathname = this.#pattern.href(pathname_params);

    let search_params = new URLSearchParams();

    if ("query" in init && init.query !== undefined && this.#serializers.query) {
      let schema: Schema.Any;
      try {
        schema = resolve_schema(this.#serializers.query.schema, context);
      } catch (cause) {
        return new SerializationError("Query serialization failed", {
          cause,
          operation: "generate_url",
          input: { query: init.query },
        });
      }
      const result = await schema["~standard"].validate(init.query);

      if (result.issues !== undefined) {
        return new SerializationError("Query serialization failed", {
          cause: result.issues,
          operation: "generate_url",
          input: { query: init.query },
        });
      }

      const transformed_query = result.value;

      if (typeof this.#serializers.query.serialize === "function") {
        try {
          search_params = this.#serializers.query.serialize(
            transformed_query as any,
            context as context_type,
          );
        } catch (cause) {
          return new SerializationError("Query serialization failed", {
            cause,
            operation: "generate_url",
            input: { query: init.query },
          });
        }
      } else if (this.#serializers.query.serialize === "urlencoded") {
        if (Array.isArray(transformed_query)) {
          transformed_query.forEach((tuple, index) => {
            if (Array.isArray(tuple)) {
              tuple.forEach((value, tupleIndex) => {
                search_params.append(`${index}[${tupleIndex}]`, String(value));
              });
            } else {
              search_params.append(String(index), String(tuple));
            }
          });
        } else if (transformed_query !== null && typeof transformed_query === "object") {
          for (const [key, value] of Object.entries(transformed_query)) {
            if (value !== undefined && value !== null) {
              search_params.set(key, String(value));
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

  /** Validate and serialize the request body, returning the encoded body and its content type. Returns a {@link SerializationError} as a value on failure. */
  async serialize_body(
    init: Pretty<HTTPFetch.TypedBodyInit<body_schema>>,
    context?: context_type,
  ): Promise<
    | {
        body: BodyInit | null;
        content_type?: string;
      }
    | SerializationError
  > {
    if (!this.#serializers.body) {
      return { body: null, content_type: undefined };
    }

    if (!("body" in init) || init.body == undefined) {
      return { body: null, content_type: undefined };
    }

    let schema: Schema.Any;
    try {
      schema = resolve_schema(this.#serializers.body.schema, context);
    } catch (cause) {
      return new SerializationError("Body serialization failed", {
        operation: "serialize_body",
        cause,
        input: { body: init.body },
      });
    }
    const result = await schema["~standard"].validate(init.body);

    if (result.issues !== undefined) {
      return new SerializationError("Body serialization failed", {
        operation: "serialize_body",
        cause: result.issues,
        input: { body: init.body },
      });
    }

    const transformed_content = result.value;

    if (typeof this.#serializers.body.serialize === "function") {
      try {
        return this.#serializers.body.serialize(
          transformed_content as any,
          context as context_type,
        );
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

  /** Parse a raw `Response` into a typed response envelope, selecting the parser for its status (exact status, then `2xx`/`4xx`/`5xx` fallback). Returns a {@link ParseError} as a value on failure. */
  async parse_response(
    raw_response: Response,
    context?: context_type,
  ): Promise<HTTPFetch.AnyResponse<extract_outputs<response_schemas>> | ParseError> {
    const response = raw_response.clone();
    const status = raw_response.status;

    if (status >= 300 && status < 400) {
      return RESPONSE.redirect(this.#method, raw_response) as HTTPFetch.AnyResponse<
        extract_outputs<response_schemas>
      >;
    }

    const parser = this.#get_parser_for(status);

    const parse_response = async (parser: Required<Parser.Any>): Promise<unknown | ParseError> => {
      if (parser.parse == null) {
        return new ParseError("Response parsing failed", {
          cause: new Error("parser.parse in not defined"),
          operation: "parse_response",
          response: {
            status,
            headers: raw_response.headers,
          },
        });
      }
      let schema: Schema.Any;
      try {
        schema = resolve_schema(parser.schema, context);
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

      let parsed;
      if (typeof parser.parse === "function") {
        try {
          parsed = await parser.parse(response.body, context as context_type);
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

      const result = await schema["~standard"].validate(parsed);

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

function resolve_schema(
  schema: Schema.Any | ((context: any) => Schema.Any),
  context: unknown,
): Schema.Any {
  return typeof schema === "function" ? schema(context) : schema;
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

function as_serializer<serializer extends Serializer.Any>(
  serializer: any,
  default_serialize?: serializer["serialize"] & string,
): serializer | null {
  if (!serializer || typeof serializer !== "object" || !("schema" in serializer)) return null;

  if (default_serialize === undefined) return serializer;

  return { ...serializer, serialize: serializer.serialize ?? default_serialize };
}

function as_parser<parser extends Parser.Any>(parser: any): parser | null {
  if (!parser || typeof parser !== "object" || !("schema" in parser)) return null;

  return parser;
}
