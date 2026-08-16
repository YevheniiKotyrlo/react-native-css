import { render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

/**
 * What this library emits for a CSS feature React Native has NOT implemented.
 *
 * The rule is that a gap in React Native is a caveat, never a reason to drop the
 * declaration. A compiler that narrows CSS to whatever the target supports today
 * can never carry a feature the moment the target adds it, and it hides the gap
 * from the one person positioned to report it — so the faithful value is emitted
 * and left inert.
 *
 * There are exactly three exceptions, and they share one narrow shape: emitting
 * the faithful value would REPLACE a rendering that works with one React Native
 * cannot read. Then the library keeps what renders and WARNS about what it
 * dropped, so the loss is visible rather than silent. `border-radius`'s
 * elliptical form, `text-shadow`'s shadow list and `font-family`'s fallback
 * stack are the three; each is asserted below WITH its warning, because a
 * narrowing without a diagnostic is the failure this whole file exists to
 * prevent.
 *
 * Every "React Native has no such key" claim here is checked against React
 * Native's own source rather than its documentation:
 *
 *     grep -rl "\bvisibility\b" node_modules/react-native/{Libraries,React,ReactCommon}
 *
 * and the type declarations in `Libraries/StyleSheet/StyleSheetTypes.d.ts`. The
 * counts are recorded in `contributions/120-react-native-capability-gaps.md`.
 */

function styleOf(className: string): Record<string, unknown> | undefined {
  return render(<View testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style as Record<string, unknown> | undefined;
}

/** The same, on a `<Text>`, for the `TextStyle` half of the surface. */
function styleOfText(className: string): Record<string, unknown> | undefined {
  return render(<Text testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style as Record<string, unknown> | undefined;
}

/* -------------------------------------------------------------------------
 * visibility — React Native has no such key at all
 * ---------------------------------------------------------------------- */

test("visibility emits the property itself, beside the approximation that renders", () => {
  registerCSS(`
    .cgf-hidden { visibility: hidden; }
    .cgf-visible { visibility: visible; }
    .cgf-collapse { visibility: collapse; }
  `);

  // `visibility` is the faithful key and is inert today. `opacity` +
  // `pointerEvents` is what actually hides the element — BOTH halves, because
  // `opacity: 0` alone leaves it fully hit-testable, so a hidden button still
  // takes taps.
  expect(styleOf("cgf-hidden")).toStrictEqual({
    visibility: "hidden",
    opacity: 0,
    pointerEvents: "none",
  });

  expect(styleOf("cgf-visible")).toStrictEqual({
    visibility: "visible",
    opacity: 1,
    pointerEvents: "auto",
  });

  // `collapse` collapses a table row or column and falls back to `hidden`
  // everywhere else — which is everywhere React Native has. The faithful key
  // still carries the author's actual word.
  expect(styleOf("cgf-collapse")).toStrictEqual({
    visibility: "collapse",
    opacity: 0,
    pointerEvents: "none",
  });
});

/* -------------------------------------------------------------------------
 * border-style — React Native has ONE key for all four edges
 * ---------------------------------------------------------------------- */

test("four differing border styles reach the four per-edge keys", () => {
  const compiled = registerCSS(`
    .cgf-bs-four { border-style: solid dashed dotted solid; }
  `);

  // React Native's `borderStyle` is a single `'solid' | 'dotted' | 'dashed'`,
  // so there is nothing here that can hold four edges. The per-edge names are
  // emitted anyway. Collapsing to one edge's style instead would be silently
  // wrong on the other three, which is worse than inert.
  expect(styleOf("cgf-bs-four")).toStrictEqual({
    borderTopStyle: "solid",
    borderRightStyle: "dashed",
    borderBottomStyle: "dotted",
    borderLeftStyle: "solid",
  });

  // The shorthand key gets nothing: a single value there would be a claim about
  // all four edges that the declaration did not make.
  expect(styleOf("cgf-bs-four")).not.toHaveProperty("borderStyle");

  // Every edge is expressible, so nothing is rejected.
  expect(compiled.warnings()).toStrictEqual({});
});

test("a uniform border style still reaches the single key React Native renders", () => {
  registerCSS(`
    .cgf-bs-one { border-style: solid; }
    .cgf-bs-same { border-style: dashed dashed dashed dashed; }
  `);

  // The four-value form whose edges AGREE is the same declaration as the
  // one-value form, so both take the key that renders.
  expect(styleOf("cgf-bs-one")).toStrictEqual({ borderStyle: "solid" });
  expect(styleOf("cgf-bs-same")).toStrictEqual({ borderStyle: "dashed" });
});

test("a border style CSS defines and React Native cannot render is reported", () => {
  const compiled = registerCSS(`
    .cgf-bs-bad { border-style: solid double groove ridge; }
  `);

  // `double`, `groove` and `ridge` are real CSS and outside React Native's
  // three-value union, so the edges that CAN be expressed are, and the rest are
  // named. A rejected edge does not discard the ones beside it.
  expect(styleOf("cgf-bs-bad")).toStrictEqual({ borderTopStyle: "solid" });

  expect(compiled.warnings()).toStrictEqual({
    values: {
      "border-right-style": ["double"],
      "border-bottom-style": ["groove"],
      "border-left-style": ["ridge"],
    },
  });
});

/* -------------------------------------------------------------------------
 * border-radius — React Native has no elliptical corner
 * ---------------------------------------------------------------------- */

test("an elliptical border-radius keeps the horizontal radius and reports the vertical", () => {
  const compiled = registerCSS(`
    .cgf-br-ellipse { border-radius: 10px / 20px; }
  `);

  // The narrowing case. `borderTopLeftRadius` and its siblings take ONE value,
  // so every corner in React Native is a circular arc — css-backgrounds-3 §5.1's
  // elliptical form has no representation. The horizontal radius is kept
  // because it renders; emitting the faithful pair would round nothing at all.
  expect(styleOf("cgf-br-ellipse")).toStrictEqual({ borderRadius: 10 });

  // ONCE. All four corners carry the same pair, which is one narrowing of one
  // declaration — reporting it four times would say the same thing four times
  // and name longhands nobody typed. `parseBorderStyle` reports a uniform
  // unsupported value the same way, for the same reason.
  expect(compiled.warnings()).toStrictEqual({
    values: { "border-radius": ["10 / 20"] },
  });
});

test("corners that narrow differently are each reported", () => {
  const compiled = registerCSS(`
    .cgf-br-mixed { border-radius: 10px 20px / 30px 40px; }
  `);

  // The other half of the rule above: here every corner loses a DIFFERENT
  // vertical radius, so four reports are four facts rather than one repeated.
  expect(compiled.warnings()).toStrictEqual({
    values: {
      "border-radius": ["20 / 40", "10 / 30", "10 / 30", "20 / 40"],
    },
  });
});

test("a circular border-radius narrows nothing and says nothing", () => {
  const compiled = registerCSS(`
    .cgf-br-one { border-radius: 10px; }
    .cgf-br-corners { border-radius: 1px 2px 3px 4px; }
  `);

  expect(styleOf("cgf-br-one")).toStrictEqual({ borderRadius: 10 });
  expect(styleOf("cgf-br-corners")).toStrictEqual({
    borderTopLeftRadius: 1,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 3,
    borderBottomLeftRadius: 4,
  });

  // The `x / y` form is what triggers the warning, not the presence of four
  // corners — so the ordinary spelling stays quiet.
  expect(compiled.warnings()).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * The logical border longhands — React Native has the physical twins only
 * ---------------------------------------------------------------------- */

test("a logical border property maps to the React Native key that means the same thing", () => {
  registerCSS(`
    .cgf-logical-axis { border-inline-color: red; }
    .cgf-logical-edge { border-inline-start-color: red; }
  `);

  // The rule is whether React Native HAS a target, not whether the CSS name is
  // logical. `borderStartColor` and `borderEndColor` exist (9 files each), and
  // the inline AXIS sets both inline edges — a direction-INVARIANT set, because
  // {inline-start, inline-end} = {start, end} whichever way the direction runs.
  // So the mapping is correct under RTL, which React Native supports, and the
  // declaration renders.
  //
  // There is no axis-level key to collapse into (`borderInlineColor` is absent),
  // so two equal edges stay two keys.
  expect(styleOf("cgf-logical-axis")).toStrictEqual({
    borderStartColor: "#f00",
    borderEndColor: "#f00",
  });

  expect(styleOf("cgf-logical-edge")).toStrictEqual({
    borderStartColor: "#f00",
  });
});

test("a logical border STYLE is dropped, because nothing maps to it", () => {
  registerCSS(`
    .cgf-logical-style { border-inline-style: dashed; }
  `);

  // The other half of the same rule, and the point where the two halves
  // diverge. A logical COLOUR has a key React Native reads, so it is renamed
  // onto it. A per-edge STYLE has none at any layer — not in
  // `ReactNativeStyleAttributes`, not in either `BaseViewConfig`, not in
  // `ViewStyle` — so there is nothing to rename onto and the declaration is
  // dropped with a warning instead. Emitting the faithful CSS key is the third
  // option and the wrong one: it puts an entry into the style object that reads
  // exactly like a live declaration and renders nothing, so a reader has no way
  // to tell the gap from a working style.
  expect(styleOf("cgf-logical-style")).toBeUndefined();
});

test("a logical SIZE is renamed to the physical key, because there it is the same property", () => {
  registerCSS(`
    .cgf-size { block-size: 10px; inline-size: 20px; }
  `);

  expect(styleOf("cgf-size")).toStrictEqual({ height: 10, width: 20 });
});

/* -------------------------------------------------------------------------
 * text-shadow — React Native has one shadow, not a list
 * ---------------------------------------------------------------------- */

test("a multi-shadow text-shadow keeps the first and reports the rest", () => {
  const compiled = registerCSS(`
    .cgf-ts-multi { text-shadow: 1px 1px 2px red, 0 0 4px blue; }
  `);

  // The second narrowing case. `textShadowColor` / `textShadowOffset` /
  // `textShadowRadius` are three SCALARS, so a list has nowhere to go —
  // `boxShadow` and `filter` in the same file are both lists, which is what
  // makes this a hole in React Native rather than a considered limit.
  expect(styleOfText("cgf-ts-multi")).toStrictEqual({
    textShadowColor: "#f00",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  });

  expect(compiled.warnings()).toStrictEqual({
    values: { "text-shadow": ["0px 0px 4px"] },
  });
});

test("a single text-shadow narrows nothing and says nothing", () => {
  const compiled = registerCSS(`
    .cgf-ts-one { text-shadow: 1px 1px 2px red; }
  `);

  expect(styleOfText("cgf-ts-one")).toStrictEqual({
    textShadowColor: "#f00",
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  });
  expect(compiled.warnings()).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * font-family — React Native has one family, not a fallback stack
 * ---------------------------------------------------------------------- */

test("a font-family stack keeps the first family and says nothing", () => {
  const compiled = registerCSS(`
    .cgf-ff-stack { font-family: Georgia, "Times New Roman", serif; }
  `);

  // The third narrowing case, and the one with the widest reach: the fallback
  // stack is the whole point of `font-family`, and `TextStyle.fontFamily` is a
  // `string`, so every stack reduces to one family.
  expect(styleOfText("cgf-ff-stack")).toStrictEqual({ fontFamily: "Georgia" });

  // Silently, unlike the other capability gaps in this file. A warning names
  // something the author can correct, and this one cannot be: React Native
  // holds one family at any value, so the fallbacks are not a mistake in the
  // stylesheet. `compiler/font-family.test.ts` carries the same assertion for
  // every stack spelling.
  expect(compiled.warnings()).toStrictEqual({});
});

test("a single font family narrows nothing and says nothing", () => {
  const compiled = registerCSS(`.cgf-ff-one { font-family: Georgia; }`);

  expect(styleOfText("cgf-ff-one")).toStrictEqual({ fontFamily: "Georgia" });
  expect(compiled.warnings()).toStrictEqual({});
});
