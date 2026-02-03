async function test() {
  try {
    const controller = new AbortController();
    const response = await fetch("https://example.com/data", {
      signal: controller.signal,
    });
    const cloned_response = response.clone();
    controller.abort();
    // body is now used in the original response
    console.log("response.bodyUsed", response.bodyUsed);
    console.log("cloned_response.bodyUsed", cloned_response.bodyUsed);
    // throws "Body is unusable: Body has already been read"
    // but it should only throw an AbortError
    await response.text();
  } catch (error) {
    console.error(error);
  }

  console.log("--------------------------------");

  // this works as expected
  try {
    const controller = new AbortController();
    const response = await fetch("https://example.com/data", {
      signal: controller.signal,
    });
    // const cloned_response = response.clone();
    controller.abort();
    // throws "Body is unusable: Body has already been read"
    // but it should only throw an AbortError
    await response.text();
  } catch (error) {
    console.error(error);
  }
}

test();
