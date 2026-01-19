import z from "zod";
import type {
  HTTPFetchApi,
  HTTPMethod,
  Parser,
  Pathname,
  Pretty,
  Schema,
  Serializer,
} from "../src/types.ts";

/** Unrendered character (U+200B) used to mark a string type */
export const ZeroWidthSpace = "\u{200B}";

/** Unrendered character (U+200B) used to mark a string type */
export type ZeroWidthSpace = typeof ZeroWidthSpace;

export type ErrorMessage<message extends string = string> =
  `${message}${ZeroWidthSpace}`;

type ExtractPathParams<Path extends string> =
  Path extends `${infer L}/${infer R}`
    ? ExtractPathParams<L> | ExtractPathParams<R>
    : Path extends `:${infer Param}`
    ? Param
    : never;

type ParamsObject<pathname extends Pathname.Relative> = Record<
  ExtractPathParams<pathname>,
  string | number
>;

type DefaultParams<pathname extends Pathname.Relative> =
  pathname extends Pathname.WithParams
    ? Schema._<ParamsObject<pathname>>
    : never;

export type EndpointConfig<
  method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
  params_schema extends Schema._<any, ParamsObject<NoInfer<pathname>>>,
  query_schema extends Schema._<
    any,
    string[][] | Record<string, string> | undefined
  >,
  body_schema extends Schema._,
  data_schema extends Schema._,
  error_schema extends Schema._
> = {
  method: method;
  pathname: pathname;
  query?: Serializer.QueryString<query_schema>;
  data: Parser.Data<data_schema>;
  error?: Parser.Error<error_schema>;
} & (pathname extends Pathname.WithParams
  ? { params?: Serializer.Params<params_schema> }
  : [params_schema] extends [never]
  ? {}
  : { params?: ErrorMessage<"this url does not have dynamic params"> }) &
  (method extends HTTPMethod.WithBody
    ? { body: Serializer.Body<body_schema> }
    : [body_schema] extends [never]
    ? {}
    : { body?: ErrorMessage<"this http method does not support body"> });

export class HTTPEndpoint<
  method extends HTTPMethod.Any,
  pathname extends Pathname.Relative,
  params_schema extends Schema._<
    any,
    ParamsObject<NoInfer<pathname>>
  > = DefaultParams<NoInfer<pathname>>,
  query_schema extends Schema._<
    any,
    string[][] | Record<string, string> | undefined
  > = never,
  body_schema extends Schema._ = never,
  data_schema extends Schema._ = never,
  error_schema extends Schema._ = never
> {
  #method: method;
  #pathname: pathname;
  #serializers: {
    params: Required<Serializer.Params> | null;
    query: Required<Serializer.QueryString> | null;
    body: Required<Serializer.Body> | null;
  };
  #parsers: {
    data: Required<Parser.Data>;
    error: Required<Parser.Error> | null;
  };

  constructor(
    config: EndpointConfig<
      method,
      pathname,
      params_schema,
      query_schema,
      body_schema,
      data_schema,
      error_schema
    >
  ) {
    this.#method = config.method;
    this.#pathname = config.pathname;

    this.#serializers = {
      params:
        "params" in config && typeof config.params === "object"
          ? config.params
          : null,
      query:
        "query" in config && typeof config.query === "object"
          ? { serialization: "urlencoded", ...config.query }
          : null,
      body:
        "body" in config && typeof config.body === "object"
          ? { serialization: "json", ...config.body }
          : null,
    };

    this.#parsers = {
      data: { deserialization: "json", ...config.data },
      error:
        "error" in config && typeof config.error === "object"
          ? { deserialization: "text", ...config.error }
          : null,
    };
  }

  get method() {
    return this.#method;
  }

  #generate_pathname(data: Schema.infer_input<params_schema>) {
    if (this.#serializers.params === null)
      return replace_params(this.#pathname, data);

    const params = validate(this.#serializers.params.schema, data);

    return replace_params(this.#pathname, params);
  }

  #generate_search_params(data: Schema.infer_input<query_schema>) {
    if (this.#serializers.query === null) return new URLSearchParams();

    const search_params = validate(this.#serializers.query.schema, data);

    if (typeof this.#serializers.query.serialization === "function")
      return this.#serializers.query.serialization(search_params);

    switch (this.#serializers.query.serialization) {
      case "urlencoded":
        return new URLSearchParams(search_params);
      default:
        throw new Error("not supported");
    }
  }

  generate_url({
    origin,
    params,
    query,
  }: Pretty<
    { origin: string } & ([params_schema] extends [never]
      ? { params?: never }
      : { params: Schema.infer_input<params_schema> }) &
      ([query_schema] extends [never]
        ? { query?: never }
        : undefined extends Schema.infer_input<query_schema>
        ? { query?: Schema.infer_input<query_schema> }
        : { query: Schema.infer_input<query_schema> })
  >): URL {
    const url = new URL(origin);

    const pathname = this.#generate_pathname(params);
    url.pathname = pathname;

    const search_params = this.#generate_search_params(query ?? {});
    url.search = search_params.size > 0 ? `?${search_params.toString()}` : "";

    return url;
  }

  #generate_body(data: Schema.infer_input<body_schema>): {
    body: BodyInit | null;
    content_type?: string;
  } {
    if (this.#method === "GET") return { body: null };

    if (this.#serializers.body === null) return { body: null };

    const body = validate(this.#serializers.body.schema, data);

    if (typeof this.#serializers.body.serialization === "function")
      return this.#serializers.body.serialization(body);

    switch (this.#serializers.body.serialization) {
      case "json":
        return { body: JSON.stringify(body), content_type: "application/json" };
      default:
        throw new Error("not supported");
    }
  }

  serialize_body(data: Schema.infer_input<body_schema>): {
    body: BodyInit | null;
    content_type?: string;
  } {
    return this.#generate_body(data);
  }

  async parse_response(
    response: Response
  ): Promise<
    HTTPFetchApi.TypedResponse<{
      data: Schema.infer_output<data_schema>;
      error: Schema.infer_output<error_schema>;
    }>
  > {
    return {} as any;
  }
}

export function endpoint<
  const method extends HTTPMethod.Any,
  const pathname extends Pathname.Relative,
  params_schema extends Schema._<
    any,
    ParamsObject<NoInfer<pathname>>
  > = DefaultParams<NoInfer<pathname>>,
  query_schema extends Schema._<
    any,
    string[][] | Record<string, string> | undefined
  > = never,
  body_schema extends Schema._ = never,
  data_schema extends Schema._ = never,
  error_schema extends Schema._ = Schema._<any, string>
>(
  config: EndpointConfig<
    method,
    pathname,
    params_schema,
    query_schema,
    body_schema,
    data_schema,
    error_schema
  >
) {
  return new HTTPEndpoint(config);
}

function replace_params(
  pathname: Pathname.Relative,
  params: Record<string, number | string> = {}
) {
  const result = pathname
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        const value = params[segment.slice(1)];
        if (value === undefined || value === "") {
          throw new Error(
            `url path param "${segment.slice(1)}" should not be empty`
          );
        }
        return encodeURIComponent(value.toString());
      }
      return segment;
    })
    .join("/");

  return result;
}

function validate<output>(schema: Schema._<any, output>, data: any): output {
  const result = schema["~standard"].validate(data);
  if (result instanceof Promise)
    throw new Error("cannot validate asynchronously");
  // if the `issues` field exists, the validation failed
  if (result.issues) {
    throw new Error(JSON.stringify(result.issues, null, 2));
  }
  return result.value;
}
