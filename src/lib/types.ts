import { type StandardSchemaV1 } from "@standard-schema/spec";
import { type Params as RoutePatternParams } from "@remix-run/route-pattern";
import type { AbortedError, NetworkError, TimeoutError, UnexpectedError } from "./errors";

export type Pretty<T> = { [K in keyof T]: T[K] } & {};

type is_any<T> = boolean extends (T extends never ? true : false) ? true : false;

export type MaybePromise<T> = T | Promise<T>;

const ZeroWidthSpace = "\u{200B}";

/** Unrendered character (U+200B) used to mark a string type */
type ZeroWidthSpace = typeof ZeroWidthSpace;

export type ErrorMessage<message extends string = string> = `error: ${message}${ZeroWidthSpace}`;

export namespace Pathname {
  export type Relative = `/${string}`;

  export type WithParams = `${string}:${string}`;

  export type Params<pathname extends Pathname.Relative> = Pretty<{
    [param in keyof RoutePatternParams<pathname>]: RoutePatternParams<pathname>[param] | number;
  }>;

  export type DefaultParamsObjectSchema<pathname extends Pathname.Relative> =
    pathname extends Pathname.WithParams ? Schema._<Pathname.Params<pathname>> : never;
}

export namespace HTTPStatus {
  export type InformationalResponse = 100 | 101 | 102 | 103;

  export type SuccessfulResponse = 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;

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

  export type ServerErrorResponse = 500 | 501 | 502 | 503 | 504 | 505 | 506 | 507 | 508 | 510 | 511;

  export type AnySuccessfullResponse = "2xx";
  export type AnyClientErrorResponse = "4xx";
  export type AnyServerErrorResponse = "5xx";

  export type Any =
    | HTTPStatus.InformationalResponse
    | HTTPStatus.SuccessfulResponse
    | HTTPStatus.ClientErrorResponse
    | HTTPStatus.ServerErrorResponse
    | HTTPStatus.RedirectMessage;
}

export namespace HTTPMethod {
  export type WithBody = "POST" | "PUT" | "PATCH" | "DELETE";
  export type WithoutBody = "GET";

  export type Any = HTTPMethod.WithoutBody | HTTPMethod.WithBody;
}

type HeaderValue = string | number | boolean | null | undefined;
type HeaderReducer = (current_value: string | undefined) => string | undefined | null;

export type HeadersInitWithReducer =
  | [string, HeaderValue | HeaderReducer][]
  | Record<string, HeaderValue | HeaderReducer>
  | Headers;

export namespace RetryPolicy {
  export type Condition = (context: {
    request: Request;
    response: Response | undefined;
    error: UnexpectedError | NetworkError | TimeoutError | AbortedError | undefined;
  }) => MaybePromise<boolean>;

  export type Attempts = number | ((context: { request: Request }) => MaybePromise<number>);

  export type Delay =
    | number
    | ((context: {
        response: Response | undefined;
        error: UnexpectedError | NetworkError | TimeoutError | AbortedError | undefined;
        request: Request;
        attempt: number;
      }) => MaybePromise<number>);

  export type Configuration = {
    attempts?: Attempts;
    delay?: Delay;
    when?: Condition;
  };
}

export namespace HTTPFetch {
  type SharedResponseContent = {
    method: HTTPMethod.Any;
    url?: string;
    headers: Headers;
    raw_response: Response;
  };

  export type ClientErrorResponse<
    errors extends Partial<Record<HTTPStatus.ClientErrorResponse, any>>,
    fallback,
  > = SharedResponseContent & {
    ok: false;
  } & (
      | {
          status: Exclude<HTTPStatus.ClientErrorResponse, keyof errors>;
          error: fallback;
        }
      | {
          [status in keyof errors & number]: { status: status; error: errors[status] };
        }[keyof errors & number]
    );

