import { render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { colorScheme } from "react-native-css/runtime";

/**
 * `line-height` beyond the happy path.
 *
 * `line-height.test.tsx` covers the four canonical forms; this file covers the
 * value space around them — zero, negatives, `em`, `calc()`, percentages, the
 * CSS-wide keywords — plus the two places the property is resolved by something
 * other than `parseLineHeight`: the `font` shorthand, and the runtime
 * `lineHeight` style function that any un-inlinable `var()` falls through to.
 *
 * Semantics under test: a UNITLESS line-height multiplies the font size, a
 * LENGTH is absolute. The default rem in tests is 14, and the default test
 * window is 750px wide.
 */

/**
 * CSS for a variable the compiler CANNOT inline.
 *
 * `inlineVariables` only substitutes a variable defined exactly once
 * (`info.count !== 1` deletes it from the inlining map). A dark-scheme override
 * — the most ordinary reason a design token is written twice — leaves the
 * `var()` in the declaration for the runtime to resolve, which is what selects
 * the defective code path exercised in the last section.
 */
const twoDefinitions = (name: string, light: string, dark: string) =>
  `:root { ${name}: ${light}; }
   @media (prefers-color-scheme: dark) { :root { ${name}: ${dark}; } }`;

/* -------------------------------------------------------------------------- */
/* Value forms                                                                */
/* -------------------------------------------------------------------------- */

test("zero is kept in both forms, not treated as absent", () => {
  registerCSS(
    `.zero-number { line-height: 0; } .zero-length { line-height: 0px; }`,
  );

  const number = render(
    <Text testID={testID} className="zero-number" />,
  ).getByTestId(testID);
  const length = render(
    <Text testID={testID} className="zero-length" />,
  ).getByTestId(testID);

  expect(number.props.style).toStrictEqual({ lineHeight: 0 });
  expect(length.props.style).toStrictEqual({ lineHeight: 0 });
});

test("a negative multiplier and a negative length both survive to the style", () => {
  // CSS rejects a negative line-height, but nothing in the pipeline clamps it,
  // so the value React Native receives is the one the author wrote. Pinned so a
  // future clamp is a deliberate change rather than a silent one.
  registerCSS(
    `.neg-number { line-height: -1.5; } .neg-length { line-height: -10px; }`,
  );

  const number = render(
    <Text testID={testID} className="neg-number" />,
  ).getByTestId(testID);
  const length = render(
    <Text testID={testID} className="neg-length" />,
  ).getByTestId(testID);

  expect(number.props.style).toStrictEqual({ lineHeight: -21 });
  expect(length.props.style).toStrictEqual({ lineHeight: -10 });
});

test("an em line-height resolves against the element's own font size", () => {
  registerCSS(`.a { font-size: 20px; line-height: 1.5em; }`);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ fontSize: 20, lineHeight: 30 });
});

test("an em line-height with no font size in scope falls back to the rem", () => {
  registerCSS(`.a { line-height: 1.5em; }`);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ lineHeight: 21 });
});

test("calc() reaches the style as a plain value, in every mix of units", () => {
  // lightningcss simplifies calc during its own parse, so `parseLineHeight`
  // never sees the `calc` branch it warns on — a length arrives as a dimension
  // and a pure ratio arrives as a number, keeping the unitless-multiplies /
  // length-is-absolute split intact.
  registerCSS(`
    .calc-mixed { line-height: calc(1rem + 4px); }
    .calc-length { line-height: calc(10px + 12px); }
    .calc-ratio { line-height: calc(2 * 1.5); }
  `);

  const mixed = render(
    <Text testID={testID} className="calc-mixed" />,
  ).getByTestId(testID);
  const length = render(
    <Text testID={testID} className="calc-length" />,
  ).getByTestId(testID);
  const ratio = render(
    <Text testID={testID} className="calc-ratio" />,
  ).getByTestId(testID);

  expect(mixed.props.style).toStrictEqual({ lineHeight: 18 });
  expect(length.props.style).toStrictEqual({ lineHeight: 22 });
  expect(ratio.props.style).toStrictEqual({ lineHeight: 42 });
});

