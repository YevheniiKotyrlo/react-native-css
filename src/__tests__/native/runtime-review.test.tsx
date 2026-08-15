import { processColor } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { VariableContextProvider } from "react-native-css";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

/**
 * Defects found by reviewing `src/native/` against what the compile-time route
 * produces for the same CSS.
 *
 * Every test here failed before the fix beside it, and each one is a case the
 * suites that already exist cannot reach:
 *
 * - `route-equivalence-census.test.tsx` renders ONE declaration per rule, so a
 *   rule whose declarations interact — a transform composed from two properties,
 *   two declarations reading one variable — is outside it by construction.
 * - the census also uses one VALUE per property, so a grammar's other arities
 *   (`border: solid` beside `border: 2px solid red`) are untested.
 * - a `var()` FALLBACK holding a function is a third shape again: the compiler
 *   wraps it in a list, and the depth that adds is invisible from every route
 *   whose value arrives already flat.
 */

/** The style React Native receives for `className`, rendered on a `<View>`. */
function styleOf(className: string): Record<string, unknown> | undefined {
  render(<View testID={testID} className={className} />);

  return screen.getByTestId(testID).props.style as
    | Record<string, unknown>
    | undefined;
}

/** The same, with the custom properties supplied from JavaScript. */
function providedStyleOf(
  className: string,
  variables: Record<`--${string}`, string>,
): Record<string, unknown> | undefined {
  render(
    <VariableContextProvider value={variables}>
      <View testID={testID} className={className} />
    </VariableContextProvider>,
  );

  return screen.getByTestId(testID).props.style as
    | Record<string, unknown>
    | undefined;
}

describe("a shorthand given one value by a variable", () => {
  /**
   * `border` and its per-edge siblings are `<line-width> || <line-style> ||
   * <color>`, so one value is a complete declaration — and the mapping tables in
   * `shorthands/border.ts` and `shorthands/border-sides.ts` carry the one-value
   * rows to prove it was meant to work.
   *
   * The rows were unreachable: `shorthandHandler` requires its resolved
   * arguments to be an ARRAY, and a variable holding a single token resolves to
   * that token. Every one-value declaration was dropped whole.
   */
  test.each([
    // The colour a declaration names arrives spelled as the author wrote it on
    // the runtime route and normalised by lightningcss on the compile-time one.
    // `processColor` reads the two as one colour; every other component is
    // compared as written.
    ["solid", { borderStyle: "solid" }, { borderStyle: "solid" }],
    ["red", { borderColor: "red" }, { borderColor: "#f00" }],
    ["2px", { borderWidth: 2 }, { borderWidth: 2 }],
  ])("border: var(--edge) with --edge: %s", (value, deferred, literal) => {
    registerCSS(`
      :root { --edge: ${value}; }
      @media (prefers-color-scheme: dark) { :root { --edge: double; } }
      .literal { border: ${value}; }
      .deferred { border: var(--edge); }
    `);

    // The colour is CSS's initial `currentcolor` whenever the declaration
    // names none, which is what the compile-time route writes for the same
    // value.
    const currentColor = { semantic: ["label", "labelColor"] };

    expect(styleOf("deferred")).toStrictEqual({
      borderColor: currentColor,
      ...deferred,
    });
    expect(styleOf("literal")).toStrictEqual({
      borderColor: currentColor,
      ...literal,
    });
  });

  test("border-top: var(--edge) with --edge: 2px", () => {
    registerCSS(`
      :root { --edge: 2px; }
      @media (prefers-color-scheme: dark) { :root { --edge: 4px; } }
      .deferred { border-top: var(--edge); }
    `);

    expect(styleOf("deferred")).toStrictEqual({
      borderTopWidth: 2,
      borderTopColor: { semantic: ["label", "labelColor"] },
    });
  });
});

describe("the individual transform properties compose in CSS's order", () => {
  /**
   * css-transforms-2 §3.1: the transform matrix is `translate`, then `rotate`,
   * then `scale`, then `transform` — the order the properties are DECLARED in
   * has no part in it.
   *
   * The compile-time route obeys that: `rotate: 45deg; translate: 10px 20px`
   * and the same two declarations reversed both compile to the entries
   * `translateX, translateY, rotateZ`. The runtime assembles the array in the
   * order the declarations were seen, so the same CSS renders a rotation about
   * the element's own origin followed by a translation — a different place on
   * screen, not a different spelling of one.
   */
  test("one rule, declared out of order", () => {
    registerCSS(`
      :root { --spin: 45deg; --shift: 10px 20px; }
      @media (prefers-color-scheme: dark) { :root { --spin: 90deg; --shift: 1px 2px; } }
      .deferred { rotate: var(--spin); translate: var(--shift); }
      .literal { rotate: 45deg; translate: 10px 20px; }
    `);

    expect(styleOf("literal")).toStrictEqual({
      transform: [{ translateX: 10 }, { translateY: 20 }, { rotateZ: "45deg" }],
    });

    expect(styleOf("deferred")).toStrictEqual({
      transform: [{ translateX: 10 }, { translateY: 20 }, { rotate: "45deg" }],
    });
  });

  /**
   * Across two rules the compiler cannot normalise the order at all — each rule
   * is compiled alone — so the runtime is the only place the composition order
   * can be decided, and it decided it by rule order. Written the other way
   * round the same two classes rendered a different transform.
   */
  test("two rules, in either order", () => {
    registerCSS(`
      .spin { rotate: 45deg; }
      .shift { translate: 10px 20px; }
    `);

    const composed = {
      transform: [{ translateX: 10 }, { translateY: 20 }, { rotateZ: "45deg" }],
    };

    expect(styleOf("spin shift")).toStrictEqual(composed);
    expect(styleOf("shift spin")).toStrictEqual(composed);
  });

  test("scale composes after rotate", () => {
    registerCSS(`
      .grow { scale: 2; }
      .spin { rotate: 45deg; }
    `);

    expect(styleOf("grow spin")).toStrictEqual({
      transform: [{ rotateZ: "45deg" }, { scaleX: 2 }, { scaleY: 2 }],
    });
  });
});

