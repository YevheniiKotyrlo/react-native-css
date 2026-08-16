import { render, screen } from "@testing-library/react-native";
import { VariableContextProvider } from "react-native-css";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

/**
 * CSS Custom Properties (CSS Variables Level 1) and the CSS Properties and
 * Values API (`@property`).
 *
 * Custom properties are the one CSS feature with no React Native equivalent at
 * all, so the library implements the whole cascade itself — `varResolver` in
 * `src/native/styles/variables.ts`, the `VariableContext` in
 * `src/native-internal/variables.tsx`, and the compiler's `inlineVariables`
 * pass. The specs are therefore the only yardstick, and every divergence is
 * the library's own.
 *
 * These tests pin ACTUAL behaviour. Divergences from the spec are marked
 * `GAP:` / `SUSPECTED DEFECT:` so the assertion reads as a record of what the
 * library does today, not as an endorsement.
 *
 * A note that explains several tests below: the compiler inlines any custom
 * property DECLARED EXACTLY ONCE at build time (`inlineVariables`, on by
 * default). Tests that need runtime resolution therefore declare each variable
 * twice, in two rules, so the optimisation does not fire. Every variable name
 * in this file is unique, because `:root` variables are process-global and
 * survive the `beforeEach` stylesheet reset.
 */

/* -------------------------------------------------------------------------
 * var() resolution and fallbacks — CSS Variables Level 1 §3
 * ---------------------------------------------------------------------- */

test("an undefined variable falls back to the fallback value", () => {
  registerCSS(`.fb-simple { width: var(--fb-missing, 10px); }`);

  render(<View testID={testID} className="fb-simple" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 10 });
});

test("fallbacks nest", () => {
  registerCSS(`.fb-nested { width: var(--fb-n1, var(--fb-n2, 20px)); }`);

  render(<View testID={testID} className="fb-nested" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 20 });
});

test("everything after the first comma is one fallback, commas included", () => {
  registerCSS(`
    .fb-commas { font-family: var(--fb-c1, Helvetica, Arial, sans-serif); }
    .fb-comma-list { box-shadow: var(--fb-c2, 0 1px 2px red, 0 2px 4px blue); }
    .fb-comma-single { box-shadow: var(--fb-c3, 0 1px 2px red); }
  `);

  render(
    <View>
      <View testID="family" className="fb-commas" />
      <View testID="list" className="fb-comma-list" />
      <View testID="single" className="fb-comma-single" />
    </View>,
  );

  // React Native takes ONE family name (`TextStyle.fontFamily` is `string`), so
  // a font stack collapses to its first entry and cannot show where the fallback
  // ended. `box-shadow` keeps its whole list, so the pair below is what proves
  // the commas stayed INSIDE the fallback: a fallback cut at the first comma
  // would leave one shadow here, and the single-shadow class is what one shadow
  // looks like.
  expect(screen.getByTestId("family").props.style).toStrictEqual({
    fontFamily: "Helvetica",
  });
  expect(screen.getByTestId("list").props.style).toStrictEqual({
    boxShadow: [
      { offsetX: 0, offsetY: 1, blurRadius: 2, color: "red" },
      { offsetX: 0, offsetY: 2, blurRadius: 4, color: "blue" },
    ],
  });
  expect(screen.getByTestId("single").props.style).toStrictEqual({
    boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: "red" }],
  });
});

test("a comma-bearing fallback survives into a comma-taking function", () => {
  registerCSS(`.fb-rgb { color: rgb(var(--fb-c2, 255, 0, 0)); }`);

  render(<View testID={testID} className="fb-rgb" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "rgb(255, 0, 0)",
  });
});

test("an undefined variable with no fallback drops only its own declaration", () => {
  registerCSS(`.fb-none { width: var(--fb-nope); height: 5px; }`);

  render(<View testID={testID} className="fb-none" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ height: 5 });
});

test("an invalid-at-computed-value-time declaration does not fall back to the previous one", () => {
  // CSS Variables Level 1 §3.1: a declaration whose var() cannot be
  // substituted is invalid at computed-value time — the property becomes
  // unset, it does NOT revert to the earlier `width: 3px` in the cascade.
  registerCSS(`.fb-iacvt { width: 3px; width: var(--fb-iacvt-nope); }`);

  render(<View testID={testID} className="fb-iacvt" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({});
});

test("a trailing comma is an empty fallback, not a missing one", () => {
  registerCSS(`.fb-empty-arg { width: var(--fb-e1,); height: 4px; }`);

  render(<View testID={testID} className="fb-empty-arg" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ height: 4 });
});

test("an empty custom property value substitutes empty, so the fallback is not used", () => {
  registerCSS(`.fb-empty-val { --fb-e2: ; width: var(--fb-e2, 30px); }`);

  render(<View testID={testID} className="fb-empty-val" />);

  expect(screen.getByTestId(testID).props.style).toBeUndefined();
});

