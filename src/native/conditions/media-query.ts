/* eslint-disable */
import { I18nManager, PixelRatio, Platform } from "react-native";

import type {
  MediaCondition,
  MediaFeatureComparison,
  StyleDescriptor,
} from "react-native-css/compiler";

import {
  colorScheme,
  highContrast,
  invertedColors,
  reduceMotion,
  reducedTransparency,
  vh,
  vw,
  type Getter,
} from "../reactivity";

/**
 * Whether the platform's primary pointer is a fine, hover-capable one. The
 * desktop out-of-tree platforms are driven by a mouse; the mobile ones are
 * touch screens. Constant for the lifetime of the process, so it is resolved
 * once rather than per query.
 */
const POINTER_IS_FINE = Platform.OS === "macos" || Platform.OS === "windows";

/**
 * `undefined` means UNKNOWN — the feature is not implemented here — and is not
 * the same answer as `false`.
 *
 * The difference is only visible under negation, and there it is the whole
 * story: `@media not (prefers-contrast: no-preference)` over a hard `false`
 * inverts to `true` and ships high-contrast styling to every user. MQ5 §3 says
 * an unrecognised feature makes the query fail to match, in either polarity, so
 * unknown propagates through `!` instead of flipping.
 */
type MediaVerdict = boolean | undefined;

export function testMediaQuery(
  mediaQueries: MediaCondition[],
  get: Getter,
): boolean {
  // Only a definite `true` matches, so an unknown feature never applies a rule.
  return mediaQueries.every((query) => test(query, get) === true);
}

function test(mediaQuery: MediaCondition, get: Getter): MediaVerdict {
  switch (mediaQuery[0]) {
    case "?":
      // A condition the compiler could not represent. Unknown, never a match.
      return undefined;
    case "!!":
      return testBooleanContext(mediaQuery[1], get);
    case "[]":
      return testInterval(mediaQuery, get);
    case "!": {
      const verdict = test(mediaQuery[1], get);
      return verdict === undefined ? undefined : !verdict;
    }
    case "&": {
      // Kleene AND: one definite `false` settles it; otherwise an unknown
      // anywhere makes the whole condition unknown.
      let unknown = false;
      for (const query of mediaQuery[1]) {
        const verdict = test(query, get);
        if (verdict === false) return false;
        if (verdict === undefined) unknown = true;
      }
      return unknown ? undefined : true;
    }
    case "|": {
      let unknown = false;
      for (const query of mediaQuery[1]) {
        const verdict = test(query, get);
        if (verdict === true) return true;
        if (verdict === undefined) unknown = true;
      }
      return unknown ? undefined : false;
    }
    case ">":
    case ">=":
    case "<":
    case "<=":
    case "=": {
      return testComparison(mediaQuery, get);
    }
    default:
      // A new `MediaCondition` variant becomes a compile error here rather than
      // silently evaluating to unknown. `container-query.ts` and `compare()`
      // both carry the same assertion.
      mediaQuery satisfies never;
      return undefined;
  }
}

/**
 * The value a discrete media feature currently has, or `undefined` when the
 * feature is not implemented.
 *
 * Every evaluation reads through here so the three forms a feature can be
 * written in — `(feature: value)`, `(feature)` and `(a < feature < b)` — cannot
 * answer differently. They previously did: only the first was implemented at
 * all.
 */
function resolveFeature(name: string, get: Getter): StyleDescriptor {
  switch (name) {
    case "dir":
      return I18nManager.isRTL ? "rtl" : "ltr";
    // `hover` answers `hover` on every platform ON PURPOSE: React Native
    // synthesises hover through Pressability (`hoverIn`/`hoverOut`) even on a
    // touch screen, so a `hover:`-prefixed utility is expected to work
    // everywhere rather than compile to dead CSS as it would in a mobile
    // browser.
    case "hover":
    case "any-hover":
      return "hover";
    // The pointer pair has no such synthesis behind it: it describes the
    // physical input, which is coarse on a touch screen and fine on the desktop
    // out-of-tree platforms.
    case "pointer":
    case "any-pointer":
      return POINTER_IS_FINE ? "fine" : "coarse";
    case "prefers-color-scheme":
      // With no OS preference `Appearance.getColorScheme()` is null, and MQ5
      // §5.4 makes `light` the answer in that case rather than neither.
      return get(colorScheme) ?? "light";
    // Each of these maps 1:1 onto an `AccessibilityInfo` getter plus its change
    // event.
    case "prefers-reduced-motion":
      // `motion-reduce:` compiles to `(prefers-reduced-motion: reduce)` and
      // `motion-safe:` to `(prefers-reduced-motion: no-preference)`, so both
      // variants are answered by this one case. Without it they compile
      // cleanly and then evaluate to false on every device — the silent shape
      // where an accessibility preference looks implemented and is not.
      return get(reduceMotion) ? "reduce" : "no-preference";
    case "inverted-colors":
      return get(invertedColors) ? "inverted" : "none";
    case "prefers-reduced-transparency":
      return get(reducedTransparency) ? "reduce" : "no-preference";
    case "prefers-contrast":
      // React Native reports one bit, so `less` and `custom` — the other two
      // values MQ5 defines — are not answerable and never match.
      return get(highContrast) ? "more" : "no-preference";
    case "orientation":
      return get(vh) < get(vw) ? "landscape" : "portrait";
    case "aspect-ratio":
      // MQ4 §4.1: width divided by height. Both are already tracked, and the
      // `@container` evaluator computes the container's ratio from exactly the
      // same two values — so the media half was the only one missing.
      return get(vh) === 0 ? undefined : get(vw) / get(vh);
    case "width":
      return get(vw);
    case "height":
      return get(vh);
    case "resolution":
      return PixelRatio.get();
    default:
      return undefined;
  }
}