describe("a var() fallback holding a transform function", () => {
  /**
   * The compiler wraps a `transform` fallback in the LIST the property always
   * is, so `var(--x, translate(10px, 20px))` reaches the resolver as a list
   * holding a list holding the function. `translate()` then resolves to two
   * entries — a third level — and the resolver flattened one.
   *
   * The surviving entry was an array, which is not a transform React Native can
   * read, so the whole declaration was dropped as `transform: []`. A function
   * that expands to ONE entry (`scale(2)`) fits in the two levels flattening
   * covered, which is why this only shows on the multi-entry functions.
   */
  test.each([
    ["translate(10px, 20px)", [{ translateX: 10 }, { translateY: 20 }]],
    ["skew(10deg, 20deg)", [{ skewX: "10deg" }, { skewY: "20deg" }]],
    ["scale(2)", [{ scale: 2 }]],
  ])("transform: var(--never, %s)", (value, expected) => {
    registerCSS(`.deferred { transform: var(--never-declared, ${value}); }`);

    expect(styleOf("deferred")).toStrictEqual({ transform: expected });
  });
});

describe("flex writes every longhand it sets", () => {
  /**
   * `flexBasis` takes the keyword — `DimensionValue` includes `'auto'` — and
   * the compile-time route writes it. Dropping it at runtime leaves whatever a
   * lower-precedence rule set, so `.basis { flex-basis: 0 } .auto { flex: auto }`
   * reset the basis when written out and kept the stale `0` through a `var()`.
   */
  test.each([
    ["auto", { flexGrow: 1, flexShrink: 1, flexBasis: "auto" }],
    ["none", { flexGrow: 0, flexShrink: 0, flexBasis: "auto" }],
    ["1 1 auto", { flexGrow: 1, flexShrink: 1, flexBasis: "auto" }],
  ])("flex: var(--grow) with --grow: %s", (value, expected) => {
    registerCSS(`
      :root { --grow: ${value}; }
      @media (prefers-color-scheme: dark) { :root { --grow: 2; } }
      .literal { flex: ${value}; }
      .deferred { flex: var(--grow); }
    `);

    expect(styleOf("deferred")).toStrictEqual(expected);
    expect(styleOf("literal")).toStrictEqual(expected);
  });

  test("a deferred flex resets a basis an earlier rule set", () => {
    registerCSS(`
      :root { --grow: auto; }
      @media (prefers-color-scheme: dark) { :root { --grow: 2; } }
      .basis { flex-basis: 0; }
      .deferred { flex: var(--grow); }
    `);

    expect(styleOf("basis deferred")).toStrictEqual({
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: "auto",
    });
  });
});

describe("a variable resolves to the same value whoever read it first", () => {
  /**
   * `line-height` is the one property whose meaning turns on the UNIT — `1.5`
   * is a ratio of the font size and `20px` is twenty pixels — so
   * `resolveDimension` classifies the declaration a `var()` resolves to rather
   * than the number it produced.
   *
   * It learned the classification from a side effect: it handed `varResolver` a
   * `resolve` that recorded each candidate, and read back the last one recorded.
   * `varResolver` memoises a name it has already resolved for this element, and
   * a memo hit answers without calling `resolve` at all — so the recording never
   * ran, the length was read as a ratio, and the font size was applied twice.
   *
   * Which meant the element's line height depended on whether ANOTHER
   * declaration in the rule happened to read the same variable first.
   */
  test.each(["length", "ratio"] as const)("an element-scoped %s", (kind) => {
    const value = kind === "length" ? "2em" : "1.5";
    const expected = kind === "length" ? 20 : 15;

    registerCSS(
      `.alone { font-size: 10px; --leading: ${value}; line-height: var(--leading); }
       .after { font-size: 10px; --leading: ${value}; width: var(--leading); line-height: var(--leading); }`,
      { inlineVariables: false },
    );

    expect(styleOf("alone")).toStrictEqual({
      fontSize: 10,
      lineHeight: expected,
    });

    expect(styleOf("after")).toStrictEqual({
      fontSize: 10,
      width: kind === "length" ? 20 : 1.5,
      lineHeight: expected,
    });
  });

  test("an inherited length", () => {
    registerCSS(`
      :root { --leading: 2em; }
      @media (prefers-color-scheme: dark) { :root { --leading: 3em; } }
      .after { font-size: 10px; width: var(--leading); line-height: var(--leading); }
    `);

    expect(styleOf("after")).toStrictEqual({
      fontSize: 10,
      width: 20,
      lineHeight: 20,
    });
  });
});

