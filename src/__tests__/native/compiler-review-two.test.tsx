import { render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-css/components/SafeAreaProvider";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import {
  compileWithAutoDebug,
  registerCSS,
  testID,
} from "react-native-css/jest";

/**
 * A second review of `src/compiler/`, each defect pinned by the reproduction
 * that failed before its fix.
 *
 * The thread running through these is a parser answering a question it was not
 * asked. `env()` asked "is there a fallback?" and answered "is the fallback
 * truthy?"; `font-variant-caps` asked "can React Native render this keyword?"
 * of a keyword that means "render none of them"; `aspect-ratio` asked about the
 * ratio before asking whether one was written. Each produces a declaration that
 * is absent, or present holding a value React Native reads as nothing — and in
 * both cases the CSS is spelled correctly and there is nothing to look at.
 */

function styleOf(className: string): Record<string, unknown> | undefined {
  return render(<View testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style as Record<string, unknown> | undefined;
}

function textStyleOf(className: string): Record<string, unknown> | undefined {
  return render(<Text testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style as Record<string, unknown> | undefined;
}

/*****************************************************************************
 * 1. `env(<name>, 0)` — the fallback was tested for truth, not for presence
 ****************************************************************************/

test("a zero env() fallback survives to the runtime", () => {
  // `padding-bottom: env(safe-area-inset-bottom, 0px)` is how a stylesheet says
  // "the inset, or nothing" — and `0` is falsy, so the fallback was dropped on
  // the way into the descriptor. With no provider the `var()` then resolved to
  // nothing and the declaration disappeared, where the same declaration written
  // with any non-zero fallback kept it.
  const compiled = compileWithAutoDebug(
    `.env-zero-fallback { padding-top: env(safe-area-inset-top, 0px); }`,
  );

  expect(compiled.stylesheet()).toStrictEqual({
    s: [
      [
        "env-zero-fallback",
        [
          {
            s: [1, 1],
            d: [
              [
                [{}, "var", ["react-native-css-safe-area-inset-top", "0px"], 1],
                "paddingTop",
                1,
              ],
            ],
            dv: 1,
          },
        ],
      ],
    ],
  });
});

test("a zero env() fallback renders as 0 when no provider supplies the inset", () => {
  registerCSS(
    `.env-zero-render { padding-top: env(safe-area-inset-top, 0px); }`,
  );

  expect(styleOf("env-zero-render")).toStrictEqual({ paddingTop: 0 });
});

test("a zero env() fallback still loses to a real inset", () => {
  // The other half: a fallback is only used when the variable is absent, so
  // restoring it must not shadow a provider that has one.
  registerCSS(
    `.env-zero-inset { padding-top: env(safe-area-inset-top, 0px); }`,
  );

  render(
    <SafeAreaProvider
      initialMetrics={{
        insets: { top: 7, bottom: 0, left: 0, right: 0 },
        frame: { x: 0, y: 0, width: 0, height: 0 },
      }}
    >
      <View testID={testID} className="env-zero-inset" />
    </SafeAreaProvider>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    paddingTop: 7,
  });
});

/*****************************************************************************
 * 2. `font-variant-caps: normal` — the initial value read as an unusable one
 ****************************************************************************/

test("font-variant-caps: normal cancels an inherited small-caps", () => {
  // `normal` is the initial value of every `font-variant*` property and means
  // "no variants" (css-fonts-4 §6.5). `parseFontVariantKeywords` already reads
  // it that way and emits React Native's empty `FontVariant[]`; the typed
  // `font-variant-caps` route carried its own allow-list, `normal` was not on
  // it, and the one declaration written to undo a variant produced no style and
  // a warning naming a value the author had written correctly.
  const compiled = registerCSS(
    `.caps-normal { font-variant-caps: normal; }
     .caps-small { font-variant-caps: small-caps; }`,
  );

  expect(textStyleOf("caps-normal")).toStrictEqual({ fontVariant: [] });
  expect(textStyleOf("caps-small")).toStrictEqual({
    fontVariant: ["small-caps"],
  });
  expect(compiled.warnings()).toStrictEqual({});
});

test("the font shorthand resets the variant rather than warning about it", () => {
  // lightningcss fills the shorthand's unwritten longhands with their initial
  // values, so `font: 16px Arial` arrives carrying `variantCaps: "normal"` —
  // and every `font` declaration in every stylesheet reported a rejected value
  // of `normal` that nobody had typed. A diagnostic that fires on correct CSS
  // is how diagnostics stop being read.
  const compiled = registerCSS(`.font-reset { font: 16px Arial; }`);

  expect(compiled.warnings()).toStrictEqual({});
  expect(textStyleOf("font-reset")).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 16,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
  });
});

