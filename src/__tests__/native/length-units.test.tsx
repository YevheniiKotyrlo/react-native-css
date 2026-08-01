/**
 * CSS lengths, units and math functions, measured against
 * CSS Values and Units Module Level 4 (css-values-4).
 *
 * Test environment facts these assertions rest on (see `src/jest/index.ts` and
 * `src/native-internal/root.ts`): the root rem is `14`, and the window is
 * `750 x 1334`, so `1vw === 7.5` and `1vh === 13.34`.
 *
 * Every `// GAP:` comment marks a place where the library produces nothing (or
 * something React Native rejects) for a value the CSS spec defines and React
 * Native could have expressed.
 */
import { render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

function renderClass(className: string): unknown {
  const component = render(
    <View testID={testID} className={className} />,
  ).getByTestId(testID);

  return component.props.style as unknown;
}

/* -------------------------------------------------------------------------- */
/* Absolute lengths — css-values-4 §5.4                                       */
/* -------------------------------------------------------------------------- */

test("px is the reference unit and passes through unchanged", () => {
  registerCSS(`
    .abs-px-a { width: 10px; }
    .abs-px-b { top: -10px; }
    .abs-px-c { width: 10.567px; }
    .abs-px-d { width: 0px; }
  `);

  expect(renderClass("abs-px-a")).toStrictEqual({ width: 10 });
  expect(renderClass("abs-px-b")).toStrictEqual({ top: -10 });
  // Fractional px survive; no rounding to whole device pixels.
  expect(renderClass("abs-px-c")).toStrictEqual({ width: 10.567 });
  expect(renderClass("abs-px-d")).toStrictEqual({ width: 0 });
});

test("unitless zero, and unitless non-zero, are both accepted as px", () => {
  registerCSS(`
    .abs-zero { width: 0; height: 0; margin: 0; gap: 0; }
    .abs-unitless { width: 10; }
  `);

  expect(renderClass("abs-zero")).toStrictEqual({
    width: 0,
    height: 0,
    margin: 0,
    gap: 0,
  });
  // css-values-4 §5.4 allows a unitless ZERO only; `width: 10` is invalid CSS
  // and a browser drops the declaration. The library accepts it as 10px.
  expect(renderClass("abs-unitless")).toStrictEqual({ width: 10 });
});

test("pt / pc / in / cm / mm / Q convert to px", () => {
  const compiled = registerCSS(`
    .abs-pt { width: 10pt; }
    .abs-pc { width: 10pc; }
    .abs-in { width: 1in; }
    .abs-cm { width: 1cm; }
    .abs-mm { width: 10mm; }
    .abs-q  { width: 40Q; }
  `);

  // css-values-4 §5.4 fixes every absolute unit to px by an exact ratio
  // (1in = 96px, 1pc = 16px, 1pt = 4/3px, 1cm = 96/2.54px, 1mm = 1cm/10,
  // 1Q = 1cm/40), so all six are computable at BUILD time with no device input.
  // They used to reach `parseLength`, which knows only px/rem/%/em/vw/vh, and
  // the whole declaration disappeared. The conversion now happens in the
  // compiler's `Length` visitor — the same hook that already folded `rem`.
  expect(renderClass("abs-pt")).toStrictEqual({ width: 13.3333 });
  expect(renderClass("abs-pc")).toStrictEqual({ width: 160 });
  expect(renderClass("abs-in")).toStrictEqual({ width: 96 });
  expect(renderClass("abs-cm")).toStrictEqual({ width: 37.7953 });
  expect(renderClass("abs-mm")).toStrictEqual({ width: 37.7953 });
  expect(renderClass("abs-q")).toStrictEqual({ width: 37.7953 });

  expect(compiled.warnings()).toStrictEqual({});
});

test("the SAME absolute units convert correctly inside calc() next to a px term", () => {
  registerCSS(`
    .abs-calc-pt { width: calc(10pt + 0px); }
    .abs-calc-pc { width: calc(1pc + 0px); }
    .abs-calc-in { width: calc(1in + 10px); }
    .abs-calc-cm { width: calc(1cm + 0px); }
    .abs-calc-mm { width: calc(10mm + 0px); }
    .abs-calc-q  { width: calc(40Q + 0px); }
  `);

  // The conversion table is clearly reachable — lightningcss applies it while
  // simplifying the calc(). Only `parseLength`'s standalone path lacks it.
  expect(renderClass("abs-calc-pt")).toStrictEqual({ width: 13.3333 });
  expect(renderClass("abs-calc-pc")).toStrictEqual({ width: 16 });
  expect(renderClass("abs-calc-in")).toStrictEqual({ width: 106 });
  expect(renderClass("abs-calc-cm")).toStrictEqual({ width: 37.7953 });
  expect(renderClass("abs-calc-mm")).toStrictEqual({ width: 37.7953 });
  expect(renderClass("abs-calc-q")).toStrictEqual({ width: 37.7953 });
});

test("an absolute unit that survives simplification alone converts too", () => {
  const compiled = registerCSS(`
    .abs-keep-calc { width: calc(1in * 1); }
    .abs-keep-min { width: min(10pt, 100px); }
    .abs-keep-var { --abs-keep: 10pt; width: var(--abs-keep); }
  `);

  // css-values-4 §5.4 + §10. Whether an absolute unit worked used to depend on
  // whether the expression happened to leave a px term behind — `calc(1in +
  // 10px)` collapsed to `106px` and worked, `calc(1in * 1)` collapsed to `1in`
  // and vanished. The `Length` visitor sees every length wherever it survives
  // simplification, so the two spellings now agree.
  expect(renderClass("abs-keep-calc")).toStrictEqual({ width: 96 });
  expect(renderClass("abs-keep-min")).toStrictEqual({ width: 13.3333 });

  // Including inside a CUSTOM PROPERTY, whose value is an untyped token list —
  // lightningcss does not parse it as a `<length>`, so the compiler's `Length`
  // visitor never sees it. `parseLength` carries the same conversion for
  // exactly that case, the way it always has for `rem`.
  expect(renderClass("abs-keep-var")).toStrictEqual({ width: 13.3333 });

  expect(compiled.warnings()).toStrictEqual({});
});

test("absolute units are dropped on every property, not just width", () => {
  const compiled = registerCSS(`
    .abs-prop-padding { padding: 12pt; }
    .abs-prop-font { font-size: 12pt; }
    .abs-prop-radius { border-radius: 0.1in; }
  `);

  // Same §5.4 conversion, and it reaches every property because the `Length`
  // visitor sees lengths rather than declarations. `12pt` is 16px and `0.1in`
  // is 9.6px.
  expect(renderClass("abs-prop-padding")).toStrictEqual({ padding: 16 });
  expect(renderClass("abs-prop-font")).toStrictEqual({ fontSize: 16 });
  expect(renderClass("abs-prop-radius")).toStrictEqual({ borderRadius: 9.6 });

  expect(compiled.warnings()).toStrictEqual({});
});

/* -------------------------------------------------------------------------- */
/* Percentages                                                                */
/* -------------------------------------------------------------------------- */

test("percentages pass through as strings on the layout properties", () => {
  registerCSS(`
    .pct-box { width: 50%; height: 50%; top: 50%; margin: 5%; padding: 5%; }
    .pct-gap { gap: 10%; }
    .pct-radius { border-radius: 10%; }
  `);

  expect(renderClass("pct-box")).toStrictEqual({
    width: "50%",
    height: "50%",
    top: "50%",
    margin: "5%",
    padding: "5%",
  });
  expect(renderClass("pct-gap")).toStrictEqual({ gap: "10%" });
  expect(renderClass("pct-radius")).toStrictEqual({ borderRadius: "10%" });
});

test("a font-size percentage resolves; a border-width percentage reaches a number-only key", () => {
  registerCSS(`
    .pct-font { font-size: 200%; }
    .pct-border { border-width: 10%; }
  `);

  // css-fonts-4 §3.5 — a `font-size` percentage resolves against the PARENT's
  // font size, which is the quantity `em` measures, so it compiles to the `em`
  // multiplier it names and `200%` of the 14 root is 28. React Native's
  // `fontSize` is `number | undefined` (StyleSheetTypes.d.ts), and this is that
  // number.
  expect(renderClass("pct-font")).toStrictEqual({ fontSize: 28 });
  // GAP: css-backgrounds-3 §4.3 — `border-width` does not accept a percentage
  // at all, so this declaration is invalid CSS and should be dropped. RN types
  // `borderWidth` as `number | undefined`; the string reaches it either way.
  expect(renderClass("pct-border")).toStrictEqual({ borderWidth: "10%" });
});

test("a line-height percentage is dropped even though it is computable", () => {
  const compiled = registerCSS(`
    .pct-lh { font-size: 10px; line-height: 150%; }
  `);

  // GAP: CSS2 §10.8.1 — a `line-height` percentage resolves against the
  // element's OWN font size, so this is 15. The font size sits in the same
  // rule and the library already resolves `line-height: 1.5` (below) to 15,
  // so the number is in hand; the percentage form is warned and dropped.
  expect(renderClass("pct-lh")).toStrictEqual({ fontSize: 10 });
  expect(compiled.warnings()).toStrictEqual({
    values: { "line-height": [1.5] },
  });
});

/* -------------------------------------------------------------------------- */
/* Font-relative lengths — css-values-4 §5.2                                  */
/* -------------------------------------------------------------------------- */

test("rem resolves against the root font size (14) at compile time", () => {
  registerCSS(`
    .fr-rem-w { width: 2rem; }
    .fr-rem-m { margin: 1rem; }
    .fr-rem-g { gap: 1rem; }
    .fr-rem-r { border-radius: 1rem; }
    .fr-rem-lh { line-height: 2rem; }
  `);

  expect(renderClass("fr-rem-w")).toStrictEqual({ width: 28 });
  expect(renderClass("fr-rem-m")).toStrictEqual({ margin: 14 });
  expect(renderClass("fr-rem-g")).toStrictEqual({ gap: 14 });
  expect(renderClass("fr-rem-r")).toStrictEqual({ borderRadius: 14 });
  expect(renderClass("fr-rem-lh")).toStrictEqual({ lineHeight: 28 });
});

test("em resolves against a font-size declared in the SAME rule", () => {
  registerCSS(`
    .fr-em-same { font-size: 10px; width: 2em; }
    .fr-em-ls { font-size: 10px; letter-spacing: 0.1em; }
    .fr-em-lh { font-size: 10px; line-height: 2em; }
  `);

  expect(renderClass("fr-em-same")).toStrictEqual({ fontSize: 10, width: 20 });
  expect(renderClass("fr-em-ls")).toStrictEqual({
    fontSize: 10,
    letterSpacing: 1,
  });
  expect(renderClass("fr-em-lh")).toStrictEqual({
    fontSize: 10,
    lineHeight: 20,
  });
});

test("em falls back to the root rem when the element has no font-size", () => {
  registerCSS(`.fr-em-none { width: 2em; }`);

  // Correct per css-values-4 §5.2: with no ancestor font size the computed
  // font size IS the root's, so 2em is 28.
  expect(renderClass("fr-em-none")).toStrictEqual({ width: 28 });
});

test("em IGNORES an ancestor's font-size and silently uses the root rem", () => {
  registerCSS(`
    .fr-em-parent { font-size: 10px; }
    .fr-em-child { width: 2em; }
  `);

  const tree = render(
    <View className="fr-em-parent">
      <View testID={testID} className="fr-em-child" />
    </View>,
  );

  // GAP: css-values-4 §5.2 — `em` is the element's own computed font size,
  // which is INHERITED when the element does not set one. The correct value is
  // 20 (2 x the ancestor's 10px). The library returns 28 (2 x the root rem).
  //
  // The value is present and reachable: the ancestor publishes it, and the
  // explicit `var(--__rn-css-em)` form below reads it correctly. The unit
  // form misses it because the compiler does not mark an `em` declaration as
  // variable-consuming (the rule carries no `dv` flag), so the inherited
  // variable context is never handed to the resolver.
  expect(tree.getByTestId(testID).props.style).toStrictEqual({ width: 28 });
});

test("the em variable itself DOES inherit — only the unit misses it", () => {
  registerCSS(`
    .fr-var-parent { font-size: 10px; }
    .fr-var-child { width: var(--__rn-css-em); }
  `);

  const tree = render(
    <View className="fr-var-parent">
      <View testID={testID} className="fr-var-child" />
    </View>,
  );

  expect(tree.getByTestId(testID).props.style).toStrictEqual({ width: 10 });
});

test("font-size: 2em resolves against the root, and against an ancestor", () => {
  registerCSS(`
    .fr-emfs-self { font-size: 2em; }
    .fr-emfs-shorthand { font: 2em Arial; }
    .fr-emfs-parent { font-size: 10px; }
    .fr-emfs-child { font-size: 2em; }
  `);

  // css-fonts-4 §3.5: on `font-size` itself, `em` is the PARENT's computed
  // font size. Both shapes are right — 2 x the root rem with no ancestor,
  // 2 x 10 with one. `font-size` deliberately does not publish itself as
  // `--__rn-css-em` when its own value is an `em` function, which is what
  // keeps the self-reference from recursing.
  expect(renderClass("fr-emfs-self")).toStrictEqual({ fontSize: 28 });
  // The shorthand also resets the longhands it covers but does not name, which
  // is why `fontVariant` is the empty list React Native spells `normal` with.
  expect(renderClass("fr-emfs-shorthand")).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 28,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
  });

  const tree = render(
    <Text className="fr-emfs-parent">
      <Text testID={testID} className="fr-emfs-child" />
    </Text>,
  );
  expect(tree.getByTestId(testID).props.style).toStrictEqual({ fontSize: 20 });
});

