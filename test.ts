async function test({
  abort,
  should_clone,
}: {
  abort:
    | "before-starting-fetch"
    | "right-after-fetching"
    | "after-cloning-response"
    | "before-read-body";
  should_clone: boolean;
}) {
  console.log(
    `testing aborting on "${abort}" ${should_clone ? "with" : "without"} cloning the response...`,
  );
  const controller = new AbortController();
  if (abort === "before-starting-fetch") {
    controller.abort();
  }
  let cloned_response: Response | undefined;
  const response = await fetch("https://jsonplaceholder.typicode.com/posts/1", {
    signal: controller.signal,
  });
  console.log("fetched", {
    is_body_used: { initial: response.bodyUsed, clone: cloned_response?.bodyUsed },
  });
  if (abort === "right-after-fetching") {
    controller.abort();
    console.log("aborted after fetching", {
      is_body_used: { initial: response.bodyUsed, clone: cloned_response?.bodyUsed },
    });
  }
  if (should_clone) {
    cloned_response = response.clone();
  }
  console.log("cloned response", {
    used: { initial: response.bodyUsed, clone: cloned_response?.bodyUsed },
  });
  if (abort === "after-cloning-response") {
    controller.abort();
    console.log("aborted after cloning the response", {
      is_body_used: { initial: response.bodyUsed, clone: cloned_response?.bodyUsed },
    });
  }
  await response.text();
  await cloned_response?.text();
  console.log("read body", {
    is_body_used: { initial: response.bodyUsed, clone: cloned_response?.bodyUsed },
  });
  console.log("--------------------------------");
}

function on_rejection(error: unknown) {
  console.error(error);
  console.log("--------------------------------");
}

async function main() {
  console.log(`running on node version ${process.version}...\n`);
  await test({ abort: "before-starting-fetch", should_clone: false }).catch(on_rejection);
  await test({ abort: "before-starting-fetch", should_clone: true }).catch(on_rejection);
  console.log();
  await test({ abort: "right-after-fetching", should_clone: false }).catch(on_rejection);
  await test({ abort: "right-after-fetching", should_clone: true }).catch(on_rejection);
  console.log();
  await test({ abort: "after-cloning-response", should_clone: false }).catch(on_rejection);
  await test({ abort: "after-cloning-response", should_clone: true }).catch(on_rejection);
  console.log();
  await test({ abort: "before-read-body", should_clone: false }).catch(on_rejection);
  await test({ abort: "before-read-body", should_clone: true }).catch(on_rejection);
}

main().catch(console.error);
