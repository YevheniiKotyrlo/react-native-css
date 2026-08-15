import { render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

/**
 * Syntax conformance for the properties this branch adds or repairs.
 *
 * Each property is exercised across the value forms its spec permits, not just
 * the one form the implementation was written against — a parser that handles
 * the example in the commit message and nothing else is the failure mode this
 * file exists to catch.
 *
 * The default rem in tests is 14.
 */

/**
 * Each call registers under a FRESH class name.
 *
 * Re-registering the same selector inside one test does not replace the
 * previous rule, so a helper that always used `.a` silently measured the FIRST
 * declaration for every later assertion in the same test — which read as the
 * implementation being wrong when the harness was.
 */
let probeCounter = 0;

const styleOf = (_className: string, css: string) => {
  probeCounter += 1;
  const probeClass = `probe${probeCounter}`;
  registerCSS(css.replaceAll(".a ", `.${probeClass} `));
  return render(<View testID={testID} className={probeClass} />).getByTestId(
    testID,
  ).props.style as unknown;
};

const textStyleOf = (_className: string, css: string) => {
  probeCounter += 1;
  const probeClass = `probe${probeCounter}`;
  registerCSS(css.replaceAll(".a ", `.${probeClass} `));
  return render(<Text testID={testID} className={probeClass} />).getByTestId(
    testID,
  ).props.style as unknown;
};

/* -------------------------------------------------------------------------- */
/* transform-origin — css-transforms-1 §, <position> syntax                   */
/* -------------------------------------------------------------------------- */

test("transform-origin: a single length fills the y axis with the center", () => {
  // Per spec a one-value form sets x; y defaults to `center`.
  expect(styleOf("a", `.a { transform-origin: 10px; }`)).toStrictEqual({
    transformOrigin: [10, "50%", 0],
  });
});

test("transform-origin: a single keyword", () => {
  expect(styleOf("a", `.a { transform-origin: left; }`)).toStrictEqual({
    transformOrigin: ["0%", "50%", 0],
  });
});

test("transform-origin: keywords in reverse order are still valid", () => {
  // `top left` is as valid as `left top`; lightningcss normalises the axes.
  expect(styleOf("a", `.a { transform-origin: top left; }`)).toStrictEqual({
    transformOrigin: ["0%", "0%", 0],
  });
});

test("transform-origin: mixed keyword and length", () => {
  expect(styleOf("a", `.a { transform-origin: right 12px; }`)).toStrictEqual({
    transformOrigin: ["100%", 12, 0],
  });
});

test("transform-origin: negative lengths are legal", () => {
  expect(styleOf("a", `.a { transform-origin: -10px -20px; }`)).toStrictEqual({
    transformOrigin: [-10, -20, 0],
  });
});

test("transform-origin: rem resolves against the root font size", () => {
  expect(styleOf("a", `.a { transform-origin: 1rem 2rem; }`)).toStrictEqual({
    transformOrigin: [14, 28, 0],
  });
});

test("transform-origin: is case-insensitive", () => {
  // CSS keywords are ASCII case-insensitive.
  expect(styleOf("a", `.a { TRANSFORM-ORIGIN: LEFT TOP; }`)).toStrictEqual({
    transformOrigin: ["0%", "0%", 0],
  });
});

/* -------------------------------------------------------------------------- */
/* font-variant-numeric — css-fonts-4 §6.5                                    */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* mix-blend-mode / isolation — css-compositing-1                             */
/* -------------------------------------------------------------------------- */

test("mix-blend-mode: every React Native blend mode is accepted", () => {
  for (const mode of [
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
  ]) {
    expect(styleOf("a", `.a { mix-blend-mode: ${mode}; }`)).toStrictEqual({
      mixBlendMode: mode,
    });
  }
});

test("mix-blend-mode: a CSS mode React Native lacks is rejected", () => {
  // `plus-darker` is the one CSS blend mode absent from React Native's
  // `blendModeFromString`. `plus-lighter` is present, and is asserted in
  // `modern-rn-capabilities.test.tsx`.
  expect(styleOf("a", `.a { mix-blend-mode: plus-darker; }`)).toBeUndefined();
});

test("isolation: isolate", () => {
  expect(styleOf("a", `.a { isolation: isolate; }`)).toStrictEqual({
    isolation: "isolate",
  });
});

test("isolation: auto compiles, being the only way to switch isolation off", () => {
  // `auto` is `isolation`'s initial value AND half of React Native's
  // `isolation?: 'auto' | 'isolate'` union. It is the only spelling that undoes
  // an `isolate` set by an earlier rule, so it is emitted rather than elided.
  expect(styleOf("a", `.a { isolation: auto; }`)).toStrictEqual({
    isolation: "auto",
  });
});

/* -------------------------------------------------------------------------- */
/* line-height — css-inline-3                                                 */
/* -------------------------------------------------------------------------- */

test("line-height: every unit form", () => {
  // A unitless number multiplies the font size; a length is absolute.
  expect(textStyleOf("a", `.a { line-height: 1.5; }`)).toStrictEqual({
    lineHeight: 21,
  });
  expect(textStyleOf("a", `.a { line-height: 32px; }`)).toStrictEqual({
    lineHeight: 32,
  });
  expect(textStyleOf("a", `.a { line-height: 2rem; }`)).toStrictEqual({
    lineHeight: 28,
  });
  expect(textStyleOf("a", `.a { line-height: normal; }`)).toBeUndefined();
});

test("line-height: an integer multiplier, not just a decimal", () => {
  expect(textStyleOf("a", `.a { line-height: 2; }`)).toStrictEqual({
    lineHeight: 28,
  });
});

test("line-height: resolves against the element's own font-size where both are set", () => {
  // `em` for a declaration is the element's OWN font size in CSS. The
  // multiplier must not silently fall back to the root rem when a font-size is
  // present on the same rule.
  expect(
    textStyleOf("a", `.a { font-size: 24px; line-height: 1.5; }`),
  ).toStrictEqual({ fontSize: 24, lineHeight: 36 });
});

/* -------------------------------------------------------------------------- */
/* the `font` shorthand — css-fonts-4 §6.9                                    */
/* -------------------------------------------------------------------------- */

test("font shorthand: size/line-height pair", () => {
  // The shorthand's unitless line-height resolves against the size declared
  // in the SAME shorthand (1.5 x 24), matching what the equivalent longhands
  // produce. It previously fell back to the root rem and gave 21, because
  // `parseFont` did not publish `--__rn-css-em` the way the `font-size`
  // longhand does.
  expect(textStyleOf("a", `.a { font: 24px/1.5 Arial; }`)).toStrictEqual(
    expect.objectContaining({
      fontSize: 24,
      fontFamily: "Arial",
      lineHeight: 36,
    }),
  );
});

test("font shorthand: style and weight before the size", () => {
  expect(textStyleOf("a", `.a { font: italic 700 24px Arial; }`)).toStrictEqual(
    expect.objectContaining({
      fontStyle: "italic",
      fontWeight: 700,
      fontSize: 24,
      fontFamily: "Arial",
    }),
  );
});