test("an em reaching font-size through a live var() resolves like the literal", () => {
  registerCSS(`
    .fr-emvar-decoy { --fr-emvar: 4em; }
    .fr-emvar { --fr-emvar: 2em; font-size: var(--fr-emvar); }
  `);

  // css-fonts-4 §3.5 — this is `font-size: 2em`, i.e. 28, which is what the
  // direct spelling above produces. The declaration is only left as a live
  // `var()` here because `--fr-emvar` is declared twice, which switches the
  // compile-time variable inliner off for that name.
  //
  // On the `var()` path `font-size` publishes itself as `--__rn-css-em`
  // unguarded (the compile-time guard matches a literal `em` StyleFunction,
  // not one hidden behind a variable), so resolving the font size reads
  // `--__rn-css-em`, which resolves to the same `em` function, which reads
  // `--__rn-css-em`... That exhausted the stack while the var resolver's cycle
  // guard was dead code. With the guard live, the re-entry is cut at the
  // self-reference and the inherited size answers instead — so both spellings
  // now agree.
  expect(renderClass("fr-emvar")).toStrictEqual({ fontSize: 28 });
});

test("ex / ch / cap / ic / lh and their r* twins are all dropped", () => {
  const compiled = registerCSS(`
    .fr-ex { font-size: 10px; width: 2ex; }
    .fr-ch { font-size: 10px; width: 2ch; }
    .fr-cap { font-size: 10px; width: 2cap; }
    .fr-ic { font-size: 10px; width: 2ic; }
    .fr-lh { font-size: 10px; line-height: 20px; width: 2lh; }
    .fr-rex { width: 2rex; }
    .fr-rch { width: 2rch; }
    .fr-rcap { width: 2rcap; }
    .fr-ric { width: 2ric; }
    .fr-rlh { width: 2rlh; }
  `);

  // GAP: css-values-4 §5.2 defines all ten. `lh` / `rlh` need only the
  // line-height already in hand (`2lh` here is 40) and `ex` / `ch` / `cap` /
  // `ic` have spec-mandated FALLBACKS when font metrics are unavailable —
  // 0.5em for ex, 0.5em for ch, 0.8em for cap, 1em for ic — every one of which
  // is a plain multiple of a font size this library already resolves. React
  // Native takes a number for all of these.
  expect(renderClass("fr-ex")).toStrictEqual({ fontSize: 10 });
  expect(renderClass("fr-ch")).toStrictEqual({ fontSize: 10 });
  expect(renderClass("fr-cap")).toStrictEqual({ fontSize: 10 });
  expect(renderClass("fr-ic")).toStrictEqual({ fontSize: 10 });
  expect(renderClass("fr-lh")).toStrictEqual({ fontSize: 10, lineHeight: 20 });
  expect(renderClass("fr-rex")).toBeUndefined();
  expect(renderClass("fr-rch")).toBeUndefined();
  expect(renderClass("fr-rcap")).toBeUndefined();
  expect(renderClass("fr-ric")).toBeUndefined();
  expect(renderClass("fr-rlh")).toBeUndefined();

  expect(compiled.warnings()).toStrictEqual({
    values: {
      width: [
        "2ex",
        "2ch",
        "2cap",
        "2ic",
        "2lh",
        "2rex",
        "2rch",
        "2rcap",
        "2ric",
        "2rlh",
      ],
    },
  });
});

