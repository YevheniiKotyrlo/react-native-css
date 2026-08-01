import { act, render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { colorScheme } from "react-native-css/runtime";

/**
 * Route equivalence for the text / font properties.
 *
 * The same declaration reaches React Native by different routes depending on
 * the shape of its value, and the routes do not share a resolver:
 *
 *   1. LITERAL          `.a { letter-spacing: 2px }`
 *                       fully resolved at compile time.
 *   2. INLINABLE VAR    a custom property with exactly ONE definition is folded
 *                       into the call site at compile time, so it behaves like
 *                       a literal.
 *   3. NON-INLINABLE VAR a custom property with a SECOND definition (here, one
 *                       inside `@media (prefers-color-scheme: dark)`) cannot be
 *                       folded, so the declaration is emitted as a runtime
 *                       function. This is the route that historically drifted.
 *   4. FALLBACK-ONLY VAR `var(--never-declared, 2px)` also defers to runtime.
 *   5. RUNTIME UNITS    `em` / `rem` / `vw` / `%` resolve at runtime even when
 *                       written literally.
 *   6. !important, and a value supplied inside a matching `@media` block.
 *
 * A test that asserts two routes produce the SAME style is the artifact worth
 * keeping — it locks the equivalence in. Where the routes disagree the actual
 * values of both are pinned, so a fix has to update this file deliberately.
 *
 * The default rem in these tests is 14 and the default viewport is 750x1334.
 */

function styleOf(className: string): unknown {
  const element = render(
    <Text testID={testID} className={className} />,
  ).getByTestId(testID);

  // `ReactTestInstance["props"]` has an `any`-valued index signature, so narrow
  // it once here rather than letting `any` leak into every assertion below.
  const props: Record<string, unknown> = element.props;

  return props.style;
}

/* -------------------------------------------------------------------------- *
 * The route matrix is real                                                    *
 * -------------------------------------------------------------------------- */

test("a var with a second definition genuinely defers to the runtime path", () => {
  // Proves route 3 is a different route and not just a differently-spelled
  // literal: the value tracks the colour scheme at runtime. Every "non-inlinable
  // var" case below is built this way, so this test underwrites all of them.
  registerCSS(`
    :root { --ls: 2px; }
    @media (prefers-color-scheme: dark) { :root { --ls: 3px; } }
    .a { letter-spacing: var(--ls); }
  `);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ letterSpacing: 2 });

  act(() => {
    colorScheme.set("dark");
  });

  expect(component.props.style).toStrictEqual({ letterSpacing: 3 });
});

/* -------------------------------------------------------------------------- *
 * color                                                                       *
 * -------------------------------------------------------------------------- */

test("color: a literal and an inlinable var normalize identically", () => {
  registerCSS(`
    :root { --c: red; }
    .lit { color: red; }
    .inl { color: var(--c); }
    .hex { color: #ff0000; }
    .fn { color: rgb(255 0 0); }
  `);

  // Every compile-time route lands on the same normalized hex, whatever syntax
  // the author used to spell the colour.
  expect(styleOf("lit")).toStrictEqual({ color: "#f00" });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("hex")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fn")).toStrictEqual(styleOf("lit"));
});

test("color: !important and @media agree with the plain literal", () => {
  registerCSS(`
    .lit { color: red; }
    .imp { color: red !important; }
    @media (min-width: 1px) { .med { color: red; } }
  `);

  expect(styleOf("lit")).toStrictEqual({ color: "#f00" });
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));
});

// SUSPECTED DEFECT: a named colour is normalized on the compile-time route but
// passed through verbatim on the runtime route.
//   literal `color: red`               -> { color: "#f00" }
//   NON-inlinable var holding `red`    -> { color: "red" }
//   fallback-only var `var(--x, red)`  -> { color: "red" }
// Per CSS the two are the same colour, and React Native happens to accept both
// spellings, so nothing renders wrong today. It is still a divergence with
// teeth: the runtime route hands React Native the raw (minified) CSS token
// instead of a value the library has validated, so a colour syntax lightningcss
// can minify but React Native cannot parse would reach the native side
// unchecked — and any consumer comparing two styles for equality sees "#f00"
// and "red" as different. Correct is the normalized form, on both routes.
test("color: SUSPECTED DEFECT — the runtime route emits the raw token, not the normalized hex", () => {
  registerCSS(`
    :root { --c: red; }
    @media (prefers-color-scheme: dark) { :root { --c: blue; } }
    .lit { color: red; }
    .rt { color: var(--c); }
    .fb { color: var(--never-declared, red); }
  `);

  expect(styleOf("lit")).toStrictEqual({ color: "#f00" });
  expect(styleOf("rt")).toStrictEqual({ color: "red" });
  expect(styleOf("fb")).toStrictEqual({ color: "red" });
});

