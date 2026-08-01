/**
 * Accessibility and user-preference media features — Media Queries Level 4/5
 * §11 (`prefers-*`, `forced-colors`, `inverted-colors`) and §10 (`hover`,
 * `pointer`, `any-hover`, `any-pointer`, `update`, `scripting`, `monochrome`,
 * `color-gamut`, `dynamic-range`).
 *
 * The runtime evaluator is `src/native/conditions/media-query.ts`; the reactive
 * sources it reads are `src/native/reactivity.ts`. A user-preference feature is
 * wired to a live source by one three-line pattern — an `observable` seeded from
 * a getter and updated by its change event — which `prefers-color-scheme` uses
 * against `Appearance`, and `inverted-colors`, `prefers-reduced-motion`,
 * `prefers-reduced-transparency` and `prefers-contrast` use against
 * `AccessibilityInfo`. Every remaining
 * `// GAP:` below is that same pattern against a getter nobody has wired yet, or
 * a preference React Native cannot report.
 *
 * Three failure shapes appear, in ascending order of danger. The second and
 * third are now closed for every feature; the first is what an unimplemented
 * feature still does, and it is the safe one.
 *
 *   NEVER MATCHES     — the feature is unknown to the evaluator, so the guarded
 *                       rule is dead. Unknown is a THIRD answer, distinct from
 *                       `false`, which is what keeps the next shape closed.
 *   ALWAYS MATCHES    — the negated form (`@media not (…)`) inverting a hard
 *                       `false` into `true`, shipping a rule meant for one class
 *                       of user to every user.
 *   CONDITION DROPPED — the compiler failing to parse a feature VALUE,
 *                       abandoning the media query, and still emitting the rules
 *                       inside it, so the block applied with no condition at all.
 *
 * Nothing here emits a warning: `compile(css).warnings()` is empty for every
 * case below, so an inert accessibility rule is indistinguishable from a
 * working one at build time.
 */
import { AccessibilityInfo, Appearance, Platform } from "react-native";

import { act, render, screen } from "@testing-library/react-native";
import { compile } from "react-native-css/compiler";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";
import { colorScheme } from "react-native-css/runtime";

const RED = { color: "#f00" };
const GREEN = { color: "#008000" };

let queryCounter = 0;

/**
 * Registers `@media <query> { … }` under a fresh class name and reports whether
 * the guarded declaration reached the rendered element.
 */
function applies(query: string): boolean {
  queryCounter += 1;
  const className = `mq${queryCounter}`;
  registerCSS(`@media ${query} { .${className} { color: red; } }`);
  render(<View testID={className} className={className} />);
  return screen.getByTestId(className).props.style !== undefined;
}

/** The runtime condition the compiler emitted for `@media <query>`. */
function conditionFor(query: string) {
  return compile(`@media ${query} { .probe { color: red; } }`).stylesheet()
    .s?.[0]?.[1]?.[0]?.m;
}

/** Warnings produced while compiling `@media <query>`. */
function warningsFor(query: string) {
  return compile(`@media ${query} { .probe { color: red; } }`).warnings();
}

/* -------------------------------------------------------------------------
 * What React Native actually offers
 * ---------------------------------------------------------------------- */

test("AccessibilityInfo pairs a getter with a change event for every preference it tracks", () => {
  // Every entry below is a live runtime answer React Native already has. Four
  // of them are now read (`isReduceMotionEnabled`, `isInvertColorsEnabled`,
  // `isReduceTransparencyEnabled`, `isHighTextContrastEnabled`); the rest are
  // still unread, and this test is the inventory a future fix works from.
  for (const getter of [
    "isReduceMotionEnabled",
    "isReduceTransparencyEnabled",
    "isInvertColorsEnabled",
    "isHighTextContrastEnabled",
    "isDarkerSystemColorsEnabled",
    "isGrayscaleEnabled",
    "isBoldTextEnabled",
    "isScreenReaderEnabled",
  ] as const) {
    expect(typeof AccessibilityInfo[getter]).toBe("function");
  }

  // …and each one has a paired change event, which is what makes a reactive
  // observable (rather than a boot-time snapshot) possible.
  for (const eventName of [
    "reduceMotionChanged",
    "reduceTransparencyChanged",
    "invertColorsChanged",
    "highTextContrastChanged",
    "darkerSystemColorsChanged",
    "grayscaleChanged",
    "boldTextChanged",
    "screenReaderChanged",
  ] as const) {
    const subscription = AccessibilityInfo.addEventListener(
      eventName,
      () => undefined,
    );
    expect(typeof subscription.remove).toBe("function");
    subscription.remove();
  }
});