/* -------------------------------------------------------------------------- */
/* Viewport lengths — css-values-4 §5.3                                       */
/* -------------------------------------------------------------------------- */

test("vw and vh resolve against the 750x1334 window", () => {
  registerCSS(`
    .vp-vw { width: 10vw; }
    .vp-vh { height: 10vh; }
    .vp-margin { margin: 10vw; }
    .vp-top { top: 10vh; }
    .vp-gap { gap: 10vw; }
  `);

  expect(renderClass("vp-vw")).toStrictEqual({ width: 75 });
  expect(renderClass("vp-vh")).toStrictEqual({ height: 133.4 });
  expect(renderClass("vp-margin")).toStrictEqual({ margin: 75 });
  expect(renderClass("vp-top")).toStrictEqual({ top: 133.4 });
  // A dynamic gap expands to the two longhands; a static one (`gap: 1rem`
  // above) stays a single `gap`.
  expect(renderClass("vp-gap")).toStrictEqual({ columnGap: 75, rowGap: 75 });
});

test("vmin / vmax and the small-large-dynamic viewport units are all dropped", () => {
  const compiled = registerCSS(`
    .vp-vmin { width: 10vmin; }
    .vp-vmax { width: 10vmax; }
    .vp-svw { width: 10svw; }
    .vp-lvw { width: 10lvw; }
    .vp-dvw { width: 10dvw; }
    .vp-svh { height: 10svh; }
    .vp-lvh { height: 10lvh; }
    .vp-dvh { height: 10dvh; }
    .vp-vi { width: 10vi; }
    .vp-vb { width: 10vb; }
  `);

  // GAP: css-values-4 §5.3. Every one of these is derivable from the width and
  // height this library ALREADY tracks reactively (`vw` / `vh` observables in
  // `native/reactivity.ts`): vmin = min(vw, vh) = 75, vmax = max = 133.4, and
  // React Native has no distinct small/large/dynamic viewport — no browser
  // chrome collapses — so sv*/lv*/dv* are each exactly their v* twin. `vi`/`vb`
  // follow the writing mode, which is horizontal-tb on both RN platforms, so
  // they are vw/vh. Ten units, zero new inputs required.
  expect(renderClass("vp-vmin")).toBeUndefined();
  expect(renderClass("vp-vmax")).toBeUndefined();
  expect(renderClass("vp-svw")).toBeUndefined();
  expect(renderClass("vp-lvw")).toBeUndefined();
  expect(renderClass("vp-dvw")).toBeUndefined();
  expect(renderClass("vp-svh")).toBeUndefined();
  expect(renderClass("vp-lvh")).toBeUndefined();
  expect(renderClass("vp-dvh")).toBeUndefined();
  expect(renderClass("vp-vi")).toBeUndefined();
  expect(renderClass("vp-vb")).toBeUndefined();

  expect(compiled.warnings()).toStrictEqual({
    values: {
      width: ["10vmin", "10vmax", "10svw", "10lvw", "10dvw", "10vi", "10vb"],
      height: ["10svh", "10lvh", "10dvh"],
    },
  });
});