test("a percentage is dropped with a warning, reported as its fraction", () => {
  // SUSPECTED DEFECT: `line-height: 150%` is 150% of the font size — 30 here —
  // and is expressible in React Native, so dropping it loses a supportable
  // value. lightningcss has already normalised the percentage to the fraction
  // `1.5` by the time the warning is raised, so the warning names a number the
  // author never wrote.
  const compiled = registerCSS(`.a { font-size: 20px; line-height: 150%; }`);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ fontSize: 20 });
  expect(compiled.warnings()).toStrictEqual({
    values: { "line-height": [1.5] },
  });
});

test("the CSS-wide keywords: `inherit` warns, `unset` is silently dropped", () => {
  const inherited = registerCSS(`.kw-inherit { line-height: inherit; }`);
  const unset = registerCSS(`.kw-unset { line-height: unset; }`);

  const inheritComponent = render(
    <Text testID={testID} className="kw-inherit" />,
  ).getByTestId(testID);
  const unsetComponent = render(
    <Text testID={testID} className="kw-unset" />,
  ).getByTestId(testID);

  // `inherit` produces no style AT ALL, rather than an empty style object: it
  // parsed to nothing, so there is no property to defer and the rule should not
  // claim one.
  //
  // `unset` is different on purpose. It reaches the runtime intact, where it
  // means "remove this value" — so the rule exists and owns no key, which is a
  // style object with nothing in it rather than an absent one.
  expect(inheritComponent.props.style).toBeUndefined();
  expect(unsetComponent.props.style).toStrictEqual({});
  expect(inherited.warnings()).toStrictEqual({
    values: { "line-height": ["inherit"] },
  });
  expect(unset.warnings()).toStrictEqual({});
});

test("!important resolves the same as the plain declaration", () => {
  // `!important` declarations travel in a separate lightningcss block, so the
  // parser is reached by a second route that could regress independently.
  registerCSS(`.a { line-height: 32px !important; }`);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ lineHeight: 32 });
});

/* -------------------------------------------------------------------------- */
/* Interaction with font-size on the same rule                                */
/* -------------------------------------------------------------------------- */

test("a rem line-height ignores the element's own font size", () => {
  // The whole point of the split: `1.5rem` is 1.5 root ems (21), NOT 1.5 x 20.
  registerCSS(`.a { font-size: 20px; line-height: 1.5rem; }`);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ fontSize: 20, lineHeight: 21 });
});

test("declaration order does not change the multiplier's base", () => {
  // `--__rn-css-em` is published by the font-size declaration, so a line-height
  // written FIRST could plausibly resolve before it exists.
  registerCSS(`.a { line-height: 1.5; font-size: 30px; }`);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ fontSize: 30, lineHeight: 45 });
});

test("a self-referential em font size falls back to the rem instead of recursing", () => {
  // `font-size: 2em` publishes its own descriptor as `--__rn-css-em`, so
  // resolving the variable would read the variable — unbounded recursion that
  // threw `RangeError` with no ancestor font size to terminate it. The publish
  // is now skipped for an `em`-valued size, so the lookup misses and falls back
  // to the root rem exactly as every other `em` consumer does.
  //
  // SUSPECTED DEFECT (reduced, not resolved): 28 is 2 x the rem, not 2 x an
  // inherited size, so the value is still wrong wherever an ancestor size
  // exists. Terminating the self-reference belongs in the `em` resolver; this
  // only stops it being fatal.
  registerCSS(`.a { font-size: 2em; }`);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ fontSize: 28 });
});

