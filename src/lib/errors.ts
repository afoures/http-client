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

export type ErrorContext = {
  operation: string;
  request?: RequestContext;
  response?: ResponseContext;
  timing?: TimingContext;
  input?: InputContext;
};

export class HttpClientError extends Error {
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

export class TimeoutError extends HttpClientError {
  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "TimeoutError";
  }
}

export class AbortedError extends HttpClientError {
  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "AbortedError";
  }
}

export class SerializationError extends HttpClientError {
  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "SerializationError";
  }
}

export class ParseError extends HttpClientError {
  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "ParseError";
  }
}

export class NetworkError extends HttpClientError {
  constructor(message: string, options: { cause?: unknown } & Partial<ErrorContext>) {
    super(message, options);
    this.name = "NetworkError";
  }
}

export class UnexpectedError extends Error {
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