/* -------------------------------------------------------------------------- */
/* calc() — css-values-4 §10.1                                                */
/* -------------------------------------------------------------------------- */

test("calc() over same-unit terms, nesting, parentheses and division", () => {
  registerCSS(`
    .calc-add { width: calc(10px + 20px); }
    .calc-parens { width: calc((10px + 5px) * 2); }
    .calc-nested { width: calc(calc(calc(1px + 1px) * 2) + 1px); }
    .calc-div { width: calc(100px / 4); }
    .calc-mul { width: calc(10 * 3px); }
    .calc-neg { top: calc(0px - 10px); }
    .calc-gap { gap: calc(4px * 2); }
    .calc-radius { border-radius: calc(2px + 2px); }
  `);

  expect(renderClass("calc-add")).toStrictEqual({ width: 30 });
  expect(renderClass("calc-parens")).toStrictEqual({ width: 30 });
  expect(renderClass("calc-nested")).toStrictEqual({ width: 5 });
  expect(renderClass("calc-div")).toStrictEqual({ width: 25 });
  expect(renderClass("calc-mul")).toStrictEqual({ width: 30 });
  expect(renderClass("calc-neg")).toStrictEqual({ top: -10 });
  expect(renderClass("calc-gap")).toStrictEqual({ gap: 8 });
  expect(renderClass("calc-radius")).toStrictEqual({ borderRadius: 4 });
});

