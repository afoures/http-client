import z from "zod";

type Pretty<T> = { [K in keyof T]: T[K] } & {};

type RelativePathname = `/${string}`;

export type UnionToIntersection<Union> =
  // `extends unknown` is always going to be the case and is used to convert the
  // `Union` into a [distributive conditional
  // type](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-8.html#distributive-conditional-types).
  (
    Union extends unknown
      ? // The union type is used as the only argument to a function since the union
        // of function arguments is an intersection.
        (distributedUnion: Union) => void
      : // This won't happen.
        never
  ) extends // Infer the `Intersection` type since TypeScript represents the positional
  // arguments of unions of functions as an intersection of the union.
  (mergedIntersection: infer Intersection) => void
    ? // The `& Union` is to allow indexing by the resulting type
      Intersection & Union
    : never;

type TransformToEndpointsDefinition<Endpoints> = Pretty<
  UnionToIntersection<
    {
      [Pathname in keyof Endpoints & RelativePathname]: {
        [Method in keyof Endpoints[Pathname] &
          HTTPClient.HTTPMethod as `${Method} ${Pathname}`]: Endpoints[Pathname][Method];
      };
    }[keyof Endpoints & RelativePathname]
  >
>;

type CreateHTTPClientArgs<Endpoints extends HTTPClient.Endpoints> = {
  origin: { host: string; prefix?: string };
  defaults?: {} | (() => {});
  endpoints: Endpoints;
};

type HTTPClient<EndpointsDefinition> = {
  [Method in HTTPClient.HTTPMethod &
    (keyof EndpointsDefinition extends `${infer Method} ${string}`
      ? Method
      : never) as Lowercase<Method>]: <
    Pathname extends keyof EndpointsDefinition &
      `${Method} ${string}` extends `${Method} ${infer Pathnames}`
      ? Pathnames
      : never
  >(
    pathname: Pathname
  ) => Promise<HTTPClient.TypedResponse<{ 200: { ok: true } }>>;
};

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

namespace HTTPClient {
  export type infer<
    Client extends HTTPClient<any>,
    Endpoint extends Client extends HTTPClient<infer EndpointsDefinition>
      ? keyof EndpointsDefinition
      : never
  > = Client extends HTTPClient<infer EndpointsDefinition>
    ? EndpointsDefinition[Endpoint]
    : never;

  export type Endpoint = Partial<{
    HEAD: {};
    GET: {};
    POST: {};
    PATCH: {};
    PUT: {};
    DELETE: {};
  }>;

  export type Endpoints = Record<RelativePathname, HTTPClient.Endpoint>;

  export type HTTPMethod = keyof HTTPClient.Endpoint;

  export type TypedRequestInit = {};

  type BodyParsingConfiguration = Partial<
    Record<
      | HTTPStatus.InformationalResponse
      | HTTPStatus.SuccessfulResponse
      | HTTPStatus.RedirectMessage
      | HTTPStatus.ClientErrorResponse
      | HTTPStatus.ServerErrorResponse
      | "2xx"
      | "3xx"
      | "4xx"
      | "5xx",
      any
    >
  >;

  export type TypedResponse<BodyParser extends BodyParsingConfiguration> = Omit<
    Response,
    "clone" | "json" | "ok" | "status"
  > & {
    clone: () => HTTPClient.TypedResponse<BodyParser>;
    json: () => unknown;
  } & {
      [Status in keyof BodyParsingConfiguration]: {
        ok: Status extends HTTPStatus.SuccessfulResponse ? true : false;
        status: Status;
        /**
         * this may consume the response body, just like `.json()`, `.text()`...
         */
        parse: () => Promise<BodyParser[Status]>;
      };
    }[keyof BodyParsingConfiguration];
}

// TODO: retry policy backed in?
function create_http_client<Endpoints extends HTTPClient.Endpoints>(
  config: CreateHTTPClientArgs<Endpoints>
) {
  return {} as HTTPClient<TransformToEndpointsDefinition<Endpoints>>;
}
/**
 * test
 */
const output = {
  json(schema: any) {},
  text() {},
  void() {},
  constant<T>(value: T) {
    return value;
  },
  error(transform: (body: string, status: number) => void) {},
  /**
   * not sure about this
   */
  stream() {},
};

