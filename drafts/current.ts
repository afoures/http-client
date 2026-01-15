import { type StandardSchemaV1 } from "@standard-schema/spec";
import { z } from "zod";

namespace HTTPStatus {
  export type InformationalResponse = 100 | 101 | 102 | 103;

  export type SuccessfulResponse =
    | 200
    | 201
    | 202
    | 203
    | 204
    | 205
    | 206
    | 207
    | 208
    | 226;

  export type RedirectMessage = 300 | 301 | 302 | 303 | 304 | 307 | 308;

  export type ClientErrorResponse =
    | 400
    | 401
    | 402
    | 403
    | 404
    | 405
    | 406
    | 407
    | 408
    | 409
    | 410
    | 411
    | 412
    | 413
    | 414
    | 415
    | 416
    | 417
    | 418
    | 421
    | 422
    | 423
    | 424
    | 425
    | 426
    | 428
    | 429
    | 431
    | 451;
  export type ServerErrorResponse =
    | 500
    | 501
    | 502
    | 503
    | 504
    | 505
    | 506
    | 507
    | 508
    | 510
    | 511;
}

type SharedResponseContent = {
  headers: Headers;
  url: string;
  raw_response: Response;
};

type ClientErrorResponse<Error> = SharedResponseContent & {
  ok: false;
  status: HTTPStatus.ClientErrorResponse;
  error: Error;
};
type ServerErrorResponse<Error> = SharedResponseContent & {
  ok: false;
  status: HTTPStatus.ServerErrorResponse;
  error: Error;
};
type SuccessfulResponse<Data> = SharedResponseContent & {
  ok: true;
} & (
    | {
        status: Exclude<HTTPStatus.SuccessfulResponse, 204>;
        data: Data;
      }
    | {
        status: 204;
        data: null;
      }
  );

type RedirectMessage = SharedResponseContent & {
  ok: false;
  status: HTTPStatus.RedirectMessage;
};

type TypedResponse<result extends { data: unknown; error: unknown }> =
  | ClientErrorResponse<result["error"]>
  | ServerErrorResponse<result["error"]>
  | SuccessfulResponse<result["data"]>;

type Pretty<T> = { [K in keyof T]: T[K] } & {};

type RelativePathname = `/${string}`;
type HTTPMethod = "GET" | "POST";

type ParamsSerializer<
  schema extends StandardSchemaV1 = StandardSchemaV1<any, any>
> = {
  schema: schema;
};

type QueryStringSerializer<
  schema extends StandardSchemaV1 = StandardSchemaV1<any, any>
> = {
  schema: schema;
  serialization?:
    | "urlencoded"
    | ([NoInfer<StandardSchemaV1.InferOutput<schema>>] extends [never]
        ? never
        : (
            query: NoInfer<StandardSchemaV1.InferOutput<schema>>
          ) => URLSearchParams);
};

type BodySerializer<
  schema extends StandardSchemaV1 = StandardSchemaV1<any, any>
> = {
  schema: schema;
  serialization?:
    | "json"
    | ((body: NoInfer<StandardSchemaV1.InferOutput<schema>>) => {
        body: BodyInit | null;
        content_type: string;
      });
};

type DataParser<schema extends StandardSchemaV1 = StandardSchemaV1<any, any>> =
  {
    schema: schema;
    deserialization?:
      | "json"
      | "text"
      | ((
          body: Response["body"]
        ) => NoInfer<StandardSchemaV1.InferInput<schema>>);
  };

type ErrorParser<schema extends StandardSchemaV1 = StandardSchemaV1<any, any>> =
  {
    schema: schema;
    deserialization?:
      | "text"
      | "json"
      | ((
          body: Response["body"]
        ) => NoInfer<StandardSchemaV1.InferInput<schema>>);
  };

type ExtractPathParams<Path extends string> =
  Path extends `${infer L}/${infer R}`
    ? ExtractPathParams<L> | ExtractPathParams<R>
    : Path extends `:${infer Param}`
    ? Param
    : never;

type InferParams<pathname extends RelativePathname> = Record<
  ExtractPathParams<pathname>,
  string | number
>;

type HasBody<method extends HTTPMethod> = method extends "POST" ? true : false;

type HasURLParams<pathname extends RelativePathname> = [
  ExtractPathParams<pathname>
] extends [never]
  ? false
  : true;

type DefaultParams<pathname extends RelativePathname> =
  HasURLParams<pathname> extends true
    ? StandardSchemaV1<InferParams<pathname>>
    : never;