test("calc() over percentages stays a percentage", () => {
  registerCSS(`
    .calc-pct-sub { width: calc(50% - 10%); }
    .calc-pct-div { width: calc(100% / 3); }
    .calc-pct-mul { width: calc(50% * 2); }
  `);

  expect(renderClass("calc-pct-sub")).toStrictEqual({ width: "40%" });
  expect(renderClass("calc-pct-div")).toStrictEqual({ width: "33.3333%" });
  expect(renderClass("calc-pct-mul")).toStrictEqual({ width: "100%" });
});

test("calc() mixing a percentage with a length is dropped", () => {
  const compiled = registerCSS(`
    .calc-mix-a { width: calc(100% - 30px); }
    .calc-mix-b { --calc-mix-len: 100px; width: calc(var(--calc-mix-len) + 20%); }
    .calc-mix-c { --calc-mix-pct: 10%; width: calc(var(--calc-mix-pct) + 20px); }
  `);

  // Genuinely unrepresentable: React Native's `DimensionValue` is either a
  // number or a single percentage string, so `100% - 30px` has no encoding.
  // Noted here as the boundary of what RN can express, not as a gap.
  expect(renderClass("calc-mix-a")).toBeUndefined();
  expect(renderClass("calc-mix-b")).toBeUndefined();
  expect(renderClass("calc-mix-c")).toBeUndefined();
  // Silent: no warning is recorded for any of the three.
  expect(compiled.warnings()).toStrictEqual({});
});

test("calc() resolves rem at compile time but drops em", () => {
  const compiled = registerCSS(`
    .calc-rem { width: calc(10px + 2rem); }
    .calc-rem-mul { width: calc(2rem * 5); }
    .calc-em-add { font-size: 10px; width: calc(10px + 2em); }
    .calc-em-mul { font-size: 10px; height: calc(2em * 2); }
    .calc-em-div { font-size: 10px; height: calc(4em / 2); }
  `);

  expect(renderClass("calc-rem")).toStrictEqual({ width: 38 });
  expect(renderClass("calc-rem-mul")).toStrictEqual({ width: 140 });
  // GAP: css-values-4 §10.1 — `calc(10px + 2em)` with a 10px font size is 30.
  // Multiplying or dividing an em works (below) because lightningcss folds the
  // scalar into the em term and leaves ONE unit; adding a px leaves a two-unit
  // sum that `parseLength` refuses ("TODO: Add the calc polyfill"). The library
  // already has a runtime `em` resolver and a runtime `calc` evaluator, so the
  // pieces to compute 30 exist.
  expect(renderClass("calc-em-add")).toStrictEqual({ fontSize: 10 });
  expect(renderClass("calc-em-mul")).toStrictEqual({
    fontSize: 10,
    height: 40,
  });
  expect(renderClass("calc-em-div")).toStrictEqual({
    fontSize: 10,
    height: 20,
  });
  // Silent — the em drop is not reported.
  expect(compiled.warnings()).toStrictEqual({});
});

