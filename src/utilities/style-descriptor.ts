import type { StyleDescriptor, StyleFunction } from "react-native-css/compiler";

export function isStyleDescriptorArray(
  value: unknown,
): value is StyleDescriptor[] {
  if (Array.isArray(value)) {
    // If its an array and the first item is an object, the only allowed value is an array
    return typeof value[0] === "object" ? Array.isArray(value[0]) : true;
  }

  return false;
}

export function isStyleFunction(value: unknown): value is StyleFunction {
  if (Array.isArray(value)) {
    // A style function's head is `Record<never, never>` - a plain object with
    // no keys. A nested stack (`[[], "Arial"]`) and a null entry both reach
    // `typeof "object"` without being one.
    const head: unknown = value[0];

    return typeof head === "object" && head !== null && !Array.isArray(head)
      ? Object.keys(head).length === 0
      : false;
  }

  return false;
}

/**
 * Whether a value holds a style function anywhere inside it, rather than BEING
 * one.
 *
 * The distinction decides whether a declaration can be settled at compile time.
 * `filter` and `transform` are always a LIST of functions — a single one is
 * wrapped so the shape is uniform — so `isStyleFunction` answers `false` for
 * exactly the two properties whose value is nothing but functions, and asking
 * it there sent them down the static path: `rule.dv` went unset, the value
 * resolved before the element's variables were in scope, and `filter: var(--f)`
 * rendered nothing.
 *
 * The recursion stops at the first function found. Deciding what to DO about
 * one — whether to delay, and whether variables are involved — is
 * `postProcessStyleFunction`'s full walk.
 */
export function containsStyleFunction(value: StyleDescriptor): boolean {
  if (isStyleFunction(value)) {
    return true;
  }

  return (
    isStyleDescriptorArray(value) &&
    value.some((entry) => containsStyleFunction(entry))
  );
}

export function postProcessStyleFunction(value: StyleDescriptor): [
  // Should it be delayed
  boolean,
  // Does it use variables
  boolean,
] {
  if (!Array.isArray(value)) {
    return [false, false];
  }

  if (isStyleDescriptorArray(value)) {
    let shouldDelay = false;
    let usesVariables = false;
    for (const v of value) {
      const [delayed, variables] = postProcessStyleFunction(v);
      shouldDelay ||= delayed;
      usesVariables ||= variables;
    }

    return [shouldDelay, usesVariables];
  }

  let [shouldDelay, usesVariables] = postProcessStyleFunction(value[2]);

  usesVariables ||= value[1] === "var";
  shouldDelay ||= value[3] === 1 || usesVariables;

  if (shouldDelay) {
    return [true, usesVariables];
  }

  return [false, false];
}
