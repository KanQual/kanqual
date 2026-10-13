// Keep browser-test inputs separate from executable JavaScript.
export async function callBrowserFunction(call, fn, ...args) {
  const { result: global, exceptionDetails } = await call("Runtime.evaluate", {
    expression: "globalThis",
  });
  if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
  try {
    const result = await call("Runtime.callFunctionOn", {
      objectId: global.objectId,
      functionDeclaration: fn.toString(),
      arguments: args.map(value => ({ value })),
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  } finally {
    await call("Runtime.releaseObject", { objectId: global.objectId });
  }
}
