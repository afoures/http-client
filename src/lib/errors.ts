import type { HTTPFetch } from "./types.ts";

type RequestContext = {
  url: string;
  method: string;
  pathname?: string;
  baseUrl?: string;
  headers?: Headers;
  /** The normalized timeouts the call ran under, never the shorthand number the caller may have passed. */
  timeout?: HTTPFetch.TimeoutConfig;
};

type ResponseContext = {
  status: number;
  statusText?: string;
  headers?: Headers;
  body?: unknown;
};

type TimingContext = {
  startTime?: number;
  duration?: number;
  attempt?: number;
  maxAttempts?: number;
};

type InputContext = {
  params?: unknown;
  query?: unknown;
  body?: unknown;
};

/** Structured context attached to every error: the failing operation plus optional request, response, timing and input details. */
export type ErrorContext = {
  operation: string;
  request?: RequestContext;
  response?: ResponseContext;
  timing?: TimingContext;
  input?: InputContext;
};

/**
 * Discriminant carried by every error the client returns, mirroring `HTTPFetch.ResponseKind` on the
 * response envelopes. Each value is the class name, matching `name` at runtime; the difference is
 * that `Error` types `name` as `string`, so only `kind` can discriminate a union.
 *
 * `instanceof Error` is the check to reach for first, since it separates every failure from the
 * response envelopes in one branch. Fall back to `kind` when the value may have been spread, cloned
 * or serialized, or when two copies of this package could be installed, since all of those break
 * prototype checks and leave `kind` intact.
 *
 * `"HttpClientError"` belongs to the base class, which a call never returns on its own.
 */
export type ErrorKind =
  | "HttpClientError"
  | "TimeoutError"
  | "AbortedError"
  | "SerializationError"
  | "ParseError"
  | "NetworkError"
  | "UnexpectedError";

/**
 * Base class for the transport-level errors the client returns (never throws) as the result of a
 * call. Because every failure comes back as a value, check for it before using a result: a single
 * `instanceof HttpClientError` catches timeouts, aborts, serialization, parse and network errors
 * (but not {@link UnexpectedError}, which extends `Error` directly and so must be handled on its
 * own; `instanceof Error` is the check that covers every failure at once).
 *
 * @example
 * const result = await api.users.get({ params: { id: "1" } });
 * if (result instanceof Error) return console.error(result.message, result.context);
 * // result is now a typed response
 */
export class HttpClientError extends Error {
  /** {@link ErrorKind} discriminant, for when `instanceof` is not available; narrowed to a literal by each subclass. */
  public readonly kind: ErrorKind = "HttpClientError";

  /** Structured details about the failure (operation, request, response, timing, input). */
  public readonly context: ErrorContext;

  constructor(message: string, { cause, ...options }: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, { cause });
    this.name = "HttpClientError";
    this.context = {
      ...options,
      operation: options.operation ?? "unknown",
    };
  }
}

/** The request exceeded the configured `timeout`. */
export class TimeoutError extends HttpClientError {
  public override readonly kind = "TimeoutError";

  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "TimeoutError";
  }
}

/** The request was aborted via an `AbortSignal`. */
export class AbortedError extends HttpClientError {
  public override readonly kind = "AbortedError";

  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "AbortedError";
  }
}

/** Serializing or validating the request params, query or body failed. */
export class SerializationError extends HttpClientError {
  public override readonly kind = "SerializationError";

  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "SerializationError";
  }
}

/** Parsing or validating the response body against its schema failed. */
export class ParseError extends HttpClientError {
  public override readonly kind = "ParseError";

  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "ParseError";
  }
}

/** The underlying `fetch` failed at the network level (connection refused, DNS, etc.). */
export class NetworkError extends HttpClientError {
  public override readonly kind = "NetworkError";

  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "NetworkError";
  }
}

/** Catch-all for the cases where something threw where a value was expected (a schema, serializer, parser or retry callback crashing) or a client invariant broke. Extends `Error` directly, not {@link HttpClientError}, so it cannot be swallowed by a single `instanceof HttpClientError` check. */
export class UnexpectedError extends Error {
  /** {@link ErrorKind} discriminant, for when `instanceof` is not available. */
  public readonly kind = "UnexpectedError";

  /** Structured details about the failure (operation, request, response, timing, input). */
  public readonly context: ErrorContext;

  constructor(message: string, { cause, ...options }: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, { cause });
    this.name = "UnexpectedError";
    this.context = {
      ...options,
      operation: options.operation ?? "unknown",
    };
  }
}