test("color: the divergence is the SPELLING only — a hex-authored var agrees exactly", () => {
  // `rebeccapurple` and `#663399` are the same colour. lightningcss minifies the
  // hex to `#639` and the name to `rebeccapurple`, and the runtime route emits
  // whichever token survived minification. So a var authored as hex agrees with
  // the literal, and a var authored as a name does not — which pins the cause to
  // token pass-through rather than to a different colour computation.
  registerCSS(`
    :root { --named: rebeccapurple; }
    @media (prefers-color-scheme: dark) { :root { --named: red; } }
    :root { --hex: #663399; }
    @media (prefers-color-scheme: dark) { :root { --hex: red; } }
    .lit { color: rebeccapurple; }
    .rt-named { color: var(--named); }
    .rt-hex { color: var(--hex); }
  `);

  expect(styleOf("lit")).toStrictEqual({ color: "#639" });
  expect(styleOf("rt-hex")).toStrictEqual(styleOf("lit"));
  expect(styleOf("rt-named")).toStrictEqual({ color: "rebeccapurple" });
});

test("color: an alpha colour agrees across every route", () => {
  // `rgba(255,0,0,.5)` minifies to `#ff000080`, which is already the normalized
  // form — so both routes land on the same string and there is nothing to fix.
  registerCSS(`
    :root { --c: rgba(255, 0, 0, 0.5); }
    @media (prefers-color-scheme: dark) { :root { --c: rgba(0, 0, 255, 0.5); } }
    .lit { color: rgba(255, 0, 0, 0.5); }
    .rt { color: var(--c); }
  `);

  expect(styleOf("lit")).toStrictEqual({ color: "#ff000080" });
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
});

test("color: the runtime route stays reactive", () => {
  // The un-normalized value is still a live value, not a frozen one — which is
  // what makes the divergence above cosmetic-but-real rather than a total break.
  registerCSS(`
    :root { --c: red; }
    @media (prefers-color-scheme: dark) { :root { --c: blue; } }
    .a { color: var(--c); }
  `);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ color: "red" });

  act(() => {
    colorScheme.set("dark");
  });

  expect(component.props.style).toStrictEqual({ color: "blue" });
});

/* -------------------------------------------------------------------------- *
 * font-size                                                                   *
 * -------------------------------------------------------------------------- */

test("font-size: every var route agrees with the literal", () => {
  registerCSS(`
    :root { --a: 20px; }
    :root { --b: 20px; }
    @media (prefers-color-scheme: dark) { :root { --b: 30px; } }
    .lit { font-size: 20px; }
    .inl { font-size: var(--a); }
    .rt { font-size: var(--b); }
    .fb { font-size: var(--never-declared, 20px); }
    .imp { font-size: 20px !important; }
    @media (min-width: 1px) { .med { font-size: 20px; } }
  `);

  expect(styleOf("lit")).toStrictEqual({ fontSize: 20 });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fb")).toStrictEqual(styleOf("lit"));
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));
});

test("font-size: em and rem agree when no font-size is inherited", () => {
  // With nothing above it, `em` falls back to the root font size, so `2em` and
  // `2rem` must land on the same number. A divergence here would mean the em
  // resolver and the rem resolver disagree about the default.
  registerCSS(`.em { font-size: 2em; } .rem { font-size: 2rem; }`);

  expect(styleOf("em")).toStrictEqual({ fontSize: 28 });
  expect(styleOf("rem")).toStrictEqual(styleOf("em"));
});

