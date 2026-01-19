export class HttpClientError extends Error {}

export class TimeoutError extends HttpClientError {}

export class AbortedError extends HttpClientError {}

export class SerializationError extends HttpClientError {}

export class DeserializationError extends HttpClientError {}
