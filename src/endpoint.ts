import z from "zod";
import type {
  ErrorMessage,
  HTTPFetchApi,
  HTTPMethod,
  HTTPStatus,
  Json,
  Parser,
  Pathname,
  Pretty,
  Schema,
  Serializer,
} from "./types";
import { RoutePattern } from "@remix-run/route-pattern";

type EndpointDefinition<
  http_method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
  params_schema extends Schema._,
  query_schema extends Schema._,
  body_schema extends Schema._,
  data_schema extends Schema._,
  error_schema extends Schema._
> = {
  method: http_method;
  pathname: pathname;
  query?: Serializer.QueryStringV2<query_schema>;
  data?: Parser.DataV2<data_schema>;
  error?: Parser.ErrorV2<error_schema>;
} & (pathname extends Pathname.WithParams
  ? { params?: Serializer.ParamsV2<pathname, params_schema> }
  : [params_schema] extends [never]
  ? { params?: never }
  : { params?: ErrorMessage<"this url does not have dynamic params"> }) &
  (http_method extends HTTPMethod.WithBody
    ? { body?: Serializer.BodyV2<body_schema> }
    : [body_schema] extends [never]
    ? { body?: never }
    : { body?: ErrorMessage<"this http method does not support body"> });

type GenerateUrlFrom<
  pathname extends Pathname.Relative,
  params_schema extends Schema._,
  query_schema extends Schema._
> = Pretty<
  { origin: string } & ([params_schema] extends [never]
    ? pathname extends Pathname.WithParams
      ? { params: Pathname.Params<pathname> }
      : { params?: never }
    : { params: Schema.infer_input<params_schema> }) &
    ([query_schema] extends [never]
      ? { query?: never }
      : undefined extends Schema.infer_input<query_schema>
      ? { query?: Schema.infer_input<query_schema> }
      : { query: Schema.infer_input<query_schema> })
>;

type SerializeBodyFrom<body_schema extends Schema._> = Pretty<
  [body_schema] extends [never]
    ? { content?: never }
    : undefined extends Schema.infer_input<body_schema>
    ? { content?: Schema.infer_input<body_schema> }
    : { content: Schema.infer_input<body_schema> }
>;

export class Endpoint<
  http_method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
  params_schema extends Schema._ = never,
  query_schema extends Schema._ = never,
  body_schema extends Schema._ = never,
  data_schema extends Schema._ = never,
  error_schema extends Schema._ = never
> {
  #method: http_method;
  #pattern: RoutePattern<pathname>;
  #serializers: {
    params: Required<Serializer.ParamsV2<any, params_schema>> | null;
    query: Required<Serializer.QueryStringV2<query_schema>> | null;
    body: Required<Serializer.BodyV2<body_schema>> | null;
  };
  #parsers: {
    data: Required<Parser.DataV2<data_schema>> | null;
    error: Required<Parser.ErrorV2<error_schema>> | null;
  };

  constructor(
    definition: EndpointDefinition<
      http_method,
      pathname,
      params_schema,
      query_schema,
      body_schema,
      data_schema,
      error_schema
    >
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
  }

  get method() {
    return this.#method;
  }

  async generate_url({
    origin,
    params,
    query,
  }: GenerateUrlFrom<pathname, params_schema, query_schema>): Promise<URL> {
    // Step 1: Handle pathname params
    let pathname_params: Record<string, string> = {};

    if (params !== undefined) {
      if (this.#serializers.params) {
        // Validate/transform params using Standard Schema
        const schema = this.#serializers.params.schema;
        const result = await schema["~standard"].validate(params);

        if (result.issues !== undefined) {
          // Validation failed - for now, throw error since return type is URL
          // TODO: Consider changing return type to Result<URL> in the future
          throw new Error(
            `Params validation failed: ${result.issues
              .map((i: any) => i.message)
              .join(", ")}`
          );
        }

        // Use transformed params
        const transformed_params = result.value;

        // Apply custom serialization if provided
        if (this.#serializers.params.serialization) {
          pathname_params = this.#serializers.params.serialization(
            transformed_params as any
          );
        } else {
          // Convert to string values for RoutePattern
          pathname_params = Object.fromEntries(
            Object.entries(transformed_params as any).map(([key, value]) => [
              key,
              String(value),
            ])
          );
        }
      } else {
        // No schema, use params directly
        pathname_params = Object.fromEntries(
          Object.entries(params as Record<string, unknown>).map(
            ([key, value]) => [key, String(value)]
          )
        );
      }
    }

    // Generate pathname using RoutePattern.href()
    const pathname = this.#pattern.href(pathname_params);

    // Step 2: Handle query parameters
    let search_params = new URLSearchParams();

    if (query !== undefined && this.#serializers.query) {
      // Validate/transform query using Standard Schema
      const schema = this.#serializers.query.schema;
      const result = await schema["~standard"].validate(query);

      if (result.issues !== undefined) {
        // Validation failed
        throw new Error(
          `Query validation failed: ${result.issues
            .map((i: any) => i.message)
            .join(", ")}`
        );
      }

      // Use transformed query
      const transformed_query = result.value;

      if (typeof this.#serializers.query.serialization === "function") {
        // Custom serialization function
        search_params = this.#serializers.query.serialization(
          transformed_query as any
        );
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
        } else if (
          transformed_query !== null &&
          typeof transformed_query === "object"
        ) {
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
    const url = new URL(pathname, origin);

    // Append query string
    const query_string = search_params.toString();
    if (query_string) {
      url.search = query_string;
    }

    return url;
  }

  async serialize_body({ content }: SerializeBodyFrom<body_schema>): Promise<{
    body: BodyInit | null;
    content_type?: string;
  }> {
    // If no body serializer, return null
    if (!this.#serializers.body) {
      return { body: null, content_type: undefined };
    }

    // Validate/transform content using Standard Schema
    const schema = this.#serializers.body.schema;
    const result = await schema["~standard"].validate(content);

    if (result.issues !== undefined) {
      // Validation failed
      throw new Error(
        `Body validation failed: ${result.issues
          .map((i: any) => i.message)
          .join(", ")}`
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
    response: Response
  ): Promise<
    HTTPFetchApi.TypedResponse<
      [data_schema] extends [never] ? void : Schema.infer_output<data_schema>,
      [error_schema] extends [never]
        ? string
        : Schema.infer_output<error_schema>
    >
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
      } as HTTPFetchApi.RedirectMessage;
    }

    // Handle client and server errors (40x and 50x)
    if (status >= 400 && status < 600) {
      let error: any;

      if (this.#parsers.error) {
        // Parse error body using error parser
        const parser = this.#parsers.error;
        let parsed: any;

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
          throw new Error(
            `Error response validation failed: ${result.issues
              .map((i: any) => i.message)
              .join(", ")}`
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
      } as
        | HTTPFetchApi.ClientErrorResponse<any>
        | HTTPFetchApi.ServerErrorResponse<any>;
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
        } as HTTPFetchApi.SuccessfulResponse<any>;
      }

      // Other success statuses
      if (this.#parsers.data) {
        // Parse data body using data parser
        const parser = this.#parsers.data;
        let parsed: any;

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
          throw new Error(
            `Response validation failed: ${result.issues
              .map((i: any) => i.message)
              .join(", ")}`
          );
        }

        return {
          ok: true,
          status: status,
          data: result.value,
          headers,
          raw_response,
        } as HTTPFetchApi.SuccessfulResponse<any>;
      } else {
        // No data parser - return null
        return {
          ok: true,
          status: status,
          data: null as any,
          headers,
          raw_response,
        } as HTTPFetchApi.SuccessfulResponse<any>;
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
      `Failed to parse response as JSON: ${
        e instanceof Error ? e.message : String(e)
      }`
    );
  }
}