test("font-size: em resolves against the INHERITED font size, not the root", () => {
  registerCSS(`.p { font-size: 20px; } .c { font-size: 2em; }`);

  const component = render(
    <View className="p">
      <Text testID={testID} className="c" />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual([
    { fontSize: 20 },
    { fontSize: 40 },
  ]);
});

// A percentage font-size is a percentage of the PARENT's computed font size
// (css-fonts-4 §3.5), which is the quantity `em` measures — so `200%` and `2em`
// are one declaration written two ways, and written out they compile to the
// same `em` function. With the default rem of 14 and nothing above the element,
// that is 28.
//
// Both routes reach it, and they get there differently. `parseFontSize` reads
// the percentage as the em multiplier it names; a `var()` never reaches that
// parser, because the declaration compiles unparsed and the variable is read at
// render. So the runtime route has a resolver of its own, and the percentage is
// resolved THERE, against the parent's em.
//
// The store is not what had to change. `:root { --p: 200% }` may be read by
// `width`, where `"200%"` is correct, and by `font-size` in the same
// stylesheet — so a stored value cannot carry the property it is destined for,
// because it does not have one. What was missing was a reader.
test("a percentage font-size resolves to the same number written out and through a var()", () => {
  registerCSS(`
    :root { --p: 200%; }
    @media (prefers-color-scheme: dark) { :root { --p: 300%; } }
    .lit { font-size: 200%; }
    .rt { font-size: var(--p); }
    .em { font-size: 2em; }
  `);

  expect(styleOf("lit")).toStrictEqual({ fontSize: 28 });
  expect(styleOf("rt")).toStrictEqual({ fontSize: 28 });
  // The `em` spelling of the same declaration, landing on the same number the
  // written-out percentage does.
  expect(styleOf("em")).toStrictEqual(styleOf("lit"));
});

// SUSPECTED DEFECT: calc() that mixes a runtime unit with a literal length
// drops the whole declaration.
//   `font-size: calc(10px + 2px)` -> { fontSize: 12 }         (both literal)
//   `font-size: calc(1rem + 2px)` -> { fontSize: 16 }         (rem folds at compile time)
//   `font-size: calc(1em + 2px)`  -> undefined                (em is runtime -> dropped)
// `1em` on its own resolves to 14 on the same stylesheet, so the runtime unit
// is not the problem — combining it with a literal term inside calc() is.
// Correct is 16, matching the rem line. The failure is silent: no warning, and
// the property simply never reaches React Native.
test("font-size: SUSPECTED DEFECT — calc() mixing em with a literal is silently dropped", () => {
  registerCSS(`
    .px { font-size: calc(10px + 2px); }
    .rem { font-size: calc(1rem + 2px); }
    .em { font-size: calc(1em + 2px); }
    .bare { font-size: 1em; }
  `);

  expect(styleOf("px")).toStrictEqual({ fontSize: 12 });
  expect(styleOf("rem")).toStrictEqual({ fontSize: 16 });
  expect(styleOf("bare")).toStrictEqual({ fontSize: 14 });
  expect(styleOf("em")).toBeUndefined();
});

/* -------------------------------------------------------------------------- *
 * font-family                                                                 *
 * -------------------------------------------------------------------------- */

test("font-family: a single family agrees across every route", () => {
  registerCSS(`
    :root { --a: Arial; }
    :root { --b: Arial; }
    @media (prefers-color-scheme: dark) { :root { --b: Georgia; } }
    .lit { font-family: Arial; }
    .inl { font-family: var(--a); }
    .rt { font-family: var(--b); }
    .fb { font-family: var(--never-declared, Arial); }
    .imp { font-family: Arial !important; }
    @media (min-width: 1px) { .med { font-family: Arial; } }
  `);

  expect(styleOf("lit")).toStrictEqual({ fontFamily: "Arial" });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fb")).toStrictEqual(styleOf("lit"));
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));
});

test("font-family: a quoted family with spaces agrees across routes and keeps its spaces", () => {
  registerCSS(`
    :root { --f: "Helvetica Neue"; }
    @media (prefers-color-scheme: dark) { :root { --f: Georgia; } }
    .lit { font-family: "Helvetica Neue"; }
    .rt { font-family: var(--f); }
  `);

  expect(styleOf("lit")).toStrictEqual({ fontFamily: "Helvetica Neue" });
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
});

// React Native's `fontFamily` is a single string (`TextStyle`, in
// `StyleSheetTypes.d.ts`) — it has no fallback-stack concept — so a stack keeps
// its first family and drops the rest, on every route. The rest is not
// recoverable elsewhere: naming a font that does not exist is what the fallback
// list is FOR, and React Native has nowhere to put it.
test("font-family: a font stack keeps its first family on every route", () => {
  registerCSS(`
    :root { --f: Arial, sans-serif; }
    @media (prefers-color-scheme: dark) { :root { --f: Georgia, serif; } }
    .lit { font-family: Arial, sans-serif; }
    .rt { font-family: var(--f); }
    .fb { font-family: var(--never-declared, Arial, sans-serif); }
  `);

  expect(styleOf("lit")).toStrictEqual({ fontFamily: "Arial" });
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fb")).toStrictEqual(styleOf("lit"));
});

/* -------------------------------------------------------------------------- *
 * font-weight                                                                 *
 * -------------------------------------------------------------------------- */

test("font-weight: a numeric weight agrees across every route and stays a number", () => {
  registerCSS(`
    :root { --a: 700; }
    :root { --b: 700; }
    @media (prefers-color-scheme: dark) { :root { --b: 400; } }
    .lit { font-weight: 700; }
    .inl { font-weight: var(--a); }
    .rt { font-weight: var(--b); }
    .fb { font-weight: var(--never-declared, 700); }
    .imp { font-weight: 700 !important; }
    @media (min-width: 1px) { .med { font-weight: 700; } }
  `);

  expect(styleOf("lit")).toStrictEqual({ fontWeight: 700 });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fb")).toStrictEqual(styleOf("lit"));
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));
});

test("font-weight: the `bold` keyword agrees across routes and is NOT converted to 700", () => {
  // Both routes keep the keyword. Worth pinning because a resolver that helpfully
  // mapped `bold` to 700 on one route only would be a silent divergence.
  registerCSS(`
    :root { --w: bold; }
    @media (prefers-color-scheme: dark) { :root { --w: 400; } }
    .lit { font-weight: bold; }
    .rt { font-weight: var(--w); }
  `);

  expect(styleOf("lit")).toStrictEqual({ fontWeight: "bold" });
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
});

