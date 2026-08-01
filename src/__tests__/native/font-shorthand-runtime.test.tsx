import { render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { registerCSS, testID } from "react-native-css/jest";

/**
 * The `font` shorthand when its value is only known once a `var()` resolves.
 *
 * `parseFont` expands the literal form from a value lightningcss has already
 * typed. This is the other half: the same six longhands reached from a flat
 * token list, because a `var()` is only a token list until it resolves.
 *
 * ## The slot that cannot be read from the resolved value alone
 *
 * CSS gives a bare `<number>` in the `/ <line-height>` slot a different meaning
 * from a `<length>` — `1.5` is one and a half font sizes, `30px` is thirty
 * pixels — and resolving a `var()` folds the unit away, so both arrive as the
 * same bare number. Guessing renders a 360px line box for a 30px declaration.
 *
 * The declared token settles it: `lookupVariable` hands back the variable's
 * DECLARATION beside its resolved value, so `"30px"` and `2.5` are still
 * distinguishable at exactly the position the resolved list holds the number.
 * Where no declaration is reachable the slot is refused rather than guessed.
 *
 * ## Why the parse is anchored on the solidus
 *
 * A size and a weight are both "a number, possibly with a unit" once the types
 * are gone — `font: 700 16px Arial` and `font: 16px/700 Arial` tokenise into
 * the same three kinds of thing — so scanning left to right and deciding which
 * number is which is the mistake this file exists to pin against. The solidus
 * cannot be anything else, so it anchors the parse.
 */

/** A variable the compiler cannot inline, so the value reaches the runtime. */
const twoDefinitions = (name: string, light: string, dark: string): string =>
  `:root { ${name}: ${light}; }
   @media (prefers-color-scheme: dark) { :root { ${name}: ${dark}; } }`;

function styleOf(css: string, className: string): unknown {
  registerCSS(css);

  return render(<Text testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style;
}

/* -------------------------------------------------------------------------
 * The line-height slot
 * ---------------------------------------------------------------------- */

test("a LENGTH line-height survives the round trip", () => {
  expect(
    styleOf(
      `${twoDefinitions("--f-len", "italic 12px/30px Georgia", "italic 9px/20px Georgia")}
       .a { font: var(--f-len); }`,
      "a",
    ),
  ).toStrictEqual({
    fontFamily: "Georgia",
    fontSize: 12,
    fontStyle: "italic",
    fontVariant: [],
    fontWeight: "normal",
    // Thirty pixels, NOT thirty font sizes. Read from the resolved value alone
    // this is the bare number 30, indistinguishable from the ratio — and 360 is
    // what multiplying it would produce.
    lineHeight: 30,
  });
});

test("a RATIO line-height multiplies the size declared beside it", () => {
  expect(
    styleOf(
      `${twoDefinitions("--f-ratio", "bold 16px/1.5 Verdana", "bold 12px/1.2 Verdana")}
       .a { font: var(--f-ratio); }`,
      "a",
    ),
  ).toStrictEqual({
    fontFamily: "Verdana",
    fontSize: 16,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "bold",
    // 1.5 x 16 — the size from the SAME declaration, which is what the
    // shorthand's own slot means and why it needs no `--__rn-css-em` lookup.
    lineHeight: 24,
  });
});

test("a PERCENTAGE line-height is that percentage of the size", () => {
  expect(
    styleOf(
      `${twoDefinitions("--f-pct", "20px/150% Arial", "16px/120% Arial")}
       .a { font: var(--f-pct); }`,
      "a",
    ),
  ).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 20,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
    lineHeight: 30,
  });
});

test("a shorthand with no line-height carries no key for one", () => {
  // Absent rather than defaulted: React Native's own leading is the right
  // answer for a declaration that named none, and inventing a number here
  // would silently override whatever the element inherited.
  expect(
    styleOf(
      `${twoDefinitions("--f-none", "16px Arial", "12px Arial")}
       .a { font: var(--f-none); }`,
      "a",
    ),
  ).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 16,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
  });
});

test("a PARTIALLY variable shorthand refuses the ambiguous slot", () => {
  // The documented limit. Here the `var()` covers only the line-height, so
  // there is no single declaration to read the unit from — and the resolved
  // value cannot distinguish `22px` from the ratio `22`. The other longhands
  // are unambiguous and all land; only the leading is withheld.
  expect(
    styleOf(
      `${twoDefinitions("--leading", "22px", "24px")}
       .a { font: 17px/var(--leading) Arial; }`,
      "a",
    ),
  ).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 17,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
  });
});

/* -------------------------------------------------------------------------
 * The prefix, in any order
 * ---------------------------------------------------------------------- */

test("style, weight and variant are read wherever they were written", () => {
  // css-fonts-4 §15.1 joins the prefix with `||`, so the order is the author's
  // choice and carries no meaning.
  const first = styleOf(
    `${twoDefinitions("--f-a", "italic small-caps 700 14px Arial", "normal 400 12px Arial")}
     .a { font: var(--f-a); }`,
    "a",
  );
  const second = styleOf(
    `${twoDefinitions("--f-b", "small-caps 700 italic 14px Arial", "normal 400 12px Arial")}
     .b { font: var(--f-b); }`,
    "b",
  );

  expect(first).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 14,
    fontStyle: "italic",
    fontVariant: ["small-caps"],
    fontWeight: 700,
  });
  expect(second).toStrictEqual(first);
});

test("the shorthand RESETS the longhands it does not name", () => {
  // `font:` is how an author cancels an inherited `small-caps` or a bold, so
  // the defaults are part of the declaration rather than a fallback.
  expect(
    styleOf(
      `${twoDefinitions("--f-plain", "16px Arial", "12px Arial")}
       .a { font: var(--f-plain); }`,
      "a",
    ),
  ).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 16,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
  });
});

test("a font-stretch keyword is dropped rather than read as a weight", () => {
  // React Native has no `fontStretch`, and `condensed` sits in the same `||`
  // group as the weight — so a prefix reader that took "the unrecognised
  // keyword" as a weight would ship `fontWeight: "condensed"`.
  expect(
    styleOf(
      `${twoDefinitions("--f-stretch", "condensed 700 16px Arial", "normal 400 12px Arial")}
       .a { font: var(--f-stretch); }`,
      "a",
    ),
  ).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 16,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: 700,
  });
});

test("a family stack narrows to its first entry", () => {
  // React Native's `fontFamily` is one family, not a stack — the same
  // narrowing every other route performs.
  expect(
    styleOf(
      `${twoDefinitions("--f-stack", "16px 'Helvetica Neue', Arial, sans-serif", "12px Arial")}
       .a { font: var(--f-stack); }`,
      "a",
    ),
  ).toStrictEqual({
    fontFamily: "Helvetica Neue",
    fontSize: 16,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
  });
});
