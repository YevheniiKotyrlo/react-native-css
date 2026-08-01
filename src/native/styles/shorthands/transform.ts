import type { StyleFunctionResolver } from "../resolve";

/**
 * Handle the unparsable transform property by converting its values into StyleDeclarations
 * Each value should be a StyleDescriptor function of the transform type
 */
export const transform: StyleFunctionResolver = (
  resolveValue,
  transformDescriptor,
) => {
  const transforms = resolveValue(transformDescriptor[2]);

  if (Array.isArray(transforms)) {
    // FLAT, to any depth. A function that expands into several transforms —
    // `translate(x, y)`, `scale(x, y)`, `skew(a, b)` — resolves to an ARRAY of
    // single-key objects, and pushing that array as one entry gives React Native
    // a nested value it rejects with "You must specify exactly one property per
    // transform object", losing every transform in the declaration.
    //
    // The depth is not fixed, because each indirection adds one and they
    // compose: `transform` is always a LIST, a `var()` FALLBACK holding a
    // function is wrapped in a list of its own, and the function itself may
    // resolve to a list. `transform: var(--x, translate(10px, 20px))` reached
    // three levels, one flatten covered two, and the survivor was an array that
    // `isTransformEntry` refused — the whole declaration shipped as
    // `transform: []`. Every entry React Native reads is a single-key OBJECT, so
    // an array at any depth is structure to remove rather than a value to keep.
    // Every surviving entry is a `{ transformKey: value }` object, because that
    // is the only shape React Native's transform array holds. A `var()` whose
    // value is not a transform at all — `transform: var(--offset)` with
    // `--offset: 10px 20px` — resolves to a list of BARE NUMBERS, and passing
    // those on both fails React Native's "exactly one property per transform
    // object" and crashes `applyValue`'s `prop in entry` filter on the next
    // transform declaration to touch the same array.
    //
    // This also covers `initial` and `none`: `none` is the CSS-wide "no
    // transform", not a value React Native can hold, and it reached the array as
    // a bare string on the runtime route where the compile-time route already
    // dropped it.
    return transforms
      .flat(Number.POSITIVE_INFINITY)
      .filter(isTransformEntry) as unknown;
  } else if (isTransformEntry(transforms)) {
    // If it's a single transform, wrap it in an array
    return [transforms];
  } else {
    return;
  }
};

/** One entry of React Native's `transform` array: a single-keyed object. */
function isTransformEntry(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