describe("a value supplied from JavaScript reads as the CSS it is", () => {
  /**
   * `parseVariableValue` mirrors the compiler's tokeniser for a value that never
   * passed through it, and one of the compiler's rules is that numbers around a
   * solidus are a `<ratio>` written back as one string — `aspect-ratio: 16 / 9`.
   *
   * That rule belongs to a whole declaration VALUE. Inside a function's argument
   * list the solidus means something else: css-color-4 §4 puts the alpha after
   * one, so `rgb(255 0 0 / 0.5)` is four arguments and a separator, not a ratio.
   * Collapsing them handed `rgb()` a single string where it reads a list, and the
   * declaration was dropped — a themed colour that renders as no colour at all.
   */
  test("a modern-syntax colour", () => {
    registerCSS(`
      .provided { color: var(--brand); }
      .literal { color: rgb(255 0 0 / 0.5); }
    `);

    expect(
      providedStyleOf("provided", { "--brand": "rgb(255 0 0 / 0.5)" })?.color,
    ).toBe("rgba(255, 0, 0, 0.5)");

    // The two spellings are one colour to React Native, which is the claim the
    // string comparison above cannot make on its own.
    expect(processColor("rgba(255, 0, 0, 0.5)")).toBe(
      processColor(styleOf("literal")?.color as string),
    );
  });

  test("a ratio, which is still a ratio", () => {
    registerCSS(`.provided { aspect-ratio: var(--ratio); }`);

    expect(providedStyleOf("provided", { "--ratio": "16 / 9" })).toStrictEqual({
      aspectRatio: "16 / 9",
    });
  });

  test("a division inside calc()", () => {
    registerCSS(`.provided { width: var(--half); }`);

    expect(
      providedStyleOf("provided", { "--half": "calc(10 / 2)" }),
    ).toStrictEqual({
      width: 5,
    });
  });
});

describe("border-style writes what React Native can render, per edge", () => {
  /**
   * `border-style` is two declarations wearing one name: four edges that agree
   * are React Native's single `borderStyle`, and four that disagree are the
   * per-edge CSS names, which React Native ignores but which are at least not
   * wrong about three of the edges.
   *
   * The runtime mapped all four positions onto the one `borderStyle` key, so a
   * declaration whose edges differ was two values for one key — which
   * `repeatShorthandHandler` resolved by dropping the declaration whole, on the
   * premise that `parseBorderStyle` did the same. It does not: it emits the
   * per-edge keys.
   *
   * The keyword set is the second half of the same disagreement. React Native
   * renders three of CSS's ten line styles, and the compile-time route drops the
   * other seven per edge — so `border-style: none` produces no style at all, not
   * an inert `borderStyle: "none"`.
   */
  test.each([
    [
      "solid dashed dotted solid",
      {
        borderTopStyle: "solid",
        borderRightStyle: "dashed",
        borderBottomStyle: "dotted",
        borderLeftStyle: "solid",
      },
    ],
    [
      "solid dashed",
      {
        borderTopStyle: "solid",
        borderRightStyle: "dashed",
        borderBottomStyle: "solid",
        borderLeftStyle: "dashed",
      },
    ],
    ["solid", { borderStyle: "solid" }],
    ["dashed dashed dashed dashed", { borderStyle: "dashed" }],
    // One expressible edge among three that are not — a rejected edge does not
    // discard the ones beside it.
    ["solid double groove ridge", { borderTopStyle: "solid" }],
  ])("border-style: var(--edges) with --edges: %s", (value, expected) => {
    registerCSS(`
      :root { --edges: ${value}; }
      @media (prefers-color-scheme: dark) { :root { --edges: dotted; } }
      .literal { border-style: ${value}; }
      .deferred { border-style: var(--edges); }
    `);

    expect(styleOf("deferred")).toStrictEqual(expected);
    expect(styleOf("literal")).toStrictEqual(expected);
  });

  test.each(["none", "double"])(
    "every edge unrenderable: --edges: %s",
    (value) => {
      registerCSS(`
      :root { --edges: ${value}; }
      @media (prefers-color-scheme: dark) { :root { --edges: dotted; } }
      .literal { border-style: ${value}; }
      .deferred { border-style: var(--edges); }
    `);

      // No style key either way. The routes differ in what an element with no
      // style at all receives — a declaration the COMPILER dropped leaves the
      // rule with nothing to write, while one dropped at runtime has already
      // created the object it would have written into. React Native reads both
      // as no style, and `shorthands/transition.ts` names the same difference.
      expect(styleOf("deferred")).toStrictEqual({});
      expect(styleOf("literal")).toBeUndefined();
    },
  );
});
