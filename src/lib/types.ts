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
    /**
     * the number of attempts to make before giving up
     */
    attempts?: Attempts;
    /**
     * the delay before retrying
     */
    delay?: Delay;
    /**
     * function to determine if a retry attempt should be made
     */
    when?: Condition;
  };
}

export namespace HTTPFetch {
  type SharedResponseContent = {
    headers: Headers;
    raw_response: Response;
  };

  export type ClientErrorResponse<Error> = SharedResponseContent & {
    ok: false;
    status: HTTPStatus.ClientErrorResponse;
    error: Error;
  };

  export type ServerErrorResponse<Error> = SharedResponseContent & {
    ok: false;
    status: HTTPStatus.ServerErrorResponse;
    error: Error;
  };

  export type SuccessfulResponse<Data> = SharedResponseContent & {
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

  export type RedirectMessage = SharedResponseContent & {
    ok: false;
    status: HTTPStatus.RedirectMessage;
    redirect_to: string | null;
  };

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

  export type DefaultRequestInit = {
    headers?: HeadersInitWithReducer;
  } & Omit<RequestInit, "body" | "method" | "headers">;

  export type OptionalRequestInit = {
    /**
     * timeout in milliseconds
     */
    timeout?: number;
    /**
     * retry policy
     */
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

export namespace Json {
  /**
  Matches a JSON object.

  @category JSON
  */
  export type Object = { [Key in string]: Json.Value };

  /**
  Matches a JSON array.

  @category JSON
  */
  export type Array = Json.Value[] | readonly Json.Value[];

  /**
  Matches any valid JSON primitive value.

  @category JSON
  */
  export type Primitive = string | number | boolean | null;

  /**
  Matches any valid JSON value.

  @category JSON
  */
  export type Value = Json.Primitive | Json.Object | Json.Array;
}

export namespace Serializer {
  export type Any = {
    schema: Schema.Any;
    serialization?: string | ((data: any) => any);
  };

  export type Params<pathname extends Pathname.Relative, schema extends Schema._> =
    schema extends Schema._<any, Pathname.Params<pathname>>
      ? {
          schema: schema;
          serialization?: (data: Schema.infer_output<NoInfer<schema>>) => Pathname.Params<pathname>;
        }
      : {
          schema: schema;
          serialization: (data: Schema.infer_output<NoInfer<schema>>) => Pathname.Params<pathname>;
        };

  export type QueryString<schema extends Schema._> =
    schema extends Schema._<any, Array<Array<string>> | Record<string, string> | undefined>
      ? {
          schema: schema;
          serialization?:
            | "urlencoded"
            | ((data: Schema.infer_output<NoInfer<schema>>) => URLSearchParams);
        }
      : {
          schema: schema;
          serialization: (data: Schema.infer_output<NoInfer<schema>>) => URLSearchParams;
        };

  export type Body<schema extends Schema._> = {
    schema: schema;
    serialization:
      | "json"
      | ((data: Schema.infer_output<NoInfer<schema>, any>) => {
          body: BodyInit | null;
          content_type: string;
        });
  };
}

export namespace Parser {
  export type Any = {
    schema: Schema.Any;
    deserialization: string | ((data: any) => any);
  };

  export type Data<schema extends Schema._> =
    schema extends Schema._<string, any>
      ? {
          schema: schema;
          deserialization:
            | "text"
            | ((body: Response["body"]) => Promise<Schema.infer_input<NoInfer<schema>>>);
        }
      : {
          schema: schema;
          deserialization:
            | "json"
            | ((body: Response["body"]) => Promise<Schema.infer_input<NoInfer<schema>>>);
        };

  export type Error<schema extends Schema._> =
    schema extends Schema._<string, any>
      ? {
          schema: schema;
          deserialization:
            | "text"
            | ((body: Response["body"]) => Promise<Schema.infer_input<NoInfer<schema>>>);
        }
      : {
          schema: schema;
          deserialization:
            | "json"
            | ((body: Response["body"]) => Promise<Schema.infer_input<NoInfer<schema>>>);
        };
}