test("a defined variable beats its own fallback", () => {
  registerCSS(`
    .fb-def-a { --fb-def: 1px; }
    .fb-def-b { --fb-def: 2px; }
    .fb-def-use { width: var(--fb-def, 99px); }
  `);

  render(<View testID={testID} className="fb-def-a fb-def-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 1 });
});

test("whitespace around the name and the value is insignificant", () => {
  registerCSS(`.ws-pad { --ws-a:    12px   ; width: var( --ws-a ); }`);

  render(<View testID={testID} className="ws-pad" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 12 });
});

test("custom property names are case-sensitive", () => {
  registerCSS(`
    .cs-use { --CS-Mixed: 4px; width: var(--cs-mixed, 88px); }
    .cs-other { --CS-Mixed: 9px; }
  `);

  render(<View testID={testID} className="cs-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 88 });
});

test("a long non-cyclic reference chain resolves", () => {
  const declarations = Array.from(
    { length: 40 },
    (_unused, index) => `--dp-${index}: var(--dp-${index + 1});`,
  ).join(" ");

  registerCSS(
    `.deep-chain { width: var(--dp-0); ${declarations} --dp-40: 7px; }`,
    {
      inlineVariables: false,
    },
  );

  render(<View testID={testID} className="deep-chain" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 7 });
});

/* -------------------------------------------------------------------------
 * Compile-time inlining — the optimisation that discards scope
 * ---------------------------------------------------------------------- */