/* -------------------------------------------------------------------------
 * Tier A — RN has the getter AND the change event. Copy `prefers-color-scheme`.
 * ---------------------------------------------------------------------- */

test("prefers-reduced-motion answers from AccessibilityInfo", () => {
  // `prefers-reduced-motion` (MQ5 §11.2), backed by
  // `AccessibilityInfo.isReduceMotionEnabled()` + the `reduceMotionChanged`
  // event. It is the feature behind every `motion-reduce:` / `motion-safe:`
  // utility, so both branches being dead meant those variants compiled cleanly
  // and then evaluated false on every device — an accessibility preference that
  // looks implemented and is not.
  expect(conditionFor("(prefers-reduced-motion: reduce)")).toStrictEqual([
    ["=", "prefers-reduced-motion", "reduce"],
  ]);
  // The preference is off in this environment, so the default branch matches
  // and the reduce branch does not.
  expect(applies("(prefers-reduced-motion: no-preference)")).toBe(true);
  expect(applies("(prefers-reduced-motion: reduce)")).toBe(false);
});

test("prefers-reduced-transparency answers from AccessibilityInfo", () => {
  // `prefers-reduced-transparency` (MQ5 §11.3), backed by
  // `AccessibilityInfo.isReduceTransparencyEnabled()` + the
  // `reduceTransparencyChanged` event (iOS "Reduce Transparency").
  //
  // Both branches used to be dead — the condition compiled and `testComparison`
  // had no case — so a stylesheet could not express even its default branch.
  expect(conditionFor("(prefers-reduced-transparency: reduce)")).toStrictEqual([
    ["=", "prefers-reduced-transparency", "reduce"],
  ]);
  // The preference is off in this environment, so the default branch matches
  // and the reduce branch does not.
  expect(applies("(prefers-reduced-transparency: no-preference)")).toBe(true);
  expect(applies("(prefers-reduced-transparency: reduce)")).toBe(false);
});

test("prefers-contrast answers from AccessibilityInfo", () => {
  // `prefers-contrast` (MQ5 §11.4), backed by
  // `AccessibilityInfo.isHighTextContrastEnabled()` +
  // `highTextContrastChanged` (Android "High contrast text").
  expect(applies("(prefers-contrast: no-preference)")).toBe(true);
  expect(applies("(prefers-contrast: more)")).toBe(false);

  // React Native reports one bit, so the other two values MQ5 defines are not
  // answerable and never match.
  expect(applies("(prefers-contrast: less)")).toBe(false);
  expect(applies("(prefers-contrast: custom)")).toBe(false);
});

test("inverted-colors answers from AccessibilityInfo", () => {
  // `inverted-colors` (MQ5 §11.6), backed by
  // `AccessibilityInfo.isInvertColorsEnabled()` + `invertColorsChanged` (iOS
  // "Smart/Classic Invert") — a 1:1 match for the CSS feature.
  expect(conditionFor("(inverted-colors: inverted)")).toStrictEqual([
    ["=", "inverted-colors", "inverted"],
  ]);
  expect(applies("(inverted-colors: none)")).toBe(true);
  expect(applies("(inverted-colors: inverted)")).toBe(false);
});

/* -------------------------------------------------------------------------
 * Tier B — statically answerable from React Native's own invariants.
 *          No native API needed; the evaluator just has no case.
 * ---------------------------------------------------------------------- */

test("hover matches its own value only, so the two branches are exclusive", () => {
  // `hover` (MQ4 §10.5) answers `hover` on every platform DELIBERATELY: React
  // Native synthesises hover through Pressability (`hoverIn`/`hoverOut`), so a
  // `hover:`-prefixed utility works on a touch screen, where a mobile browser
  // would answer `none` and make it dead CSS. That is a considered divergence
  // from the spec's "primary input mechanism" reading, not an oversight — the
  // vendor Tailwind suites depend on it.
  //
  // The defect was that `case "hover": return true` ignored the value, so
  // `(hover: hover)` and `(hover: none)` — mutually exclusive in CSS — both
  // applied and declaration order silently decided which won.
  expect(applies("(hover: hover)")).toBe(true);
  expect(applies("(hover: none)")).toBe(false);
  // A value outside the spec's grammar matches nothing.
  expect(applies("(hover: anything)")).toBe(false);

  registerCSS(`
.hover-both { color: green; }
@media (hover: hover) { .hover-both { color: red; } }
@media (hover: none)  { .hover-both { color: blue; } }
`);
  render(<View testID="hover-both" className="hover-both" />);
  expect(screen.getByTestId("hover-both").props.style).toStrictEqual({
    color: "#f00",
  });
});

