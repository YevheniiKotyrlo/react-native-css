import type { StyleResolver } from "../resolve";
import { resolveShorthandArguments, shorthandObject } from "./_expand";

/**
 * `flex` and `flex-flow`, expanded from the values a `var()` supplied.
 *
 * React Native's `flex` is a number, so a deferred `flex` can never ship under
 * its own key: the three longhands are the only form it has.
 */

/**
 * The three longhands `flex` sets, before the ones React Native cannot carry
 * are dropped.
 */
interface FlexLonghands {
  readonly flexGrow: number;
  readonly flexShrink: number;
  readonly flexBasis: unknown;
}

/**
 * `flex-basis: auto` is a value React Native holds: `flexBasis` is a
 * `DimensionValue`, whose union includes the keyword.
 *
 * It is the basis every keyword form of the shorthand sets — `flex: auto`,
 * `flex: none` and `flex: 1 1 auto` all mean "size from the content" — so
 * writing it is what makes the shorthand RESET a basis a lower-precedence rule
 * set, rather than leaving that one in place.
 */
const AUTO = "auto";

/** css-flexbox-1 §7.1.1's two keyword forms. */
const KEYWORD_FLEX: Record<string, FlexLonghands> = {
  auto: { flexGrow: 1, flexShrink: 1, flexBasis: AUTO },
  none: { flexGrow: 0, flexShrink: 0, flexBasis: AUTO },
};

/**
 * Whether a value can be this shorthand's `<'flex-basis'>` component.
 *
 * A CSS length and a CSS number are the same JavaScript number once a `var()`
 * has been read — `30px` and `30` both resolve to `30` — so the slot a bare
 * number lands in is decided by position alone: `flex: 1 30px` is read as
 * `flex: 1 30`, grow one and shrink thirty. A percentage keeps its `%` and so
 * stays distinguishable.
 *
 * A `<flex-basis>` is one token, so a string carrying whitespace is a value
 * list that nothing split — which is what a variable set from JavaScript
 * delivers, its value never having passed a tokeniser. `"1 1 0%"` ends in `%`
 * and is not a basis.
 */
function isFlexBasis(value: unknown): boolean {
  return (
    typeof value === "number" ||
    value === AUTO ||
    (typeof value === "string" && value.endsWith("%") && !/\s/.test(value))
  );
}

function readFlexLonghands(values: unknown[]): FlexLonghands | undefined {
  const [first, second, third] = values;

  switch (values.length) {
    case 1: {
      // css-flexbox-1 §7.1.1: `flex: <number>` is `<number> 1 0%`.
      if (typeof first === "number") {
        return { flexGrow: first, flexShrink: 1, flexBasis: "0%" };
      }

      if (typeof first !== "string") {
        return undefined;
      }

      return (
        KEYWORD_FLEX[first] ??
        (isFlexBasis(first)
          ? { flexGrow: 1, flexShrink: 1, flexBasis: first }
          : undefined)
      );
    }
    case 2: {
      if (typeof first !== "number") {
        return undefined;
      }

      if (typeof second === "number") {
        return { flexGrow: first, flexShrink: second, flexBasis: "0%" };
      }

      return isFlexBasis(second)
        ? { flexGrow: first, flexShrink: 1, flexBasis: second }
        : undefined;
    }
    case 3: {
      if (typeof first !== "number" || typeof second !== "number") {
        return undefined;
      }

      return isFlexBasis(third)
        ? { flexGrow: first, flexShrink: second, flexBasis: third }
        : undefined;
    }
    default:
      return undefined;
  }
}

export const flex: StyleResolver = (resolve, value) => {
  const values = resolveShorthandArguments(resolve, value);

  if (values === undefined) {
    return undefined;
  }

  const longhands = readFlexLonghands(values);

  if (longhands === undefined) {
    return undefined;
  }

  return shorthandObject([
    ["flexGrow", longhands.flexGrow],
    ["flexShrink", longhands.flexShrink],
    ["flexBasis", longhands.flexBasis],
  ]);
};

/** `flex-flow` is `<flex-direction> || <flex-wrap>`, in either order. */
const FLEX_DIRECTIONS = new Set([
  "row",
  "row-reverse",
  "column",
  "column-reverse",
]);
const FLEX_WRAPS = new Set(["nowrap", "wrap", "wrap-reverse"]);

export const flexFlow: StyleResolver = (resolve, value) => {
  const values = resolveShorthandArguments(resolve, value);

  if (values === undefined || values.length > 2) {
    return undefined;
  }

  let direction: string | undefined;
  let wrap: string | undefined;

  for (const token of values) {
    if (typeof token !== "string") {
      return undefined;
    }

    if (FLEX_DIRECTIONS.has(token) && direction === undefined) {
      direction = token;
    } else if (FLEX_WRAPS.has(token) && wrap === undefined) {
      wrap = token;
    } else {
      // A token belonging to neither component, or a second one for a component
      // already filled, is not this shorthand's grammar.
      return undefined;
    }
  }

  if (direction === undefined && wrap === undefined) {
    return undefined;
  }

  // The omitted component takes its initial value, which is what `parseFlexFlow`
  // writes for it.
  return shorthandObject([
    ["flexDirection", direction ?? "row"],
    ["flexWrap", wrap ?? "nowrap"],
  ]);
};