test("an em font size resolves against the ancestor, and so does the line-height beside it", () => {
  // SUSPECTED DEFECT: the line-height resolves against the INHERITED 24
  // (1.5 x 24 = 36), not the element's own computed font size of 48, which is
  // what CSS specifies and what `fontSize: 48` on the very same style object
  // says the font size is. The element's own `--__rn-css-em` is the unresolved
  // `em` function, so the line-height reads past it to the ancestor's.
  registerCSS(
    `.ancestor { font-size: 24px; } .child { font-size: 2em; line-height: 1.5; }`,
  );

  const component = render(
    <View className="ancestor">
      <Text testID={testID} className="child" />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual([
    { fontSize: 24 },
    { fontSize: 48, lineHeight: 36 },
  ]);
});

/* -------------------------------------------------------------------------- */
/* The `font` shorthand                                                       */
/* -------------------------------------------------------------------------- */

/*
 * Every expectation in this section carries `fontVariant: []`, because that is
 * what the shorthand MEANS: lightningcss fills its unwritten longhands with
 * their initial values, and `font-variant: normal` asks for no variants — the
 * empty list React Native spells that with (`fontVariant?: FontVariant[]`). A
 * `font` after a rule that set a variant is what resets it.
 */

test("the shorthand's line-height is absolute for every length form", () => {
  registerCSS(`
    .font-px { font: 20px/30px Arial; }
    .font-rem { font: 20px/2rem Arial; }
    .font-normal { font: 20px/normal Arial; }
  `);

  const px = render(<Text testID={testID} className="font-px" />).getByTestId(
    testID,
  );
  const rem = render(<Text testID={testID} className="font-rem" />).getByTestId(
    testID,
  );
  const normal = render(
    <Text testID={testID} className="font-normal" />,
  ).getByTestId(testID);

  expect(px.props.style).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 20,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
    lineHeight: 30,
  });
  expect(rem.props.style).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 20,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
    lineHeight: 28,
  });
  expect(normal.props.style).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 20,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
  });
});

test("the shorthand and the longhands agree", () => {
  // The same declaration written two ways, so the leading must match. It does
  // because `parseFont` publishes `--__rn-css-em` beside its `font-size`
  // exactly as `parseFontSizeDeclaration` does — the shorthand's own unitless
  // line-height therefore multiplies the size declared beside it (36) rather
  // than the root rem (21), which is the only other number in scope and the
  // one a missing `em` would silently produce.
  registerCSS(`
    .longhand { font-size: 24px; line-height: 1.5; }
    .shorthand { font: 24px/1.5 Arial; }
  `);

  const longhand = render(
    <Text testID={testID} className="longhand" />,
  ).getByTestId(testID);
  const shorthand = render(
    <Text testID={testID} className="shorthand" />,
  ).getByTestId(testID);

  expect(longhand.props.style).toStrictEqual({ fontSize: 24, lineHeight: 36 });
  expect(shorthand.props.style).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 24,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
    lineHeight: 36,
  });
});

test("a rem size in the shorthand feeds its own unitless line-height", () => {
  // The rem is resolved to 28 before the multiplier reads it, so the leading is
  // 1.5 x 28 and not 1.5 x the rem of 14. Distinct from the px case above: the
  // published `em` is the RESOLVED size, so a size whose own unit needs
  // resolving must not short-circuit to the raw declaration.
  registerCSS(`
    .longhand { font-size: 2rem; line-height: 1.5; }
    .shorthand { font: 2rem/1.5 Arial; }
  `);

  const longhand = render(
    <Text testID={testID} className="longhand" />,
  ).getByTestId(testID);
  const shorthand = render(
    <Text testID={testID} className="shorthand" />,
  ).getByTestId(testID);

  expect(longhand.props.style).toStrictEqual({ fontSize: 28, lineHeight: 42 });
  expect(shorthand.props.style).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 28,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
    lineHeight: 42,
  });
});

test("an em line-height inside the shorthand resolves against the shorthand's size", () => {
  // `em` and a unitless ratio reach the size by the same published variable, so
  // this is the second consumer that a missing `em` would have sent to the rem.
  registerCSS(`.a { font: 24px/1.5em Arial; }`);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 24,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
    lineHeight: 36,
  });
});