test("any-hover agrees with hover", () => {
  // `any-hover` (MQ4 §10.8) answers the same question as `hover` and can only
  // disagree on a device with several input mechanisms, which React Native
  // does not model. It used to never match, contradicting the `hover` sitting
  // beside it.
  expect(applies("(any-hover: hover)")).toBe(true);
  expect(applies("(any-hover: none)")).toBe(false);
  expect(applies("(hover: hover)")).toBe(true);
});

test("pointer and any-pointer report the physical input", () => {
  // `pointer` / `any-pointer` (MQ4 §10.6, §10.9) describe the input device
  // rather than a synthesised capability, so unlike `hover` they answer
  // `coarse` on a touch screen. `(pointer: coarse)` is the single most common
  // way to say "this is a touchscreen" in CSS, and it used to be dead.
  for (const feature of ["pointer", "any-pointer"]) {
    expect(applies(`(${feature}: coarse)`)).toBe(true);
    expect(applies(`(${feature}: fine)`)).toBe(false);
    expect(applies(`(${feature}: none)`)).toBe(false);
  }
});

test("scripting never matches", () => {
  // GAP: `scripting` (MQ5 §11.8).
  //   RN answer: statically `enabled` — a React Native app is, by construction,
  //   running script. No API needed, no reactivity needed.
  //   Today: NEVER MATCHES.
  expect(applies("(scripting: enabled)")).toBe(false);
  expect(applies("(scripting: none)")).toBe(false);
  expect(applies("(scripting: initial-only)")).toBe(false);
});

test("update never matches", () => {
  // GAP: `update` (MQ4 §10.3).
  //   RN answer: statically `fast` — the renderer repaints continuously.
  //   Today: NEVER MATCHES, so an `@media (update: fast)` animation opt-in is
  //   dead while `@media (update: none)` print-style fallbacks are dead too.
  expect(applies("(update: fast)")).toBe(false);
  expect(applies("(update: slow)")).toBe(false);
  expect(applies("(update: none)")).toBe(false);
});

test("monochrome never matches, in plain, prefixed, range and interval form", () => {
  // GAP: `monochrome` (MQ4 §10.11).
  //   RN answer: statically `0` — every React Native surface has a colour
  //   framebuffer. (`AccessibilityInfo.isGrayscaleEnabled()` +
  //   `grayscaleChanged` reports the iOS greyscale colour FILTER, which per
  //   spec still leaves `monochrome` at 0, so it is a near-miss rather than
  //   the answer.)
  //   Today: NEVER MATCHES. The value does reach `testComparison` as a number,
  //   but `monochrome` is absent from the numeric ladder, so it falls to
  //   `default: return false` — `(monochrome: 0)`, the "this is a colour
  //   screen" branch that should be true everywhere, is dead.
  expect(conditionFor("(monochrome: 0)")).toStrictEqual([
    ["=", "monochrome", 0],
  ]);
  expect(applies("(monochrome: 0)")).toBe(false);
  expect(applies("(monochrome: 1)")).toBe(false);
  expect(applies("(min-monochrome: 1)")).toBe(false);
  expect(applies("(max-monochrome: 8)")).toBe(false);
  expect(applies("(monochrome > 0)")).toBe(false);
  expect(applies("(0 < monochrome < 8)")).toBe(false);
});

test("color-gamut and dynamic-range never match, including their baselines", () => {
  // GAP: `color-gamut` / `dynamic-range` (MQ4 §10.12, MQ5 §11.10).
  //   RN answer: no runtime API for either. But their BASELINE values are
  //   statically true by definition — every display is at least `srgb` and at
  //   least `standard` dynamic range — so those two could be answered without
  //   any native call, and the rest left false.
  //   Today: NEVER MATCHES, baselines included.
  expect(applies("(color-gamut: srgb)")).toBe(false);
  expect(applies("(color-gamut: p3)")).toBe(false);
  expect(applies("(dynamic-range: standard)")).toBe(false);
  expect(applies("(dynamic-range: high)")).toBe(false);
});