// CSS Variables Level 1 §2 — a custom property is an inherited property, so
// `.inline-src`'s declaration is visible to `.inline-src` and its descendants
// and to nothing else. `.inline-use` has no ancestor at all, so the reference is
// invalid at computed-value time and `color` stays unset.
//
// The compiler folds a custom property into a `var()` only where it can PROVE
// the referencing element has the property: a universal unconditional scope
// (`:root`, `html`, `:host`, `*`), or the same declaration block. Folding on the
// weaker test of "declared exactly once anywhere" leaked a value into rules that
// could never see it.
test("a variable declared in another rule does not reach an unrelated element", () => {
  registerCSS(`
    .inline-src { --inline-x: red; }
    .inline-use { color: var(--inline-x); }
  `);

  render(<View testID={testID} className="inline-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({});
});

test("a variable declared twice is left to runtime, and scope is respected", () => {
  registerCSS(`
    .inline2-src1 { --inline2-x: red; }
    .inline2-src2 { --inline2-x: blue; }
    .inline2-use { color: var(--inline2-x); }
  `);

  render(<View testID={testID} className="inline2-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * Scoping and the cascade
 * ---------------------------------------------------------------------- */

test(":root variables are visible everywhere", () => {
  registerCSS(`
    :root { --sc-root: 11px; }
    .sc-root-other { --sc-root: 12px; }
    .sc-root-use { width: var(--sc-root); }
  `);

  render(<View testID={testID} className="sc-root-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 11 });
});

test("an ancestor declaration overrides :root", () => {
  registerCSS(`
    :root { --sc-anc: 11px; }
    .sc-anc-p { --sc-anc: 22px; }
    .sc-anc-other { --sc-anc: 33px; }
    .sc-anc-use { width: var(--sc-anc); }
  `);

  render(
    <View className="sc-anc-p">
      <View testID={testID} className="sc-anc-use" />
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 22 });
});

test("the nearest ancestor wins when an intermediate element redefines", () => {
  registerCSS(`
    .sc-mid-a { --sc-mid: 1px; }
    .sc-mid-b { --sc-mid: 2px; }
    .sc-mid-c { --sc-mid: 3px; }
    .sc-mid-use { width: var(--sc-mid); }
  `);

  render(
    <View className="sc-mid-a">
      <View className="sc-mid-b">
        <View testID={testID} className="sc-mid-use" />
      </View>
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 2 });
});

test("a variable is visible through an ancestor that declares nothing", () => {
  registerCSS(`
    .sc-pub-p { --sc-pub: 5px; }
    .sc-pub-other { --sc-pub: 6px; }
    .sc-pub-use { width: var(--sc-pub); }
  `);

  render(
    <View className="sc-pub-p">
      <View>
        <View testID={testID} className="sc-pub-use" />
      </View>
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 5 });
});

test("a sibling's declaration is not visible", () => {
  registerCSS(`
    .sc-sib-p { --sc-sib: 1px; }
    .sc-sib-other { --sc-sib: 2px; }
    .sc-sib-use { width: var(--sc-sib, 40px); }
  `);

  render(
    <View>
      <View className="sc-sib-p">
        <View testID="scoped" className="sc-sib-use" />
      </View>
      <View testID="unscoped" className="sc-sib-use" />
    </View>,
  );

  expect(screen.getByTestId("scoped").props.style).toStrictEqual({ width: 1 });
  expect(screen.getByTestId("unscoped").props.style).toStrictEqual({
    width: 40,
  });
});

test("a variable may be used before it is declared in source order", () => {
  registerCSS(`
    .sc-order-use { width: var(--sc-order); --sc-order: 6px; }
    .sc-order-other { --sc-order: 7px; }
  `);

  render(<View testID={testID} className="sc-order-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 6 });
});

test("the last matching rule wins, regardless of className attribute order", () => {
  registerCSS(`
    .sc-cas-a { --sc-cas: 1px; }
    .sc-cas-b { --sc-cas: 2px; }
    .sc-cas-use { width: var(--sc-cas); }
  `);

  const { getByTestId } = render(
    <View testID={testID} className="sc-cas-b sc-cas-a sc-cas-use" />,
  );

  expect(getByTestId(testID).props.style).toStrictEqual({ width: 2 });
});

test("specificity orders competing custom property declarations", () => {
  registerCSS(`
    .sc-spec-a.sc-spec-b { --sc-spec: 1px; }
    .sc-spec-a { --sc-spec: 2px; }
    .sc-spec-use { width: var(--sc-spec); }
  `);

  render(<View testID={testID} className="sc-spec-a sc-spec-b sc-spec-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 1 });
});

test("!important applies to custom property declarations", () => {
  registerCSS(`
    .sc-imp-a { --sc-imp: 1px !important; }
    .sc-imp-b { --sc-imp: 2px; }
    .sc-imp-use { width: var(--sc-imp); }
  `);

  render(<View testID={testID} className="sc-imp-b sc-imp-a sc-imp-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 1 });
});

test("a variable declared inside a matching media query applies", () => {
  registerCSS(`
    .sc-med-a { --sc-med: 1px; }
    @media (min-width: 1px) { .sc-med-b { --sc-med: 2px; } }
    .sc-med-use { width: var(--sc-med); }
  `);

  render(<View testID={testID} className="sc-med-a sc-med-b sc-med-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 2 });
});

// CSS Variables Level 1 §2 — custom properties cascade like any other property,
// so an element's OWN declaration beats a value inherited from an ancestor.
// `varResolver` therefore consults the element's own declarations before the
// inherited `VariableContext` (`src/native/styles/variables.ts`), and keys both
// on PRESENCE: a name the element declares shadows an ancestor's even when the
// declared value computes to nothing.
test("the element's own declaration beats an ancestor's", () => {
  registerCSS(`
    .sh-anc { --sh-x: 1px; }
    .sh-anc-other { --sh-x: 9px; }
    .sh-self { --sh-x: 2px; width: var(--sh-x); }
    .sh-self-other { --sh-x: 8px; }
  `);

  render(
    <View className="sh-anc">
      <View testID={testID} className="sh-self" />
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 2 });
});

test("an element's own declaration applies when no ancestor declares the name", () => {
  registerCSS(`
    .sh2-self { --sh2-x: 2px; width: var(--sh2-x); }
    .sh2-other { --sh2-x: 8px; }
  `);

  render(<View testID={testID} className="sh2-self" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 2 });
});

test("a * declaration supplies a variable everywhere", () => {
  registerCSS(`
    * { --uni-a: 5px; }
    .uni-a-use { width: var(--uni-a); }
  `);

  render(<View testID={testID} className="uni-a-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 5 });
});

// GAP: Selectors Level 4 §16 — `:root` has specificity (0,1,0) and `*` has
// (0,0,0), so the `:root` declaration must win. `varResolver` consults the
// universal store before the root store, so `*` wins instead. CSS requires
// `width: 6`.
test("a * declaration outranks :root", () => {
  registerCSS(`
    * { --uni-b: 5px; }
    :root { --uni-b: 6px; }
    .uni-b-use { width: var(--uni-b); }
  `);

  render(<View testID={testID} className="uni-b-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 5 });
});

test("an ancestor declaration outranks a * declaration", () => {
  registerCSS(`
    * { --uni-c: 5px; }
    .uni-c-anc { --uni-c: 7px; }
    .uni-c-other { --uni-c: 8px; }
    .uni-c-use { width: var(--uni-c); }
  `);

  render(
    <View className="uni-c-anc">
      <View testID={testID} className="uni-c-use" />
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 7 });
});

/* -------------------------------------------------------------------------
 * Substitution semantics — where var() is resolved
 * ---------------------------------------------------------------------- */

test("an inherited property carrying a var() resolves when nothing redefines it", () => {
  registerCSS(`
    .su-ctl-p { color: var(--su-ctl); --su-ctl: red; }
    .su-ctl-other { --su-ctl: pink; }
  `);

  render(
    <View className="su-ctl-p">
      <Text testID={testID} />
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "red",
  });
});

// SUSPECTED DEFECT: CSS Variables Level 1 §3 — var() is substituted at the
// element that DECLARES the property, so `.su-p`'s `color` computes to `red`
// there and descendants inherit that COMPUTED value. An intermediate element
// redefining `--su-c` cannot retroactively change an ancestor's computed
// colour. The library inherits the unresolved var() REFERENCE and re-resolves
// it in each consumer's own variable scope, so the intermediate redefinition
// wins. CSS requires `color: red`.
test("an inherited var() reference is re-resolved in the consumer's scope", () => {
  registerCSS(`
    .su-p { color: var(--su-c); --su-c: red; }
    .su-p-other { --su-c: pink; }
    .su-mid { --su-c: blue; }
    .su-mid-other { --su-c: green; }
  `);

  render(
    <View className="su-p">
      <View className="su-mid">
        <Text testID={testID} />
      </View>
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "blue",
  });
});

// SUSPECTED DEFECT: same break, one level of indirection deeper. `.su2-p`'s
// `--su2-a` computes to `red` at the declaring element, so every descendant
// inherits `--su2-a: red` no matter what they do to `--su2-b`. The library
// inherits `--su2-a` as the raw `var(--su2-b)` reference and re-resolves it,
// so redefining `--su2-b` on a descendant changes it. CSS requires
// `color: red`.
test("an inherited variable that references another variable is re-resolved too", () => {
  registerCSS(`
    .su2-p { --su2-a: var(--su2-b); --su2-b: red; }
    .su2-p-other { --su2-a: 1px; --su2-b: pink; }
    .su2-mid { --su2-b: blue; }
    .su2-mid-other { --su2-b: teal; }
    .su2-use { color: var(--su2-a); }
  `);

  render(
    <View className="su2-p">
      <View className="su2-mid">
        <View testID={testID} className="su2-use" />
      </View>
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "blue",
  });
});

test("a fallback is resolved against the consumer's inherited scope", () => {
  registerCSS(`
    .su3-use { width: var(--su3-a, var(--su3-b)); }
    .su3-p { --su3-b: 31px; }
    .su3-other { --su3-b: 32px; }
  `);

  render(
    <View className="su3-p">
      <View testID={testID} className="su3-use" />
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 31 });
});

/* -------------------------------------------------------------------------
 * Invalid at computed-value time — CSS Variables Level 1 §3.1
 * ---------------------------------------------------------------------- */

// GAP: substituting `notacolor` into `color` yields a declaration that is
// invalid at computed-value time, so `color` must become unset (and therefore
// inherit). The library passes the raw token straight through to the React
// Native style object, where it is not a colour.
test("a variable holding a non-colour leaks the raw token into color", () => {
  registerCSS(`
    .iv-col-use { --iv-col: notacolor; color: var(--iv-col); }
    .iv-col-other { --iv-col: alsonot; }
  `);

  render(<View testID={testID} className="iv-col-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "notacolor",
  });
});

