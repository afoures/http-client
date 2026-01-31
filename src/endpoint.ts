import { DeserializationError, SerializationError } from "./errors.ts";
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
      : { body?: ErrorMessage<"this http method does not support body"> }) &
  HTTPFetch.OptionalRequestInit &
  HTTPFetch.DefaultRequestInit;

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
  ) {
    const { method, pathname, params, query, body, data, error, ...options } = definition;
    this.#method = method;
    this.#pattern = new RoutePattern(pathname, {
      ignoreCase: false,
    });
    this.#serializers = {
      params: as_serializer(params),
      query: as_serializer(query, "urlencoded"),
      body: as_serializer(body, "json"),
    };
    this.#parsers = {
      data: as_parser(data, "json"),
      error: as_parser(error, "text"),
    };
    this.#options = options;
  }

  get method() {
    return this.#method;
  }

  get options(): HTTPFetch.OptionalRequestInit & HTTPFetch.DefaultRequestInit {
    return this.#options;
  }

  async generate_url(
    init: Pretty<
      { origin: string } & HTTPFetch.TypedParamsInit<pathname, params_schema> &
        HTTPFetch.TypedQueryInit<query_schema>
    >,
  ): Promise<URL | SerializationError> {
    // Step 1: Handle pathname params
    let pathname_params: Record<string, string> = {};

    if ("params" in init && init.params !== undefined) {
      if (this.#serializers.params) {
        // Validate/transform params using Standard Schema
        const schema = this.#serializers.params.schema;
        const result = await schema["~standard"].validate(init.params);

        if (result.issues !== undefined) {
          return new SerializationError(
            `Params validation failed: ${result.issues.map((i: any) => i.message).join(", ")}`,
          );
        }

        // Use transformed params
        const transformed_params = result.value;

        // Apply custom serialization if provided
        if (this.#serializers.params.serialization) {
          pathname_params = this.#serializers.params.serialization(transformed_params as any);
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

    // Step 2: Handle query parameters
    let search_params = new URLSearchParams();

    if ("query" in init && init.query !== undefined && this.#serializers.query) {
      // Validate/transform query using Standard Schema
      const schema = this.#serializers.query.schema;
      const result = await schema["~standard"].validate(init.query);

      if (result.issues !== undefined) {
        return new SerializationError(
          `Query validation failed: ${result.issues.map((i: any) => i.message).join(", ")}`,
        );
      }

      // Use transformed query
      const transformed_query = result.value;

      if (typeof this.#serializers.query.serialization === "function") {
        // Custom serialization function
        search_params = this.#serializers.query.serialization(transformed_query as any);
      } else if (this.#serializers.query.serialization === "urlencoded") {
        // Default urlencoded serialization
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

    // Step 3: Construct URL
    const url = new URL(pathname, init.origin);

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
      return new SerializationError(
        `Body validation failed: ${result.issues.map((i: any) => i.message).join(", ")}`,
      );
    }

    // Use transformed content
    const transformed_content = result.value;

    // Apply custom serialization if provided
    if (typeof this.#serializers.body.serialization === "function") {
      // Custom serialization function
      return this.#serializers.body.serialization(transformed_content as any);
    } else {
      // Default JSON serialization
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
    | DeserializationError
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

        if (typeof parser.deserialization === "function") {
          // Custom deserialization function
          parsed = await parser.deserialization(cloned_response.body);
        } else if (parser.deserialization === "json") {
          parsed = await parse_as_json(cloned_response);
        } else if (parser.deserialization === "text") {
          // Default to text deserialization
          parsed = await cloned_response.text();
        }

        // Validate with schema
        const schema = parser.schema;
        const result = await schema["~standard"].validate(parsed);

        if (result.issues !== undefined) {
          return new DeserializationError(
            `Error response validation failed: ${result.issues
              .map((i: any) => i.message)
              .join(", ")}`,
          );
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

        if (typeof parser.deserialization === "function") {
          // Custom deserialization function
          parsed = await parser.deserialization(cloned_response.body);
        } else if (parser.deserialization === "json") {
          // JSON deserialization
          parsed = await parse_as_json(cloned_response);
        } else if (parser.deserialization === "text") {
          // Text deserialization
          parsed = await cloned_response.text();
        }

        // Validate with schema
        const schema = parser.schema;
        const result = await schema["~standard"].validate(parsed);

        if (result.issues !== undefined) {
          return new DeserializationError(
            `Response validation failed: ${result.issues.map((i: any) => i.message).join(", ")}`,
          );
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
  try {
    const text = await response.text();
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
  default_serialization?: serializer["serialization"] & string,
): serializer | null {
  if (!serializer || typeof serializer !== "object" || !("schema" in serializer)) return null;

  if (
    default_serialization === undefined ||
    ("serialization" in serializer && typeof serializer.serialization !== "undefined")
  )
    return serializer;

  return { serialization: default_serialization, ...serializer };
}

function as_parser<parser extends Parser.Any>(
  parser: any,
  default_deserialization?: parser["deserialization"] & string,
): parser | null {
  if (!parser || typeof parser !== "object" || !("schema" in parser)) return null;

  if (
    default_deserialization === undefined ||
    ("deserialization" in parser && typeof parser.deserialization !== "undefined")
  )
    return parser;

  return { deserialization: default_deserialization, ...parser };
}