const http_client = create_http_client({
  origin: { host: "https://google.com" },
  defaults: {},
  endpoints: {
    "/hello": {
      GET: {
        parse: {
          "200": output.json({}),
          "204": output.void(),
          "2xx": output.stream(),
          "404": output.json({}),
          "4xx": output.error(() => {}),
          "5xx": output.text(),
        },
      },
      HEAD: {
        output: { b: true },
      },
      POST: (url: URL, init: any) => {
        return fetch(url, init).then((response) => {
          if (response.status === 404) return [];
          return ["ok"];
        });
      },
    },
    "/": {
      POST: {
        handle: [
          {
            status: [200, 204],
            as: output.json({}),
          },
          {
            status: [200, 204],
            as: output.json({}),
          },
          {
            status: [200, 204],
            as: output.json({}),
          },
        ],
      },
    },
    "/post/:id": {
      PUT: {
        output: { d: true },
      },

      // the ideal config?
      POST: {
        search_params: {},
        input: {
          body: {},
          serialization: "application/json",
        },
        // only need to define what should be the response, how to do that best?
        // ok: [],
        // ko: [],
        parse: {
          // this should be the default for 204, because it means no content?
          // should we do this one automatically?
          // "204": output.void(), // or output.constant(null)
          "2xx": { "200": output.json({}), "201": output.json({}) },
          // "404": output.constant(null),
          "4xx": z.object({ status: z.literal(404) }),
          "5xx": output.error(() => {}),
        },
        parse_: {
          ok: {},
          ko: {},
        },
      },
    },
    "/users/:id": {
      POST: {
        params: {
          schema: {},
          serialization: "urlencoded",
        },
        search_params: {
          schema: {},
          serialization: "urlencoded", // (search_params: Schema) => URLSearchParams
        },
        body: {
          schema: {},
          serialization: "json", // 'formdata', 'urlencoded', 'binary', (body: Schema) => BodyInit
        },
        data: {
          schema: {},
          deserialization: "json", // 'text', (body: ReadableStream<Uint8Array<ArrayBufferLike>> | null) => any
        },
        error: {
          schema: {},
          deserialization: "text", // 'json', (body: ReadableStream<Uint8Array<ArrayBufferLike>> | null) => any
        },

        //
        retry: {},
        timeout: 30_000,

        // should we allow this configuration here?
        // pros: centralised way of adding those,
        // cons: does not impact type safety, some only works in the browser
        headers: {},
        cache: "no-store",
        credentials: false,
      },
    },
  },
});

type infered = HTTPClient.infer<typeof http_client, "GET /hello">;

http_client.get("/hello");
http_client.post("/");
// @ts-expect-error
const response = await http_client.post("/users/:id", {
  params: { id: "1234567" },
});
const result1 = await response.parse();
if (response.ok) {
  const result = await response.parse();
}
if (response.status === 200) {
  const result = await response.parse();
}

type DataParser = unknown;

type DataParserByStatus = { "2xx": DataParser };

function parse_output(response: Response, config: Record<string, {}>) {
  const parser =
    config[response.status] ??
    config[response.status.toString().slice(0, 1) + "xx"] ??
    null;
}

type SharedResponseContent = {
  headers: Headers;
  url: string;
  raw_response: Response;
};

type ClientErrorResponse<Error> = SharedResponseContent & {
  // ok: false;
  status: HTTPStatus.ClientErrorResponse;
  error: Error;
};
type ServerErrorResponse<Error> = SharedResponseContent & {
  // ok: false;
  status: HTTPStatus.ServerErrorResponse;
  error: Error;
};
type SuccessfulResponse<Data> = SharedResponseContent & {
  // ok: true;
  status: HTTPStatus.SuccessfulResponse;
  data: Data;
};

type RedirectMessage = SharedResponseContent & {
  // ok: false;
  status: HTTPStatus.RedirectMessage;
};

type TypedResponse<Data, Error> =
  | ClientErrorResponse<Error>
  | ServerErrorResponse<Error>
  | SuccessfulResponse<Data>;

declare const result: TypedResponse<unknown, unknown>;

if (result.status === 200) {
  result;
}

if (result.status === 404) {
  result;
}

type EndpointDefinition_<Pathname extends string> = {};

function endpoint<Pathname extends RelativePathname>(
  pathname: Pathname,
  definition: EndpointDefinition_<Pathname>
) {
  return {};
}

type Router<
  Prefix extends RelativePathname,
  Routes extends Record<RelativePathname, EndpointDefinition_<RelativePathname>>
> = {
  register<
    Pathname extends RelativePathname,
    Definition extends EndpointDefinition_<NoInfer<Pathname>>
  >(
    pathname: Pathname extends keyof Routes
      ? `error: route '${Pathname}' already defined`
      : Pathname,
    definition: Definition
  ): Router<
    Prefix,
    Pretty<{
      [K in Pathname | keyof Routes]: K extends keyof Routes
        ? Routes[K]
        : Definition;
    }>
  >;
};

function router<Prefix extends RelativePathname = never>(args?: {
  prefix?: Prefix;
}): Router<Prefix, {}> {
  const routes = new Map<RelativePathname, any>();
  return {
    prefix: args?.prefix,
    register(pathname: any, definition: any) {
      routes.set(pathname, definition);
      return this as any;
    },
  } as any;
}

const user_routes = router()
  .register("/me", { xxx: true })
  .register("/signin", {})
  .register("/register", {})
  // @ts-expect-error
  .register("/me", { test: 42 });

const client = create_http_client({
  // @ts-expect-error
  routes: [user_routes],
});