test("the shorthand's size is the em a descendant's line-height multiplies", () => {
  // The variable the shorthand publishes travels the same subtree as the
  // longhand's, so a child declaring only a ratio gets 2 x 24.
  registerCSS(`.p { font: 24px/1.5 Arial; } .c { line-height: 2; }`);

  const component = render(
    <View className="p">
      <Text testID={testID} className="c" />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual([
    {
      fontFamily: "Arial",
      fontSize: 24,
      fontStyle: "normal",
      fontVariant: [],
      fontWeight: "normal",
      lineHeight: 36,
    },
    { lineHeight: 48 },
  ]);
});

test("an em SIZE in the shorthand behaves exactly as the longhand does", () => {
  // The shorthand publishes `em` through the same guarded helper, so it shares
  // the longhand's fallback rather than the crash it briefly shared.
  registerCSS(`.a { font: 2em/1.5 Arial; }`);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual(
    expect.objectContaining({ fontSize: 28, fontFamily: "Arial" }),
  );
});

test("an em size in the shorthand resolves against an ancestor when there is one", () => {
  // SUSPECTED DEFECT: the same divergence the `font-size: 2em` longhand shows —
  // the leading is 1.5 x the INHERITED 24, not 1.5 x the element's own computed
  // 48 that sits on the very same style object.
  registerCSS(`.p { font-size: 24px; } .c { font: 2em/1.5 Arial; }`);

  const component = render(
    <View className="p">
      <Text testID={testID} className="c" />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual([
    { fontSize: 24 },
    {
      fontFamily: "Arial",
      fontSize: 48,
      fontStyle: "normal",
      fontVariant: [],
      fontWeight: "normal",
      lineHeight: 36,
    },
  ]);
});

/* -------------------------------------------------------------------------- */
/* Inheritance across a View boundary                                         */
/* -------------------------------------------------------------------------- */

test("a length line-height inherits unchanged", () => {
  registerCSS(`.p { line-height: 24px; }`);

  const component = render(
    <View className="p">
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ lineHeight: 24 });
});

test("a unitless line-height inherits already resolved against the ancestor", () => {
  registerCSS(`.p { font-size: 20px; line-height: 1.5; }`);

  const component = render(
    <View className="p">
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ fontSize: 20, lineHeight: 30 });
});

test("an inherited unitless line-height is not re-multiplied by the child's own font size", () => {
  // SUSPECTED DEFECT: CSS inherits the RATIO for a unitless line-height, so the
  // child here should get 1.5 x 40 = 60. What inherits is the ancestor's
  // already-resolved 21 (1.5 x the rem), so a child that changes its font size
  // keeps its parent's leading. The publish/consume pair carries the computed
  // `lineHeight`, which has no room for "unitless, resolve later".
  registerCSS(`.p { line-height: 1.5; } .c { font-size: 40px; }`);

  const component = render(
    <View className="p">
      <Text testID={testID} className="c" />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual([
    { lineHeight: 21 },
    { fontSize: 40 },
  ]);
});

test("a child's own unitless line-height does multiply the inherited font size", () => {
  // The mirror of the case above, and the one that works: the em travels, so a
  // line-height declared on the child resolves against the ancestor's size.
  registerCSS(
    `.p { font-size: 20px; line-height: 1.5; } .c { line-height: 2; }`,
  );

  const component = render(
    <View className="p">
      <Text testID={testID} className="c" />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual([
    { fontSize: 20, lineHeight: 30 },
    { lineHeight: 40 },
  ]);
});

/* -------------------------------------------------------------------------- */
/* var() — the runtime `lineHeight` path                                      */
/* -------------------------------------------------------------------------- */

/**
 * The boundary mapped by this section.
 *
 * `line-height` is in `unparsedRuntimeParsing`, so a declaration the compiler
 * cannot fully resolve is emitted as the style function `[{}, "lineHeight",
 * args, 1]`. The runtime resolver for it (`native/styles/line-height.ts`) hands
 * `args` to `resolveDimension`, which reads the KIND off the descriptor tree
 * BEFORE it is flattened — so it makes the same split `parseLineHeight` makes
 * from lightningcss's typed value: a length is absolute, a percentage is that
 * share of the font size, and only a bare number multiplies `--__rn-css-em`
 * (falling back to `--__rn-css-rem`).
 *
 * The trigger for this path is not "defined twice" — it is "still contains a
 * `var()` after inlining", which the tests below reach three separate ways.
 *
 * The classification can only see a unit the COMPILER left on the value, which
 * is why a length written into a CUSTOM PROPERTY keeps its `px` suffix
 * (`asDeclaredLength`, `compiler/declarations.ts`). Folded to the bare number
 * `22`, `--x: 22px` is indistinguishable from the ratio `22` and reads as one —
 * and lightningcss rewrites `rem` to `px` ahead of the compiler, so `--x:
 * 1.5rem` arrives by the same door. `em`, `vw` and `vh` survive as length
 * FUNCTIONS (`[{}, "em", 1.5, 1]`) and a percentage survives as the string
 * `"150%"`, so every form classifies as what it is.
 *
 * A var() FALLBACK classifies as a length too, and it is the route that has to
 * say so explicitly. Its tokens are parsed under `line-height` — they must be,
 * or `auto` and a font-relative percentage would be read wrong — but they are
 * then STORED inside the `var()` descriptor and read back later, which puts the
 * reader in exactly the position a custom property's consumer is in. So the
 * value carries `use: "substituted"` and keeps its unit, rather than folding to
 * the bare number a ratio is spelled as.
 */

test("a length-valued variable that cannot be inlined is still a length", () => {
  // 22px is a length, so it IS the leading. Read as a ratio it would be 22 font
  // sizes — 374.
  registerCSS(`
    ${twoDefinitions("--leading-md", "22px", "24px")}
    .a { font-size: 17px; line-height: var(--leading-md); }
  `);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({
    fontSize: 17,
    lineHeight: 22,
  });
});

test("the same variable with a single definition inlines to the same number", () => {
  // The inlined twin of the case above: identical CSS, one definition, so the
  // compiler substitutes the token and the parsed path treats it as a length.
  // Both routes land on the leading the author wrote.
  registerCSS(`
    :root { --leading-solo: 22px; }
    .a { font-size: 17px; line-height: var(--leading-solo); }
  `);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ fontSize: 17, lineHeight: 22 });
});