test("the three font-variant spellings answer normal the same way", () => {
  registerCSS(`
    .variant-shorthand { font-variant: normal; }
    .variant-caps { font-variant-caps: normal; }
    .variant-numeric { font-variant-numeric: normal; }
  `);

  expect(textStyleOf("variant-shorthand")).toStrictEqual({ fontVariant: [] });
  expect(textStyleOf("variant-caps")).toStrictEqual({ fontVariant: [] });
  expect(textStyleOf("variant-numeric")).toStrictEqual({ fontVariant: [] });
});

/*****************************************************************************
 * 3. `aspect-ratio: auto` — the ratio was read before anyone asked for one
 ****************************************************************************/

test("aspect-ratio: auto cancels a ratio set by an earlier rule", () => {
  // The only reason to write it. `parseAspectRatio` tested `value.ratio` first,
  // so the `auto` branch below it was unreachable for the value that has no
  // ratio: the declaration produced no style and no warning, and the earlier
  // rule's ratio survived it.
  registerCSS(`
    .ratio-set { aspect-ratio: 16/9; }
    .ratio-auto { aspect-ratio: auto; }
  `);

  expect(styleOf("ratio-set ratio-auto")).toStrictEqual({
    aspectRatio: "auto",
  });

  // React Native's own reader is what makes `"auto"` the right carrier: it maps
  // to no aspect ratio at all, which is what `auto` means for a box with no
  // natural one. Asked of the real module rather than inferred.
  const processAspectRatio = jest.requireActual<{
    default: (aspectRatio: unknown) => number | undefined;
  }>("react-native/Libraries/StyleSheet/processAspectRatio").default;

  expect(processAspectRatio("auto")).toBeUndefined();
  expect(processAspectRatio("16/9")).toBeCloseTo(16 / 9);
});

test("aspect-ratio: auto reaches the same value through a var()", () => {
  registerCSS(`
    :root { --ratio: auto; }
    @media (prefers-color-scheme: dark) { :root { --ratio: 4/3; } }
    .ratio-literal { aspect-ratio: auto; }
    .ratio-deferred { aspect-ratio: var(--ratio); }
  `);

  expect(styleOf("ratio-deferred")).toStrictEqual(styleOf("ratio-literal"));
});

test("aspect-ratio: auto 16/9 keeps the half React Native can render", () => {
  // css-sizing-4 §2 makes the ratio the used value unless the box has a natural
  // one, and no React Native box has a natural one — so the ratio is what this
  // declaration renders. Emitting `"auto"` instead threw away the renderable
  // half and shipped the half `processAspectRatio` reads as nothing.
  registerCSS(`.ratio-both { aspect-ratio: auto 16/9; }`);

  expect(styleOf("ratio-both")).toStrictEqual({ aspectRatio: "16/9" });
});

/*****************************************************************************
 * 4. `border-block-end-style` — one edge of a pair had no parser
 ****************************************************************************/

test("both block edges are recognised, and both report the same drop", () => {
  // `border-block-start-style` was in the parser table and its opposite edge
  // was not, so one of a symmetric pair compiled and the other was reported as
  // a property this library does not handle. The asymmetry is what this pins,
  // and it survives the answer changing: both edges now reach
  // `parseUnsupportedEdgeStyle`, so both are RECOGNISED and both drop.
  //
  // Dropped rather than emitted, because React Native has no per-edge border
  // style at any layer — `borderBlockStartStyle` is a name nothing reads, and
  // an entry in the style object carrying it looks exactly like a live
  // declaration. A non-`solid` value is warned about under its own edge's name,
  // which is the other half of the symmetry: an unrecognised property warns
  // under `properties`, a recognised one that cannot render warns under
  // `values`.
  const compiled = compileWithAutoDebug(`
    .bbs { border-block-start-style: dashed; }
    .bbe { border-block-end-style: dashed; }
  `);

  expect(compiled.warnings()).toStrictEqual({
    values: {
      "border-block-start-style": ["dashed"],
      "border-block-end-style": ["dashed"],
    },
  });

  registerCSS(`
    .bbs-r { border-block-start-style: dashed; }
    .bbe-r { border-block-end-style: dashed; }
  `);

  expect(styleOf("bbs-r")).toBeUndefined();
  expect(styleOf("bbe-r")).toBeUndefined();
});