test("calc() folds a viewport unit only while it stays alone", () => {
  const compiled = registerCSS(`
    .calc-vw-mul { width: calc(10vw * 2); }
    .calc-vw-div { width: calc(10vw / 2); }
    .calc-vw-sum { width: calc(10vw + 5vw); }
    .calc-vw-px { width: calc(10vw + 5px); }
    .calc-vw-minus { width: calc(100vw - 20px); }
    .calc-vw-vh { width: calc(10vw + 10vh); }
  `);

  expect(renderClass("calc-vw-mul")).toStrictEqual({ width: 150 });
  expect(renderClass("calc-vw-div")).toStrictEqual({ width: 37.5 });
  expect(renderClass("calc-vw-sum")).toStrictEqual({ width: 112.5 });
  // GAP: css-values-4 §10.1. `calc(100vw - 20px)` — the single most common
  // real-world calc — is 730 here, and `calc(10vw + 10vh)` is 208.4. Both
  // resolve to a plain number React Native accepts, from observables the
  // library already keeps live. They are dropped, and silently.
  expect(renderClass("calc-vw-px")).toBeUndefined();
  expect(renderClass("calc-vw-minus")).toBeUndefined();
  expect(renderClass("calc-vw-vh")).toBeUndefined();
  expect(compiled.warnings()).toStrictEqual({});
});

test("calc() with var() is evaluated at runtime", () => {
  registerCSS(`
    .calc-var-add { --cv-a: 100px; width: calc(var(--cv-a) + 20px); }
    .calc-var-nested { --cv-b: 100px; width: calc(var(--cv-b) + calc(10px * 2)); }
    .calc-var-div { --cv-c: 100px; width: calc(var(--cv-c) / 4); }
    .calc-var-mul { --cv-d: 100px; --cv-e: 3; width: calc(var(--cv-d) * var(--cv-e)); }
    .calc-var-pct { --cv-f: 10%; width: calc(var(--cv-f) + 20%); }
    .calc-in-var { --cv-g: calc(10px + 20px); width: var(--cv-g); }
  `);

  expect(renderClass("calc-var-add")).toStrictEqual({ width: 120 });
  expect(renderClass("calc-var-nested")).toStrictEqual({ width: 120 });
  expect(renderClass("calc-var-div")).toStrictEqual({ width: 25 });
  expect(renderClass("calc-var-mul")).toStrictEqual({ width: 300 });
  expect(renderClass("calc-var-pct")).toStrictEqual({ width: "30%" });
  expect(renderClass("calc-in-var")).toStrictEqual({ width: 30 });
});

test("calc() division by zero produces an empty style rather than no style", () => {
  registerCSS(`
    .calc-div0 { width: calc(100px / 0); }
    .calc-div0-zero { width: calc(0px / 0); }
  `);

  // css-values-4 §10.1 makes division by zero a parse-time error, so dropping
  // the declaration is right. Note the SHAPE differs from every other drop in
  // this file: the style object is created and left empty, because the value
  // only fails at runtime inside the calc evaluator.
  expect(renderClass("calc-div0")).toStrictEqual({});
  expect(renderClass("calc-div0-zero")).toStrictEqual({});
});

test("calc(infinity * 1px) clamps to the safe-integer ceiling", () => {
  registerCSS(`.calc-inf { border-radius: calc(infinity * 1px); }`);

  // Number.MAX_SAFE_INTEGER, then passed through the 2-dp rounder, which costs
  // the last digit: 9007199254740991 -> 9007199254740990.
  expect(renderClass("calc-inf")).toStrictEqual({
    borderRadius: 9007199254740990,
  });
});

/* -------------------------------------------------------------------------- */
/* min() / max() / clamp() — css-values-4 §10.2                               */
/* -------------------------------------------------------------------------- */

test("min / max / clamp over same-unit arguments", () => {
  registerCSS(`
    .cmp-min { width: min(10px, 20px); }
    .cmp-max { width: max(10px, 20px); }
    .cmp-clamp { width: clamp(10px, 15px, 20px); }
    .cmp-min-one { width: min(10px); }
    .cmp-max-three { width: max(1px, 5px, 3px); }
    .cmp-min-rem { width: min(10px, 2rem); }
    .cmp-min-calc { width: min(calc(5px + 5px), 20px); }
    .cmp-in-calc { width: calc(10px + min(5px, 8px)); }
  `);

  expect(renderClass("cmp-min")).toStrictEqual({ width: 10 });
  expect(renderClass("cmp-max")).toStrictEqual({ width: 20 });
  expect(renderClass("cmp-clamp")).toStrictEqual({ width: 15 });
  expect(renderClass("cmp-min-one")).toStrictEqual({ width: 10 });
  expect(renderClass("cmp-max-three")).toStrictEqual({ width: 5 });
  expect(renderClass("cmp-min-rem")).toStrictEqual({ width: 10 });
  expect(renderClass("cmp-min-calc")).toStrictEqual({ width: 10 });
  expect(renderClass("cmp-in-calc")).toStrictEqual({ width: 15 });
});

