import { render, screen } from "@testing-library/react-native";
import { compile } from "react-native-css/compiler";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

import { StylesheetBuilder } from "../../compiler/stylesheet";

/**
 * The cascade rules a stylesheet is entitled to assume, and the places this
 * library used to break them.
 *
 * Every test here asserts the SPEC answer, with the clause it comes from. They
 * are grouped by the mechanism that decides the answer — custom-property
 * resolution order, the compiler's inlining pass, `@layer` rank, warning
 * attribution, and the `a` flag that decides whether a component is wrapped
 * for reanimated.
 *
 * Two conventions carried over from `custom-property-semantics.test.tsx`,
 * because the same machinery is under test:
 *
 * - The compiler folds any custom property DECLARED EXACTLY ONCE into its
 *   consumers at build time, so a test that needs runtime resolution declares
 *   the name in more than one rule.
 * - `:root` variables are process-global and survive the `beforeEach`
 *   stylesheet reset, so every name in this file is unique.
 */

function styleOf(id: string = testID): unknown {
  return screen.getByTestId(id).props.style;
}

/* -------------------------------------------------------------------------
 * 1. Custom-property resolution order — CSS Variables Level 1 §2
 *
 * A custom property cascades like any other property, so an element's OWN
 * declaration wins over the value it would otherwise inherit.
 * ---------------------------------------------------------------------- */

test("an element's own custom property beats an ancestor's", () => {
  registerCSS(`
    .cg1-anc { --cg1-oc: red; }
    .cg1-anc-other { --cg1-oc: pink; }
    .cg1-self { --cg1-oc: blue; color: var(--cg1-oc); }
    .cg1-self-other { --cg1-oc: green; }
  `);

  render(
    <View className="cg1-anc">
      <View testID={testID} className="cg1-self" />
    </View>,
  );

  // A colour carried through a custom property keeps the spelling it was
  // written with — only a literal declaration is normalised at compile time.
  expect(styleOf()).toStrictEqual({ color: "blue" });
});

test("an element's own custom property beats one two levels up", () => {
  registerCSS(`
    .cg1b-grand { --cg1b-x: 1px; }
    .cg1b-parent { --cg1b-x: 2px; }
    .cg1b-self { --cg1b-x: 3px; width: var(--cg1b-x); }
    .cg1b-other { --cg1b-x: 4px; }
  `);

  render(
    <View className="cg1b-grand">
      <View className="cg1b-parent">
        <View testID={testID} className="cg1b-self" />
      </View>
    </View>,
  );

  expect(styleOf()).toStrictEqual({ width: 3 });
});

test("an ancestor still supplies a name the element does not declare", () => {
  registerCSS(`
    .cg1c-anc { --cg1c-x: 1px; --cg1c-y: 5px; }
    .cg1c-anc-other { --cg1c-x: 9px; --cg1c-y: 9px; }
    .cg1c-self { --cg1c-x: 2px; width: var(--cg1c-x); height: var(--cg1c-y); }
    .cg1c-self-other { --cg1c-x: 8px; }
  `);

  render(
    <View className="cg1c-anc">
      <View testID={testID} className="cg1c-self" />
    </View>,
  );

  expect(styleOf()).toStrictEqual({ width: 2, height: 5 });
});

test("an element's own declaration wins for an inherited property too", () => {
  registerCSS(`
    .cg1d-anc { --cg1d-c: red; }
    .cg1d-anc-other { --cg1d-c: pink; }
    .cg1d-self { --cg1d-c: blue; color: var(--cg1d-c); }
    .cg1d-self-other { --cg1d-c: green; }
  `);

  render(
    <View className="cg1d-anc">
      <Text testID={testID} className="cg1d-self" />
    </View>,
  );

  expect(styleOf()).toStrictEqual({ color: "blue" });
});

/* -------------------------------------------------------------------------
 * 2. The compiler's single-declaration inlining pass — CSS Variables L1 §2
 *
 * Folding a custom property into its consumers is only sound when every
 * element that references the name is guaranteed to have it. A declaration in
 * a class scope carries no such guarantee.
 * ---------------------------------------------------------------------- */

test("a class-scoped custom property does not leak into an unrelated rule", () => {
  registerCSS(`
    .cg2-sc1 { --cg2-only: red; }
    .cg2-sc2 { color: var(--cg2-only); }
  `);

  render(<View testID={testID} className="cg2-sc2" />);

  // The rule still exists — `.cg2-sc2` declares `color` — but the declaration
  // resolves to nothing, which is what CSS calls invalid at computed-value
  // time. An empty style object is how this library reports that everywhere
  // (`calc(1px / 0)` produces the same).
  expect(styleOf()).toStrictEqual({});
});