  export type ServerErrorResponse<
    errors extends Partial<Record<HTTPStatus.ServerErrorResponse, any>>,
    fallback,
  > = SharedResponseContent & {
    ok: false;
  } & (
      | {
          status: Exclude<HTTPStatus.ServerErrorResponse, keyof errors>;
          error: fallback;
        }
      | {
          [status in keyof errors & number]: { status: status; error: errors[status] };
        }[keyof errors & number]
    );

  export type SuccessfulResponse<
    data extends Partial<Record<Exclude<HTTPStatus.SuccessfulResponse, 204>, any>>,
    fallback,
  > = SharedResponseContent & {
    ok: true;
  } & (
      | {
          status: Exclude<HTTPStatus.SuccessfulResponse, keyof data>;
          data: fallback;
        }
      | { [status in keyof data & number]: { status: status; data: data[status] } }[keyof data &
          number]
      | {
          status: 204;
          data: null;
        }
    );

  export type RedirectMessage = SharedResponseContent & {
    ok: false;
    status: HTTPStatus.RedirectMessage;
    redirect_to: string | null;
  };

  type extract_applicable_status<
    map extends Partial<Record<Parser.AllowedStatus, any>>,
    list extends keyof map,
  > = Pretty<{ [status in Extract<normalize_key_as_number<keyof map>, list>]: map[status] }>;

  type normalize_key_as_number<key> = key extends number
    ? key
    : key extends `${infer n extends number}`
      ? n
      : never;

  type extract_default<
    map extends Partial<Record<Parser.AllowedStatus, any>>,
    key extends "2xx" | "4xx" | "5xx",
    default_type,
  > = key extends keyof map ? map[key] : default_type;

  export type AnyResponse<map extends Partial<Record<Parser.AllowedStatus, any>>> = [
    keyof map,
  ] extends [never]
    ?
        | SuccessfulResponse<{}, void>
        | ClientErrorResponse<{}, string>
        | ServerErrorResponse<{}, string>
        | RedirectMessage
    : string extends keyof map
      ?
          | SuccessfulResponse<{}, unknown>
          | ClientErrorResponse<{}, unknown>
          | ServerErrorResponse<{}, unknown>
          | RedirectMessage
      :
          | SuccessfulResponse<
              extract_applicable_status<map, Exclude<HTTPStatus.SuccessfulResponse, 204>>,
              extract_default<map, "2xx", void>
            >
          | ClientErrorResponse<
              extract_applicable_status<map, HTTPStatus.ClientErrorResponse>,
              extract_default<map, "4xx", string>
            >
          | ServerErrorResponse<
              extract_applicable_status<map, HTTPStatus.ServerErrorResponse>,
              extract_default<map, "5xx", string>
            >
          | RedirectMessage;

  export type TypedParamsInit<pathname extends Pathname.Relative, params_schema extends Schema._> =
    is_any<params_schema> extends true
      ? { params: any }
      : [params_schema] extends [never]
        ? pathname extends Pathname.WithParams
          ? { params: Pathname.Params<pathname> }
          : {}
        : { params: Schema.infer_input<params_schema> };

  export type TypedQueryInit<query_schema extends Schema._> =
    is_any<query_schema> extends true
      ? { query: any }
      : [query_schema] extends [never]
        ? {}
        : undefined extends Schema.infer_input<query_schema>
          ? { query?: Schema.infer_input<query_schema> }
          : { query: Schema.infer_input<query_schema> };

  export type TypedBodyInit<body_schema extends Schema._> =
    is_any<body_schema> extends true
      ? { body: any }
      : [body_schema] extends [never]
        ? {}
        : undefined extends Schema.infer_input<body_schema>
          ? { body?: Schema.infer_input<body_schema> }
          : { body: Schema.infer_input<body_schema> };

  type split_context<context_type, defaulted_keys extends PropertyKey> = Pretty<
    {
      [key in keyof context_type as key extends defaulted_keys ? never : key]: context_type[key];
    } & {
      [key in keyof context_type as key extends defaulted_keys ? key : never]?: context_type[key];
    }
  >;

