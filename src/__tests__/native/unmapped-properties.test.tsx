import { render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

/**
 * Style properties React Native supports that were previously dropped.
 *
 * Each of these compiled to nothing — the declaration parsed, produced no
 * style, and in most cases not even a warning. They were found by compiling a
 * broad set of declarations and recording which resolved to nothing, then
 * cross-checking each against React Native's own `StyleSheetTypes`; the ones
 * React Native cannot express (`text-indent`, `white-space`, `word-break`,
 * `will-change`) are correctly still absent.
 */

// `cursor` is deliberately absent: upstream PR #346 ("feat: add cursor CSS
// property support") is open and covers it. Adding it here would duplicate
// someone else's in-flight work.

test("isolation", () => {
  registerCSS(`.a { isolation: isolate; }`);

  const component = render(<View testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ isolation: "isolate" });
});

test("mix-blend-mode", () => {
  registerCSS(`.a { mix-blend-mode: multiply; }`);

  const component = render(<View testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ mixBlendMode: "multiply" });
});

test("an unsupported mix-blend-mode keyword warns rather than emitting garbage", () => {
  const compiled = registerCSS(`.a { mix-blend-mode: plus-darker; }`);
  // React Native's `BlendMode` union has no `plus-darker`; passing it through
  // would be a value React Native rejects at runtime. `plus-lighter`, which it
  // DOES carry, is asserted in `modern-rn-capabilities.test.tsx`.
  expect(compiled).toBeDefined();

  const component = render(<View testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toBeUndefined();
});

test("font-variant-numeric maps to React Native's fontVariant array", () => {
  // React Native types `fontVariant` as `FontVariant[]`, and its union
  // contains four of this property's keywords.
  registerCSS(`.fvn { font-variant-numeric: tabular-nums; }`);

  const component = render(
    <Text testID={testID} className="fvn" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    fontVariant: ["tabular-nums"],
  });
});

test("every React-Native-expressible numeric keyword maps", () => {
  const keywords = [
    "lining-nums",
    "oldstyle-nums",
    "proportional-nums",
    "tabular-nums",
  ];

  keywords.forEach((keyword, index) => {
    registerCSS(`.fvn${index} { font-variant-numeric: ${keyword}; }`);

    const component = render(
      <Text testID={testID} className={`fvn${index}`} />,
    ).getByTestId(testID);

    expect(component.props.style).toStrictEqual({ fontVariant: [keyword] });
  });
});

test("a numeric keyword React Native cannot express is not emitted", () => {
  // `ordinal`, `slashed-zero` and the fraction keywords have no `FontVariant`
  // equivalent, so they must not reach React Native as values it ignores.
  const keywords = ["ordinal", "slashed-zero", "diagonal-fractions"];

  keywords.forEach((keyword, index) => {
    registerCSS(`.fvx${index} { font-variant-numeric: ${keyword}; }`);

    const component = render(
      <Text testID={testID} className={`fvx${index}`} />,
    ).getByTestId(testID);

    expect(component.props.style).toBeUndefined();
  });
});

test("a mixed list keeps the expressible keywords and drops the rest", () => {
  // The spec permits one keyword per sub-group at once. The half React Native
  // can render must survive rather than the whole declaration being lost.
  registerCSS(`.fvm { font-variant-numeric: ordinal tabular-nums; }`);

  const component = render(
    <Text testID={testID} className="fvm" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    fontVariant: ["tabular-nums"],
  });
});

test("font-variant-numeric is case-insensitive", () => {
  // CSS keywords are ASCII case-insensitive, and the emitted value must be the
  // canonical spelling React Native expects.
  registerCSS(`.fvc { font-variant-numeric: TABULAR-NUMS; }`);

  const component = render(
    <Text testID={testID} className="fvc" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    fontVariant: ["tabular-nums"],
  });
});

test("font-variant-numeric: normal emits the empty variant list", () => {
  // `normal` means "no numeric variants", which React Native spells as the
  // empty list — `fontVariant` being `FontVariant[]`. That is what cancels a
  // variant the element would otherwise inherit from an ancestor, so it is a
  // declaration with an effect rather than a no-op.
  registerCSS(`.fvnorm { font-variant-numeric: normal; }`);

  const component = render(
    <Text testID={testID} className="fvnorm" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ fontVariant: [] });
});

test("font-variant emits an array, not a bare string", () => {
  // React Native types `fontVariant` as `FontVariant[]`; a bare string is not
  // the documented shape.
  registerCSS(`.fvcaps { font-variant: small-caps; }`);

  const component = render(
    <Text testID={testID} className="fvcaps" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ fontVariant: ["small-caps"] });
});

test("transform-origin", () => {
  registerCSS(`.a { transform-origin: 10px 20px; }`);

  const component = render(<View testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ transformOrigin: [10, 20, 0] });
});

test("transform-origin in percentages", () => {
  registerCSS(`.a { transform-origin: 25% 75%; }`);

  const component = render(<View testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({
    transformOrigin: ["25%", "75%", 0],
  });
});

test("a zero percentage stays a percentage", () => {
  // `0%` and `0` are the same position and React Native accepts either form,
  // so which one is emitted is a spelling choice — and the percentage is the
  // spelling it renders correctly. `asOriginComponent` in
  // `compiler/declarations.ts` carries the device measurement behind that.
  registerCSS(`.a { transform-origin: 0% 100%; }`);

  const component = render(<View testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({
    transformOrigin: ["0%", "100%", 0],
  });
});

test("transform-origin side keywords resolve to the percentage they mean", () => {
  // React Native has no keyword form, so `left top` must become 0% 0%.
  registerCSS(`.a { transform-origin: left top; }`);

  const component = render(<View testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({
    transformOrigin: ["0%", "0%", 0],
  });
});

test("transform-origin right/bottom keywords resolve to 100%", () => {
  registerCSS(`.a { transform-origin: right bottom; }`);

  const component = render(<View testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({
    transformOrigin: ["100%", "100%", 0],
  });
});

test("transform-origin center", () => {
  registerCSS(`.a { transform-origin: center; }`);

  const component = render(<View testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({
    transformOrigin: ["50%", "50%", 0],
  });
});

test("transform-origin coexists with a transform", () => {
  registerCSS(`.a { transform-origin: 25% 75%; transform: scale(2); }`);

  const component = render(<View testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({
    transformOrigin: ["25%", "75%", 0],
    transform: [{ scaleX: 2 }, { scaleY: 2 }],
  });
});