test("a class-scoped custom property still reaches a descendant", () => {
  registerCSS(`
    .cg2b-sc1 { --cg2b-only: red; }
    .cg2b-sc2 { color: var(--cg2b-only); }
  `);

  render(
    <View className="cg2b-sc1">
      <View testID={testID} className="cg2b-sc2" />
    </View>,
  );

  expect(styleOf()).toStrictEqual({ color: "red" });
});

test("a class-scoped custom property still reaches the same element", () => {
  registerCSS(`
    .cg2c-sc1 { --cg2c-only: red; }
    .cg2c-sc2 { color: var(--cg2c-only); }
  `);

  render(<View testID={testID} className="cg2c-sc1 cg2c-sc2" />);

  expect(styleOf()).toStrictEqual({ color: "red" });
});

test(":root is a universal scope, so its declaration is still inlined", () => {
  // The optimisation is retained where it is sound: a `:root` declaration
  // reaches every element, so folding it into the consumer cannot invent a
  // value the element would not have had. Asserted on the COMPILED shape —
  // an inlined property leaves a literal declaration and no root variable,
  // where the runtime path leaves a `var()` style function plus a `vr` entry.
  expect(
    compile(`
      :root { --cg2d-root: red; }
      .cg2d-use { color: var(--cg2d-root); }
    `).stylesheet(),
  ).toStrictEqual({
    s: [
      [
        "cg2d-use",
        [
          {
            s: [1, 1],
            v: [["__rn-css-inherit-color", "#f00"]],
            d: [{ color: "#f00" }],
          },
        ],
      ],
    ],
  });
});

test("a universal-selector declaration is still inlined", () => {
  expect(
    compile(`
      * { --cg2e-uni: red; }
      .cg2e-use { color: var(--cg2e-uni); }
    `).stylesheet(),
  ).toStrictEqual({
    s: [
      [
        "cg2e-use",
        [
          {
            s: [1, 1],
            v: [["__rn-css-inherit-color", "#f00"]],
            d: [{ color: "#f00" }],
          },
        ],
      ],
    ],
  });
});

test("an html declaration is a universal scope too", () => {
  // `html { … }` compiles to no rule of its own, so the inlining pass is the
  // ONLY thing that can deliver the value — and it is sound to, because every
  // element descends from `html`.
  registerCSS(`
    html { --cg2f-html: red; }
    .cg2f-use { color: var(--cg2f-html); }
  `);

  render(<View testID={testID} className="cg2f-use" />);

  expect(styleOf()).toStrictEqual({ color: "#f00" });
});

test("a :root declaration inside a layer is still a universal scope", () => {
  // `@layer` is not a condition — everything inside it always applies — so a
  // layered `:root` declaration is as universal as an unlayered one. This is
  // the shape Tailwind v4 emits for its theme.
  registerCSS(`
    @layer cg2g-theme { :root { --cg2g-t: red; } }
    .cg2g-use { color: var(--cg2g-t); }
  `);

  render(<View testID={testID} className="cg2g-use" />);

  expect(styleOf()).toStrictEqual({ color: "#f00" });
});

test("a media-conditioned :root declaration is not inlined unconditionally", () => {
  // The declaration only applies when the query matches, so folding it into
  // the consumer would apply it always. The window is 750x1334 under the jest
  // preset, so this query does NOT match and the property has no value.
  registerCSS(`
    @media (min-width: 2000px) { :root { --cg2h-wide: red; } }
    .cg2h-use { color: var(--cg2h-wide); }
  `);

  render(<View testID={testID} className="cg2h-use" />);

  expect(styleOf()).toStrictEqual({});
});

test("a media-conditioned :root declaration applies when its query matches", () => {
  // The other half: restricting the inlining does not lose the value, it moves
  // it onto the runtime path where the query is actually evaluated.
  registerCSS(`
    @media (min-width: 100px) { :root { --cg2i-narrow: red; } }
    .cg2i-use { color: var(--cg2i-narrow); }
  `);

  render(<View testID={testID} className="cg2i-use" />);

  expect(styleOf()).toStrictEqual({ color: "red" });
});

/* -------------------------------------------------------------------------
 * 3. `@layer` rank — CSS Cascade Level 5 §6.4.4
 *
 * Unlayered normal declarations outrank every layered one, and layer order
 * outranks specificity.
 * ---------------------------------------------------------------------- */