test("excluding a single-definition variable from inlining takes the runtime path", () => {
  // No media query, no second definition — only `inlineVariables.exclude`. This
  // is what pins the trigger to inlinability rather than to anything about the
  // dark-scheme override, and the runtime path reads the length as a length.
  registerCSS(
    `:root { --leading-excluded: 22px; }
     .a { font-size: 17px; line-height: var(--leading-excluded); }`,
    { inlineVariables: { exclude: ["--leading-excluded"] } },
  );

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({
    fontSize: 17,
    lineHeight: 22,
  });
});

test("a length in a var() fallback is a length, not a ratio", () => {
  // The route that most easily loses the unit: `22px` is parsed under
  // `line-height` and stored for a resolver to read back, so if the store did
  // not record that it IS a store, the bare number `22` would arrive where
  // `"22px"` arrives from every other source — and a bare number in
  // `line-height` position is a multiple of the font size, which would render
  // 374 instead of 22.
  registerCSS(
    `.a { font-size: 17px; line-height: var(--never-declared, 22px); }`,
  );

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({
    fontSize: 17,
    lineHeight: 22,
  });
});

test("an em variable and a rem one are both absolute", () => {
  // `1.5em` survives compilation as the length function `[{}, "em", 1.5, 1]`,
  // so it classifies as a length and resolves against the element's own size:
  // 1.5 x 17 = 25.5.
  //
  // `1.5rem` does not survive as a function — lightningcss rewrites it to
  // `21px` before the compiler sees it — so it arrives as the length string
  // `"21px"` and classifies as one. Read as a ratio it would be 21 x 17 = 357.
  registerCSS(`
    ${twoDefinitions("--leading-rem", "1.5rem", "2rem")}
    ${twoDefinitions("--leading-em", "1.5em", "2em")}
    .rem-var { font-size: 17px; line-height: var(--leading-rem); }
    .em-var { font-size: 17px; line-height: var(--leading-em); }
  `);

  const remVar = render(
    <Text testID={testID} className="rem-var" />,
  ).getByTestId(testID);
  const emVar = render(<Text testID={testID} className="em-var" />).getByTestId(
    testID,
  );

  expect(remVar.props.style).toStrictEqual({ fontSize: 17, lineHeight: 21 });
  expect(emVar.props.style).toStrictEqual({ fontSize: 17, lineHeight: 25.5 });
});

