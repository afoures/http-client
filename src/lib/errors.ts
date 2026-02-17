type BaseContext = {
  operation: string;
};

type ErrorCause = {
  cause?: unknown;
};

export class HttpClientError extends Error {
  public readonly name = "HttpClientError";
}

export class TimeoutError extends HttpClientError {
  public readonly kind = "TimeoutError";
  public readonly context: BaseContext;

  constructor(message: string, { cause, ...context }: ErrorCause & BaseContext) {
    super(message, { cause });
    this.context = context;
  }
}

export class AbortedError extends HttpClientError {
  public readonly kind = "AbortedError";
  public readonly context: BaseContext;

  constructor(message: string, { cause, ...context }: ErrorCause & BaseContext) {
    super(message, { cause });
    this.context = context;
  }
}

export class SerializationError extends HttpClientError {
  public readonly kind = "SerializationError";
  public readonly context: BaseContext;

  constructor(message: string, { cause, ...context }: ErrorCause & BaseContext) {
    super(message, { cause });
    this.context = context;
  }
}

export class DeserializationError extends HttpClientError {
  public readonly kind = "DeserializationError";
  public readonly context: BaseContext;

  constructor(message: string, { cause, ...context }: ErrorCause & BaseContext) {
    super(message, { cause });
    this.context = context;
  }
}

export class NetworkError extends HttpClientError {
  public readonly kind = "NetworkError";
  public readonly context: BaseContext;

  constructor(message: string, { cause, ...context }: ErrorCause & BaseContext) {
    super(message, { cause });
    this.context = context;
  }
}

export class UnexpectedError extends Error {
  public readonly name = "UnexpectedError";
  public readonly context: BaseContext;

  constructor(message: string, { cause, ...context }: ErrorCause & BaseContext) {
    super(message, { cause });
    this.context = context;
  }
}