test("an unlayered rule outranks a layered one declared after it", () => {
  registerCSS(
    `.cg3-a { color: blue; } @layer cg3-l { .cg3-a { color: red; } }`,
  );

  render(<View testID={testID} className="cg3-a" />);

  expect(styleOf()).toStrictEqual({ color: "#00f" });
});

test("an unlayered rule outranks a layered one declared before it", () => {
  registerCSS(
    `@layer cg3-m { .cg3-b { color: red; } } .cg3-b { color: blue; }`,
  );

  render(<View testID={testID} className="cg3-b" />);

  expect(styleOf()).toStrictEqual({ color: "#00f" });
});

test("an unlayered rule outranks a MORE specific layered one", () => {
  registerCSS(`
    @layer cg3-n { .cg3-c.cg3-d { color: red; } }
    .cg3-c { color: blue; }
  `);

  render(<View testID={testID} className="cg3-c cg3-d" />);

  expect(styleOf()).toStrictEqual({ color: "#00f" });
});

test("named layers keep their declared order among themselves", () => {
  // `@layer cg3-pb, cg3-pa;` declares `cg3-pa` LAST, so it has the higher
  // priority even though its rule comes first in the source.
  registerCSS(`
    @layer cg3-pb, cg3-pa;
    @layer cg3-pa { .cg3-e { color: red; } }
    @layer cg3-pb { .cg3-e { color: blue; } }
  `);

  render(<View testID={testID} className="cg3-e" />);

  expect(styleOf()).toStrictEqual({ color: "#f00" });
});

test("a later layer outranks an earlier layer's higher specificity", () => {
  registerCSS(`
    @layer cg3-base { .cg3-f.cg3-g { color: red; } }
    @layer cg3-util { .cg3-f { color: blue; } }
  `);

  render(<View testID={testID} className="cg3-f cg3-g" />);

  expect(styleOf()).toStrictEqual({ color: "#00f" });
});

test("specificity still decides within one layer", () => {
  registerCSS(`
    @layer cg3-solo {
      .cg3-h { color: blue; }
      .cg3-h.cg3-i { color: red; }
    }
  `);

  render(<View testID={testID} className="cg3-h cg3-i" />);

  expect(styleOf()).toStrictEqual({ color: "#f00" });
});

test("a nested layer sits below its parent layer's own declarations", () => {
  // CSS Cascade 5 §6.4.4 applies recursively: a layer's own declarations
  // outrank those of its sublayers.
  registerCSS(`
    @layer cg3-o {
      @layer cg3-inner { .cg3-j { color: red; } }
      .cg3-j { color: blue; }
    }
  `);

  render(<View testID={testID} className="cg3-j" />);

  expect(styleOf()).toStrictEqual({ color: "#00f" });
});

test("a nested layer sits below its parent wherever it is written", () => {
  // The same rule with the sublayer declared LAST, which is the ordering a
  // rank read off document order gets wrong on its own.
  registerCSS(`
    @layer cg3-p {
      .cg3-l { color: blue; }
      @layer cg3-tail { .cg3-l { color: red; } }
    }
  `);

  render(<View testID={testID} className="cg3-l" />);

  expect(styleOf()).toStrictEqual({ color: "#00f" });
});

test("sublayers keep their declared order among themselves", () => {
  registerCSS(`
    @layer cg3-q {
      @layer cg3-one { .cg3-m { color: red; } }
      @layer cg3-two { .cg3-m { color: blue; } }
    }
  `);

  render(<View testID={testID} className="cg3-m" />);

  expect(styleOf()).toStrictEqual({ color: "#00f" });
});

test("an important layered declaration still beats a normal unlayered one", () => {
  // Cascade 5 §6.4.4 reverses layer order for important declarations; the
  // coarser rule this library already applies — important beats normal — is
  // what decides here, and the layer rank must not override it.
  registerCSS(`
    .cg3-k { color: blue; }
    @layer cg3-imp { .cg3-k { color: red !important; } }
  `);

  render(<View testID={testID} className="cg3-k" />);

  expect(styleOf()).toStrictEqual({ color: "#f00" });
});

/* -------------------------------------------------------------------------
 * 4. Warning attribution
 *
 * A diagnostic names the declaration that caused it, or says it cannot.
 * ---------------------------------------------------------------------- */

test("the custom-declaration path names its own property", () => {
  // `mix-blend-mode` is one of the properties lightningcss does not model, so
  // it is parsed through `parseCustomDeclaration` — the third declaration path,
  // and the last one to name the declaration it is working on. Every warning
  // from it was either dropped or filed against an unrelated property.
  expect(compile(`.cg4-a { mix-blend-mode: frobnicate; }`).warnings()).toEqual({
    values: { "mix-blend-mode": ["frobnicate"] },
  });
});

