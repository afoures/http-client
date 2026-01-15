import { z } from "zod";

import { Exception } from "@/lib/error-management/errors";

// eslint-disable-next-line @typescript-eslint/ban-types
type Pretty<T> = { [K in keyof T]: T[K] } & {};

type Remove<Values, From> = Omit<
  From,
  {
    [Key in keyof From]: [From[Key]] extends [never]
      ? [Values] extends [never]
        ? Key
        : never
      : [From[Key]] extends [Values]
      ? Key
      : never;
  }[keyof From]
>;

type MaybeZodUnion<T extends z.Schema> = T | z.ZodUnion<[T, ...Array<T>]>;
type MaybeZodOptional<T extends z.Schema> = T | z.ZodOptional<T>;

type BodyDefinition =
  | {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: MaybeZodUnion<z.AnyZodObject | z.ZodArray<any>>;
      serialize?: "application/json";
    }
  | {
      body: z.ZodType<File, z.ZodTypeDef, File>;
      serialize: "application/binary";
    }
  | {
      body: MaybeZodUnion<z.AnyZodObject>;
      serialize: "multipart/form-data";
    };
type SearchParamsDefinition = {
  searchParams: MaybeZodOptional<z.AnyZodObject>;
};
type OutputDefinition = { output: z.ZodSchema };

type EndpointDefinition = {
  GET: Partial<SearchParamsDefinition> & OutputDefinition;
  POST: Partial<SearchParamsDefinition> & BodyDefinition & OutputDefinition;
  PATCH: Partial<SearchParamsDefinition> & BodyDefinition & OutputDefinition;
  PUT: Partial<SearchParamsDefinition> & BodyDefinition & OutputDefinition;
  DELETE: Partial<SearchParamsDefinition & BodyDefinition> & OutputDefinition;
};

const HTTP_METHODS = new Set<keyof EndpointDefinition>([
  "POST",
  "PUT",
  "PATCH",
  "GET",
  "DELETE",
]);

function isAllowedHttpMethod(method: string): method is HttpMethod {
  return HTTP_METHODS.has(method as HttpMethod);
}

type HttpMethod = keyof EndpointDefinition;

type RelativeUrl = `/${string}`;

export type EndpointsDefinitions = Record<
  RelativeUrl,
  Partial<EndpointDefinition>
>;

export type InferOutput<
  Definitions extends EndpointsDefinitions,
  Endpoint extends keyof Definitions,
  Method extends keyof Definitions[Endpoint]
> = Definitions[Endpoint][Method] extends { output: z.Schema }
  ? z.infer<Definitions[Endpoint][Method]["output"]>
  : never;

export type InferBody<
  Definitions extends EndpointsDefinitions,
  Endpoint extends keyof Definitions,
  Method extends keyof Definitions[Endpoint]
> = Definitions[Endpoint][Method] extends { body: z.Schema }
  ? z.infer<Definitions[Endpoint][Method]["body"]>
  : never;

export type InferSearchParams<
  Definitions extends EndpointsDefinitions,
  Endpoint extends keyof Definitions,
  Method extends keyof Definitions[Endpoint]
> = Definitions[Endpoint][Method] extends { searchParams: z.Schema }
  ? z.infer<Definitions[Endpoint][Method]["searchParams"]>
  : never;

export type TypedRequestInit<
  Definition extends { params: string; body: unknown; searchParams: unknown }
> = Omit<RequestInit, "body" | "method" | "headers"> & {
  headers?: (defaultHeaders: Headers) => Headers;
  // eslint-disable-next-line @typescript-eslint/ban-types
} & ([Definition["body"]] extends [never] ? {} : { body: Definition["body"] }) &
  ([Definition["searchParams"]] extends [never]
    ? // eslint-disable-next-line @typescript-eslint/ban-types
      {}
    : { searchParams: Definition["searchParams"] }) &
  ([Definition["params"]] extends [never]
    ? // eslint-disable-next-line @typescript-eslint/ban-types
      {}
    : {
        params: Record<Definition["params"], string | number>;
      });

export type TypedResponse<Output> = Omit<Response, "json" | "ok"> &
  (
    | {
        ok: true;
        json: () => Promise<Output>;
      }
    | { ok: false; json: () => Promise<unknown> }
  );

type FilterByHttpMethod<
  Endpoints extends EndpointsDefinitions,
  Method extends HttpMethod
> = Pretty<
  Remove<
    never,
    {
      [Url in keyof Endpoints]: [Endpoints[Url]] extends [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { [_ in Method]: any }
      ]
        ? Endpoints[Url][Method]
        : never;
    }
  >
>;

type ExtractPathParams<Path extends string> =
  Path extends `${infer L}/${infer R}`
    ? ExtractPathParams<L> | ExtractPathParams<R>
    : Path extends `:${infer Param}`
    ? Param
    : never;

type TypedFetchMethod<
  FilteredEndpoints extends Record<RelativeUrl, OutputDefinition>
  // eslint-disable-next-line @typescript-eslint/ban-types
> = {} extends FilteredEndpoints
  ? never
  : <
      Url extends keyof FilteredEndpoints & RelativeUrl = never,
      Definition extends {
        params: string;
        body: unknown;
        searchParams: unknown;
      } = {
        params: ExtractPathParams<Url>;
        searchParams: FilteredEndpoints[Url] extends SearchParamsDefinition
          ? z.input<FilteredEndpoints[Url]["searchParams"]>
          : never;
        body: FilteredEndpoints[Url] extends BodyDefinition
          ? z.input<FilteredEndpoints[Url]["body"]>
          : never;
      }
    >(
      // this helps making init param not required if no input are required
      ...args: Definition extends {
        params: never;
        searchParams: never;
        body: never;
      }
        ? [url: Url, init?: TypedRequestInit<Definition>]
        : [url: Url, init: TypedRequestInit<Definition>]
    ) => Promise<TypedResponse<z.output<FilteredEndpoints[Url]["output"]>>>;