// GAP: same break for a length. CSS requires `width` to be unset (initial
// `auto`); the library emits the string `"banana"` as a React Native width.
test("a variable holding a non-length leaks the raw token into width", () => {
  registerCSS(`
    .iv-len-use { --iv-len: banana; width: var(--iv-len); }
    .iv-len-other { --iv-len: kiwi; }
  `);

  render(<View testID={testID} className="iv-len-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    width: "banana",
  });
});

// GAP: `width: 10` (no unit) is invalid in CSS, so the declaration is invalid
// at computed-value time. The library accepts it as a unitless React Native
// length.
test("a variable holding a unitless number is accepted as a length", () => {
  registerCSS(`
    .iv-num-use { --iv-num: 10; width: var(--iv-num); }
    .iv-num-other { --iv-num: 20; }
  `);

  render(<View testID={testID} className="iv-num-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 10 });
});

// GAP: a custom property may hold an arbitrary token stream, including one
// that looks like a whole declaration. Substituting it into `width` is invalid
// at computed-value time, so CSS requires `width` to be unset. The library
// emits the token stream as an array.
test("a variable holding a whole declaration leaks a token array", () => {
  registerCSS(`
    .iv-decl-use { --iv-decl: color: red; width: var(--iv-decl); }
    .iv-decl-other { --iv-decl: color: blue; }
  `);

  render(<View testID={testID} className="iv-decl-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    width: ["color", "red"],
  });
});

