import { compile } from "react-native-css/compiler";
import { INHERIT_VARIABLE_PREFIX } from "react-native-css/utilities";

/**
 * The PUBLISH half of CSS property inheritance, asserted at the compiler.
 *
 * The runtime half is covered by `__tests__/native/inheritance.test.tsx`.
 * Splitting them matters: a rendered assertion can pass because the runtime
 * compensated for a wrong descriptor, so what the compiler emits is pinned
 * here on its own.
 */

/** The `[name, value]` variable pairs a class publishes. */
const variablesFor = (css: string, className = "a") => {
  const sheet = compile(css).stylesheet();
  const rules = sheet.s?.find(([name]) => name === className)?.[1];
  return (rules?.[0] as { v?: [string, unknown][] } | undefined)?.v ?? [];
};

const inheritedFrom = (css: string, className = "a") =>
  Object.fromEntries(
    variablesFor(css, className)
      .filter(([name]) => name.startsWith(INHERIT_VARIABLE_PREFIX))
      .map(([name, value]) => [
        name.slice(INHERIT_VARIABLE_PREFIX.length),
        value,
      ]),
  );

test("an inherited property is published as a variable", () => {
  expect(inheritedFrom(`.a { color: red; }`)).toStrictEqual({ color: "#f00" });
});

test("a NON-inherited property publishes nothing", () => {
  // The guard on the property set. Box properties must never reach a
  // descendant's text style.
  expect(
    inheritedFrom(`
      .a {
        background-color: red;
        margin: 10px;
        padding: 4px;
        border-width: 2px;
        width: 100px;
        text-decoration-line: underline;
      }
    `),
  ).toStrictEqual({});
});

test("the `font` shorthand publishes each longhand it expands to", () => {
  // Shorthands need no special handling because they are expanded before the
  // descriptor is published. This pins that: if `parseFont` ever emitted a
  // single `font` descriptor instead, the shorthand would silently stop
  // inheriting and only this test would notice.
  expect(
    inheritedFrom(`.a { font: italic 700 24px/1.5 Arial; }`),
  ).toStrictEqual(
    expect.objectContaining({
      fontFamily: "Arial",
      fontSize: 24,
      fontStyle: "italic",
      fontWeight: 700,
    }),
  );
});

test("a var() with a single definition is published already inlined", () => {
  // The compiler folds a variable that has exactly one definition, so the
  // published value is the literal — there is no reference left to carry.
  expect(
    inheritedFrom(`
      :root { --brand: red; }
      .a { color: var(--brand); }
    `).color,
  ).toBe("#f00");
});

test("a var() the compiler cannot inline is published as a reference", () => {
  // Two definitions under different conditions defeat the single-definition
  // inliner, so the reference survives into the published value. That is the
  // case that matters for a theme: the DESCENDANT resolves it against its own
  // variable scope, so a nearer override still wins rather than being baked in
  // at publish time.
  const published = inheritedFrom(`
    :root { --brand: red; }
    @media (prefers-color-scheme: dark) { :root { --brand: blue; } }
    .a { color: var(--brand); }
  `);

  expect(Array.isArray(published.color)).toBe(true);
  expect(published.color).toStrictEqual(expect.arrayContaining(["var"]));
});

test("a dynamic (function-valued) declaration is published as its descriptor", () => {
  // Not every inherited value is a literal. `line-height` compiles to a
  // StyleFunction, and the descriptor is what gets published — the runtime
  // resolves it with the same options the normal style pipeline uses.
  const published = inheritedFrom(`.a { line-height: 1.5; }`);

  expect(Array.isArray(published.lineHeight)).toBe(true);
});

test("publishing does not disturb the element's own declarations", () => {
  // The publish is additive: the rule still carries its normal `d`
  // declarations, so an element that declares a property still renders it.
  const sheet = compile(`.a { color: red; }`).stylesheet();
  const rule = sheet.s?.find(([name]) => name === "a")?.[1]?.[0] as
    | { d?: unknown[] }
    | undefined;

  expect(rule?.d).toStrictEqual([{ color: "#f00" }]);
});

test("the currentcolor channel IS the inherited-property channel", () => {
  // `currentcolor` used to read a variable of its own, published beside the
  // inherited-property one and holding the same value. One channel, so the two
  // can never disagree — and so `color: inherit` has a single name to skip the
  // element's own scope on.
  expect(
    variablesFor(`.a { color: red; }`).map(([name]) => name),
  ).toStrictEqual([`${INHERIT_VARIABLE_PREFIX}color`]);
});

test("property names are matched case-insensitively", () => {
  // CSS property names are case-insensitive per spec, so `COLOR` and
  // `Font-Size` are valid declarations an author or preprocessor may emit.
  expect(
    inheritedFrom(
      `.a { COLOR: red; Font-Size: 24px; TEXT-TRANSFORM: uppercase; }`,
    ),
  ).toStrictEqual({
    // Published under the CANONICAL React Native spelling regardless of how
    // the declaration was cased — `fontsize` would be ignored by React Native.
    color: "#f00",
    fontSize: 24,
    textTransform: "uppercase",
  });
});

test("a property whose name merely starts with an inherited one is not published", () => {
  // `color` is inherited; `caret-color` and `background-color` are not. A
  // prefix or substring match would wrongly publish both.
  expect(
    inheritedFrom(`.a { background-color: red; caret-color: blue; }`),
  ).toStrictEqual({});
});

test("an unknown or custom property is not published", () => {
  expect(inheritedFrom(`.a { --custom: red; }`)).toStrictEqual({});
});

test("keyframes do not publish inherited properties", () => {
  // A keyframe declares values for an animation timeline, not for a subtree —
  // publishing from one would leak an animation's intermediate value to every
  // descendant.
  const sheet = compile(`
    @keyframes fade { from { color: red; } to { color: blue; } }
  `).stylesheet();

  expect(JSON.stringify(sheet)).not.toContain(INHERIT_VARIABLE_PREFIX);
});

/**
 * `light-dark()` compiles to TWO rules: the base rule carrying the light value,
 * and an extra rule gated on `@media (prefers-color-scheme: dark)` carrying the
 * dark one. Both must publish the value THEY hold, or a descendant inherits a
 * colour the ancestor is not rendering.
 */
const rulesFor = (css: string, className = "a") =>
  (compile(css)
    .stylesheet()
    .s?.find(([name]) => name === className)?.[1] ?? []) as {
    v?: [string, unknown][];
    m?: unknown;
  }[];

const publishedColour = (rule: { v?: [string, unknown][] }) =>
  rule.v?.find(([name]) => name === `${INHERIT_VARIABLE_PREFIX}color`)?.[1];

test("light-dark() publishes the DARK value from the dark rule", () => {
  const rules = rulesFor(`.a { color: light-dark(#333333, #eeeeee); }`);

  // Two rules, and the one carrying a media condition is the dark one.
  expect(rules).toHaveLength(2);
  const [lightRule, darkRule] = rules;

  expect(lightRule?.m).toBeUndefined();
  expect(darkRule?.m).toStrictEqual([["=", "prefers-color-scheme", "dark"]]);

  expect(publishedColour(lightRule ?? {})).toBe("#333");
  expect(publishedColour(darkRule ?? {})).toBe("#eee");
});
