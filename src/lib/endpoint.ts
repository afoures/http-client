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

/**
 * Phantom-typed marker that declares an endpoint's out-of-band `context` type and its
 * endpoint-level defaults. Created via `define_context`. The `context_type` is carried
 * only at the type level (the `__context_type__` field never exists at runtime); `defaults`
 * is the sole runtime payload.
 */
export interface ContextMarker<context_type = unknown, defaults = {}> {
  /**
   * Phantom carrier for the full context type; never present at runtime (constructed via a
   * cast in `define_context`). A required, contravariant function position so `context_type`
   * is inferred strongly and early from the marker — the single source of truth — before any
   * factory/serialize/parse parameter is contextually typed against it.
   */
  readonly __context_type__: (context: context_type) => void;
  readonly defaults: defaults;
  /**
   * Refine the marker with endpoint-level default context values. Any key given a default
   * becomes optional at the call site. This is a separate call (rather than an argument to
   * `define_context`) so the default keys infer precisely: passing the context type argument
   * explicitly would otherwise disable inference of the defaults (partial type-argument inference).
   */
  with_defaults<const next_defaults extends Partial<context_type>>(
    defaults: next_defaults,
  ): ContextMarker<context_type, next_defaults>;
}

/**
 * Declare an endpoint's out-of-band `context` type.
 *
 * The `context` is data a caller passes per call that is **not** serialized into the
 * request; it is threaded into a slot's schema factory (`(context) => schema`) and into
 * custom `serialize`/`parse` functions. The type parameter is declared once here and is
 * the single source of truth for every factory and for the call-site `context` field.
 *
 * Chain `.with_defaults({...})` to provide endpoint-level defaults; any defaulted key (here,
 * or via the client-level `context` on `http_client`) becomes optional at the call site.
 *
 * @example
 * new Endpoint({
 *   method: "GET",
 *   pathname: "/users/:id",
 *   context: define_context<{ tz: string; locale: string }>().with_defaults({ tz: "UTC" }),
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

  get method() {
    return this.#method;
  }

  get options(): HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit {
    return this.#options;
  }

  /** Endpoint-level default context, merged under any client-level and per-call context. */
  get context_default(): context_defaults {
    return this.#context_default;
  }

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
        // Resolve the schema (a factory receives the per-call context) then validate/transform.
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

        // Use transformed params
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
          // Convert to string values for RoutePattern
          pathname_params = Object.fromEntries(
            Object.entries(transformed_params as any).map(([key, value]) => [key, String(value)]),
          );
        }
      } else {
        // No schema, use params directly
        pathname_params = Object.fromEntries(
          Object.entries(init.params as Record<string, unknown>).map(([key, value]) => [
            key,
            String(value),
          ]),
        );
      }
    }

    // Generate pathname using RoutePattern.href()
    const pathname = this.#pattern.href(pathname_params);

    let search_params = new URLSearchParams();

    if ("query" in init && init.query !== undefined && this.#serializers.query) {
      // Resolve the schema (a factory receives the per-call context) then validate/transform.
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

      // Use transformed query
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
          // Array schema (tuples) - serialize tuples as key-value pairs
          // For tuples like [["ok", "test"]], serialize each tuple element
          transformed_query.forEach((tuple, index) => {
            if (Array.isArray(tuple)) {
              // Tuple: serialize each element
              tuple.forEach((value, tupleIndex) => {
                search_params.append(`${index}[${tupleIndex}]`, String(value));
              });
            } else {
              // Non-tuple array element
              search_params.append(String(index), String(tuple));
            }
          });
        } else if (transformed_query !== null && typeof transformed_query === "object") {
          // Object schema - serialize as key-value pairs
          for (const [key, value] of Object.entries(transformed_query)) {
            if (value !== undefined && value !== null) {
              search_params.set(key, String(value));
            }
          }
        }
      }
    }

    // remove leading slash from pathname if it exists to allow relative pathname resolving
    // https://developer.mozilla.org/en-US/docs/Web/API/URL_API/Resolving_relative_references
    const url = new URL(pathname.startsWith("/") ? pathname.slice(1) : pathname, init.base_url);

    // Append query string
    const query_string = search_params.toString();
    if (query_string) {
      url.search = query_string;
    }

    return url;
  }

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
    // If no body serializer, return null
    if (!this.#serializers.body) {
      return { body: null, content_type: undefined };
    }

    if (!("body" in init) || init.body == undefined) {
      return { body: null, content_type: undefined };
    }

    // Resolve the schema (a factory receives the per-call context) then validate/transform.
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
      // Validation failed
      return new SerializationError("Body serialization failed", {
        operation: "serialize_body",
        cause: result.issues,
        input: { body: init.body },
      });
    }

    // Use transformed content
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

  async parse_response(
    raw_response: Response,
    context?: context_type,
  ): Promise<HTTPFetch.AnyResponse<extract_outputs<response_schemas>> | ParseError> {
    const response = raw_response.clone();
    const status = raw_response.status;

    // Handle redirects (30x) - never schema'd.
    if (status >= 300 && status < 400) {
      return RESPONSE.redirect(this.#method, raw_response) as HTTPFetch.AnyResponse<
        extract_outputs<response_schemas>
      >;
    }

    const parser = this.#get_parser_for(status);

    // Parse + validate the body with a resolved parser, or ParseError on failure.
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
      // Resolve the schema (a factory receives the per-call context).
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

    // Handle client and server errors (40x and 50x)
    if (status >= 400 && status < 600) {
      let error: any;
      if (parser) {
        const parsed = await parse_response(parser);
        if (parsed instanceof ParseError) return parsed;
        error = parsed;
      } else {
        // No parser - default to raw text so the body is never lost.
        error = await response.text();
      }

      return (
        status < 500
          ? RESPONSE.client_error(this.#method, error, raw_response)
          : RESPONSE.server_error(this.#method, error, raw_response)
      ) as HTTPFetch.AnyResponse<extract_outputs<response_schemas>>;
    }

    // Handle successful response_schemas (20x)
    if (status >= 200 && status < 300) {
      // 204 No Content always has a null body, regardless of any parser.
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

    // Fallback for other status codes (shouldn't happen in practice)
    throw new Error(`Unhandled status code: ${status}`);
  }
}

export type AnyEndpoint = Endpoint<any, any, any, any, any, any, any, any>;

/** Resolve a slot's `schema`: call it with the per-call context when it is a factory. */
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