test("a variable resolves correctly inside calc()", () => {
  registerCSS(`
    .iv-calc-use { --iv-calc: 10px; width: calc(var(--iv-calc) * 2); }
    .iv-calc-other { --iv-calc: 20px; }
  `);

  render(<View testID={testID} className="iv-calc-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 20 });
});

test("a variable may supply only part of a value", () => {
  registerCSS(`
    .iv-part-use { --iv-part: 3; width: calc(var(--iv-part) * 1px); }
    .iv-part-other { --iv-part: 4; }
  `);

  render(<View testID={testID} className="iv-part-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 3 });
});

test("guaranteed-invalid `initial` in a custom property triggers the fallback", () => {
  registerCSS(`
    .kw-init-use { --kw-init: initial; width: var(--kw-init, 15px); }
    .kw-init-other { --kw-init: 1px; }
  `);

  render(<View testID={testID} className="kw-init-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 15 });
});

// A custom property is an INHERITED property, so `unset` computes to `inherit`
// on it (css-cascade-4 §7.3). With no ancestor value to inherit, `--kw-unset`
// holds the guaranteed-invalid value — exactly as `initial` leaves it above —
// and the fallback is what the `var()` substitutes.
test("`unset` in a custom property computes to `inherit`, so the fallback is used", () => {
  registerCSS(`
    .kw-unset-use { --kw-unset: unset; width: var(--kw-unset, 16px); }
    .kw-unset-other { --kw-unset: 1px; }
  `);

  render(<View testID={testID} className="kw-unset-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    width: 16,
  });
});

/* -------------------------------------------------------------------------
 * Shorthands substituted from a variable
 * ---------------------------------------------------------------------- */

// CSS Variables Level 1 §3 — substitution happens before the declaration is
// parsed, so `padding: var(--x)` with `--x: 10px 20px` parses exactly like the
// literal `padding: 10px 20px`. Both routes therefore owe the same four
// longhands: React Native's `padding` is a single `DimensionValue`
// (`StyleSheetTypes.d.ts`), so a two-value list under that key is not a style it
// can read.
test("a padding shorthand supplied by a variable expands like the literal", () => {
  registerCSS(`
    .sh-pad-literal { padding: 10px 20px; }
    .sh-pad-var { --sh-pad: 10px 20px; padding: var(--sh-pad); }
    .sh-pad-other { --sh-pad: 1px 2px; }
  `);

  render(
    <View>
      <View testID="literal" className="sh-pad-literal" />
      <View testID="through-var" className="sh-pad-var" />
    </View>,
  );

  expect(screen.getByTestId("literal").props.style).toStrictEqual({
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 20,
    paddingRight: 20,
  });
  expect(screen.getByTestId("through-var").props.style).toStrictEqual({
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 20,
    paddingRight: 20,
  });
});

// `margin`, whose four values are read clockwise from the top.
test("a margin shorthand supplied by a variable expands like the literal", () => {
  registerCSS(`
    .sh-mar-literal { margin: 1px 2px 3px 4px; }
    .sh-mar-var { --sh-mar: 1px 2px 3px 4px; margin: var(--sh-mar); }
    .sh-mar-other { --sh-mar: 9px; }
  `);

  render(
    <View>
      <View testID="literal" className="sh-mar-literal" />
      <View testID="through-var" className="sh-mar-var" />
    </View>,
  );

  expect(screen.getByTestId("literal").props.style).toStrictEqual({
    marginTop: 1,
    marginRight: 2,
    marginBottom: 3,
    marginLeft: 4,
  });
  expect(screen.getByTestId("through-var").props.style).toStrictEqual({
    marginTop: 1,
    marginRight: 2,
    marginBottom: 3,
    marginLeft: 4,
  });
});

// A `border` shorthand DOES expand through a variable — but the colour is not
// normalised on the var() path (`red` rather than the `#f00` the literal path
// produces), so the two paths disagree on the value they emit.
test("a border shorthand supplied by a variable expands but skips colour normalisation", () => {
  registerCSS(`
    .sh-bor-literal { border: 2px solid red; }
    .sh-bor-var { --sh-bor: 2px solid red; border: var(--sh-bor); }
    .sh-bor-other { --sh-bor: 1px solid blue; }
  `);

  render(
    <View>
      <View testID="literal" className="sh-bor-literal" />
      <View testID="through-var" className="sh-bor-var" />
    </View>,
  );

  expect(screen.getByTestId("literal").props.style).toStrictEqual({
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "#f00",
  });
  expect(screen.getByTestId("through-var").props.style).toStrictEqual({
    borderWidth: 2,
    borderStyle: "solid",
    borderColor: "red",
  });
});

test("a transform supplied by a variable matches the literal form", () => {
  registerCSS(`
    .sh-tr-literal { transform: translateX(10px); }
    .sh-tr-var { --sh-tr: translateX(10px); transform: var(--sh-tr); }
    .sh-tr-other { --sh-tr: translateX(20px); }
  `);

  render(
    <View>
      <View testID="literal" className="sh-tr-literal" />
      <View testID="through-var" className="sh-tr-var" />
    </View>,
  );

  expect(screen.getByTestId("literal").props.style).toStrictEqual({
    transform: [{ translateX: 10 }],
  });
  expect(screen.getByTestId("through-var").props.style).toStrictEqual({
    transform: [{ translateX: 10 }],
  });
});

/* -------------------------------------------------------------------------
 * @property — CSS Properties and Values API Level 1
 * ---------------------------------------------------------------------- */

test("@property initial-value supplies the value when nothing declares the variable", () => {
  registerCSS(`
    @property --pr-init {
      syntax: '<length>';
      inherits: true;
      initial-value: 42px;
    }
    .pr-init-use { width: var(--pr-init); }
  `);

  render(<View testID={testID} className="pr-init-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 42 });
});

test("an ordinary declaration beats the registered initial-value", () => {
  registerCSS(`
    @property --pr-decl {
      syntax: '<length>';
      inherits: true;
      initial-value: 10px;
    }
    .pr-decl-use { --pr-decl: 20px; width: var(--pr-decl); }
    .pr-decl-other { --pr-decl: 30px; }
  `);

  render(<View testID={testID} className="pr-decl-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 20 });
});

test("a :root declaration beats the registered initial-value", () => {
  registerCSS(`
    @property --pr-root {
      syntax: '<length>';
      inherits: true;
      initial-value: 1px;
    }
    :root { --pr-root: 2px; }
    .pr-root-use { width: var(--pr-root); }
  `);

  render(<View testID={testID} className="pr-root-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 2 });
});

test("the universal syntax with no initial-value is accepted", () => {
  registerCSS(`
    @property --pr-uni { syntax: '*'; inherits: true; }
    .pr-uni-use { width: var(--pr-uni, 78px); }
  `);

  render(<View testID={testID} className="pr-uni-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 78 });
});

// CSS Properties and Values API Level 1 §2.2 — `inherits: false` means a
// descendant that does not declare the property gets the registered
// INITIAL-VALUE, not the ancestor's value. `extractPropertyRule`
// (`src/compiler/compiler.ts`) records the flag as a `vn` entry and the runtime
// variable lookup skips the inherited scope for a name it holds, so the
// ancestor's `blue` never reaches the descendant and the registered `red` does.
test("@property inherits:false does not inherit", () => {
  registerCSS(`
    @property --pr-noinherit {
      syntax: '<color>';
      inherits: false;
      initial-value: red;
    }
    .pr-noinherit-p { --pr-noinherit: blue; }
    .pr-noinherit-other { --pr-noinherit: green; }
    .pr-noinherit-use { color: var(--pr-noinherit); }
  `);

  render(
    <View className="pr-noinherit-p">
      <View testID={testID} className="pr-noinherit-use" />
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });
});

// GAP: CSS Properties and Values API Level 1 §2.1 — a declaration whose value
// does not parse against the registered `syntax` is invalid, and at
// computed-value time the property falls back to its `initial-value`. The
// `syntax` descriptor is never read, so `banana` is stored and substituted
// verbatim. CSS requires `width: 5px`.
test("@property syntax is not enforced, so a mismatched value is substituted verbatim", () => {
  registerCSS(`
    @property --pr-syntax {
      syntax: '<length>';
      inherits: true;
      initial-value: 5px;
    }
    .pr-syntax-use { --pr-syntax: banana; width: var(--pr-syntax); }
    .pr-syntax-other { --pr-syntax: kiwi; }
  `);

  render(<View testID={testID} className="pr-syntax-use" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    width: "banana",
  });
});

// CSS Properties and Values API Level 1 §3 — when `syntax` is not the universal
// definition, `initial-value` is REQUIRED, and a @property rule missing it "is
// invalid and must be ignored". Ignoring one rule is the whole remedy; the rest
// of the stylesheet is unaffected.
//
// The underlying lightningcss parse used to throw, because `compile()` did not
// pass `errorRecovery`, so the whole sheet was rejected and `.pr-blast-a` and
// `.pr-blast-b` never registered.
test("an invalid @property rule is ignored and its siblings survive", () => {
  registerCSS(`
    .pr-blast-a { width: 5px; }
    @property --pr-blast { syntax: '<length>'; inherits: true; }
    .pr-blast-b { height: 6px; }
  `);

  render(<View testID={testID} className="pr-blast-a pr-blast-b" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    width: 5,
    height: 6,
  });
});

// The `inherits` descriptor is likewise required, and its absence invalidates
// only the @property rule.
test("a @property rule missing the inherits descriptor is ignored", () => {
  registerCSS(`
    @property --pr-noinh { syntax: '<length>'; initial-value: 9px; }
    .pr-noinh-use { width: var(--pr-noinh); }
  `);

  render(<View testID={testID} className="pr-noinh-use" />);

  // The rule registers; the variable it referenced was never defined, so the
  // declaration resolves to nothing rather than taking the sheet down.
  expect(screen.getByTestId(testID).props.style).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * Malformed var()
 * ---------------------------------------------------------------------- */

// CSS Variables Level 1 §3 — `var(notavar, 5px)` is a parse error in one
// DECLARATION, so that declaration is dropped and the rest of the stylesheet is
// unaffected. The compile used to throw instead, losing every rule in the file.
test("a var() with a non-custom-property name drops only its own rule", () => {
  registerCSS(`
    .badname-a { width: var(notavar, 5px); }
    .badname-b { height: 5px; }
  `);

  render(<View testID={testID} className="badname-a" />);
  expect(screen.getByTestId(testID).props.style).toBeUndefined();
  screen.unmount();

  render(<View testID={testID} className="badname-b" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({ height: 5 });
});

// Same for an empty var() — and the recovery is per DECLARATION, so the valid
// declaration beside it in the same rule survives.
test("an argument-less var() drops only its own declaration", () => {
  registerCSS(`.noargs-a { width: var(); height: 4px; }`);

  render(<View testID={testID} className="noargs-a" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ height: 4 });
});

/* -------------------------------------------------------------------------
 * VariableContextProvider
 * ---------------------------------------------------------------------- */

test("VariableContextProvider supplies a variable to its subtree", () => {
  registerCSS(`.vcp-supply { width: var(--vcp-a, 1px); }`);

  render(
    <VariableContextProvider value={{ "--vcp-a": 88 }}>
      <View testID="root" className="vcp-supply">
        <View testID="descendant" className="vcp-supply" />
      </View>
    </VariableContextProvider>,
  );

  expect(screen.getByTestId("root").props.style).toStrictEqual({ width: 88 });
  expect(screen.getByTestId("descendant").props.style).toStrictEqual({
    width: 88,
  });
});

test("the innermost VariableContextProvider wins", () => {
  registerCSS(`.vcp-nested { width: var(--vcp-b, 1px); }`);

  render(
    <VariableContextProvider value={{ "--vcp-b": 10 }}>
      <VariableContextProvider value={{ "--vcp-b": 20 }}>
        <View testID={testID} className="vcp-nested" />
      </VariableContextProvider>
    </VariableContextProvider>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 20 });
});

test("a stylesheet ancestor closer than the provider wins", () => {
  registerCSS(`
    .vcp-anc { --vcp-c: 3px; }
    .vcp-anc-other { --vcp-c: 4px; }
    .vcp-anc-use { width: var(--vcp-c); }
  `);

  render(
    <VariableContextProvider value={{ "--vcp-c": 99 }}>
      <View className="vcp-anc">
        <View testID={testID} className="vcp-anc-use" />
      </View>
    </VariableContextProvider>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 3 });
});

// The same cascade rule as "the element's own declaration beats an ancestor's"
// above, reached through the public provider API. A provider supplies an
// INHERITED value, so `.vcp-self`'s own `--vcp-d: 3px` outranks it.
test("the consuming element's own declaration beats VariableContextProvider", () => {
  registerCSS(`
    .vcp-self { --vcp-d: 3px; width: var(--vcp-d); }
    .vcp-self-other { --vcp-d: 4px; }
  `);

  render(
    <VariableContextProvider value={{ "--vcp-d": 99 }}>
      <View testID={testID} className="vcp-self" />
    </VariableContextProvider>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 3 });
});

// The public prop type is `Record<`--${string}`, StyleDescriptor>`, but the
// implementation only strips a leading `--` (`k.replace(/^--/, "")`), so an
// unprefixed key lands on the same internal name and resolves. Undocumented,
// and worth knowing before the prop type is tightened.
test("VariableContextProvider also accepts keys without the -- prefix", () => {
  registerCSS(`.vcp-noprefix { width: var(--vcp-e, 1px); }`);

  const unprefixed: Record<`--${string}`, number> = Object.fromEntries([
    ["vcp-e", 55],
  ]) as Record<`--${string}`, number>;

  render(
    <VariableContextProvider value={unprefixed}>
      <View testID={testID} className="vcp-noprefix" />
    </VariableContextProvider>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 55 });
});

test("VariableContextProvider parses a px-suffixed string into a number", () => {
  registerCSS(`.vcp-px { width: var(--vcp-f, 1px); }`);

  const pxValue: Record<`--${string}`, string> = { "--vcp-f": "44px" };

  render(
    <VariableContextProvider value={pxValue}>
      <View testID={testID} className="vcp-px" />
    </VariableContextProvider>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 44 });
});