/* -------------------------------------------------------------------------
 * Tier C — React Native has no answer. Recorded so the absence is deliberate.
 * ---------------------------------------------------------------------- */

test("forced-colors never matches", () => {
  // GAP: `forced-colors` (MQ5 §11.7).
  //   RN answer: NOT expressible. `forced-colors: active` means the user agent
  //   is overriding the author's palette with a system one; React Native has
  //   no forced-colours mode to report. Android's high-text-contrast and iOS's
  //   darker-system-colours are adjacent signals but they belong to
  //   `prefers-contrast`, not here.
  //   Today: NEVER MATCHES — which is the correct verdict for `active` and the
  //   WRONG one for `none`, the value that should be true on every device.
  expect(applies("(forced-colors: active)")).toBe(false);
  expect(applies("(forced-colors: none)")).toBe(false);
});

test("prefers-reduced-data never matches", () => {
  // GAP: `prefers-reduced-data` (MQ5 §11.9).
  //   RN answer: NOT expressible from core React Native — the signal lives in
  //   `@react-native-community/netinfo` (`isConnectionExpensive`), a separate
  //   package, so wiring it here would add a dependency rather than read an
  //   API the library already has.
  //   Today: NEVER MATCHES.
  expect(applies("(prefers-reduced-data: reduce)")).toBe(false);
  expect(applies("(prefers-reduced-data: no-preference)")).toBe(false);
});

/* -------------------------------------------------------------------------
 * The cross-cutting shapes — these hit every feature above at once
 * ---------------------------------------------------------------------- */

test("negating an unsupported feature does not make the rule apply", () => {
  // This was the ALWAYS MATCHES shape, and it reached every feature in this
  // file: `test` returned a hard `false` for anything it had no case for, and
  // `case "!": return !test(...)` turned that into an unconditional `true` —
  // the exact inverse of the intended behaviour. Each of these reads as "only
  // when the user has expressed this preference" and applied to everyone.
  //
  // The evaluator now answers UNKNOWN rather than `false` for a feature it does
  // not implement, and unknown propagates through `!` instead of flipping.
  // MQ5 §3: an unrecognised feature makes the query fail to match in EITHER
  // polarity.
  expect(applies("not (forced-colors: none)")).toBe(false);
  expect(applies("not (monochrome: 0)")).toBe(false);
  expect(applies("not (scripting: enabled)")).toBe(false);

  // `prefers-reduced-motion` is implemented, so its negation is ordinary logic
  // rather than the unknown case: the preference is off here, so negating its
  // default value is false.
  expect(applies("not (prefers-reduced-motion: no-preference)")).toBe(false);
  expect(applies("not (prefers-reduced-motion: reduce)")).toBe(true);

  // `prefers-contrast` and `inverted-colors` ARE implemented, so their
  // negations are ordinary logic rather than the unknown case: the preference
  // is off here, so negating its default value is false and negating the set
  // value is true.
  expect(applies("not (prefers-contrast: no-preference)")).toBe(false);
  expect(applies("not (inverted-colors: none)")).toBe(false);
  expect(applies("not (prefers-contrast: more)")).toBe(true);
  expect(applies("not (inverted-colors: inverted)")).toBe(true);
  // `not all and (…)` and grouped negation take the same path. The feature
  // named here has to be one the evaluator genuinely does not implement, or
  // the assertion stops testing the unknown case and starts testing ordinary
  // logic — which is what `prefers-reduced-motion` became once it was wired.
  expect(applies("not all and (forced-colors: active)")).toBe(false);
  expect(
    applies("not ((forced-colors: active) and (scripting: enabled))"),
  ).toBe(false);

  // MQ4 §3.1 three-valued logic: `X and Y` is FALSE if either side is false,
  // even when the other is unknown — so negating it is a definite `true`. This
  // is not the old bug in a new costume; the negation is anchored by a side
  // whose answer is known.
  expect(
    applies("not ((forced-colors: active) and (prefers-contrast: more))"),
  ).toBe(true);

  // A feature that IS implemented still negates normally — unknown is a third
  // answer, not a blanket refusal to negate.
  expect(applies("not (hover: none)")).toBe(true);
  expect(applies("not (hover: hover)")).toBe(false);

  registerCSS(`
.rm-inverted { color: green; }
@media not (prefers-reduced-motion: no-preference) { .rm-inverted { color: red; } }
`);
  render(<View testID="rm-inverted" className="rm-inverted" />);
  expect(screen.getByTestId("rm-inverted").props.style).toStrictEqual(GREEN);
});

