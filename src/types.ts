import { type StandardSchemaV1 } from "@standard-schema/spec";
import { type Params as RoutePatternParams } from "@remix-run/route-pattern";
import z from "zod";

export type Pretty<T> = { [K in keyof T]: T[K] } & {};

const ZeroWidthSpace = "\u{200B}";

/** Unrendered character (U+200B) used to mark a string type */
type ZeroWidthSpace = typeof ZeroWidthSpace;

export type ErrorMessage<message extends string = string> =
  `error: ${message}${ZeroWidthSpace}`;

export namespace Pathname {
  export type Relative = `/${string}`;

  export type WithParams = `${string}:${string}`;

  export type Params<pathname extends Pathname.Relative> = Pretty<{
    [param in keyof RoutePatternParams<pathname>]:
      | RoutePatternParams<pathname>[param]
      | number;
  }>;

  export type DefaultParamsObjectSchema<pathname extends Pathname.Relative> =
    pathname extends Pathname.WithParams
      ? Schema._<Pathname.Params<pathname>>
      : never;
}

export namespace HTTPStatus {
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

export namespace HTTPMethod {
  export type WithBody = "POST" | "PUT" | "PATCH" | "DELETE";
  export type WithoutBody = "GET";

  export type Any = HTTPMethod.WithoutBody | HTTPMethod.WithBody;
}

export namespace HTTPFetchApi {
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

  export type TypedResponse<
    data extends unknown = void,
    error extends unknown = string
  > =
    | ClientErrorResponse<error>
    | ServerErrorResponse<error>
    | SuccessfulResponse<data>
    | RedirectMessage;

  export type TypedRequestInit<
    args extends { params: unknown; body: unknown; query: unknown }
  > = Omit<RequestInit, "body" | "method" | "headers"> & {
    headers?: (default_headers: Headers) => Headers;
  } & ([args["params"]] extends [never] ? {} : { params: args["params"] }) &
    ([args["query"]] extends [never] ? {} : { query: args["query"] }) &
    ([args["body"]] extends [never] ? {} : { body: args["body"] });
}

export namespace Schema {
  export type _<input = unknown, output = input> = StandardSchemaV1<
    input,
    output
  >;

  export type Any = Schema._<any, any>;

  export type Unknown = Schema._<unknown, unknown>;

  export type infer_input<schema extends Schema.Any> =
    StandardSchemaV1.InferInput<schema>;

  export type infer_output<schema extends Schema.Any> =
    StandardSchemaV1.InferOutput<schema>;
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

  export type Params<schema extends Schema._ = Schema.Any> = {
    schema: schema;
  };

  export type ParamsV2<
    pathname extends Pathname.Relative,
    schema extends Schema._
  > = schema extends Schema._<any, Pathname.Params<pathname>>
    ? {
        schema: schema;
        serialization?: (
          data: Schema.infer_output<NoInfer<schema>>
        ) => Pathname.Params<pathname>;
      }
    : {
        schema: schema;
        serialization: (
          data: Schema.infer_output<NoInfer<schema>>
        ) => Pathname.Params<pathname>;
      };

  export type QueryString<schema extends Schema._ = Schema.Any> = {
    schema: schema;
    serialization?:
      | "urlencoded"
      | ([Schema.infer_output<NoInfer<schema>>] extends [never]
          ? never
          : (query: Schema.infer_output<NoInfer<schema>>) => URLSearchParams);
  };

  export type QueryStringV2<schema extends Schema._> = schema extends Schema._<
    any,
    Array<Array<string>> | Record<string, string> | undefined
  >
    ? {
        schema: schema;
        serialization?:
          | "urlencoded"
          | ((data: Schema.infer_output<NoInfer<schema>>) => URLSearchParams);
      }
    : {
        schema: schema;
        serialization: (
          data: Schema.infer_output<NoInfer<schema>>
        ) => URLSearchParams;
      };

  export type Body<schema extends Schema._ = Schema.Any> = {
    schema: schema;
    serialization?:
      | "json"
      | ((body: Schema.infer_output<NoInfer<schema>>) => {
          body: BodyInit | null;
          content_type: string;
        });
  };

  export type BodyV2<schema extends Schema._> = schema extends Schema._<
    any,
    Json.Value
  >
    ? {
        schema: schema;
        serialization?:
          | "json"
          | ((data: Schema.infer_output<NoInfer<schema>>) => {
              body: BodyInit | null;
              content_type: string;
            });
      }
    : {
        schema: schema;
        serialization: (data: Schema.infer_output<NoInfer<schema>>) => {
          body: BodyInit | null;
          content_type: string;
        };
      };
}

export namespace Parser {
  export type Any = {
    schema: Schema.Any;
    deserialization?: string | ((data: any) => any);
  };

  export type Data<schema extends Schema._ = Schema.Any> = {
    schema: schema;
    deserialization?:
      | "json"
      | "text"
      | ((body: Response["body"]) => Schema.infer_input<NoInfer<schema>>);
  };

  export type DataV2<schema extends Schema._> = schema extends Schema._<
    string,
    any
  >
    ? {
        schema: schema;
        deserialization:
          | "text"
          | "json"
          | ((
              body: Response["body"]
            ) => Promise<Schema.infer_input<NoInfer<schema>>>);
      }
    : schema extends Schema._<Json.Value, any>
    ? {
        schema: schema;
        deserialization?:
          | "json"
          | ((
              body: Response["body"]
            ) => Promise<Schema.infer_input<NoInfer<schema>>>);
      }
    : {
        schema: schema;
        deserialization: (
          body: Response["body"]
        ) => Promise<Schema.infer_input<NoInfer<schema>>>;
      };

  export type Error<schema extends Schema._ = Schema.Any> = {
    schema: schema;
    deserialization?:
      | "text"
      | "json"
      | ((body: Response["body"]) => Schema.infer_input<NoInfer<schema>>);
  };

  export type ErrorV2<schema extends Schema._> = schema extends Schema._<
    string,
    any
  >
    ? {
        schema: schema;
        deserialization:
          | "text"
          | "json"
          | ((
              body: Response["body"]
            ) => Promise<Schema.infer_input<NoInfer<schema>>>);
      }
    : schema extends Schema._<Json.Value, any>
    ? {
        schema: schema;
        deserialization:
          | "json"
          | ((
              body: Response["body"]
            ) => Promise<Schema.infer_input<NoInfer<schema>>>);
      }
    : {
        schema: schema;
        deserialization: (
          body: Response["body"]
        ) => Promise<Schema.infer_input<NoInfer<schema>>>;
      };
}