function as_serializer<serializer extends Serializer.Any>(
  serializer: any,
  default_serialization?: serializer["serialization"] & string
): serializer | null {
  if (
    !serializer ||
    typeof serializer !== "object" ||
    !("schema" in serializer)
  )
    return null;

  if (
    default_serialization === undefined ||
    ("serialization" in serializer &&
      typeof serializer.serialization !== "undefined")
  )
    return serializer;

  return { serialization: default_serialization, ...serializer };
}

function as_parser<parser extends Parser.Any>(
  parser: any,
  default_deserialization?: parser["deserialization"] & string
): parser | null {
  if (!parser || typeof parser !== "object" || !("schema" in parser))
    return null;

  if (
    default_deserialization === undefined ||
    ("deserialization" in parser &&
      typeof parser.deserialization !== "undefined")
  )
    return parser;

  return { deserialization: default_deserialization, ...parser };
}

// local testing

const delete_user = new Endpoint({
  method: "POST",
  pathname: "/users/(:id)",
  query: {
    schema: z.array(z.tuple([z.literal("ok"), z.string()])),
  },
  body: {
    schema: z.object({ test: z.string().transform((str) => str.length) }),
  },
});

type infer_result<endpoint extends AnyEndpoint> = Awaited<
  ReturnType<NoInfer<endpoint>["parse_response"]>
>;

type extract_pathname<endpoint extends AnyEndpoint> = endpoint extends Endpoint<
  any,
  infer pathname,
  any,
  any,
  any,
  any,
  any
>
  ? pathname
  : never;

type extract_params_schema<endpoint extends AnyEndpoint> =
  endpoint extends Endpoint<any, any, infer params_schema, any, any, any, any>
    ? params_schema
    : never;

type extract_query_schema<endpoint extends AnyEndpoint> =
  endpoint extends Endpoint<any, any, any, infer query_schema, any, any, any>
    ? query_schema
    : never;

type extract_body_schema<endpoint extends AnyEndpoint> =
  endpoint extends Endpoint<any, any, any, any, infer body_schema, any, any>
    ? body_schema
    : never;

type CustomFetch = (
  url: URL,
  init: Omit<RequestInit, "headers"> & { headers: Headers }
) => Promise<Response>;

async function fetch_endpoint<endpoint extends AnyEndpoint>(
  endpoint: endpoint,
  init: Pretty<
    GenerateUrlFrom<
      extract_pathname<NoInfer<endpoint>>,
      extract_params_schema<NoInfer<endpoint>>,
      extract_query_schema<NoInfer<endpoint>>
    > &
      SerializeBodyFrom<extract_body_schema<NoInfer<endpoint>>> & {
        custom_fetch?: CustomFetch;
        headers?: HeadersInit;
      }
  >,
  defaults?: {}
): Promise<infer_result<NoInfer<endpoint>>> {
  const headers = new Headers();

  const url = await endpoint.generate_url({
    origin: init.origin,
    params: init.params,
    query: init.query,
  });

  const { body, content_type } = await endpoint.serialize_body({
    content: init.content,
  });
  if (content_type) headers.set("Content-Type", content_type);

  const custom_fetch = init.custom_fetch ?? fetch;
  const response = await custom_fetch(url, {
    method: endpoint.method,
    body,
    headers,
  });

  const result = await endpoint.parse_response(response);

  return result as infer_result<endpoint>;
}

const r = await fetch_endpoint(delete_user, {
  origin: "https://ok.com",
  params: { id: 1234567 },
  query: [],
  content: { test: "" },
  custom_fetch(url, init) {
    return fetch(url, init);
  },
  headers: {},
});
