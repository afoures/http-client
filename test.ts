function mergeHeaders(...sources) {
  const result = new Headers();

  for (const source of sources) {
    // We convert the source to a Headers object to make it iterable
    const tempHeaders = new Headers(source);

    tempHeaders.forEach((value, name) => {
      result.append(name, value);
    });
  }

  return result;
}

// Example usage:
const baseHeaders = {
  Accept: "text/html",
  "Content-Type": "text/html",
  "x-custom": "opu",
};
const extraHeaders = {
  Accept: "application/json",
  "X-Custom": "Value",
  "Content-Type": "application/json",
};

const finalHeaders = mergeHeaders(baseHeaders, extraHeaders);

console.log(Array.from(finalHeaders.entries()));
// Output: "text/html, application/json" (Merged, not overridden!)