test("a value warning does not cross a rule boundary", () => {
  // The offence is in `.cg4-c`; `.cg4-b` compiles cleanly. `color` is the last
  // property to name itself before the offending declaration, so a builder-wide
  // ambient property files the warning against it — blaming a declaration in
  // another rule that compiled without complaint.
  expect(
    compile(`
      .cg4-b { color: red; }
      .cg4-c { mix-blend-mode: frobnicate; }
    `).warnings(),
  ).toEqual({
    values: { "mix-blend-mode": ["frobnicate"] },
  });
});

test("a warning with no declaration in scope is recorded, not dropped", () => {
  // The fallback of last resort. Every declaration path names itself now, so
  // reaching this needs a warning raised before any declaration has been read —
  // which is what an at-rule preamble or a keyframe selector does. Recorded
  // under a reserved key rather than discarded: `<>` cannot appear in a CSS
  // property name, so it collides with nothing, and dropping it made a
  // stylesheet with a real fault compile clean.
  const builder = new StylesheetBuilder({});

  builder.addWarning("value", "frobnicate");

  expect(builder.getWarnings()).toStrictEqual({
    values: { "<unattributed>": ["frobnicate"] },
  });
});

test("addWarning files a value under the property it is given", () => {
  const builder = new StylesheetBuilder({});

  builder.addWarning("value", "frobnicate", "mix-blend-mode");

  expect(builder.getWarnings()).toStrictEqual({
    values: { "mix-blend-mode": ["frobnicate"] },
  });
});

test("an explicit property outranks the ambient one", () => {
  const builder = new StylesheetBuilder({});

  builder.setWarningProperty("color");
  builder.addWarning("value", "frobnicate", "mix-blend-mode");

  expect(builder.getWarnings()).toStrictEqual({
    values: { "mix-blend-mode": ["frobnicate"] },
  });
});

test("the ambient property is still the fallback", () => {
  const builder = new StylesheetBuilder({});

  builder.setWarningProperty("color");
  builder.addWarning("value", "frobnicate");

  expect(builder.getWarnings()).toStrictEqual({
    values: { color: ["frobnicate"] },
  });
});

test("the ambient property does not leak into a forked builder", () => {
  const builder = new StylesheetBuilder({});

  builder.setWarningProperty("color");
  const fork = builder.fork();
  fork.setWarningProperty("width");
  builder.addWarning("value", "frobnicate");

  expect(builder.getWarnings()).toStrictEqual({
    values: { color: ["frobnicate"] },
  });
});

/* -------------------------------------------------------------------------
 * 5. The `a` flag — which rules make a component Animated
 * ---------------------------------------------------------------------- */

test("a bare parametrized easing flags its rule as animated", () => {
  expect(
    compile(`
      .cg5-bezier { transition-timing-function: cubic-bezier(0.25, 0.5, 0.75, 1); }
      .cg5-steps { transition-timing-function: steps(4, end); }
      .cg5-keyword { transition-timing-function: ease-in; }
      .cg5-plain { width: 10px; }
    `)
      .stylesheet()
      .s?.map(([name, rules]) => [name, rules[0]?.a]),
  ).toStrictEqual([
    ["cg5-bezier", true],
    ["cg5-steps", true],
    ["cg5-keyword", true],
    ["cg5-plain", undefined],
  ]);
});

test("a bare cubic-bezier easing wraps the component instead of leaking", () => {
  registerCSS(
    `.cg5-run { transition-timing-function: cubic-bezier(0.25, 0.5, 0.75, 1); }`,
  );

  render(<View testID={testID} className="cg5-run" />);

  expect(screen.getByTestId(testID).props.collapsable).toBe(false);
});

test("a bare steps() easing wraps the component too", () => {
  registerCSS(`.cg5-run-steps { transition-timing-function: steps(4, end); }`);

  render(<View testID={testID} className="cg5-run-steps" />);

  expect(screen.getByTestId(testID).props.collapsable).toBe(false);
});

test("an animation-timing-function keyword is unaffected", () => {
  expect(
    compile(
      `.cg5-anim { animation-timing-function: cubic-bezier(0, 0, 1, 1); }`,
    )
      .stylesheet()
      .s?.map(([name, rules]) => [name, rules[0]?.a]),
  ).toStrictEqual([["cg5-anim", true]]);
});
