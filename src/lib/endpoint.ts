import { ParseError, SerializationError, type ErrorContext } from "./errors.ts";
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

export type EndpointDefinition<
  http_method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
  params_schema extends Schema._,
  query_schema extends Schema._,
  body_schema extends Schema._,
  data_schema extends Schema._,
  error_schema extends Schema._,
> = {
  method: http_method;
  pathname: pathname;
  query?: Serializer.QueryString<query_schema>;
  data?: Parser.Data<data_schema>;
  error?: Parser.Error<error_schema>;
} & (pathname extends Pathname.WithParams
  ? { params?: Serializer.Params<pathname, params_schema> }
  : [params_schema] extends [never]
    ? { params?: never }
    : { params?: ErrorMessage<"this url does not have dynamic params"> }) &
  (http_method extends HTTPMethod.WithBody
    ? { body?: Serializer.Body<body_schema> }
    : [body_schema] extends [never]
      ? { body?: never }
      : { body?: ErrorMessage<"this http method does not support body"> });

export class Endpoint<
  http_method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
  params_schema extends Schema._ = never,
  query_schema extends Schema._ = never,
  body_schema extends Schema._ = never,
  data_schema extends Schema._ = never,
  error_schema extends Schema._ = never,
> {
  #method: http_method;
  #pattern: RoutePattern<pathname>;
  #serializers: {
    params: Required<Serializer.Params<any, params_schema>> | null;
    query: Required<Serializer.QueryString<query_schema>> | null;
    body: Required<Serializer.Body<body_schema>> | null;
  };
  #parsers: {
    data: Required<Parser.Data<data_schema>> | null;
    error: Required<Parser.Error<error_schema>> | null;
  };
  #options: HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit;

  constructor(
    definition: EndpointDefinition<
      http_method,
      pathname,
      params_schema,
      query_schema,
      body_schema,
      data_schema,
      error_schema
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
    this.#parsers = {
      data: as_parser(definition.data, "json"),
      error: as_parser(definition.error, "text"),
    };
    this.#options = options ?? {};
  }

  get method() {
    return this.#method;
  }

  get options(): HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit {
    return this.#options;
  }

  async generate_url(
    init: Pretty<
      { base_url: string } & HTTPFetch.TypedParamsInit<pathname, params_schema> &
        HTTPFetch.TypedQueryInit<query_schema>
    >,
  ): Promise<URL | SerializationError> {
    let pathname_params: Record<string, string> = {};

    if ("params" in init && init.params !== undefined) {
      if (this.#serializers.params) {
        // Validate/transform params using Standard Schema
        const schema = this.#serializers.params.schema;
        const result = await schema["~standard"].validate(init.params);

        if (result.issues !== undefined) {
          return new SerializationError("Params serialization failed", {
            operation: "generate_url",
            cause: result.issues,
            input: { params: init.params },
          } as ErrorContext);
        }

        // Use transformed params
        const transformed_params = result.value;

        if (this.#serializers.params.serialize) {
          pathname_params = this.#serializers.params.serialize(transformed_params as any);
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
      // Validate/transform query using Standard Schema
      const schema = this.#serializers.query.schema;
      const result = await schema["~standard"].validate(init.query);

        if (result.issues !== undefined) {
          return new SerializationError("Query serialization failed", {
            cause: result.issues,
            operation: "generate_url",
            input: { query: init.query },
          } as ErrorContext);
        }

      // Use transformed query
      const transformed_query = result.value;

      if (typeof this.#serializers.query.serialize === "function") {
        search_params = this.#serializers.query.serialize(transformed_query as any);
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

  async serialize_body(init: Pretty<HTTPFetch.TypedBodyInit<body_schema>>): Promise<
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

    // Validate/transform content using Standard Schema
    const schema = this.#serializers.body.schema;
    const result = await schema["~standard"].validate(init.body);

    if (result.issues !== undefined) {
      // Validation failed
      return new SerializationError("Body serialization failed", {
        operation: "serialize_body",
        cause: result.issues,
        input: { body: init.body },
      } as ErrorContext);
    }

    // Use transformed content
    const transformed_content = result.value;

    if (typeof this.#serializers.body.serialize === "function") {
      return this.#serializers.body.serialize(transformed_content as any);
    } else {
      return {
        body: JSON.stringify(transformed_content),
        content_type: "application/json",
      };
    }
  }

  async parse_response(
    response: Response,
  ): Promise<
    | HTTPFetch.ClientErrorResponse<Schema.infer_output<error_schema, string>>
    | HTTPFetch.ServerErrorResponse<Schema.infer_output<error_schema, string>>
    | HTTPFetch.SuccessfulResponse<Schema.infer_output<data_schema, void>>
    | HTTPFetch.RedirectMessage
    | ParseError
  > {
    const raw_response = response;
    const cloned_response = response.clone();

    const status = cloned_response.status;
    const headers = cloned_response.headers;

    // Handle redirects (30x)
    if (status >= 300 && status < 400) {
      const redirect_to = headers.get("Location") || null;
      return {
        ok: false,
        status: status as HTTPStatus.RedirectMessage,
        redirect_to,
        headers,
        raw_response,
      } as HTTPFetch.RedirectMessage;
    }

    // Handle client and server errors (40x and 50x)
    if (status >= 400 && status < 600) {
      let error: any;

      if (this.#parsers.error) {
        // Parse error body using error parser
        const parser = this.#parsers.error;
        let parsed;

        if (typeof parser.parse === "function") {
          parsed = await parser.parse(cloned_response.body);
        } else if (parser.parse === "json") {
          parsed = await parse_as_json(cloned_response);
        } else if (parser.parse === "text") {
          parsed = await cloned_response.text();
        }

        // Validate with schema
        const schema = parser.schema;
        const result = await schema["~standard"].validate(parsed);

        if (result.issues !== undefined) {
          return new ParseError("Error parsing failed", {
            cause: result.issues,
            operation: "parse_response",
            response: {
              status,
              headers,
              body: parsed,
            },
          } as ErrorContext);
        }

        error = result.value;
      } else {
        // No error parser - default to text
        error = await cloned_response.text();
      }

      return {
        ok: false,
        status: status,
        error,
        headers,
        raw_response,
      } as HTTPFetch.ClientErrorResponse<any> | HTTPFetch.ServerErrorResponse<any>;
    }

    // Handle successful responses (20x)
    if (status >= 200 && status < 300) {
      // 204 No Content - special handling
      if (status === 204) {
        return {
          ok: true,
          status: 204,
          data: null,
          headers,
          raw_response,
        } as HTTPFetch.SuccessfulResponse<any>;
      }

      // Other success statuses
      if (this.#parsers.data) {
        // Parse data body using data parser
        const parser = this.#parsers.data;
        let parsed;

        if (typeof parser.parse === "function") {
          parsed = await parser.parse(cloned_response.body);
        } else if (parser.parse === "json") {
          parsed = await parse_as_json(cloned_response);
        } else if (parser.parse === "text") {
          parsed = await cloned_response.text();
        }

        // Validate with schema
        const schema = parser.schema;
        const result = await schema["~standard"].validate(parsed);

        if (result.issues !== undefined) {
          return new ParseError("Response parsing failed", {
            cause: result.issues,
            operation: "parse_response",
            response: {
              status,
              headers,
              body: parsed,
            },
          } as ErrorContext);
        }

        return {
          ok: true,
          status: status,
          data: result.value,
          headers,
          raw_response,
        } as HTTPFetch.SuccessfulResponse<any>;
      } else {
        // No data parser - return null
        return {
          ok: true,
          status: status,
          data: null as any,
          headers,
          raw_response,
        } as HTTPFetch.SuccessfulResponse<any>;
      }
    }

    // Fallback for other status codes (shouldn't happen in practice)
    throw new Error(`Unhandled status code: ${status}`);
  }
}

export type AnyEndpoint = Endpoint<any, any, any, any, any, any, any>;

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

  if (
    default_serialize === undefined ||
    ("serialize" in serializer && typeof serializer.serialize !== "undefined")
  )
    return serializer;

  return { serialize: default_serialize, ...serializer };
}

function as_parser<parser extends Parser.Any>(
  parser: any,
  default_parse?: parser["parse"] & string,
): parser | null {
  if (!parser || typeof parser !== "object" || !("schema" in parser)) return null;

  if (
    default_parse === undefined ||
    ("parse" in parser && typeof parser.parse !== "undefined")
  )
    return parser;

  return { parse: default_parse, ...parser };
}