/* -------------------------------------------------------------------------- *
 * font-style                                                                  *
 * -------------------------------------------------------------------------- */

test("font-style: italic agrees across every route", () => {
  registerCSS(`
    :root { --a: italic; }
    :root { --b: italic; }
    @media (prefers-color-scheme: dark) { :root { --b: normal; } }
    .lit { font-style: italic; }
    .inl { font-style: var(--a); }
    .rt { font-style: var(--b); }
    .fb { font-style: var(--never-declared, italic); }
    .imp { font-style: italic !important; }
    @media (min-width: 1px) { .med { font-style: italic; } }
  `);

  expect(styleOf("lit")).toStrictEqual({ fontStyle: "italic" });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fb")).toStrictEqual(styleOf("lit"));
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));
});

// SUSPECTED DEFECT: `oblique` is validated on the compile-time route and NOT on
// the runtime route — the divergence runs the opposite way to every other one
// in this file.
//   literal `font-style: oblique`             -> undefined  (dropped)
//   NON-inlinable var holding `oblique`       -> { fontStyle: "oblique" }
// React Native's `fontStyle` accepts only `normal` and `italic`, so dropping is
// the correct behaviour and the compile-time route is right. The runtime route
// forwards an unsupported keyword straight to the native side, where it is a
// render-time warning rather than a compile-time one.
test("font-style: SUSPECTED DEFECT — an unsupported keyword is dropped literally but forwarded at runtime", () => {
  registerCSS(`
    :root { --s: oblique; }
    @media (prefers-color-scheme: dark) { :root { --s: normal; } }
    .lit { font-style: oblique; }
    .rt { font-style: var(--s); }
  `);

  expect(styleOf("lit")).toBeUndefined();
  expect(styleOf("rt")).toStrictEqual({ fontStyle: "oblique" });
});

/* -------------------------------------------------------------------------- *
 * font-variant                                                                *
 * -------------------------------------------------------------------------- */

test("font-variant: the compile-time routes agree and produce an array", () => {
  registerCSS(`
    :root { --a: small-caps; }
    .lit { font-variant: small-caps; }
    .inl { font-variant: var(--a); }
    .imp { font-variant: small-caps !important; }
    @media (min-width: 1px) { .med { font-variant: small-caps; } }
    .num { font-variant: tabular-nums; }
  `);

  expect(styleOf("lit")).toStrictEqual({ fontVariant: ["small-caps"] });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));
  expect(styleOf("num")).toStrictEqual({ fontVariant: ["tabular-nums"] });
});

// Every route reaches `fontVariant`, including a value that only exists at
// runtime and one that comes from a `var()` fallback. Validating the keyword
// only where it is written literally dropped both — no style and no warning,
// so a font-variant behind a theme variable was a silently dead declaration.
test("font-variant reaches the same value on every route", () => {
  registerCSS(`
    :root { --v: small-caps; }
    @media (prefers-color-scheme: dark) { :root { --v: normal; } }
    .lit { font-variant: small-caps; }
    .rt { font-variant: var(--v); }
    .fb { font-variant: var(--never-declared, small-caps); }
  `);

  expect(styleOf("lit")).toStrictEqual({ fontVariant: ["small-caps"] });
  expect(styleOf("rt")).toStrictEqual({ fontVariant: ["small-caps"] });
  expect(styleOf("fb")).toStrictEqual({ fontVariant: ["small-caps"] });
});

// The `font-variant` shorthand takes a keyword from any of its longhands, and
// as many at once as the author likes — which is precisely the shape React
// Native's `fontVariant` array exists to carry.
test("font-variant carries every keyword it was given", () => {
  registerCSS(`
    .one { font-variant: small-caps; }
    .two { font-variant: small-caps tabular-nums; }
  `);

  expect(styleOf("one")).toStrictEqual({ fontVariant: ["small-caps"] });
  expect(styleOf("two")).toStrictEqual({
    fontVariant: ["small-caps", "tabular-nums"],
  });
});

// SUSPECTED DEFECT: the two font-variant longhands disagree about the SHAPE of
// the value they write to the same React Native prop.
//   `font-variant-numeric: tabular-nums` -> { fontVariant: ["tabular-nums"] }
//   `font-variant-caps: small-caps`      -> { fontVariant: ["small-caps"] }
// React Native's `fontVariant` is an array of strings. All three spellings
// agree on that shape; the caps longhand used to emit a bare string.
test("font-variant: every spelling emits the array shape React Native types", () => {
  registerCSS(`
    .numeric { font-variant-numeric: tabular-nums; }
    .caps { font-variant-caps: small-caps; }
    .shorthand { font-variant: small-caps; }
  `);

  expect(styleOf("numeric")).toStrictEqual({ fontVariant: ["tabular-nums"] });
  expect(styleOf("shorthand")).toStrictEqual({ fontVariant: ["small-caps"] });
  expect(styleOf("caps")).toStrictEqual({ fontVariant: ["small-caps"] });
});