type EndpointConfig<
  method extends HTTPMethod,
  pathname extends RelativePathname,
  params_schema extends StandardSchemaV1<any, InferParams<NoInfer<pathname>>>,
  query_schema extends StandardSchemaV1<Record<any, any>>,
  body_schema extends StandardSchemaV1,
  data_schema extends StandardSchemaV1,
  error_schema extends StandardSchemaV1
> = {
  method: method;
  pathname: pathname;
  query?: QueryStringSerializer<query_schema>;
  data: DataParser<data_schema>;
  error?: ErrorParser<error_schema>;
} & (HasURLParams<NoInfer<pathname>> extends true
  ? { params?: ParamsSerializer<params_schema> }
  : [params_schema] extends [never]
  ? {}
  : { params?: "error: this url does not have dynamic params" }) &
  (HasBody<NoInfer<method>> extends true
    ? { body: BodySerializer<body_schema> }
    : [body_schema] extends [never]
    ? {}
    : { body?: "error: this http method does not support body" });

function replace_params(
  pathname: RelativePathname,
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

function validate<output>(
  schema: StandardSchemaV1<any, output>,
  data: any
): output {
  const result = schema["~standard"].validate(data);
  if (result instanceof Promise)
    throw new Error("cannot validate asynchronously");
  // if the `issues` field exists, the validation failed
  if (result.issues) {
    throw new Error(JSON.stringify(result.issues, null, 2));
  }
  return result.value;
}

class HTTPEndpoint<
  method extends HTTPMethod,
  pathname extends RelativePathname,
  params_schema extends StandardSchemaV1<
    any,
    InferParams<NoInfer<pathname>>
  > = DefaultParams<NoInfer<pathname>>,
  query_schema extends StandardSchemaV1<Record<any, any>> = never,
  body_schema extends StandardSchemaV1 = never,
  data_schema extends StandardSchemaV1 = never,
  error_schema extends StandardSchemaV1 = never
> {
  #method: method;
  #pathname: pathname;
  #serializers: {
    params: Required<ParamsSerializer> | null;
    query: Required<QueryStringSerializer> | null;
    body: Required<BodySerializer> | null;
  };
  #parsers: {
    data: Required<DataParser>;
    error: Required<ErrorParser> | null;
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

  #generate_pathname(data: StandardSchemaV1.InferInput<params_schema>) {
    if (this.#serializers.params === null)
      return replace_params(this.#pathname, data);

    const params = validate(this.#serializers.params.schema, data);

    return replace_params(this.#pathname, params);
  }

  #generate_search_params(data: StandardSchemaV1.InferInput<query_schema>) {
    if (this.#serializers.query === null) return null;

    const search_params = validate(this.#serializers.query.schema, data);

    if (typeof this.#serializers.query.serialization === "function")
      return this.#serializers.query.serialization(search_params);

    return new URLSearchParams(search_params);
  }

  url({
    origin,
    params,
    query,
  }: Pretty<
    { origin: string } & ([params_schema] extends [never]
      ? { params?: never }
      : { params: StandardSchemaV1.InferInput<params_schema> }) &
      ([query_schema] extends [never]
        ? { query?: never }
        : { query: StandardSchemaV1.InferInput<query_schema> })
  >): URL {
    const url = new URL(origin);

    const pathname = this.#generate_pathname(params);
    url.pathname = pathname;

    const search_params = this.#generate_search_params(query ?? {});
    url.search = search_params ? `?${search_params.toString()}` : "";

    return url;
  }

  #generate_body(data: StandardSchemaV1.InferInput<body_schema>): {
    body: BodyInit | null;
    content_type?: string;
  } {
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

  body(data: StandardSchemaV1.InferInput<body_schema>): {
    body: BodyInit | null;
    content_type?: string;
  } {
    return this.#generate_body(data);
  }

  async parse_response(response: Response): Promise<
    TypedResponse<{
      data: StandardSchemaV1.InferOutput<data_schema>;
      error: StandardSchemaV1.InferOutput<error_schema>;
    }>
  > {
    return {} as any;
  }
}

type AnyEndpoint = HTTPEndpoint<any, any, any, any, any, any, any>;

function endpoint<
  const method extends HTTPMethod,
  const pathname extends RelativePathname,
  params_schema extends StandardSchemaV1<
    any,
    InferParams<NoInfer<pathname>>
  > = DefaultParams<NoInfer<pathname>>,
  query_schema extends StandardSchemaV1<Record<any, any>> = never,
  body_schema extends StandardSchemaV1 = never,
  data_schema extends StandardSchemaV1 = never,
  error_schema extends StandardSchemaV1 = StandardSchemaV1<any, string>
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

interface EndpointDefinitions {
  [name: string]: AnyEndpoint | EndpointDefinitions;
}

type TypedRequestInit<
  args extends { params: unknown; body: unknown; query: unknown }
> = Omit<RequestInit, "body" | "method" | "headers"> & {
  headers?: (default_headers: Headers) => Headers;
} & ([args["params"]] extends [never] ? {} : { params: args["params"] }) &
  ([args["query"]] extends [never] ? {} : { query: args["query"] }) &
  ([args["body"]] extends [never] ? {} : { body: args["body"] });

type Fetcher<
  def extends {
    params: unknown;
    query: unknown;
    body: unknown;
    data: unknown;
    error: unknown;
  }
> = (
  args: TypedRequestInit<{
    params: def["params"];
    query: def["query"];
    body: def["body"];
  }>
) => Promise<TypedResponse<{ data: def["data"]; error: def["error"] }>>;

type AnyFetcher = Fetcher<{
  params: any;
  query: any;
  body: any;
  data: any;
  error: any;
}>;

type HTTPFetchers<endpoints extends EndpointDefinitions> = Pretty<{
  -readonly [name in keyof endpoints]: endpoints[name] extends HTTPEndpoint<
    any,
    any,
    infer params_schema,
    infer query_schema,
    infer body_schema,
    infer data_schema,
    infer error_schema
  >
    ? Fetcher<{
        params: StandardSchemaV1.InferInput<params_schema>;
        query: StandardSchemaV1.InferInput<query_schema>;
        body: StandardSchemaV1.InferInput<body_schema>;
        data: StandardSchemaV1.InferOutput<data_schema>;
        error: StandardSchemaV1.InferOutput<error_schema>;
      }>
    : endpoints[name] extends EndpointDefinitions
    ? HTTPFetchers<endpoints[name]>
    : never;
}>;

type HttpClientOptions<endpoints extends EndpointDefinitions> = {
  origin: string;
  defaults?: { headers?: HeadersInit };
  endpoints: endpoints;
  fetch?: (
    url: URL,
    init: Omit<RequestInit, "headers"> & { headers: Headers }
  ) => Promise<Response>;
};
function http_client<const endpoints extends EndpointDefinitions>({
  origin,
  endpoints,
  defaults = {},
  fetch: custom_fetch = fetch,
}: HttpClientOptions<endpoints>) {
  function map_to_fetcher<defs extends EndpointDefinitions>(
    definition: defs
  ): HTTPFetchers<defs> {
    return Object.fromEntries(
      Object.entries(definition).map(([key, endpoint_or_object]) => {
        if (endpoint_or_object instanceof HTTPEndpoint) {
          const endpoint = endpoint_or_object;

          const fetcher: AnyFetcher = async ({
            query: unprocessed_query,
            params: unprocessed_params,
            body: unprocessed_body,
            headers: compute_headers = (h) => h,
            ...rest
          }) => {
            const headers = new Headers(defaults.headers ?? {});

            const url = endpoint.url({
              origin,
              params: unprocessed_params,
              query: unprocessed_query,
            });

            const { body, content_type } = endpoint.body(unprocessed_body);
            if (content_type) headers.set("Content-Type", content_type);

            const response = await custom_fetch(url, {
              ...defaults,
              ...rest,
              method: endpoint.method,
              body: body,
              headers: compute_headers(headers),
            });

            const output = await endpoint.parse_response(response);
            return output;
          };

          return [key, fetcher];
        }

        return [key, map_to_fetcher(endpoint_or_object)];
      })
    ) as HTTPFetchers<defs>;
  }

  return map_to_fetcher(endpoints);
}

// ---------------------------------------------------

const delete_user = endpoint({
  method: "POST",
  pathname: "/users/:id",
  params: {
    schema: z.object({
      id: z.boolean().transform((bool) => (bool ? "on" : "off")),
    }),
  },
  query: {
    schema: z.object({ x: z.string() }),
  },
  data: {
    schema: z.void(),
  },
  body: {
    schema: z.object({ test: z.string().transform((str) => str.length) }),
  },
});

const get_user = endpoint({
  method: "GET",
  pathname: "/users/:id",
  /* params: {
    schema: z.object({ id: z.boolean().transform((bool) => (bool ? "on" : "off")) }),
  },*/
  data: {
    schema: z.object({
      id: z.string(),
      username: z.string(),
      age: z.number().min(0),
    }),
  },
});

const api = http_client({
  origin: "",
  endpoints: {
    users: {
      get: get_user,
      delete: delete_user,
    },
  },
});

const x = await api.users.get({ params: { id: 33 } });
const y = await api.users.delete({
  params: { id: true },
  query: { x: "foo" },
  body: { test: "anything" },
});

if (x.ok) {
  x.data;
}
