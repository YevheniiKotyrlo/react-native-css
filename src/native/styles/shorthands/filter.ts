import type { StyleFunctionResolver } from "../resolve";

/**
 * `filter`, flattened to the list React Native reads.
 *
 * `ViewStyle.filter` is `ReadonlyArray<FilterFunction>`, and a `FilterFunction`
 * is a single-key object. `processFilter` reads that key with
 * `Object.entries(filterFunction)[0]` and switches on it — so a nested entry has
 * no key it knows, `_getFilterAmount` answers `undefined`, and the processor's
 * response to ONE bad entry is `return []`. Every filter in the declaration is
 * discarded, not just the offending one.
 *
 * The compiler cannot settle the shape on its own, which is why this exists.
 * `filter` is always a LIST, so `parseUnparsed` wraps a single function to make
 * the shape uniform — and when the content is a `var()` the arity is unknown
 * until it resolves. Both compile-time shapes are then wrong for one arity:
 *
 *     filter: blur(4px)                    wrapped   [{blur:4}]            correct
 *     filter: var(--f)  --f: blur(4px)     wrapped   [{blur:4}]            correct
 *     filter: var(--f)  --f: blur() brightness()     [[{blur},{brightness}]]  nested, => []
 *
 * and removing the wrap fixes the third at the cost of the second, which then
 * hands `processFilter` a bare object and THROWS. Measured, all three, against
 * React Native's own processor.
 *
 * So the arity is settled here, where it is known. This is the same shape
 * `./transform.ts` uses for the same reason — `transform` is also always a list,
 * and a function that expands into several entries (`translate(x, y)`) resolves
 * to an array that has to be flattened into its siblings rather than pushed as
 * one.
 */
export const filter: StyleFunctionResolver = (resolveValue, descriptor) => {
  const filters = resolveValue(descriptor[2]);

  if (Array.isArray(filters)) {
    // FLAT, one level. A `var()` standing in for several functions resolves to
    // an array whose members are the functions; a `var()` standing in for one
    // resolves to the function. Flattening covers both without asking which
    // happened.
    return filters.flat().filter(isFilterEntry) as unknown;
  }

  return isFilterEntry(filters) ? [filters] : undefined;
};

/**
 * One entry of React Native's `filter` array.
 *
 * A single-keyed object, which is what `processFilter` reads. A bare number or
 * string — which is what a `var()` holding something that is not a filter
 * resolves to — is dropped rather than passed on, because one unreadable entry
 * costs the whole declaration.
 */
function isFilterEntry(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