/* -------------------------------------------------------------------------- *
 * letter-spacing                                                              *
 * -------------------------------------------------------------------------- */

test("letter-spacing: every var route agrees with the literal", () => {
  registerCSS(`
    :root { --a: 2px; }
    :root { --b: 2px; }
    @media (prefers-color-scheme: dark) { :root { --b: 3px; } }
    .lit { letter-spacing: 2px; }
    .inl { letter-spacing: var(--a); }
    .rt { letter-spacing: var(--b); }
    .fb { letter-spacing: var(--never-declared, 2px); }
    .imp { letter-spacing: 2px !important; }
    @media (min-width: 1px) { .med { letter-spacing: 2px; } }
  `);

  expect(styleOf("lit")).toStrictEqual({ letterSpacing: 2 });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fb")).toStrictEqual(styleOf("lit"));
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));
});

test("letter-spacing: a runtime unit resolves identically whether written literally or carried in a var", () => {
  // The `line-height` failure this suite exists to generalize was exactly this
  // case going wrong — a var carrying a length reached a resolver that treated
  // it as a multiplier. letter-spacing gets it right for em, rem and vw alike.
  registerCSS(`
    :root { --em: 0.5em; }
    @media (prefers-color-scheme: dark) { :root { --em: 1em; } }
    :root { --vw: 1vw; }
    @media (prefers-color-scheme: dark) { :root { --vw: 2vw; } }
    .lit-em { letter-spacing: 0.5em; }
    .rt-em { letter-spacing: var(--em); }
    .lit-rem { letter-spacing: 0.5rem; }
    .lit-vw { letter-spacing: 1vw; }
    .rt-vw { letter-spacing: var(--vw); }
  `);

  expect(styleOf("lit-em")).toStrictEqual({ letterSpacing: 7 });
  expect(styleOf("rt-em")).toStrictEqual(styleOf("lit-em"));
  // With no inherited font size, em falls back to the root font size, so
  // 0.5em and 0.5rem must land together.
  expect(styleOf("lit-rem")).toStrictEqual(styleOf("lit-em"));

  expect(styleOf("lit-vw")).toStrictEqual({ letterSpacing: 7.5 });
  expect(styleOf("rt-vw")).toStrictEqual(styleOf("lit-vw"));
});

test("letter-spacing: calc() over compile-time terms resolves on every route", () => {
  registerCSS(`
    :root { --c: calc(2px + 3px); }
    @media (prefers-color-scheme: dark) { :root { --c: calc(2px + 8px); } }
    .add { letter-spacing: calc(2px + 3px); }
    .rt { letter-spacing: var(--c); }
    .mul { letter-spacing: calc(2px * 2); }
    .rem { letter-spacing: calc(1rem + 2px); }
    .rem-rem { letter-spacing: calc(1rem + 1rem); }
  `);

  expect(styleOf("add")).toStrictEqual({ letterSpacing: 5 });
  expect(styleOf("rt")).toStrictEqual(styleOf("add"));
  expect(styleOf("mul")).toStrictEqual({ letterSpacing: 4 });
  expect(styleOf("rem")).toStrictEqual({ letterSpacing: 16 });
  expect(styleOf("rem-rem")).toStrictEqual({ letterSpacing: 28 });
});

// SUSPECTED DEFECT: calc() that ADDS a runtime unit to a literal length drops
// the declaration, while the same runtime unit alone — and the same calc() with
// multiplication — both work.
//   `letter-spacing: 0.5em`               -> { letterSpacing: 7 }
//   `letter-spacing: calc(0.5em * 2)`     -> { letterSpacing: 14 }
//   `letter-spacing: calc(0.5em + 2px)`   -> undefined   (should be 9)
//   `letter-spacing: 1vw`                 -> { letterSpacing: 7.5 }
//   `letter-spacing: calc(1vw + 2px)`     -> undefined   (should be 9.5)
// So neither calc() nor the runtime unit is individually the problem: it is the
// ADDITION of a runtime term and a literal term, which is the single most common
// way calc() is written. The same shape breaks font-size (see above), so this is
// one defect surfacing on every length-valued property rather than two.
test("letter-spacing: SUSPECTED DEFECT — calc() adding a runtime unit to a literal is silently dropped", () => {
  registerCSS(`
    .bare-em { letter-spacing: 0.5em; }
    .mul-em { letter-spacing: calc(0.5em * 2); }
    .add-em { letter-spacing: calc(0.5em + 2px); }
    .bare-vw { letter-spacing: 1vw; }
    .add-vw { letter-spacing: calc(1vw + 2px); }
  `);

  expect(styleOf("bare-em")).toStrictEqual({ letterSpacing: 7 });
  expect(styleOf("mul-em")).toStrictEqual({ letterSpacing: 14 });
  expect(styleOf("bare-vw")).toStrictEqual({ letterSpacing: 7.5 });

  expect(styleOf("add-em")).toBeUndefined();
  expect(styleOf("add-vw")).toBeUndefined();
});