test("min / max / clamp are dropped whenever an argument needs the device", () => {
  const compiled = registerCSS(`
    .cmp-pct-min { width: min(10px, 50%); }
    .cmp-pct-max { width: max(10%, 20px); }
    .cmp-pct-clamp { width: clamp(10px, 50%, 20px); }
    .cmp-vw { width: max(10px, 10vw); }
    .cmp-em { font-size: 10px; height: min(3em, 100px); }
  `);

  // `min(10px, 50%)` is genuinely unrepresentable in React Native. The other
  // three are not:
  // GAP: css-values-4 §10.2 — `max(10px, 10vw)` is 75 and `min(3em, 100px)` is
  // 30, both plain numbers. A literal viewport or font-relative argument takes
  // the whole function down because lightningcss cannot fold it and
  // `parseLength` treats any surviving math function as an unsupported calc.
  // The var()-carrying forms below prove the runtime resolver could do it.
  expect(renderClass("cmp-pct-min")).toBeUndefined();
  expect(renderClass("cmp-pct-max")).toBeUndefined();
  expect(renderClass("cmp-pct-clamp")).toBeUndefined();
  expect(renderClass("cmp-vw")).toBeUndefined();
  expect(renderClass("cmp-em")).toStrictEqual({ fontSize: 10 });
  expect(compiled.warnings()).toStrictEqual({});
});

test("min / max / clamp DO evaluate at runtime once a var() is involved", () => {
  registerCSS(`
    .cmp-var-min { --cm-a: 10px; width: min(var(--cm-a), 20px); }
    .cmp-var-max { --cm-b: 10px; width: max(var(--cm-b), 20px); }
    .cmp-var-clamp { --cm-c: 15px; width: clamp(10px, var(--cm-c), 20px); }
    .cmp-var-pct { --cm-d: 10%; width: min(var(--cm-d), 20%); }
  `);

  expect(renderClass("cmp-var-min")).toStrictEqual({ width: 10 });
  expect(renderClass("cmp-var-max")).toStrictEqual({ width: 20 });
  expect(renderClass("cmp-var-clamp")).toStrictEqual({ width: 15 });
  expect(renderClass("cmp-var-pct")).toStrictEqual({ width: "10%" });
});

test("a viewport unit inside min() is dropped even behind a var()", () => {
  const compiled = registerCSS(`
    .cmp-var-vw { --cm-e: 10vw; width: min(var(--cm-e), 20px); }
    .cmp-var-vw2 { --cm-f: 50px; --cm-g: 10vw; width: min(var(--cm-f), var(--cm-g)); }
  `);

  // GAP: css-values-4 §10.2 + §5.3. Both are 50 (10vw is 75). The variable
  // inliner substitutes the literal `10vw` back into the function BEFORE the
  // second compiler pass, so the declaration re-parses as a length-valued
  // math function and `parseLength` drops it — the runtime `min` resolver,
  // which handles the `--cm-a` case above, is never reached.
  expect(renderClass("cmp-var-vw")).toBeUndefined();
  expect(renderClass("cmp-var-vw2")).toBeUndefined();
  expect(compiled.warnings()).toStrictEqual({});
});

test("clamp() agrees with the spec on both routes when min exceeds max", () => {
  registerCSS(`
    .cmp-inv-static { width: clamp(30px, 15px, 20px); }
    .cmp-inv-var { --cm-h: 15px; width: clamp(30px, var(--cm-h), 20px); }
  `);

  // css-values-4 §10.2: "clamp(MIN, VAL, MAX) is equivalent to
  // max(MIN, min(VAL, MAX))", so when MIN > MAX the MIN wins.
  //
  // The runtime resolver computed `Math.min(Math.max(a, b), c)` over the
  // arguments in source order, which is `min(max(MIN, VAL), MAX)` — MAX wins
  // instead. The same declaration therefore answered 30 or 20 depending only on
  // whether a `var()` forced it down the runtime path.
  expect(renderClass("cmp-inv-static")).toStrictEqual({ width: 30 });
  expect(renderClass("cmp-inv-var")).toStrictEqual({ width: 30 });
});

/* -------------------------------------------------------------------------- */
/* round() / mod() / rem() / abs() / sign() — css-values-4 §10.3 and §10.6    */
/* -------------------------------------------------------------------------- */

