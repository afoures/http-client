import z from "zod";
import type {
  ErrorMessage,
  HTTPFetchApi,
  HTTPMethod,
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
    ? { body: Serializer.BodyV2<body_schema> }
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

type SerializeBodyFrom<body_schema extends Schema._> = Pretty<{
  content: Schema.infer_input<body_schema>;
}>;

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
    params: Serializer.ParamsV2<any, params_schema> | null;
    query: Serializer.QueryStringV2<query_schema> | null;
    body: Serializer.BodyV2<body_schema> | null;
  };
  #parsers: {
    data: Parser.DataV2<data_schema> | null;
    error: Parser.ErrorV2<error_schema> | null;
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

  generate_url({
    origin,
    params,
    query,
  }: GenerateUrlFrom<pathname, params_schema, query_schema>): URL {
    return new URL("");
  }

  serialize_body({ content }: SerializeBodyFrom<body_schema>): {
    body: BodyInit | null;
    content_type?: string;
  } {
    return { body: null };
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
    return {} as any;
  }
}

export type AnyEndpoint = Endpoint<any, any, any, any, any, any, any>;

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

  const url = endpoint.generate_url({
    origin: init.origin,
    params: init.params,
    query: init.query,
  });

  const { body, content_type } = endpoint.serialize_body({
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