// SUSPECTED DEFECT: a percentage letter-spacing is handed to React Native as the
// string "200%", the same shape font-size produces. React Native's
// `letterSpacing` takes a number only, so the declaration is inert.
test("letter-spacing: SUSPECTED DEFECT — a percentage is passed through as a string", () => {
  registerCSS(`.pct { letter-spacing: 200%; }`);

  expect(styleOf("pct")).toStrictEqual({ letterSpacing: "200%" });
});

/* -------------------------------------------------------------------------- *
 * text-align                                                                  *
 * -------------------------------------------------------------------------- */

test("text-align: every route agrees", () => {
  registerCSS(`
    :root { --a: center; }
    :root { --b: center; }
    @media (prefers-color-scheme: dark) { :root { --b: right; } }
    .lit { text-align: center; }
    .inl { text-align: var(--a); }
    .rt { text-align: var(--b); }
    .fb { text-align: var(--never-declared, center); }
    .imp { text-align: center !important; }
    @media (min-width: 1px) { .med { text-align: center; } }
  `);

  expect(styleOf("lit")).toStrictEqual({ textAlign: "center" });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fb")).toStrictEqual(styleOf("lit"));
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));
});

test("text-align: `justify` also agrees across routes", () => {
  // `justify` is the value React Native supports on Android only, so it is the
  // one most likely to be filtered by a platform-aware resolver on one route.
  registerCSS(`
    :root { --a: justify; }
    @media (prefers-color-scheme: dark) { :root { --a: left; } }
    .lit { text-align: justify; }
    .rt { text-align: var(--a); }
  `);

  expect(styleOf("lit")).toStrictEqual({ textAlign: "justify" });
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
});

/* -------------------------------------------------------------------------- *
 * text-transform                                                              *
 * -------------------------------------------------------------------------- */

test("text-transform: every route agrees", () => {
  registerCSS(`
    :root { --a: uppercase; }
    :root { --b: uppercase; }
    @media (prefers-color-scheme: dark) { :root { --b: lowercase; } }
    .lit { text-transform: uppercase; }
    .inl { text-transform: var(--a); }
    .rt { text-transform: var(--b); }
    .fb { text-transform: var(--never-declared, uppercase); }
    .imp { text-transform: uppercase !important; }
    @media (min-width: 1px) { .med { text-transform: uppercase; } }
  `);

  expect(styleOf("lit")).toStrictEqual({ textTransform: "uppercase" });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fb")).toStrictEqual(styleOf("lit"));
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));
});

test("text-transform: `capitalize` also agrees across routes", () => {
  registerCSS(`
    :root { --a: capitalize; }
    @media (prefers-color-scheme: dark) { :root { --a: none; } }
    .lit { text-transform: capitalize; }
    .rt { text-transform: var(--a); }
  `);

  expect(styleOf("lit")).toStrictEqual({ textTransform: "capitalize" });
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
});

/* -------------------------------------------------------------------------- *
 * text-decoration-line                                                        *
 * -------------------------------------------------------------------------- */

test("text-decoration-line: a single keyword agrees across every route", () => {
  registerCSS(`
    :root { --a: underline; }
    :root { --b: underline; }
    @media (prefers-color-scheme: dark) { :root { --b: line-through; } }
    .lit { text-decoration-line: underline; }
    .inl { text-decoration-line: var(--a); }
    .rt { text-decoration-line: var(--b); }
    .fb { text-decoration-line: var(--never-declared, underline); }
    .imp { text-decoration-line: underline !important; }
    @media (min-width: 1px) { .med { text-decoration-line: underline; } }
  `);

  expect(styleOf("lit")).toStrictEqual({ textDecorationLine: "underline" });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fb")).toStrictEqual(styleOf("lit"));
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));
});

test("text-decoration-line: `none` agrees across routes", () => {
  registerCSS(`
    :root { --a: none; }
    @media (prefers-color-scheme: dark) { :root { --a: underline; } }
    .lit { text-decoration-line: none; }
    .rt { text-decoration-line: var(--a); }
  `);

  expect(styleOf("lit")).toStrictEqual({ textDecorationLine: "none" });
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
});

// React Native's `textDecorationLine` is an enum of four strings, one of which
// is literally `"underline line-through"` (`TextStyle`, in
// `StyleSheetTypes.d.ts`). Two lines therefore have to reach it as that ONE
// string — joined in the CSS order the enum names, not the author's — so a
// two-member list is not a value it accepts.
test("text-decoration-line: two lines are one enum string on every route", () => {
  registerCSS(`
    :root { --a: underline line-through; }
    @media (prefers-color-scheme: dark) { :root { --a: underline; } }
    .lit { text-decoration-line: underline line-through; }
    .rt { text-decoration-line: var(--a); }
    .fb { text-decoration-line: var(--never-declared, underline line-through); }
  `);

  expect(styleOf("lit")).toStrictEqual({
    textDecorationLine: "underline line-through",
  });
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fb")).toStrictEqual(styleOf("lit"));
});

