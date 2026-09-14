- Release a retried response body before the backoff delay, not after

  A response the retry policy decides to retry away is spent as soon as that decision is made: the callbacks only ever see metadata, and nothing will read the body. It was cancelled at the start of the next attempt, which left the connection pinned for the whole of the delay in between. With an exponential backoff that is seconds per retry.