  export type TypedContextInit<context_type, defaulted_keys extends PropertyKey> = [
    context_type,
  ] extends [never]
    ? {}
    : keyof context_type extends never
      ? {}
      : split_context<context_type, defaulted_keys> extends infer context
        ? {} extends context
          ? { context?: context }
          : { context: context }
        : never;

  export type DefaultRequestInit = {
    headers?: HeadersInitWithReducer;
  } & Omit<RequestInit, "body" | "method" | "headers">;

  export type OptionalRequestInit = {
    timeout?: number;
    retry?: RetryPolicy.Configuration;
  };
}

export namespace Schema {
  export type _<input = unknown, output = input> = StandardSchemaV1<input, output>;

  export type Any = Schema._<any, any>;

  export type Unknown = Schema._<unknown, unknown>;

  export type infer_input<schema extends Schema.Any, default_value extends unknown = never> = [
    default_value,
  ] extends [never]
    ? StandardSchemaV1.InferInput<schema>
    : [schema] extends [never]
      ? default_value
      : StandardSchemaV1.InferInput<schema>;

  export type infer_output<schema extends Schema.Any, default_value extends unknown = never> = [
    default_value,
  ] extends [never]
    ? StandardSchemaV1.InferOutput<schema>
    : [schema] extends [never]
      ? default_value
      : StandardSchemaV1.InferOutput<schema>;
}

type SchemaOrFactory<schema, context_type> = schema | ((context: NoInfer<context_type>) => schema);

export namespace Json {
  export type Object = { [Key in string]: Json.Value };

  export type Array = Json.Value[] | readonly Json.Value[];

  export type Primitive = string | number | boolean | null;

  export type Value = Json.Primitive | Json.Object | Json.Array;
}

export namespace Serializer {
  export type Any = {
    schema: SchemaOrFactory<Schema.Any, any>;
    serialize?: string | ((data: any, context: any) => any);
  };

  export type Params<pathname extends Pathname.Relative, schema, context_type = unknown> = {
    schema: SchemaOrFactory<schema, context_type>;
    serialize?: (
      data: Schema.infer_output<NoInfer<schema & Schema._>, any>,
      context: NoInfer<context_type>,
    ) => Pathname.Params<pathname>;
  };

  export type QueryString<schema, context_type = unknown> = {
    schema: SchemaOrFactory<schema, context_type>;
    serialize?:
      | "urlencoded"
      | ((
          data: Schema.infer_output<NoInfer<schema & Schema._>, any>,
          context: NoInfer<context_type>,
        ) => URLSearchParams);
  };

  export type Body<schema, context_type = unknown> = {
    schema: SchemaOrFactory<schema, context_type>;
    serialize:
      | "json"
      | ((
          data: Schema.infer_output<NoInfer<schema & Schema._>, any>,
          context: NoInfer<context_type>,
        ) => {
          body: BodyInit | null;
          content_type: string;
        });
  };
}

export namespace Parser {
  export type Any = {
    schema: SchemaOrFactory<Schema.Any, any>;
    parse: string | ((data: any, context: any) => any);
  };

  export type ResponseBody<schema, context_type = unknown> = {
    schema: SchemaOrFactory<schema, context_type>;
    parse:
      | "json"
      | "text"
      | ((
          body: Response["body"],
          context: NoInfer<context_type>,
        ) => Promise<Schema.infer_input<NoInfer<schema & Schema._>, any>>);
  };

  export type AllowedStatus =
    | HTTPStatus.AnySuccessfullResponse
    | Exclude<HTTPStatus.SuccessfulResponse, 204>
    | HTTPStatus.AnyClientErrorResponse
    | HTTPStatus.ClientErrorResponse
    | HTTPStatus.AnyServerErrorResponse
    | HTTPStatus.ServerErrorResponse;

  export type ResponseBodyByStatus<
    map extends Partial<Record<Parser.AllowedStatus, Schema._>>,
    context_type = unknown,
  > = {
    [status in keyof map]: Parser.ResponseBody<map[status], context_type>;
  };
}