/* -------------------------------------------------------------------------- *
 * text-decoration-color                                                       *
 * -------------------------------------------------------------------------- */

test("text-decoration-color: the compile-time routes normalize identically", () => {
  registerCSS(`
    :root { --a: red; }
    .lit { text-decoration-color: red; }
    .inl { text-decoration-color: var(--a); }
    .imp { text-decoration-color: red !important; }
    @media (min-width: 1px) { .med { text-decoration-color: red; } }
  `);

  expect(styleOf("lit")).toStrictEqual({ textDecorationColor: "#f00" });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));
});

// SUSPECTED DEFECT: the same raw-token pass-through `color` has — pinned
// separately because it proves the divergence is in the shared colour handling
// and not in the `color` property specifically.
//   literal `text-decoration-color: red`  -> { textDecorationColor: "#f00" }
//   NON-inlinable var holding `red`       -> { textDecorationColor: "red" }
test("text-decoration-color: SUSPECTED DEFECT — the runtime route emits the raw token", () => {
  registerCSS(`
    :root { --a: red; }
    @media (prefers-color-scheme: dark) { :root { --a: blue; } }
    .lit { text-decoration-color: red; }
    .rt { text-decoration-color: var(--a); }
    .fb { text-decoration-color: var(--never-declared, red); }
  `);

  expect(styleOf("lit")).toStrictEqual({ textDecorationColor: "#f00" });
  expect(styleOf("rt")).toStrictEqual({ textDecorationColor: "red" });
  expect(styleOf("fb")).toStrictEqual(styleOf("rt"));
});

/* -------------------------------------------------------------------------- *
 * text-decoration-style                                                       *
 * -------------------------------------------------------------------------- */

test("text-decoration-style: every route agrees", () => {
  registerCSS(`
    :root { --a: dotted; }
    :root { --b: dotted; }
    @media (prefers-color-scheme: dark) { :root { --b: double; } }
    .lit { text-decoration-style: dotted; }
    .inl { text-decoration-style: var(--a); }
    .rt { text-decoration-style: var(--b); }
    .fb { text-decoration-style: var(--never-declared, dotted); }
    .imp { text-decoration-style: dotted !important; }
    @media (min-width: 1px) { .med { text-decoration-style: dotted; } }
  `);

  expect(styleOf("lit")).toStrictEqual({ textDecorationStyle: "dotted" });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fb")).toStrictEqual(styleOf("lit"));
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));
});

/* -------------------------------------------------------------------------- *
 * the text-decoration shorthand                                               *
 * -------------------------------------------------------------------------- */

// `textDecoration` is not a React Native style key — `TextStyle` declares
// `textDecorationLine`, `textDecorationStyle` and `textDecorationColor`
// (`StyleSheetTypes.d.ts`) and nothing that holds the shorthand — so the
// expansion is the only shape that renders, and every route owes it.
//
// The semantic colour is the shorthand's own doing rather than the route's: an
// omitted `text-decoration-color` is `currentcolor`, which this library maps to
// the platform label colour. The longhand tests above set no colour at all.
test("text-decoration: every route expands the shorthand into the longhands", () => {
  registerCSS(`
    :root { --a: underline; }
    @media (prefers-color-scheme: dark) { :root { --a: line-through; } }
    .lit { text-decoration: underline; }
    .rt { text-decoration: var(--a); }
    .fb { text-decoration: var(--never-declared, underline); }
  `);

  expect(styleOf("lit")).toStrictEqual({
    textDecorationLine: "underline",
    textDecorationColor: { semantic: ["label", "labelColor"] },
  });
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fb")).toStrictEqual(styleOf("lit"));
});

// SUSPECTED DEFECT: the shorthand silently discards its style component.
//   `text-decoration: underline dotted`
//     -> { textDecorationLine: "underline", textDecorationColor: <semantic> }
//   `text-decoration-style: dotted` (longhand)
//     -> { textDecorationStyle: "dotted" }
// The longhand works, so `textDecorationStyle` is supported — the shorthand
// parser just drops it. Correct is for the shorthand to set
// `textDecorationStyle: "dotted"` alongside the line.
test("text-decoration: SUSPECTED DEFECT — the shorthand drops its style component", () => {
  registerCSS(`
    .shorthand { text-decoration: underline dotted; }
    .longhand { text-decoration-style: dotted; }
    .with-color { text-decoration: underline red; }
  `);

  expect(styleOf("longhand")).toStrictEqual({ textDecorationStyle: "dotted" });
  expect(styleOf("shorthand")).toStrictEqual({
    textDecorationLine: "underline",
    textDecorationColor: { semantic: ["label", "labelColor"] },
  });
  // An explicit colour IS carried through, and suppresses the semantic default —
  // which pins the loss to the style component alone.
  expect(styleOf("with-color")).toStrictEqual({
    textDecorationLine: "underline",
    textDecorationColor: "#f00",
  });
});

