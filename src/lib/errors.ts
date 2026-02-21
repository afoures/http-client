type BaseContext = {
  operation: string;
};

type ErrorCause = {
  cause?: unknown;
};

export class HttpClientError extends Error {
  constructor(message: string, options: ErrorCause) {
    super(message, options);
    this.name = "HttpClientError";
  }
}

export class TimeoutError extends HttpClientError {
  public readonly context: BaseContext;

  constructor(message: string, { cause, ...context }: ErrorCause & BaseContext) {
    super(message, { cause });
    this.name = "TimeoutError";
    this.context = context;
  }
}

export class AbortedError extends HttpClientError {
  public readonly context: BaseContext;

  constructor(message: string, { cause, ...context }: ErrorCause & BaseContext) {
    super(message, { cause });
    this.name = "AbortedError";
    this.context = context;
  }
}

export class SerializationError extends HttpClientError {
  public readonly context: BaseContext;

  constructor(message: string, { cause, ...context }: ErrorCause & BaseContext) {
    super(message, { cause });
    this.name = "SerializationError";
    this.context = context;
  }
}

export class DeserializationError extends HttpClientError {
  public readonly context: BaseContext;

  constructor(message: string, { cause, ...context }: ErrorCause & BaseContext) {
    super(message, { cause });
    this.name = "DeserializationError";
    this.context = context;
  }
}

export class NetworkError extends HttpClientError {
  public readonly context: BaseContext;

  constructor(message: string, { cause, ...context }: ErrorCause & BaseContext) {
    super(message, { cause });
    this.name = "NetworkError";
    this.context = context;
  }
}

export class UnexpectedError extends Error {
  public readonly context: BaseContext;

  constructor(message: string, { cause, ...context }: ErrorCause & BaseContext) {
    super(message, { cause });
    this.name = "UnexpectedError";
    this.context = context;
  }
}