/*****************************************************************************
 * 5. The `font` shorthand's family stack — narrowed in silence
 ****************************************************************************/

test("the font shorthand reports the font families it drops", () => {
  // `TextStyle.fontFamily` is one string, so the fallback stack has no
  // representation and the first family is kept. The longhand says so; the
  // shorthand took `value.family[0]` directly and said nothing, so the same
  // narrowing was reported or not depending on how the declaration was
  // spelled.
  const shorthand = compileWithAutoDebug(
    `.font-stack { font: 16px Inter, Helvetica, sans-serif; }`,
  );
  const longhand = compileWithAutoDebug(
    `.family-stack { font-family: Inter, Helvetica, sans-serif; }`,
  );

  expect(shorthand.warnings()).toStrictEqual({
    values: { font: ["Helvetica, sans-serif"] },
  });
  expect(longhand.warnings()).toStrictEqual({
    values: { "font-family": ["Helvetica, sans-serif"] },
  });
});

/*****************************************************************************
 * 6. A `var()` fallback is STORED, and was parsed as though it were delivered
 ****************************************************************************/

test("a length in a var() fallback is read as a length", () => {
  // `24px` here is parsed under `line-height`, which is right — the consuming
  // property is what decides whether `auto` is legal and what a percentage
  // measures against. What it is NOT is the thing that reads the value: the
  // fallback is stored inside the `var()` descriptor and read back by
  // `resolveDimension` at render, which is in exactly the position a custom
  // property's consumer is in and can no more tell the length 24 from the ratio
  // 24. Folded to a bare number it multiplied the font size: 24 x 14.
  registerCSS(`.lh-fallback { line-height: var(--lh-never-declared, 24px); }`);

  expect(textStyleOf("lh-fallback")).toStrictEqual({ lineHeight: 24 });
});

test("the fallback keeps its unit in the descriptor, as a custom property's value does", () => {
  const compiled = compileWithAutoDebug(
    `.lh-shape { line-height: var(--lh-never, 24px); }`,
  );

  expect(compiled.stylesheet()).toStrictEqual({
    s: [
      [
        "lh-shape",
        [
          {
            s: [1, 1],
            v: [
              [
                "__rn-css-inherit-lineHeight",
                [{}, "lineHeight", [{}, "var", ["lh-never", "24px"], 1], 1],
              ],
            ],
            d: [
              [
                [{}, "lineHeight", [{}, "var", ["lh-never", "24px"], 1], 1],
                "lineHeight",
                1,
              ],
            ],
            dv: 1,
          },
        ],
      ],
    ],
  });
});

test("a unitless fallback is still a ratio", () => {
  // The other half. Storing the unit must not make every fallback a length —
  // `1.5` in `line-height` position is one and a half font sizes, and the
  // suffix is only ever added to a value that HAD a unit.
  registerCSS(
    `.lh-ratio { font-size: 20px; line-height: var(--lh-none, 1.5); }`,
  );

  expect(textStyleOf("lh-ratio")).toStrictEqual({
    fontSize: 20,
    lineHeight: 30,
  });
});

test("a fallback still loses to a declared variable", () => {
  registerCSS(`
    :root { --lh-declared: 30px; }
    @media (prefers-color-scheme: dark) { :root { --lh-declared: 40px; } }
    .lh-declared { line-height: var(--lh-declared, 24px); }
  `);

  expect(textStyleOf("lh-declared")).toStrictEqual({ lineHeight: 30 });
});

test("an env() fallback is stored the same way a var() fallback is", () => {
  // `parseEnv` builds the same `[{}, "var", [name, fallback], 1]` descriptor, so
  // it is the same storage site and takes the same treatment. Without it
  // `line-height: env(safe-area-inset-top, 24px)` had the identical defect.
  registerCSS(`.lh-env { line-height: env(safe-area-inset-top, 24px); }`);

  expect(textStyleOf("lh-env")).toStrictEqual({ lineHeight: 24 });
});