/* -------------------------------------------------------------------------- *
 * text-shadow                                                                 *
 * -------------------------------------------------------------------------- */

test("text-shadow: offsets and radius agree across every route", () => {
  registerCSS(`
    :root { --a: 2px; }
    :root { --b: 2px; }
    @media (prefers-color-scheme: dark) { :root { --b: 5px; } }
    .lit { text-shadow: 1px 2px 3px red; }
    .inl { text-shadow: 1px var(--a) 3px red; }
    .imp { text-shadow: 1px 2px 3px red !important; }
    @media (min-width: 1px) { .med { text-shadow: 1px 2px 3px red; } }
    .rt { text-shadow: 1px var(--b) 3px red; }
  `);

  const expected = {
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 3,
  };

  expect(styleOf("lit")).toStrictEqual({
    ...expected,
    textShadowColor: "#f00",
  });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));

  // The geometry survives the runtime route intact; only the colour spelling
  // differs, for the reason pinned in the `color` section.
  expect(styleOf("rt")).toStrictEqual({ ...expected, textShadowColor: "red" });
});

test("text-shadow: an em offset resolves the same as the equivalent literal", () => {
  registerCSS(`
    .em { text-shadow: 1px 0.5em 3px red; }
    .px { text-shadow: 1px 7px 3px red; }
  `);

  expect(styleOf("em")).toStrictEqual(styleOf("px"));
  expect(styleOf("em")).toStrictEqual({
    textShadowOffset: { width: 1, height: 7 },
    textShadowRadius: 3,
    textShadowColor: "#f00",
  });
});

test("text-shadow: omitted radius and colour take documented defaults", () => {
  // Pinned so a change to the defaults is a deliberate edit rather than a
  // surprise — the semantic colour in particular is a value the author never
  // wrote, injected by the shorthand expansion.
  registerCSS(`
    .no-color { text-shadow: 1px 2px 3px; }
    .no-radius { text-shadow: 1px 2px; }
  `);

  expect(styleOf("no-color")).toStrictEqual({
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 3,
    textShadowColor: { semantic: ["label", "labelColor"] },
  });
  expect(styleOf("no-radius")).toStrictEqual({
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 0,
    textShadowColor: { semantic: ["label", "labelColor"] },
  });
});

/* -------------------------------------------------------------------------- *
 * vertical-align                                                              *
 * -------------------------------------------------------------------------- */

test("vertical-align: every route agrees", () => {
  registerCSS(`
    :root { --a: top; }
    :root { --b: top; }
    @media (prefers-color-scheme: dark) { :root { --b: bottom; } }
    .lit { vertical-align: top; }
    .inl { vertical-align: var(--a); }
    .rt { vertical-align: var(--b); }
    .fb { vertical-align: var(--never-declared, top); }
    .imp { vertical-align: top !important; }
    @media (min-width: 1px) { .med { vertical-align: top; } }
  `);

  expect(styleOf("lit")).toStrictEqual({ verticalAlign: "top" });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fb")).toStrictEqual(styleOf("lit"));
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));
});

test("vertical-align: `middle` also agrees across routes", () => {
  registerCSS(`
    :root { --a: middle; }
    @media (prefers-color-scheme: dark) { :root { --a: bottom; } }
    .lit { vertical-align: middle; }
    .rt { vertical-align: var(--a); }
  `);

  expect(styleOf("lit")).toStrictEqual({ verticalAlign: "middle" });
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
});

/* -------------------------------------------------------------------------- *
 * user-select                                                                 *
 * -------------------------------------------------------------------------- */

test("user-select: every route agrees", () => {
  registerCSS(`
    :root { --a: none; }
    :root { --b: none; }
    @media (prefers-color-scheme: dark) { :root { --b: text; } }
    .lit { user-select: none; }
    .inl { user-select: var(--a); }
    .rt { user-select: var(--b); }
    .fb { user-select: var(--never-declared, none); }
    .imp { user-select: none !important; }
    @media (min-width: 1px) { .med { user-select: none; } }
  `);

  expect(styleOf("lit")).toStrictEqual({ userSelect: "none" });
  expect(styleOf("inl")).toStrictEqual(styleOf("lit"));
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
  expect(styleOf("fb")).toStrictEqual(styleOf("lit"));
  expect(styleOf("imp")).toStrictEqual(styleOf("lit"));
  expect(styleOf("med")).toStrictEqual(styleOf("lit"));
});

test("user-select: `text` also agrees across routes", () => {
  registerCSS(`
    :root { --a: text; }
    @media (prefers-color-scheme: dark) { :root { --a: none; } }
    .lit { user-select: text; }
    .rt { user-select: var(--a); }
  `);

  expect(styleOf("lit")).toStrictEqual({ userSelect: "text" });
  expect(styleOf("rt")).toStrictEqual(styleOf("lit"));
});