/* -------------------------------------------------------------------------
 * Reference cycles
 * ---------------------------------------------------------------------- */

// CSS Variables Level 1 §3 — "if there is a cycle in the dependency graph, all
// the custom properties in the cycle must compute to their guaranteed-invalid
// value", which makes the consuming declaration invalid at computed-value time.
// The property is left unset: a well-defined, non-fatal outcome.
//
// `varResolver`'s cycle guard used to be dead code. The Set was read out of
// `options` with a default (`variableHistory = new Set()`) and never written
// back, so every recursive call allocated a fresh empty one and
// `variableHistory.has(name)` was always false. The resolver recursed until the
// JS stack was exhausted and render threw `RangeError`.
//
// The compiler's own `inlineVariables` pass has a working cycle guard
// (`flattenVar`), which is why reaching the runtime resolver needs either
// `inlineVariables: false` or — as the second test shows — a variable declared
// more than once, the condition that makes the compiler skip inlining under
// DEFAULT options.
test("a mutual reference cycle computes to invalid rather than overflowing", () => {
  registerCSS(
    `.cyc-a { width: var(--cyc-1); --cyc-1: var(--cyc-2); --cyc-2: var(--cyc-1); }`,
    { inlineVariables: false },
  );

  render(<View testID={testID} className="cyc-a" />);

  // The property is unset. Whether the emptied container survives as `{}`
  // or is dropped entirely is incidental; what CSS fixes is that `width`
  // has no value.
  expect(screen.getByTestId(testID).props.style?.width).toBeUndefined();
});

