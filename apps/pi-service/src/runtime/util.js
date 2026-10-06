export const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function immutableCopy(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => immutableCopy(item)));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, immutableCopy(item)]),
    ));
  }
  return value;
}

export function isAborted(error, signal) {
  return Boolean(signal?.aborted || error?.name === "AbortError" || error?.code === "AGENT_ABORTED");
}

export function createSerialExecutor() {
  let tail = Promise.resolve();
  return async (operation) => {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

export function explicitNumberedGoalCount(content) {
  const numbers = new Set(
    [...content.matchAll(/(?:^|[：:，,；;\n])\s*([1-9]\d?)(?=(?:[.、．)]\s*)?[\p{Script=Han}A-Za-z])/gu)]
      .map((match) => Number(match[1])),
  );
  let count = 0;
  while (numbers.has(count + 1)) count += 1;
  return count >= 3 ? count : 0;
}
