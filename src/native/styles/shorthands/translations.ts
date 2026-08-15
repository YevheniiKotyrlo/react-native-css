import { ShortHandSymbol } from "../constants";
import type { StyleResolver } from "../resolve";
import { resolveShorthandArguments } from "./_expand";

/**
 * Properties React Native has no key of its own for, which the compile-time
 * parsers express through the keys it does have.
 *
 * They are not shorthands, and they carry the same fault for the same reason:
 * the deferred route writes the camelCased CSS name, which React Native reads
 * as nothing at all. `visibility` is the sharpest — a themed `visibility:
 * hidden` leaves the element fully opaque and still taking taps.
 */

/**
 * The single value these properties take, or `undefined` for anything else.
 * Neither has a multi-value form, so a value list is not their grammar.
 */
function readKeyword(values: unknown[] | undefined): string | undefined {
  if (values === undefined || values.length !== 1) {
    return undefined;
  }

  const [only] = values;

  return typeof only === "string" ? only : undefined;
}

/**
 * `opacity` alone would hide the element and leave it hit-testable, so a hidden
 * button still takes taps. `pointerEvents` is a real React Native style key, so
 * both halves compose through the cascade like any other declaration.
 *
 * `collapse` collapses a table row or column and falls back to `hidden`
 * everywhere else, which is everywhere React Native has.
 */
const VISIBILITY: Record<string, { opacity: number; pointerEvents: string }> = {
  visible: { opacity: 1, pointerEvents: "auto" },
  hidden: { opacity: 0, pointerEvents: "none" },
  collapse: { opacity: 0, pointerEvents: "none" },
};

export const visibility: StyleResolver = (resolve, value) => {
  const keyword = readKeyword(resolveShorthandArguments(resolve, value));
  const keys = keyword === undefined ? undefined : VISIBILITY[keyword];

  if (keys === undefined) {
    return undefined;
  }

  // `visibility` itself goes out beside the approximation, exactly as the
  // compile-time route emits it. React Native has no such key today — it is in
  // neither `StyleSheetTypes` nor `ReactNativeStyleAttributes` — so it is inert,
  // and it is emitted because a gap in the target is a caveat rather than a
  // reason to drop a CSS property. Omitting it here would also make the same
  // declaration a different style object depending on how its value arrived.
  return { [ShortHandSymbol]: true, visibility: keyword, ...keys };
};

/**
 * `writingDirection` is the Text-side twin of the layout `direction`, so one
 * declaration works on a `<View>` and on a `<Text>` alike.
 */
const DIRECTIONS = new Set(["ltr", "rtl"]);

export const direction: StyleResolver = (resolve, value) => {
  const keyword = readKeyword(resolveShorthandArguments(resolve, value));

  if (keyword === undefined || !DIRECTIONS.has(keyword)) {
    return undefined;
  }

  return {
    [ShortHandSymbol]: true,
    direction: keyword,
    writingDirection: keyword,
  };
};
