type RequestContext = {
  url: string;
  method: string;
  pathname?: string;
  baseUrl?: string;
  headers?: Headers;
  timeout?: number;
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
 * Base class for the transport-level errors the client returns (never throws) as the result of a
 * call. Because every failure comes back as a value, check for it before using a result: a single
 * `instanceof HttpClientError` catches timeouts, aborts, serialization, parse and network errors
 * (but not {@link UnexpectedError}, which extends `Error` directly).
 *
 * @example
 * const result = await api.users.get({ params: { id: "1" } });
 * if (result instanceof HttpClientError) return handle(result.context);
 * // result is now a typed response
 */
export class HttpClientError extends Error {
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
  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "TimeoutError";
  }
}

/** The request was aborted via an `AbortSignal`. */
export class AbortedError extends HttpClientError {
  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "AbortedError";
  }
}

/** Serializing or validating the request params, query or body failed. */
export class SerializationError extends HttpClientError {
  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "SerializationError";
  }
}

/** Parsing or validating the response body against its schema failed. */
export class ParseError extends HttpClientError {
  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "ParseError";
  }
}

/** The underlying `fetch` failed at the network level (connection refused, DNS, etc.). */
export class NetworkError extends HttpClientError {
  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "NetworkError";
  }
}

/** Catch-all for the cases where something threw where a value was expected (a schema, serializer, parser or retry callback crashing) or a client invariant broke. Extends `Error` directly, not {@link HttpClientError}, so it cannot be swallowed by a single `instanceof HttpClientError` check. */
export class UnexpectedError extends Error {
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