export type TypedJsonApi<Endpoints extends EndpointsDefinitions> = Remove<
  never,
  {
    [Method in HttpMethod as Lowercase<Method>]: TypedFetchMethod<
      FilterByHttpMethod<Endpoints, Method>
    >;
  }
>;

export type CreateTypedJsonApiArgs<Endpoints extends EndpointsDefinitions> = {
  origin: string;
  endpoints: Endpoints;
  fetch?: (
    url: URL,
    init: Omit<RequestInit, "headers"> & { headers: Headers }
  ) => Promise<Response>;
  defaultRequestInit?: Omit<RequestInit, "method" | "body">;
};

function replaceParams(
  relativeUrl: RelativeUrl,
  params: Record<string, number | string> = {}
) {
  const url = relativeUrl
    .split("/")
    .map((segment) => {
      if (segment.startsWith(":")) {
        const value = params[segment.slice(1)];
        if (value === undefined || value === "") {
          throw new Exception(
            `url path param "${segment.slice(1)}" should not be empty`,
            { param: segment.slice(1) }
          );
        }
        return encodeURIComponent(value.toString());
      }
      return segment;
    })
    .join("/");

  return url;
}

function parse<Schema extends z.ZodSchema>(
  name: string,
  schema: Schema,
  data: unknown,
  url: string
): z.output<Schema> {
  const parsed = schema.safeParse(data);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Exception(
    `parsing of "${name}" of "${url}" failed`,
    parsed.error.format()
  );
}

function removeUndefinedValues(obj: Record<string, unknown>) {
  Object.keys(obj).forEach((key) => {
    if (obj[key] === undefined) {
      // eslint-disable-next-line no-param-reassign
      delete obj[key];
    }
  });
}

export function override<In extends object, Out extends In = In>(
  something: In,
  diff: Partial<{ [Key in keyof In]: () => Out[Key] }>
): Out {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function isInDiff(key: any): key is keyof typeof diff {
    return key in diff;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Proxy<Out>(something as any, {
    get: (target, key, receiver) => {
      if (isInDiff(key)) {
        const getNewValue = diff[key];
        if (getNewValue) return getNewValue();
      }
      const value = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function createTypedJsonApi<
  const Endpoints extends EndpointsDefinitions
>(args: CreateTypedJsonApiArgs<Endpoints>): TypedJsonApi<Endpoints> {
  const fetchApi = args.fetch ?? fetch;

  const methodsUsedInDefinition = new Set<HttpMethod>();
  // eslint-disable-next-line no-restricted-syntax
  for (const definition of Object.values(args.endpoints)) {
    Object.keys(definition).forEach((method) =>
      methodsUsedInDefinition.add(method as HttpMethod)
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Proxy<TypedJsonApi<Endpoints>>({} as any, {
    get: (target, key, receiver) => {
      const method = String(key).toUpperCase();
      if (
        !isAllowedHttpMethod(method) ||
        !methodsUsedInDefinition.has(method)
      ) {
        return Reflect.get(target, key, receiver);
      }

      return async (
        relativeUrl: RelativeUrl,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        typedRequestInit: TypedRequestInit<any> = {} as any
      ) => {
        const definition = args.endpoints[relativeUrl]?.[method];
        if (!definition) {
          throw new Exception(
            `url "${relativeUrl}" with "${method}" method does not match any endpoint definition on this api`,
            { relativeUrl, method, endpoints: args.endpoints }
          );
        }

        const {
          params: requestParams,
          body: requestBody,
          searchParams: requestSearchParams,
          headers: requestHeaders,
          ...requestInit
        } = typedRequestInit;

        const url = new URL(
          replaceParams(relativeUrl, requestParams),
          args.origin
        );
        if (
          "searchParams" in definition &&
          definition.searchParams &&
          requestSearchParams
        ) {
          const parsedSearchParams = parse(
            "searchParams",
            definition.searchParams,
            requestSearchParams,
            relativeUrl
          );
          if (parsedSearchParams) {
            removeUndefinedValues(parsedSearchParams);
            url.search = `?${new URLSearchParams(parsedSearchParams)}`;
          }
        }

        let headers = new Headers(args.defaultRequestInit?.headers);
        if (requestHeaders) {
          headers = requestHeaders(headers);
        }

        let body: BodyInit | null = null;
        if ("body" in definition && definition.body && requestBody) {
          switch (definition.serialize) {
            case "multipart/form-data":
              // eslint-disable-next-line no-case-declarations
              const formData = new FormData();
              Object.entries(
                parse("body", definition.body, requestBody, relativeUrl)
              ).forEach(([property, value]) => {
                if (value != null) {
                  formData.append(property, value);
                }
              });
              body = formData;
              break;
            case "application/binary":
              body = parse("body", definition.body, requestBody, relativeUrl);
              headers.set("Content-Type", "application/binary");
              break;
            default:
              body = JSON.stringify(
                parse("body", definition.body, requestBody, relativeUrl)
              );
              headers.set("Content-Type", "application/json");
              break;
          }
        }

        const response = await fetchApi(url, {
          ...args.defaultRequestInit,
          ...requestInit,
          method,
          body,
          headers,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return override<Response, TypedResponse<any>>(response, {
          json: () => () => {
            return response.json().then((json) => {
              if (response.ok) {
                return parse("output", definition.output, json, relativeUrl);
              }
              return json;
            });
          },
        });
      };
    },
  });
}
