import type { StyleFunctionResolver } from "../resolve";

export const max: StyleFunctionResolver = (resolveValue, value) => {
  const args = resolveValue(value[2]);

  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "number")) {
    return;
  }

  return Math.max(...(args as number[]));
};

export const min: StyleFunctionResolver = (resolveValue, value) => {
  const args = resolveValue(value[2]);

  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "number")) {
    return;
  }

  return Math.min(...(args as number[]));
};

export const clamp: StyleFunctionResolver = (resolveValue, value) => {
  const args = resolveValue(value[2]);

  // The array guard comes BEFORE the destructure. A resolved value that is not
  // iterable — a bare number, which `resolveValue` returns for a single-argument
  // call — throws a `TypeError` out of the destructure, so the guard below it
  // was unreachable for exactly the input it existed to reject.
  if (!Array.isArray(args)) {
    return;
  }

  // `clamp(MIN, VAL, MAX)` — the minimum comes FIRST. The previous names read
  // the arguments as `(value, min, max)`, which is not what CSS passes.
  const [minimum, clampValue, maximum] = args as number[];

  if (
    typeof minimum !== "number" ||
    typeof clampValue !== "number" ||
    typeof maximum !== "number"
  ) {
    return;
  }

  // css-values-4 §10.3 defines this as `max(MIN, min(VAL, MAX))`, which decides
  // the one case the two orderings disagree on: when MIN is above MAX the
  // minimum wins. `min(max(...), MAX)` answers MAX there.
  return Math.max(minimum, Math.min(clampValue, maximum));
};