test("an elliptical border-radius in a fallback narrows like every other route", () => {
  // The same thread, on a different property. `10px / 20px` in a fallback was
  // parsed as two DECLARED lengths, so `reduceParseUnparsed`'s `<ratio>` case —
  // which only fires on bare numbers — joined them into the string `"10 / 20"`,
  // a shape no other route produces and the runtime shorthand cannot read.
  // Stored with their units the two are `["10px", "/", "20px"]`, which is
  // exactly what the custom-property route already hands the same resolver.
  registerCSS(`
    :root { --br: 10px / 20px; }
    @media (prefers-color-scheme: dark) { :root { --br: 30px / 40px; } }
    .br-literal { border-radius: 10px / 20px; }
    .br-deferred { border-radius: var(--br); }
    .br-fallback { border-radius: var(--br-never, 10px / 20px); }
  `);

  expect(styleOf("br-literal")).toStrictEqual({ borderRadius: 10 });
  expect(styleOf("br-deferred")).toStrictEqual(styleOf("br-literal"));
  expect(styleOf("br-fallback")).toStrictEqual(styleOf("br-literal"));
});

test("four identical elliptical corners are reported once", () => {
  // `border-radius: 10px / 20px` is ONE narrowing — the same vertical radius
  // dropped on four corners — and was reported four times, because the parse
  // that narrows runs per corner. `parseBorderStyle` argues the rule this
  // follows: a uniform value React Native cannot express is named once, against
  // the shorthand the author wrote.
  expect(
    compileWithAutoDebug(`.br1 { border-radius: 10px / 20px; }`).warnings(),
  ).toStrictEqual({ values: { "border-radius": ["10 / 20"] } });

  // Corners that narrow DIFFERENTLY each lose a different radius, so each is
  // still named.
  expect(
    compileWithAutoDebug(
      `.br2 { border-radius: 10px 20px / 30px 40px; }`,
    ).warnings(),
  ).toStrictEqual({
    values: { "border-radius": ["20 / 40", "10 / 30", "10 / 30", "20 / 40"] },
  });
});

test("a length inside a stored calc() keeps its unit too", () => {
  // `parseCalcArguments` has its own `length` branch, so the suffix stopped at
  // the math function's boundary: `calc(24px * 1)` in a fallback reached
  // `resolveDimension` as the terms `[24, "*", 1]`, which classify as a bare
  // number — the ratio 24, not the length. A term of a stored value is stored
  // like the value around it.
  registerCSS(`
    .lh-calc-fallback { line-height: var(--lh-never2, calc(24px * 1)); }
  `);

  expect(textStyleOf("lh-calc-fallback")).toStrictEqual({ lineHeight: 24 });
});

test("a unitless calc() in a stored value is still a ratio", () => {
  // The other half: only a term that HAD a unit gains the suffix, so arithmetic
  // over bare numbers still reads as the multiplier it is.
  registerCSS(`
    .lh-calc-ratio { font-size: 20px; line-height: var(--lh-never3, calc(1 + 0.5)); }
  `);

  expect(textStyleOf("lh-calc-ratio")).toStrictEqual({
    fontSize: 20,
    lineHeight: 30,
  });
});

test("a declared length still reaches React Native as a number", () => {
  // The guard on the change: a value the consuming property USES keeps folding,
  // because it lands in the static declaration record without passing through
  // `resolveValue` at all — a suffixed string would reach React Native raw.
  registerCSS(`.declared-length { width: 24px; outline-offset: 2px; }`);

  expect(styleOf("declared-length")).toStrictEqual({
    outlineOffset: 2,
    width: 24,
  });
});

/*****************************************************************************
 * 7. `font-size` through a var() — the reading belongs at render
 ****************************************************************************/

