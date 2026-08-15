import type { StyleDescriptor } from "../../../compiler";
import type { StyleFunctionResolver } from "../resolve";

/**
 * The properties whose CSS value is a KEYWORD this library translates, resolved
 * at runtime.
 *
 * Most declarations pass their value through — a length is a length, and the
 * compiler needs to know nothing about it. These do not: each accepts a closed
 * set of keywords, and one of them (`corner-shape`) renames both the property
 * and the value on the way to React Native. Validating that at compile time
 * works only when the value is written literally, so a value arriving through a
 * `var()` with more than one definition — a dark-mode override is the ordinary
 * shape — had nowhere to be checked and the declaration was dropped.
 *
 * These resolvers are that missing half. The compiler hands the unresolved
 * value to one of them, and the SAME keyword table decides the answer on every
 * route, so the literal and deferred spellings of one declaration cannot drift
 * apart. A keyword React Native cannot render still produces no style, which is
 * the behaviour the literal route already has — passing it through unchecked
 * would ship `borderCurve: "bevel"`, a value React Native silently ignores.
 */

/** `isolation` — React Native types the property `'auto' | 'isolate'`. */
const ISOLATION_KEYWORDS = new Set(["auto", "isolate"]);

/**
 * `mix-blend-mode` — React Native's `BlendMode` union, which is CSS's separable
 * and non-separable blend modes plus `plus-lighter`.
 */
const BLEND_MODE_KEYWORDS = new Set([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "plus-lighter",
]);

/**
 * `corner-shape` to React Native's `borderCurve`, which is the only part of the
 * property React Native implements: `'circular' | 'continuous'`. CSS's `bevel`,
 * `scoop`, `notch` and `superellipse()` have no curve to land on.
 */
const CORNER_SHAPE_CURVES: Record<string, string | undefined> = {
  round: "circular",
  squircle: "continuous",
};

/**
 * Every keyword React Native's `FontVariant` union accepts, across the three
 * CSS spellings that reach `fontVariant` — the shorthand and the `-numeric` and
 * `-ligatures` longhands.
 *
 * One set rather than three, because the runtime resolver is reached from a
 * property the compiler has already decided: by the time a value gets here the
 * declaration is known to be a `font-variant*` one, and CSS has already
 * rejected a keyword written under the wrong longhand.
 */
const FONT_VARIANT_KEYWORDS = new Set([
  "small-caps",
  "lining-nums",
  "oldstyle-nums",
  "proportional-nums",
  "tabular-nums",
  "common-ligatures",
  "no-common-ligatures",
  "discretionary-ligatures",
  "no-discretionary-ligatures",
  "historical-ligatures",
  "no-historical-ligatures",
  "contextual",
  "no-contextual",
]);

/**
 * The keywords `font-variant-ligatures: none` means — CSS defines it as
 * switching off all four ligature groups, and React Native has no single
 * keyword for that.
 */
const NO_LIGATURES = [
  "no-common-ligatures",
  "no-discretionary-ligatures",
  "no-historical-ligatures",
  "no-contextual",
];

/**
 * A resolved value as a flat list of keywords, or `undefined` if it is not made
 * of keywords at all.
 *
 * A `var()` standing in for several keywords resolves to an array; one standing
 * in for a single keyword resolves to a string. Both describe the same thing.
 */
function readKeywords(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    return [value.toLowerCase()];
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const keywords: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      return undefined;
    }

    keywords.push(entry.toLowerCase());
  }

  return keywords.length > 0 ? keywords : undefined;
}

export const isolation: StyleFunctionResolver = (resolveValue, value) => {
  const keywords = readKeywords(resolveValue(value[2]));

  if (keywords?.length !== 1) {
    // `isolation` takes exactly one keyword, so a list is invalid CSS rather
    // than a value to truncate.
    return undefined;
  }

  const [keyword = ""] = keywords;

  return ISOLATION_KEYWORDS.has(keyword) ? keyword : undefined;
};

export const mixBlendMode: StyleFunctionResolver = (resolveValue, value) => {
  const keywords = readKeywords(resolveValue(value[2]));

  if (keywords?.length !== 1) {
    // `mix-blend-mode` takes exactly one keyword.
    return undefined;
  }

  const [keyword = ""] = keywords;

  return BLEND_MODE_KEYWORDS.has(keyword) ? keyword : undefined;
};

export const cornerShape: StyleFunctionResolver = (resolveValue, value) => {
  const keywords = readKeywords(resolveValue(value[2]));

  if (keywords?.length !== 1) {
    return undefined;
  }

  const [keyword = ""] = keywords;

  return CORNER_SHAPE_CURVES[keyword];
};

export const fontVariant: StyleFunctionResolver = (resolveValue, value) => {
  const keywords = readKeywords(resolveValue(value[2]));

  if (!keywords) {
    return undefined;
  }

  // `none` belongs to `font-variant-ligatures` and is exclusive there.
  if (keywords.length === 1 && keywords[0] === "none") {
    return NO_LIGATURES;
  }

  // `normal` is the initial value of all three properties and is exclusive: on
  // its own it means "no variants", which React Native spells as the empty
  // list — the only way to cancel a variant inherited from an ancestor.
  if (keywords.length === 1 && keywords[0] === "normal") {
    return [];
  }

  const expressible = keywords.filter((keyword) =>
    FONT_VARIANT_KEYWORDS.has(keyword),
  );

  // A keyword React Native cannot express does not discard the ones it can —
  // `ordinal tabular-nums` still yields tabular figures.
  return expressible.length > 0 ? (expressible as StyleDescriptor) : undefined;
};

/**
 * `-rn-ripple-style: borderless` and `-rn-ripple-layer: foreground`.
 *
 * Both are one keyword that means `true` to React Native's `android_ripple`
 * prop, and nothing otherwise — an inverted spelling of the same question, so
 * they share a factory rather than being written twice.
 */
function rippleKeyword(keyword: string): StyleFunctionResolver {
  return (resolveValue, value) => {
    const keywords = readKeywords(resolveValue(value[2]));

    return keywords?.length === 1 && keywords[0] === keyword ? true : undefined;
  };
}

export const rnRippleStyle = rippleKeyword("borderless");
export const rnRippleLayer = rippleKeyword("foreground");

/**
 * `-rn-shadow-offset` when its pair is only known at runtime.
 *
 * React Native reads `shadowOffset` as `{width, height}` — that is the shape
 * `sizesDiffer` in `ReactNativeStyleAttributes` compares — and both components
 * have to be plain numbers, because it does arithmetic on them. The literal
 * route reaches the same object through two deep paths
 * (`&.shadowOffset.width` / `.height`); a value still behind a `var()` cannot
 * be split that way at compile time, so the object is assembled here instead.
 *
 * Anything that is not a pair of numbers produces nothing. A partial offset
 * would draw the shadow at a place the author did not ask for, which is worse
 * than no shadow: it looks deliberate.
 */
export const rnShadowOffset: StyleFunctionResolver = (resolveValue, value) => {
  const resolved: unknown = resolveValue(value[2]);

  if (!Array.isArray(resolved) || resolved.length !== 2) {
    return undefined;
  }

  // Read by index rather than destructured: `Array.isArray` narrows `unknown`
  // to `any[]`, so destructuring hands back two `any`s and the checks below
  // would be proving nothing.
  const width: unknown = resolved[0];
  const height: unknown = resolved[1];

  if (typeof width !== "number" || typeof height !== "number") {
    return undefined;
  }

  return { width, height } as unknown as StyleDescriptor;
};