test("a viewport-unit variable resolves to its own length", () => {
  // `10vw` survives compilation as the length function `[{}, "vw", 10, 1]`, so
  // it classifies as a length: 10% of the 750px test window is 75, and the font
  // size beside it never enters the arithmetic.
  registerCSS(`
    ${twoDefinitions("--leading-vw", "10vw", "12vw")}
    .a { font-size: 17px; line-height: var(--leading-vw); }
  `);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({
    fontSize: 17,
    lineHeight: 75,
  });
});

test("calc() around the variable keeps the kind of what it computes", () => {
  // `calc(22px + 2px)` is a LENGTH of 24, so it is the leading — read as a
  // ratio it would be 24 x 17 = 408. `calc(1.25 * 2)` is the RATIO 2.5, and
  // 2.5 x 20 is exactly what a unitless line-height means.
  registerCSS(`
    ${twoDefinitions("--calc-length", "22px", "24px")}
    ${twoDefinitions("--calc-ratio", "1.25", "1.5")}
    .calc-len { font-size: 17px; line-height: calc(var(--calc-length) + 2px); }
    .calc-num { font-size: 20px; line-height: calc(var(--calc-ratio) * 2); }
  `);

  const calcLength = render(
    <Text testID={testID} className="calc-len" />,
  ).getByTestId(testID);
  const calcRatio = render(
    <Text testID={testID} className="calc-num" />,
  ).getByTestId(testID);

  expect(calcLength.props.style).toStrictEqual({
    fontSize: 17,
    lineHeight: 24,
  });
  expect(calcRatio.props.style).toStrictEqual({ fontSize: 20, lineHeight: 50 });
});

test("a length needs no font size in scope, because it never consults one", () => {
  // The font size beside a length never enters the arithmetic — with none
  // declared, a ratio would fall back to the rem and render 22 x 14 = 308.
  registerCSS(`
    ${twoDefinitions("--leading-bare", "22px", "24px")}
    .a { line-height: var(--leading-bare); }
  `);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ lineHeight: 22 });
});

test("a unitless variable is correct, with and without a font size", () => {
  // The one value form the runtime path gets right, because multiplying by the
  // font size is exactly what a unitless line-height means. 25 is 1.25 x 20 and
  // 17.5 is 1.25 x the rem of 14.
  registerCSS(`
    ${twoDefinitions("--leading-tight", "1.25", "1.4")}
    .with-size { font-size: 20px; line-height: var(--leading-tight); }
    .without-size { line-height: var(--leading-tight); }
  `);

  const withSize = render(
    <Text testID={testID} className="with-size" />,
  ).getByTestId(testID);
  const withoutSize = render(
    <Text testID={testID} className="without-size" />,
  ).getByTestId(testID);

  expect(withSize.props.style).toStrictEqual({ fontSize: 20, lineHeight: 25 });
  expect(withoutSize.props.style).toStrictEqual({ lineHeight: 17.5 });
});

test("a negative variable keeps its sign; a zero one reaches the style", () => {
  // A negative length is a length, carried through with its sign — read as a
  // ratio it would be -10 x 17 = -170.
  //
  // Zero is the one value where the two readings agree — `0` and `0px` are both
  // 0 — and it reaches the style rather than being skipped, because the resolver
  // bails only on a value that did not resolve, never on a falsy one.
  // `line-height: 0` written literally reaches the style as 0 too.
  registerCSS(`
    ${twoDefinitions("--leading-negative", "-10px", "-12px")}
    ${twoDefinitions("--leading-zero", "0px", "0")}
    .neg { font-size: 17px; line-height: var(--leading-negative); }
    .zero { font-size: 17px; line-height: var(--leading-zero); }
  `);

  const negative = render(<Text testID={testID} className="neg" />).getByTestId(
    testID,
  );
  const zero = render(<Text testID={testID} className="zero" />).getByTestId(
    testID,
  );

  expect(negative.props.style).toStrictEqual({
    fontSize: 17,
    lineHeight: -10,
  });
  expect(zero.props.style).toStrictEqual({ fontSize: 17, lineHeight: 0 });
});