test("the boolean form evaluates the feature it names", () => {
  // MQ4 §2.4 boolean context. `@media (prefers-reduced-motion)` is the
  // shorthand for "the feature is not in its false state" and is how the
  // feature is most often written. `parseFeature` compiles it to `["!!", name]`
  // and the evaluator's first case was `case "[]": case "!!": return false;` —
  // a hard `false` with no per-feature dispatch at all, so the boolean form was
  // dead even for the features the evaluator DID support.
  expect(conditionFor("(prefers-reduced-motion)")).toStrictEqual([
    ["!!", "prefers-reduced-motion"],
  ]);

  // Still unimplemented, so still unknown — and unknown does not match in
  // either polarity.
  for (const feature of [
    "forced-colors",
    "prefers-reduced-data",
    "scripting",
    "update",
    "monochrome",
    "color-gamut",
    "dynamic-range",
  ]) {
    expect(applies(`(${feature})`)).toBe(false);
    expect(applies(`not (${feature})`)).toBe(false);
  }

  // The accessibility features that ARE implemented answer their boolean form
  // from the same value their plain form reads. Both preferences are off here,
  // so the boolean form — "the feature is not in its false state" — is false,
  // and its negation is true.
  for (const feature of [
    "prefers-contrast",
    "prefers-reduced-motion",
    "prefers-reduced-transparency",
    "inverted-colors",
  ]) {
    expect(applies(`(${feature})`)).toBe(false);
    expect(applies(`not (${feature})`)).toBe(true);
  }

  // The features that ARE implemented now answer their boolean form too, and
  // the answer agrees with the plain form. `(hover)` and `(hover: hover)` are
  // the same query in CSS; they used to be opposites.
  for (const feature of [
    "prefers-color-scheme",
    "hover",
    "any-hover",
    "any-pointer",
    "orientation",
    "resolution",
  ]) {
    expect(applies(`(${feature})`)).toBe(true);
    expect(applies(`not (${feature})`)).toBe(false);
  }

  expect(applies("(hover)")).toBe(true);
  expect(applies("(hover: hover)")).toBe(true);
});

test("an env() feature value makes the rule unmatchable", () => {
  // This WAS the CONDITION DROPPED shape — the dangerous one — and it is
  // reachable from an accessibility feature.
  //
  // `env()` is valid in a media feature value (CSS Environment Variables L1).
  // `parseMediaFeatureValue` has no `env` case and returns `undefined`;
  // `parseMediaQuery` then hit `condition.some((v) => v === undefined)` and
  // returned WITHOUT calling `builder.addMediaQuery`. But `extractMedia` goes
  // on to `extractRule` every rule inside the block regardless, so the guarded
  // declarations were registered with no `m` condition at all — the rule did
  // not merely match too often, it carried no condition to evaluate and nothing
  // downstream could ever suppress it.
  //
  // The condition is now the `["?"]` marker: present, and unknown.
  expect(
    conditionFor("(forced-colors: env(safe-area-inset-top))"),
  ).toStrictEqual([["?"]]);
  expect(applies("(forced-colors: env(safe-area-inset-top))")).toBe(false);
  expect(applies("(monochrome: env(safe-area-inset-top))")).toBe(false);
  // Including on `prefers-color-scheme`, the one feature that otherwise works.
  expect(applies("(prefers-color-scheme: env(x))")).toBe(false);

  registerCSS(`
.env-drop { color: green; }
@media (prefers-color-scheme: env(x)) { .env-drop { color: red; } }
`);
  render(<View testID="env-drop" className="env-drop" />);
  expect(screen.getByTestId("env-drop").props.style).toStrictEqual(GREEN);
});