test("a percentage font-size resolves the same written out and through a var()", () => {
  // A `<percentage>` font size measures against the PARENT's computed size
  // (css-fonts-4 §3.5), and only the consuming property knows that. Stored in a
  // custom property the value is the string `"200%"` — which is the faithful
  // storage, because the same variable may be read by `width`, where that
  // string is exactly right. The reading therefore belongs at render, under the
  // property that asked. Without it the string reached React Native raw, where
  // `fontSize` is a `number` (`StyleSheetTypes.d.ts:496`) and it is inert.
  registerCSS(`
    :root { --fs-p: 200%; }
    @media (prefers-color-scheme: dark) { :root { --fs-p: 300%; } }
    .fs-literal { font-size: 200%; }
    .fs-deferred { font-size: var(--fs-p); }
    .fs-em { font-size: 2em; }
  `);

  // The default rem is 14, and nothing above the element declares a size.
  expect(textStyleOf("fs-literal")).toStrictEqual({ fontSize: 28 });
  expect(textStyleOf("fs-deferred")).toStrictEqual({ fontSize: 28 });
  expect(textStyleOf("fs-em")).toStrictEqual({ fontSize: 28 });
});

test("a percentage font-size measures against an ancestor's size, not its own", () => {
  // The difference from `line-height`, and the reason the resolver cannot read
  // `--__rn-css-em` from the element's own rule: that variable IS the size
  // being computed. Reading it would multiply the percentage by its own result,
  // and 200% of 20 is 40 — not 80.
  registerCSS(`
    :root { --fs-half: 200%; }
    @media (prefers-color-scheme: dark) { :root { --fs-half: 300%; } }
    .fs-parent { font-size: 20px; }
    .fs-child { font-size: var(--fs-half); }
  `);

  render(
    <Text testID="parent" className="fs-parent">
      <Text testID={testID} className="fs-child" />
    </Text>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    fontSize: 40,
  });
});

test("a deferred font-size publishes the em its own lengths resolve against", () => {
  // `--__rn-css-em` is the channel an element's `em` lengths and its
  // descendants both read, and a size the compiler could not resolve is still
  // the size they need. The RESOLVED descriptor is published, so a unitless
  // line-height beside it multiplies the size that actually rendered.
  registerCSS(`
    :root { --fs-pub: 20px; }
    @media (prefers-color-scheme: dark) { :root { --fs-pub: 30px; } }
    .fs-pub { font-size: var(--fs-pub); line-height: 1.5; }
  `);

  expect(textStyleOf("fs-pub")).toStrictEqual({
    fontSize: 20,
    lineHeight: 30,
  });
});

test("a length font-size through a var() is still absolute", () => {
  registerCSS(`
    :root { --fs-len: 24px; }
    @media (prefers-color-scheme: dark) { :root { --fs-len: 32px; } }
    .fs-len { font-size: var(--fs-len); }
  `);

  expect(textStyleOf("fs-len")).toStrictEqual({ fontSize: 24 });
});

test("a percentage font-size in a var() FALLBACK is unchanged", () => {
  // The route that was already correct. A fallback's tokens are parsed under
  // the CONSUMING property, so `parseFontSize` reads the percentage as the `em`
  // it is at compile time — the property decides MEANING, the use decides
  // REPRESENTATION, and only the second changed.
  const compiled = compileWithAutoDebug(
    `.fs-fallback { font-size: var(--fs-never, 200%); }`,
  );

  expect(compiled.stylesheet().s?.[0]?.[1]?.[0]?.d).toStrictEqual([
    [
      [{}, "fontSize", [{}, "var", ["fs-never", [{}, "em", 2, 1]], 1], 1],
      "fontSize",
      1,
    ],
  ]);

  registerCSS(`.fs-fallback-r { font-size: var(--fs-never, 200%); }`);
  expect(textStyleOf("fs-fallback-r")).toStrictEqual({ fontSize: 28 });
});

/*****************************************************************************
 * 8. `align-content: baseline` — the warning named lightningcss's type
 ****************************************************************************/

test("a rejected align-content names the value the author wrote", () => {
  // React Native's `alignContent` has no `baseline`, so the declaration is
  // rejected either way — but the warning read `baseline-position`, which is
  // lightningcss's name for the SHAPE of the value and appears nowhere in the
  // stylesheet. `parseAlignItems` maps the same shape to `baseline`; the two
  // read one value and named it two different things.
  const compiled = compileWithAutoDebug(`.ac { align-content: baseline; }`);

  expect(compiled.warnings()).toStrictEqual({
    values: { "align-content": ["baseline"] },
  });
});