test("a `normal` variable is dropped; a percentage one is a share of the font size", () => {
  // `normal` is CORRECT: it classifies as `unknown`, so nothing numeric
  // resolves and the resolver bails. React Native has no `normal` leading.
  //
  // css-inline-3 §2.2: a percentage line-height is that percentage OF the font
  // size. `150%` survives compilation as the string `"150%"`, which classifies
  // as a percentage — 150% of 20 is 30 — so this route renders the value the
  // literal route drops (see "a percentage is dropped with a warning" above,
  // where lightningcss has already normalised the percentage to the fraction
  // `1.5` before the parser can recognise it). Neither value warns here,
  // because neither is lost.
  const compiled = registerCSS(`
    ${twoDefinitions("--leading-normal", "normal", "normal")}
    ${twoDefinitions("--leading-percent", "150%", "160%")}
    .norm { font-size: 17px; line-height: var(--leading-normal); }
    .pct { font-size: 20px; line-height: var(--leading-percent); }
  `);

  const normal = render(<Text testID={testID} className="norm" />).getByTestId(
    testID,
  );
  const percent = render(<Text testID={testID} className="pct" />).getByTestId(
    testID,
  );

  expect(normal.props.style).toStrictEqual({ fontSize: 17 });
  expect(percent.props.style).toStrictEqual({ fontSize: 20, lineHeight: 30 });
  expect(compiled.warnings()).toStrictEqual({});
});

test("the dark branch of the same variable is a length too", () => {
  // The second definition is what forces the runtime path in the first place,
  // so it is the one most easily left behind by a fix aimed at the first — read
  // as a ratio it would be 24 x 17 = 408.
  registerCSS(`
    ${twoDefinitions("--leading-themed", "22px", "24px")}
    .a { font-size: 17px; line-height: var(--leading-themed); }
  `);

  colorScheme.set("dark");

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({
    fontSize: 17,
    lineHeight: 24,
  });
});

test("the resolved value is what inherits to a descendant", () => {
  // The inheritance pair publishes the resolved `lineHeight`, so a descendant
  // is told the number the ancestor drew rather than the descriptor behind it.
  registerCSS(`
    ${twoDefinitions("--leading-parent", "22px", "24px")}
    .p { font-size: 17px; line-height: var(--leading-parent); }
  `);

  const component = render(
    <View className="p">
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    fontSize: 17,
    lineHeight: 22,
  });
});

test("the `font` shorthand with a var() keeps the size and refuses the leading", () => {
  // The shorthand expands at runtime, so the size and family survive a `var()`
  // where the whole declaration used to be dropped. The LEADING is the one part
  // that cannot cross: resolving folds a length's unit away, so `17px/22px` and
  // `17px/1.25` arrive as the same pair of bare numbers and nothing left in the
  // value says which was written.
  //
  // Both cases below therefore land on a size with no `lineHeight` — the
  // platform's own leading, rather than a number produced by a guess.
  registerCSS(`
    ${twoDefinitions("--leading-shorthand", "22px", "24px")}
    ${twoDefinitions("--ratio-shorthand", "1.25", "1.4")}
    .font-len { font: 17px/var(--leading-shorthand) Arial; }
    .font-num { font: 20px/var(--ratio-shorthand) Arial; }
  `);

  const length = render(
    <Text testID={testID} className="font-len" />,
  ).getByTestId(testID);
  const ratio = render(
    <Text testID={testID} className="font-num" />,
  ).getByTestId(testID);

  expect(length.props.style).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 17,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
  });
  expect(ratio.props.style).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 20,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
  });
});

test("font-size and letter-spacing variables are unaffected, so the fault is line-height's", () => {
  // The control that scopes the bug: the same un-inlinable variable shape in
  // two neighbouring properties resolves correctly, because neither is in
  // `unparsedRuntimeParsing`. `line-height` is, and that membership is the
  // whole difference. 25.5 is 1.5 x the var-supplied font size of 17.
  registerCSS(`
    ${twoDefinitions("--size-control", "17px", "18px")}
    ${twoDefinitions("--tracking-control", "2px", "3px")}
    .a { font-size: var(--size-control); letter-spacing: var(--tracking-control); line-height: 1.5; }
  `);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({
    fontSize: 17,
    letterSpacing: 2,
    lineHeight: 25.5,
  });
});