// The same cycle with the DEFAULT compiler options. Each variable is declared
// twice, so the compiler's single-use inlining does not fire and the cycle
// reaches the runtime resolver. Declaring one custom property more than once is
// the normal shape of themed CSS, which is what made the overflow reachable
// from ordinary input.
test("a reference cycle is handled under default compiler options", () => {
  registerCSS(`
    .cyc2-use { width: var(--cyc2-1); }
    .cyc2-p { --cyc2-1: var(--cyc2-2); --cyc2-2: var(--cyc2-1); }
    .cyc2-other { --cyc2-1: 1px; --cyc2-2: 2px; }
  `);

  render(<View testID={testID} className="cyc2-use cyc2-p" />);

  // The property is unset. Whether the emptied container survives as `{}`
  // or is dropped entirely is incidental; what CSS fixes is that `width`
  // has no value.
  expect(screen.getByTestId(testID).props.style?.width).toBeUndefined();
});

// A self-reference is a one-element cycle.
test("a self-referencing variable computes to invalid", () => {
  registerCSS(`.cyc3-a { width: var(--cyc3-1); --cyc3-1: var(--cyc3-1); }`, {
    inlineVariables: false,
  });

  render(<View testID={testID} className="cyc3-a" />);

  // The property is unset. Whether the emptied container survives as `{}`
  // or is dropped entirely is incidental; what CSS fixes is that `width`
  // has no value.
  expect(screen.getByTestId(testID).props.style?.width).toBeUndefined();
});