test("round() honours every rounding strategy", () => {
  registerCSS(`
    .stp-round { width: round(10.4px, 1px); }
    .stp-round-half { width: round(10.5px, 1px); }
    .stp-round-up { width: round(up, 10.1px, 1px); }
    .stp-round-down { width: round(down, 10.9px, 1px); }
    .stp-round-zero { top: round(to-zero, -10.9px, 1px); }
  `);

  expect(renderClass("stp-round")).toStrictEqual({ width: 10 });
  expect(renderClass("stp-round-half")).toStrictEqual({ width: 11 });
  expect(renderClass("stp-round-up")).toStrictEqual({ width: 11 });
  expect(renderClass("stp-round-down")).toStrictEqual({ width: 10 });
  expect(renderClass("stp-round-zero")).toStrictEqual({ top: -10 });
});

test("mod() and rem() differ in sign exactly as the spec requires", () => {
  registerCSS(`
    .stp-mod { width: mod(18px, 5px); }
    .stp-mod-neg { top: mod(-18px, 5px); }
    .stp-rem { width: rem(18px, 5px); }
    .stp-rem-neg { top: rem(-18px, 5px); }
  `);

  expect(renderClass("stp-mod")).toStrictEqual({ width: 3 });
  // mod() takes the sign of the DIVISOR: -18 mod 5 = 2.
  expect(renderClass("stp-mod-neg")).toStrictEqual({ top: 2 });
  expect(renderClass("stp-rem")).toStrictEqual({ width: 3 });
  // rem() takes the sign of the DIVIDEND: -18 rem 5 = -3.
  expect(renderClass("stp-rem-neg")).toStrictEqual({ top: -3 });
});

test("abs() and sign() over literal lengths", () => {
  registerCSS(`
    .stp-abs { width: abs(-10px); }
    .stp-sign-neg { top: sign(-10px); }
    .stp-sign-pos { width: sign(10px); }
    .stp-sign-calc { width: calc(sign(-10px) * 1px); }
  `);

  expect(renderClass("stp-abs")).toStrictEqual({ width: 10 });
  expect(renderClass("stp-sign-neg")).toStrictEqual({ top: -1 });
  expect(renderClass("stp-sign-pos")).toStrictEqual({ width: 1 });
  expect(renderClass("stp-sign-calc")).toStrictEqual({ width: -1 });
});

test("abs() of a percentage is dropped", () => {
  const compiled = registerCSS(`.stp-abs-pct { width: abs(-10%); }`);

  // GAP: css-values-4 §10.6 — `abs(-10%)` is `10%`, which React Native
  // expresses directly as the string "10%" (the plain `width: 10%` case above
  // proves it). The declaration is dropped, silently.
  expect(renderClass("stp-abs-pct")).toBeUndefined();
  expect(compiled.warnings()).toStrictEqual({});
});

test("only abs() survives a var(); sign(), round() and mod() are dropped", () => {
  const compiled = registerCSS(`
    .stp-var-abs { --sv-a: -10px; width: abs(var(--sv-a)); }
    .stp-var-sign { --sv-b: -10px; width: sign(var(--sv-b)); }
    .stp-var-sign-top { --sv-e: -10px; top: sign(var(--sv-e)); }
    .stp-var-round { --sv-c: 10.4px; width: round(var(--sv-c), 1px); }
    .stp-var-mod { --sv-d: 18px; height: mod(var(--sv-d), 5px); }
  `);

  expect(renderClass("stp-var-abs")).toStrictEqual({ width: 10 });
  // GAP: css-values-4 §10.3 and §10.6 — every one of these four has a literal
  // twin earlier in this file that produces the number: `sign(-10px)` is -1,
  // `round(10.4px, 1px)` is 10, `mod(18px, 5px)` is 3. Only `abs()` survives
  // the trip through a variable.
  //
  // The compile-time variable inliner substitutes the value and appends a
  // whitespace token, so the re-serialised CSS reads `round(10.4px , 1px)`.
  // Whitespace before a comma is legal in the §10 grammar, but it defeats the
  // simplifier: the second compiler pass hands back an unrecognised function
  // (hence the `round()` / `mod()` warnings) instead of a length. `sign()`
  // fails for a different reason again — it simplifies to a UNITLESS number,
  // which is not a `<length-percentage>`, so the declaration is discarded with
  // no warning at all. The math-function set that works therefore depends on
  // whether a var() is in the expression, which is not a distinction CSS makes.
  expect(renderClass("stp-var-sign")).toBeUndefined();
  expect(renderClass("stp-var-sign-top")).toBeUndefined();
  expect(renderClass("stp-var-round")).toBeUndefined();
  expect(renderClass("stp-var-mod")).toBeUndefined();
  expect(compiled.warnings()).toStrictEqual({
    values: { width: ["round()"], height: ["mod()"] },
  });
});