/**
 * MQ5 §2.4.3: in boolean context a feature is true unless it holds its own
 * "false" value. Only features that HAVE one appear here; for the rest —
 * `prefers-color-scheme`, `orientation`, `dir` — every value is true.
 *
 * The whole boolean form used to answer a hard `false`, so `@media (hover)`
 * never matched even though `@media (hover: hover)` did.
 */
const BOOLEAN_FALSE_VALUE: Record<string, StyleDescriptor> = {
  "any-hover": "none",
  "any-pointer": "none",
  "height": 0,
  "hover": "none",
  "inverted-colors": "none",
  "pointer": "none",
  "prefers-contrast": "no-preference",
  "prefers-reduced-motion": "no-preference",
  "prefers-reduced-transparency": "no-preference",
  "resolution": 0,
  "width": 0,
};

function testBooleanContext(name: string, get: Getter): MediaVerdict {
  const current = resolveFeature(name, get);

  if (current === undefined) {
    return undefined;
  }

  const falseValue = BOOLEAN_FALSE_VALUE[name];
  return falseValue === undefined ? true : current !== falseValue;
}

/**
 * The interval form, `(400px < width < 800px)`. Note the asymmetry: the START
 * comparison reads with the feature on the RIGHT (`start < feature`), the end
 * with it on the left (`feature < end`).
 */
function testInterval(
  mediaQuery: Extract<MediaCondition, { 0: "[]" }>,
  get: Getter,
): MediaVerdict {
  const [, name, start, startOperator, end, endOperator] = mediaQuery;

  const current = resolveFeature(name, get);

  if (current === undefined) {
    return undefined;
  }

  if (
    typeof current !== "number" ||
    typeof start !== "number" ||
    typeof end !== "number"
  ) {
    return false;
  }

  return (
    compare(startOperator, start, current) &&
    compare(endOperator, current, end)
  );
}

function testComparison(
  mediaQuery: Extract<MediaCondition, { 0: MediaFeatureComparison }>,
  get: Getter,
): MediaVerdict {
  const name = mediaQuery[1];
  const value = mediaQuery[2];

  switch (name) {
    // `native` is a wildcard neither of these features has in CSS — it is this
    // library's way of writing "any React Native platform".
    case "platform":
      return value === "native" || value === Platform.OS;
    case "display-mode":
      return value === "native" || Platform.OS === value;
    // The `min-`/`max-` prefixed forms are their own feature names rather than
    // a comparison over one.
    case "min-width":
      return typeof value === "number" && get(vw) >= value;
    case "max-width":
      return typeof value === "number" && get(vw) <= value;
    case "min-height":
      return typeof value === "number" && get(vh) >= value;
    case "max-height":
      return typeof value === "number" && get(vh) <= value;
  }

  const current = resolveFeature(name, get);

  if (current === undefined) {
    return undefined;
  }

  if (typeof current === "string") {
    // A discrete feature only supports equality; `(hover > hover)` is not a
    // thing CSS can express, so anything else is a malformed query.
    return mediaQuery[0] === "=" ? current === value : false;
  }

  if (typeof current !== "number" || typeof value !== "number") {
    return false;
  }

  return compare(mediaQuery[0], current, value);
}

function compare(
  operator: MediaFeatureComparison,
  left: number,
  right: number,
): boolean {
  switch (operator) {
    case "=":
      return left === right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    default:
      operator satisfies never;
      return false;
  }
}