test("the interval form is evaluated, and stays dead for an unknown feature", () => {
  // MQ4 §2.4.3 range context with two comparisons. `parseFeature` compiles it
  // to `["[]", …]`, which used to share the evaluator's hard-`false` branch with
  // the boolean form — the compiler emitted a complete, correct interval and
  // the runtime never looked at it.
  //
  // `monochrome` is still unimplemented, so this one is unknown rather than
  // false — which is why it does not match in either polarity.
  expect(conditionFor("(0 < monochrome < 8)")).toStrictEqual([
    ["[]", "monochrome", 0, "<", 8, "<"],
  ]);
  expect(applies("(0 < monochrome < 8)")).toBe(false);
  expect(applies("(0 <= monochrome <= 8)")).toBe(false);
  expect(applies("not (0 < monochrome < 8)")).toBe(false);

  // The same form over a feature that IS implemented evaluates both bounds.
  // The test viewport is 375 wide.
  expect(applies("(1px < width < 99999px)")).toBe(true);
  expect(applies("(99999px < width < 999999px)")).toBe(false);
  expect(applies("(1px < width < 2px)")).toBe(false);
});

test("no warning is emitted for any inert accessibility query", () => {
  // Every gap above is silent. A stylesheet author gets identical build output
  // for a query that works and one that can never match.
  for (const query of [
    "(prefers-reduced-motion: reduce)",
    "(prefers-reduced-transparency: reduce)",
    "(prefers-contrast: more)",
    "(inverted-colors: inverted)",
    "(forced-colors: active)",
    "(pointer: coarse)",
    "(monochrome: 0)",
    "(prefers-reduced-motion)",
    "(0 < monochrome < 8)",
    "(forced-colors: env(safe-area-inset-top))",
  ]) {
    expect(warningsFor(query)).toStrictEqual({});
  }
});

/* -------------------------------------------------------------------------
 * What IS evaluated — the exemplar to copy, and its one hole
 * ---------------------------------------------------------------------- */

test("orientation, resolution and display-mode are evaluated", () => {
  // Recorded as the contrast: these three reach a real source, so an
  // unsupported feature is a missing case rather than a missing capability.
  // `orientation` reads `vh`/`vw`; `resolution` reads `PixelRatio.get()`.
  expect(applies("(orientation: portrait)")).toBe(true);
  expect(applies("(orientation: landscape)")).toBe(false);
  expect(applies("(min-resolution: 1dppx)")).toBe(true);
  expect(applies("(max-resolution: 1dppx)")).toBe(false);

  // `display-mode` is evaluated against a NON-CSS vocabulary: the evaluator
  // compares the value to `Platform.OS` (plus the literal `native`), so none of
  // the spec's own values — `fullscreen`, `standalone`, `minimal-ui`,
  // `browser` — can ever match.
  expect(applies("(display-mode: native)")).toBe(true);
  expect(applies(`(display-mode: ${Platform.OS})`)).toBe(true);
  expect(applies("(display-mode: fullscreen)")).toBe(false);
  expect(applies("(display-mode: standalone)")).toBe(false);
  expect(applies("(display-mode: browser)")).toBe(false);
});

test("prefers-color-scheme is reactive, and no-preference reads as light", () => {
  const initial = Appearance.getColorScheme();
  try {
    // `prefers-color-scheme` (MQ5 §11.5) in the no-preference state.
    // `Appearance.getColorScheme()` returns `null` when the OS reports no
    // preference — the state this test starts in. MQ5 says `light` must match
    // when the user "has no active preference"; the evaluator used to be a
    // bare `value === get(colorScheme)`, and `null` equals neither string, so
    // the light branch of every themed stylesheet was dead until the OS
    // committed to a scheme.
    expect(initial).toBeNull();
    expect(applies("(prefers-color-scheme: light)")).toBe(true);
    expect(applies("(prefers-color-scheme: dark)")).toBe(false);

    // The reactive half is the pattern every gap above should copy: an
    // observable seeded from a native API, updated by that API's change event,
    // read through `get` so the style recomputes in place.
    const className = "pcs-live";
    registerCSS(`
.pcs-live { color: green; }
@media (prefers-color-scheme: dark) { .pcs-live { color: red; } }
`);
    render(<View testID={className} className={className} />);
    const element = screen.getByTestId(className);
    expect(element.props.style).toStrictEqual({ color: "#008000" });

    act(() => {
      colorScheme.set("dark");
    });
    expect(element.props.style).toStrictEqual(RED);

    act(() => {
      colorScheme.set("light");
    });
    expect(element.props.style).toStrictEqual({ color: "#008000" });
  } finally {
    act(() => {
      colorScheme.set(initial);
    });
  }
});
