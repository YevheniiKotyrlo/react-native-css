import type { StyleDescriptor, StyleFunction } from "react-native-css/compiler";

import { INHERITED_VAR_FUNCTION } from "./inheritance";

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

/**
 * Whether `value` reads the custom property `name` anywhere inside it, through
 * either variable function.
 *
 * The read is not always at the top level, which is why this is a walk rather
 * than a test of the first slot: `var(--brand, var(--x))` buries one in a
 * fallback, `color-mix(in srgb, currentcolor, blue)` buries one in an argument
 * list, and `light-dark(currentcolor, blue)` returns one from a branch.
 *
 * A style function's other slots are its marker object, its name and the
 * delayed-resolution flag; only the arguments can nest a descriptor.
 */
export function readsVariable(value: StyleDescriptor, name: string): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  if (isStyleFunction(value)) {
    const args = value[2];

    if (value[1] === "var" || value[1] === INHERITED_VAR_FUNCTION) {
      // Both functions take the name alone, or `[name, fallback]`.
      if ((Array.isArray(args) ? args[0] : args) === name) {
        return true;
      }
    }

    return readsVariable(args, name);
  }

  return value.some((entry) => readsVariable(entry, name));
}

/**
 * Re-point every read of `name` inside `value` at the INHERITED context.
 *
 * This is the compile-time half of what `currentcolor` means on the `color`
 * property itself. Everywhere else the keyword is the element's own computed
 * `color` (css-color-4 §6.2) and compiles to an ordinary cascading `var()`; on
 * `color` the same keyword is defined as `inherit`, and the declaration being
 * computed IS the element's own, so the read has to skip the element's scope.
 *
 * A rewrite of the parsed value rather than a branch at each keyword site,
 * because the keyword nests — `color: color-mix(in srgb, currentcolor, blue)`
 * and `color: light-dark(currentcolor, blue)` both bury it below the level a
 * per-site check can see, and the second reaches the builder from inside
 * `parseColor` rather than from the declaration's own handler.
 *
 * A fresh tuple per rewritten node: a descriptor is owned by the rule it lands
 * in, and the parsed value can be shared with the extra rule a `light-dark()`
 * publishes.
 */
export function toInheritedReads(
  value: StyleDescriptor,
  name: string,
): StyleDescriptor {
  if (!Array.isArray(value)) {
    return value;
  }

  if (isStyleFunction(value)) {
    const args = toInheritedReads(value[2], name);
    const isThisName =
      value[1] === "var" && (Array.isArray(args) ? args[0] : args) === name;

    return [
      value[0],
      isThisName ? INHERITED_VAR_FUNCTION : value[1],
      args,
      ...value.slice(3),
    ] as StyleFunction;
  }

  return value.map((entry) => toInheritedReads(entry, name));
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

  usesVariables ||= value[1] === "var" || value[1] === INHERITED_VAR_FUNCTION;
  shouldDelay ||= value[3] === 1 || usesVariables;

  if (shouldDelay) {
    return [true, usesVariables];
  }

  return [false, false];
}