// A self-reference WITH a fallback is still a cycle, and CSS requires the
// fallback to be ignored rather than to rescue it — the declaration is invalid
// at computed-value time either way.
test("a self-referencing variable ignores its own fallback", () => {
  registerCSS(
    `.cyc4-a { width: var(--cyc4-1); --cyc4-1: var(--cyc4-1, 10px); }`,
    { inlineVariables: false },
  );

  render(<View testID={testID} className="cyc4-a" />);

  // The property is unset. Whether the emptied container survives as `{}`
  // or is dropped entirely is incidental; what CSS fixes is that `width`
  // has no value.
  expect(screen.getByTestId(testID).props.style?.width).toBeUndefined();
});

// The cycle need not live in one rule: an ancestor contributes one half through
// inheritance, so no single stylesheet rule looks cyclic on its own. This is
// also the case that reaches the `name in variables` branch, which recursed
// ahead of the guard and so escaped it even once the Set was shared.
test("a cycle inherited from an ancestor computes to invalid in the descendant", () => {
  registerCSS(`
    .cyc5-p { --cyc5-1: var(--cyc5-2); --cyc5-2: var(--cyc5-1); }
    .cyc5-other { --cyc5-1: 1px; --cyc5-2: 2px; }
    .cyc5-use { width: var(--cyc5-1); }
  `);

  render(
    <View className="cyc5-p">
      <View testID={testID} className="cyc5-use" />
    </View>,
  );

  // The property is unset. Whether the emptied container survives as `{}`
  // or is dropped entirely is incidental; what CSS fixes is that `width`
  // has no value.
  expect(screen.getByTestId(testID).props.style?.width).toBeUndefined();
});
