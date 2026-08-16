/**
 * Which CSS **selector** and **at-rule** constructs survive the compile, and
 * which are silently dropped.
 *
 * Judged against the CSS specs (Selectors Level 4, Media Queries Level 4/5,
 * CSS Cascade 5, CSS Conditional 3/4, CSS Containment 3, CSS Nesting) and
 * against what React Native can actually express. Every drop is marked
 * `// GAP:` with the spec it comes from and an explicit verdict on whether
 * React Native could express it at all.
 *
 * The library emits **no warning** for any dropped selector or at-rule —
 * `compile(css).warnings()` is empty for every case below — so a dropped rule
 * is indistinguishable from a typo at build time.
 */
import { Dimensions, PixelRatio } from "react-native";

import { fireEvent, render, screen } from "@testing-library/react-native";
import { compile } from "react-native-css/compiler";
import { TextInput } from "react-native-css/components/TextInput";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

import { dimensions } from "../../native/reactivity";

/** The whole compiled stylesheet. `{}` means every rule in `css` was dropped. */
function compiled(css: string) {
  return compile(css).stylesheet();
}

/** The class names the compiler actually registered a rule set under. */
function registeredClassNames(css: string): string[] {
  return (compiled(css).s ?? []).map(([className]) => className);
}

function styleOf(id: string): unknown {
  return screen.getByTestId(id).props.style;
}

/* -------------------------------------------------------------------------
 * Simple selectors — Selectors Level 4 §5
 * ---------------------------------------------------------------------- */

test("class selector is the only element selector that carries declarations", () => {
  expect(compiled(`.sel-class { width: 1px; }`)).toStrictEqual({
    s: [["sel-class", [{ s: [1, 1], d: [{ width: 1 }] }]]],
  });
});

test("type selectors are dropped", () => {
  // GAP: Selectors L4 §5.1 type selector. `div {}` / `html {}` compile to
  // nothing — a rule keyed on anything but a class name is discarded.
  // React Native: NOT expressible. There are no element names in RN; the
  // renderer's host components (`View`, `Text`, …) are not addressable from
  // CSS, and the library's whole matching model is `className` → rule set.
  expect(compiled(`div { width: 1px; }`)).toStrictEqual({});
  expect(compiled(`html { width: 1px; }`)).toStrictEqual({});
  // A type selector also poisons an otherwise-supported compound.
  expect(compiled(`div.sel-type { width: 1px; }`)).toStrictEqual({});
  // ...including inside `:is()`, which is otherwise supported.
  expect(compiled(`.sel-type-is:is(div) { width: 1px; }`)).toStrictEqual({});
});

test("id selectors are dropped", () => {
  // GAP: Selectors L4 §5.2 ID selector. `#foo {}` compiles to nothing, and
  // `Specificity` in src/utilities/specificity.ts has no `Id` slot
  // ("We don't support ID yet").
  // React Native: EXPRESSIBLE. RN ships an `id` prop on every host view
  // (View/Text/…), and the library already reads arbitrary props through its
  // attribute-query mechanism — `#foo` is `["a", "id", "=", "foo"]`. This is a
  // real gap, not a platform limit.
  expect(compiled(`#sel-id { width: 1px; }`)).toStrictEqual({});
});

test("universal selector only carries variables, never declarations", () => {
  // `* { --v }` becomes the universal-variable scope...
  const universal = compile(
    `* { --sel-uv: red; } .sel-uc { color: var(--sel-uv); }`,
    {
      inlineVariables: false,
    },
  ).stylesheet();
  expect(universal.vu).toStrictEqual([["sel-uv", [["red"]]]]);

  registerCSS(`* { --uv: blue; } .uv1 { color: var(--uv); }`, {
    inlineVariables: false,
  });
  render(<View testID="sel-uv" className="uv1" />);
  expect(styleOf("sel-uv")).toStrictEqual({ color: "blue" });

  // ...but a declaration on `*` is never applied to anything.
  // GAP: Selectors L4 §5.3 universal selector. `* { width: 1px }` registers no
  // rule; only custom properties survive.
  // React Native: EXPRESSIBLE in principle (the library already threads a
  // universal-variable scope through context, so a universal *declaration*
  // scope is the same mechanism), but deliberately not done.
  expect(compiled(`* { width: 1px; }`)).toStrictEqual({});
});

test("compound class selectors match by class token", () => {
  // `.a.b` keeps the LAST class as the rule key and turns the rest into a
  // `className ~= "a"` attribute query — the whitespace-separated TOKEN test
  // Selectors 4 §6.1 defines a class selector as.
  expect(compiled(`.sel-x.sel-y { width: 1px; }`)).toStrictEqual({
    s: [
      [
        "sel-y",
        [
          {
            s: [1, 2],
            d: [{ width: 1 }],
            aq: [["a", "className", "~=", "sel-x"]],
          },
        ],
      ],
    ],
  });

  registerCSS(`.cmp-x.cmp-y { color: red; }`);
  render(<View testID="cmp-both" className="cmp-x cmp-y" />);
  expect(styleOf("cmp-both")).toStrictEqual({ color: "#f00" });

  render(<View testID="cmp-one" className="cmp-y" />);
  expect(styleOf("cmp-one")).toBeUndefined();

  // Selectors 4 §6.1 — a class selector matches a whitespace-separated TOKEN of
  // the class attribute, which is what `~=` tests. A class that merely CONTAINS
  // the compound member is a different class and does not match.
  registerCSS(`.fp-a.fp-b { color: blue; }`);
  render(<View testID="cmp-fp" className="prefix-fp-a-suffix fp-b" />);
  expect(styleOf("cmp-fp")).toBeUndefined();

  render(<View testID="cmp-fp-real" className="fp-a fp-b" />);
  expect(styleOf("cmp-fp-real")).toStrictEqual({ color: "#00f" });

  // A `className` is written by hand, and a multi-line template literal is an
  // ordinary way to write a long one. Both halves of the match have to agree
  // about where the tokens are: the rule-set lookup that decides which rules an
  // element sees at all splits on any whitespace, so the attribute query for
  // the compound's other classes has to as well. Splitting only on a literal
  // space makes an element match `.fp-b` and then fail `.fp-a`, so exactly the
  // rules written as a compound go missing.
  registerCSS(`.ws-a.ws-b { color: green; }`);
  render(
    <View
      testID="cmp-ws"
      className={`
        ws-a
        ws-b
      `}
    />,
  );
  expect(styleOf("cmp-ws")).toStrictEqual({ color: "#008000" });
});

/* -------------------------------------------------------------------------
 * Combinators — Selectors Level 4 §15
 * ---------------------------------------------------------------------- */

test("descendant combinator compiles to an ancestor container query", () => {
  expect(compiled(`.des-p .des-c { width: 1px; }`)).toStrictEqual({
    s: [
      ["des-p", [{ s: [0], c: ["g:des-p"] }]],
      ["des-c", [{ s: [1, 2], d: [{ width: 1 }], cq: [{ n: "g:des-p" }] }]],
    ],
  });

  registerCSS(`.dp .dc { color: red; }`);
  render(
    <View className="dp">
      <View testID="des-in" className="dc" />
    </View>,
  );
  expect(styleOf("des-in")).toStrictEqual({ color: "#f00" });

  render(<View testID="des-out" className="dc" />);
  expect(styleOf("des-out")).toBeUndefined();
});

test("descendant chains nest, and a compound ancestor keeps its extra classes", () => {
  expect(
    registeredClassNames(`.dn-a .dn-b .dn-c { width: 1px; }`),
  ).toStrictEqual(["dn-a", "dn-b", "dn-c"]);
  expect(compiled(`.dc-a.dc-b .dc-c { width: 1px; }`).s?.[0]).toStrictEqual([
    "dc-b",
    [{ s: [0], c: ["g:dc-b.dc-a"], aq: [["a", "className", "~=", "dc-a"]] }],
  ]);
});

test("child combinator is dropped", () => {
  // GAP: Selectors L4 §15.2 child combinator `>`. The whole rule is discarded
  // (`parseComponents` returns `[]` for any non-descendant combinator).
  // React Native: EXPRESSIBLE with work. The library already propagates an
  // ancestor "container" record through React context; a direct-parent match
  // needs that record to carry a depth/generation marker so a child can tell
  // "my immediate parent" from "some ancestor". Nothing about RN blocks it —
  // it is a missing feature in the matching model, not a platform limit.
  expect(compiled(`.chi-p > .chi-c { width: 1px; }`)).toStrictEqual({});

  registerCSS(`.gp > .gc { color: red; }`);
  render(
    <View className="gp">
      <View testID="chi" className="gc" />
    </View>,
  );
  expect(styleOf("chi")).toBeUndefined();
});

test("adjacent and general sibling combinators are dropped", () => {
  // GAP: Selectors L4 §15.3 next-sibling `+` and §15.4 subsequent-sibling `~`.
  // React Native: NOT expressible in this architecture. Styles resolve inside
  // each component from its own props plus context inherited from ancestors;
  // a component never sees its siblings, and React context only flows
  // downward. Supporting these would require the PARENT to enumerate and
  // annotate its children — a different rendering model, not a small fix.
  expect(compiled(`.sib-a + .sib-b { width: 1px; }`)).toStrictEqual({});
  expect(compiled(`.sib-c ~ .sib-d { width: 1px; }`)).toStrictEqual({});
});

test("an unsupported arm of a selector list does not poison the supported arms", () => {
  // Note this DIVERGES from CSS: Selectors L4 §3.1 says an invalid selector in
  // a list invalidates the whole list. Here the unsupported arm is dropped and
  // the supported arm survives — which is the more useful behaviour for a
  // subset implementation, and is pinned deliberately.
  expect(
    registeredClassNames(`.list-a, .list-b > .list-c { width: 1px; }`),
  ).toStrictEqual(["list-a"]);
  expect(
    registeredClassNames(`.list-d, #list-e { width: 1px; }`),
  ).toStrictEqual(["list-d"]);
});

/* -------------------------------------------------------------------------
 * Attribute selectors — Selectors Level 4 §6.2
 * ---------------------------------------------------------------------- */

test("every attribute operator compiles, against props or dataSet", () => {
  const operators = [
    [`[attr-a]`, ["a", "attrA"]],
    [`[attr-b="v"]`, ["a", "attrB", "=", "v"]],
    [`[attr-c~="v"]`, ["a", "attrC", "~=", "v"]],
    [`[attr-d|="v"]`, ["a", "attrD", "|=", "v"]],
    [`[attr-e^="v"]`, ["a", "attrE", "^=", "v"]],
    [`[attr-f$="v"]`, ["a", "attrF", "$=", "v"]],
    [`[attr-g*="v"]`, ["a", "attrG", "*=", "v"]],
    // `data-*` is routed to RN's `dataSet` prop and camelCased.
    [`[data-foo-bar="v"]`, ["d", "fooBar", "=", "v"]],
  ] as const;

  for (const [selector, expected] of operators) {
    expect(
      compiled(`.attr-host${selector} { width: 1px; }`).s?.[0]?.[1]?.[0]?.aq,
    ).toStrictEqual([expected]);
  }
});

test("attribute presence, token and dash matching at runtime", () => {
  registerCSS(`.aq-p[data-open] { color: red; }`);
  render(
    <View testID="aq-on" className="aq-p" {...{ dataSet: { open: true } }} />,
  );
  expect(styleOf("aq-on")).toStrictEqual({ color: "#f00" });
  render(
    <View testID="aq-off" className="aq-p" {...{ dataSet: { open: false } }} />,
  );
  expect(styleOf("aq-off")).toBeUndefined();

  registerCSS(`.aq-t[data-list~="b"] { color: red; }`);
  render(
    <View
      testID="aq-tok"
      className="aq-t"
      {...{ dataSet: { list: "a b c" } }}
    />,
  );
  expect(styleOf("aq-tok")).toStrictEqual({ color: "#f00" });

  registerCSS(`.aq-d[data-lang|="en"] { color: red; }`);
  render(
    <View
      testID="aq-dash"
      className="aq-d"
      {...{ dataSet: { lang: "en-US" } }}
    />,
  );
  expect(styleOf("aq-dash")).toStrictEqual({ color: "#f00" });

  // Selectors L4 §6.2 dash-match — `[a|=v]` matches a value that is EXACTLY
  // `v`, as well as one beginning with `v-`, so `[data-lang|="en"]` names the
  // language `en` and each of its regional variants.
  registerCSS(`.aq-x[data-lang|="en"] { color: red; }`);
  render(
    <View
      testID="aq-exact"
      className="aq-x"
      {...{ dataSet: { lang: "en" } }}
    />,
  );
  expect(styleOf("aq-exact")).toStrictEqual({ color: "#f00" });

  // ...and stops there: a longer value that merely STARTS with `en` is a
  // different language rather than a variant of this one, which is what
  // separates the dash-match from `^=`.
  registerCSS(`.aq-n[data-lang|="en"] { color: red; }`);
  render(
    <View
      testID="aq-prefix"
      className="aq-n"
      {...{ dataSet: { lang: "english" } }}
    />,
  );
  expect(styleOf("aq-prefix")).toBeUndefined();
});

test("the `i` attribute flag folds case, and `s` asks for the default", () => {
  // Selectors L4 §6.3 — `i` rides along in the query tuple as a fifth member,
  // so the runtime knows to fold both sides before comparing.
  expect(
    compiled(`.attr-i[data-state="OPEN" i] { width: 1px; }`).s?.[0]?.[1]?.[0]
      ?.aq,
  ).toStrictEqual([["d", "state", "=", "OPEN", "i"]]);

  // `s` asks for the case-SENSITIVE comparison, which is already the default
  // here — React Native has no HTML document for the other reading — so it
  // compiles to exactly the same query as no flag at all.
  expect(
    compiled(`.attr-s[data-state="OPEN" s] { width: 1px; }`),
  ).toStrictEqual(compiled(`.attr-s[data-state="OPEN"] { width: 1px; }`));

  // Both sides are folded, never just one, so the rule matches whichever case
  // the value arrives in.
  registerCSS(`.ci[data-state="OPEN" i] { color: red; }`);
  render(
    <View
      testID="attr-ci"
      className="ci"
      {...{ dataSet: { state: "open" } }}
    />,
  );
  expect(styleOf("attr-ci")).toStrictEqual({ color: "#f00" });

  // Without the flag the comparison is case-sensitive, which is what makes the
  // flag observable at all.
  registerCSS(`.cs[data-state="OPEN"] { color: red; }`);
  render(
    <View
      testID="attr-cs"
      className="cs"
      {...{ dataSet: { state: "open" } }}
    />,
  );
  expect(styleOf("attr-cs")).toBeUndefined();
});

test("a standalone attribute selector is dropped; [class] reads the className prop", () => {
  // GAP: Selectors L4 §6.2 — an attribute selector with no class alongside it
  // has no rule-set key to hang off, so it is discarded.
  // React Native: EXPRESSIBLE only with a different index (the runtime looks
  // rules up BY class name), so this is a real architectural constraint rather
  // than a one-line fix.
  expect(compiled(`[data-open] { width: 1px; }`)).toStrictEqual({});

  // `class` is spelled `className` on every React Native component, so the
  // attribute name is mapped onto that prop exactly as `data-*` is mapped onto
  // `dataSet`.
  expect(
    compiled(`.attr-cl[class="foo"] { width: 1px; }`).s?.[0]?.[1]?.[0]?.aq,
  ).toStrictEqual([["a", "className", "=", "foo"]]);

  // Selectors L4 §6.2 — `[att=val]` is an EXACT match against the whole
  // attribute value, not a token match; `[class~="foo"]` and the plain `.foo`
  // are the token forms. So an element carrying a second class does not match.
  registerCSS(`.cl-host[class="foo"] { color: red; }`);
  render(<View testID="attr-class" className="cl-host foo" />);
  expect(styleOf("attr-class")).toBeUndefined();

  // ...and one whose whole `className` is that value does.
  registerCSS(`.cl-only[class="cl-only"] { color: red; }`);
  render(<View testID="attr-class-exact" className="cl-only" />);
  expect(styleOf("attr-class-exact")).toStrictEqual({ color: "#f00" });
});

test("[dir] is special-cased into a media condition", () => {
  expect(compiled(`.dir-a[dir="rtl"] { width: 1px; }`)).toStrictEqual({
    s: [
      ["dir-a", [{ s: [1, 1], d: [{ width: 1 }], m: [["=", "dir", "rtl"]] }]],
    ],
  });

  // On an LTR device `ltr` matches and `rtl` does not. Note `ltr` is returned
  // unconditionally by the runtime (`value === "ltr"`), so `[dir="ltr"]` also
  // matches on an RTL device — pinned here in its LTR form only.
  registerCSS(`.dir-l[dir="ltr"] { color: red; }`);
  render(<View testID="dir-ltr" className="dir-l" />);
  expect(styleOf("dir-ltr")).toStrictEqual({ color: "#f00" });

  registerCSS(`.dir-r[dir="rtl"] { color: red; }`);
  render(<View testID="dir-rtl" className="dir-r" />);
  expect(styleOf("dir-rtl")).toBeUndefined();
});

/* -------------------------------------------------------------------------
 * Functional and structural pseudo-classes — Selectors Level 4 §9, §12, §14
 * ---------------------------------------------------------------------- */

test(":is() with a simple class behaves as a compound selector", () => {
  expect(compiled(`.is-a:is(.is-b) { width: 1px; }`)).toStrictEqual({
    s: [
      [
        "is-b",
        [
          {
            s: [1, 2],
            d: [{ width: 1 }],
            aq: [["a", "className", "~=", "is-a"]],
          },
        ],
      ],
    ],
  });

  registerCSS(`.i-a:is(.i-b) { color: red; }`);
  render(<View testID="is-same" className="i-a i-b" />);
  expect(styleOf("is-same")).toStrictEqual({ color: "#f00" });
});

test(":is(.dark *) compiles to an ancestor container query", () => {
  // This is the shape Tailwind emits for `dark:` in selector mode, and it is
  // the reason `:is()` is supported at all.
  expect(compiled(`.isu-a:is(.dark *) { width: 1px; }`)).toStrictEqual({
    s: [
      ["dark", [{ s: [0], c: ["g:dark"] }]],
      ["isu-a", [{ s: [1, 2], d: [{ width: 1 }], cq: [{ n: "g:dark" }] }]],
    ],
  });
});

test(":where() qualifies the same element and adds no specificity", () => {
  // Selectors L4 §9.2 — `.a:where(.b)` is a COMPOUND selector: one element
  // carrying both classes. The inner class becomes a token query on that
  // element (§6.1 — a class selector is `[class~=name]`), and per §17
  // `:where()` contributes zero, so the whole specificity is the one class of
  // `.wh-a` — unlike `:is()`, which takes its most specific argument's.
  expect(compiled(`.wh-a:where(.wh-b) { width: 1px; }`)).toStrictEqual({
    s: [
      [
        "wh-a",
        [
          {
            s: [1, 1],
            d: [{ width: 1 }],
            aq: [["a", "className", "~=", "wh-b"]],
          },
        ],
      ],
    ],
  });

  registerCSS(`.w-a:where(.w-b) { color: red; }`);
  render(<View testID="wh-same" className="w-a w-b" />);
  expect(styleOf("wh-same")).toStrictEqual({ color: "#f00" });

  // ...and only that element. Matching `.w-a` nested inside `.w-b` is what
  // `:where(.w-b *)` asks for, and it is a different selector.
  render(
    <View className="w-b">
      <View testID="wh-desc" className="w-a" />
    </View>,
  );
  expect(styleOf("wh-desc")).toBeUndefined();
});

test(":is() / :where() with multiple arguments fan out into one rule per argument", () => {
  // Selectors L4 §9.1 — each argument is an ALTERNATIVE, so the rule set keyed
  // on the subject class carries one rule per argument and the runtime applies
  // whichever of them matches.
  expect(compiled(`.isl-a:is(.isl-b, .isl-c) { width: 1px; }`)).toStrictEqual({
    s: [
      [
        "isl-a",
        [
          {
            s: [1, 2],
            d: [{ width: 1 }],
            aq: [["a", "className", "~=", "isl-b"]],
          },
          {
            s: [1, 2],
            d: [{ width: 1 }],
            aq: [["a", "className", "~=", "isl-c"]],
          },
        ],
      ],
    ],
  });

  // `:where()` fans out the same way, and each arm counts only the subject's
  // own class (§17).
  expect(
    compiled(`.whl-a:where(.whl-b, .whl-c) { width: 1px; }`),
  ).toStrictEqual({
    s: [
      [
        "whl-a",
        [
          {
            s: [1, 1],
            d: [{ width: 1 }],
            aq: [["a", "className", "~=", "whl-b"]],
          },
          {
            s: [1, 1],
            d: [{ width: 1 }],
            aq: [["a", "className", "~=", "whl-c"]],
          },
        ],
      ],
    ],
  });
});

test(":not() compiles to a negated prop query", () => {
  // Selectors L4 §9.3 negation. The argument compiles to the conditions it
  // asserts and the runtime inverts them (`["!", …]`), so everything `:not()`
  // negates has to be a question about the element's own props — a class
  // token, an attribute, a form state. Per §17 the pseudo-class carries the
  // specificity of its most specific argument, so `.a:not(.b)` counts two
  // classes.
  expect(compiled(`.not-a:not(.not-b) { width: 1px; }`)).toStrictEqual({
    s: [
      [
        "not-a",
        [
          {
            s: [1, 2],
            d: [{ width: 1 }],
            aq: [["!", ["a", "className", "~=", "not-b"]]],
          },
        ],
      ],
    ],
  });

  // The nested (`&:not(.b)`) and wrapped (`:is(:not(.b))`) forms take the same
  // path and produce the same query.
  expect(compiled(`.not-c { &:not(.not-d) { width: 1px; } }`)).toStrictEqual({
    s: [
      [
        "not-c",
        [
          {
            s: [2, 2],
            d: [{ width: 1 }],
            aq: [["!", ["a", "className", "~=", "not-d"]]],
          },
        ],
      ],
    ],
  });
  expect(compiled(`.not-e:is(:not(.not-f)) { width: 1px; }`)).toStrictEqual({
    s: [
      [
        "not-e",
        [
          {
            s: [1, 2],
            d: [{ width: 1 }],
            aq: [["!", ["a", "className", "~=", "not-f"]]],
          },
        ],
      ],
    ],
  });

  registerCSS(`.nt:not(.other) { color: red; }`);
  render(<View testID="not-el" className="nt" />);
  expect(styleOf("not-el")).toStrictEqual({ color: "#f00" });

  // ...and the element that carries the excluded class is the one the rule
  // must skip, which is what makes the negation observable.
  render(<View testID="not-other" className="nt other" />);
  expect(styleOf("not-other")).toBeUndefined();
});

test(":has() is dropped", () => {
  // GAP: Selectors L4 §9.4 relational `:has()`.
  // React Native: NOT expressible in this architecture. `:has()` is an upward
  // query — a parent styled from its descendants — while the library resolves
  // each component's style from its own props plus context flowing DOWN.
  // Answering it would require a subtree pass before the parent renders.
  expect(compiled(`.has-a:has(.has-b) { width: 1px; }`)).toStrictEqual({});
});

test("tree-structural pseudo-classes are dropped, except :empty", () => {
  // GAP: Selectors L4 §14 child-indexed pseudo-classes.
  // React Native: NOT expressible in this architecture — every one of these is
  // a question about a node's POSITION AMONG ITS SIBLINGS, and a component
  // resolving its own style has no sibling list and no index. Only the parent
  // knows, and the library never involves the parent in a child's match.
  for (const selector of [
    ":first-child",
    ":last-child",
    ":only-child",
    ":nth-child(2)",
    ":nth-last-child(2)",
    ":nth-child(2 of .x)",
    ":first-of-type",
    ":last-of-type",
    ":only-of-type",
    ":nth-of-type(2)",
  ]) {
    expect(compiled(`.struct-a${selector} { width: 1px; }`)).toStrictEqual({});
  }

  // `:empty` IS supported — it is a question about the element's own children,
  // which map onto RN's `children` prop.
  expect(
    compiled(`.struct-b:empty { width: 1px; }`).s?.[0]?.[1]?.[0]?.aq,
  ).toStrictEqual([["a", "children", "!"]]);
});

test(":root and :host scope custom properties, but nothing else", () => {
  const root = compile(
    `:root { --root-v: red; } .root-c { color: var(--root-v); }`,
    {
      inlineVariables: false,
    },
  ).stylesheet();
  expect(root.vr).toStrictEqual([["root-v", [["red"]]]]);

  registerCSS(`:root { --rv: red; } .rv1 { color: var(--rv); }`, {
    inlineVariables: false,
  });
  render(<View testID="root-var" className="rv1" />);
  expect(styleOf("root-var")).toStrictEqual({ color: "red" });

  // GAP: `:host` (CSS Scoping 1 §3.1) alone registers NO variable — only the
  // `:root, :host {}` list form works, and only because `:root` carries it.
  // Tailwind v4 emits exactly that list, which is why this has gone unnoticed.
  // React Native: `:host` has no meaning (no shadow DOM), so treating it as an
  // alias of `:root` is the only sensible reading — and is what the list form
  // already does inconsistently.
  const host = compile(
    `:host { --host-v: red; } .host-c { color: var(--host-v); }`,
    {
      inlineVariables: false,
    },
  ).stylesheet();
  expect(host.vr).toBeUndefined();

  const both = compile(
    `:root, :host { --both-v: red; } .both-c { color: var(--both-v); }`,
    {
      inlineVariables: false,
    },
  ).stylesheet();
  expect(both.vr).toStrictEqual([["both-v", [["red"]]]]);

  // GAP: `:root` is not usable as an ordinary selector or as an ancestor —
  // `:root { width }` and `:root .a {}` both compile to nothing.
  // React Native: EXPRESSIBLE — the root of an RN tree is a real component and
  // the library already has an ancestor-container mechanism to hang it on.
  expect(compiled(`:root .root-d { width: 1px; }`)).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * Interaction / state pseudo-classes — Selectors Level 4 §4, §10, §11
 * ---------------------------------------------------------------------- */

test(":hover, :active and :focus compile to pseudo-class queries", () => {
  expect(
    compiled(`.pc-h:hover { width: 1px; }`).s?.[0]?.[1]?.[0]?.p,
  ).toStrictEqual({ h: 1 });
  expect(
    compiled(`.pc-a:active { width: 1px; }`).s?.[0]?.[1]?.[0]?.p,
  ).toStrictEqual({ a: 1 });
  expect(
    compiled(`.pc-f:focus { width: 1px; }`).s?.[0]?.[1]?.[0]?.p,
  ).toStrictEqual({ f: 1 });
  // ...and they survive `:is()` wrapping.
  expect(
    compiled(`.pc-i:is(:hover) { width: 1px; }`).s?.[0]?.[1]?.[0]?.p,
  ).toStrictEqual({ h: 1 });
});

test("an ancestor's :hover reaches a descendant", () => {
  expect(
    compiled(`.hov-p:hover .hov-c { width: 1px; }`).s?.[1]?.[1]?.[0]?.cq,
  ).toStrictEqual([{ p: { h: 1 }, n: "g:hov-p" }]);

  registerCSS(`.hp:hover .hc { color: red; }`);
  render(
    <View testID="hov-parent" className="hp">
      <View testID="hov-child" className="hc" />
    </View>,
  );
  expect(styleOf("hov-child")).toBeUndefined();
  fireEvent(screen.getByTestId("hov-parent"), "hoverIn");
  expect(styleOf("hov-child")).toStrictEqual({ color: "#f00" });
});

test(":disabled compiles to an attribute query on the `disabled` prop", () => {
  expect(
    compiled(`.dis-a:disabled { width: 1px; }`).s?.[0]?.[1]?.[0]?.aq,
  ).toStrictEqual([["a", "disabled"]]);
});

test("input-state pseudo-classes are dropped, except those with a React Native prop", () => {
  // Each supported one asks about a single prop React Native delivers, in the
  // shape `:disabled` set above.
  //   - `:enabled` (Selectors L4 §4) is the complement of `:disabled`, so it
  //     reads the same prop through the runtime's `!` operator.
  //   - `:checked` (§11) and `:required` (§11) read the React spellings a
  //     component receives and forwards.
  //   - `:read-only` (§4) reads `readOnly`.
  for (const [selector, query] of [
    [":enabled", ["a", "disabled", "!"]],
    [":checked", ["a", "checked"]],
    [":required", ["a", "required"]],
    [":read-only", ["a", "readOnly"]],
  ] as const) {
    expect(
      compiled(`.state-a${selector} { width: 1px; }`).s?.[0]?.[1]?.[0]?.aq,
    ).toStrictEqual([query]);
  }

  registerCSS(`.en:enabled { color: red; }`);
  render(<View testID="state-en" className="en" />);
  expect(styleOf("state-en")).toStrictEqual({ color: "#f00" });
  render(<View testID="state-dis" className="en" {...{ disabled: true }} />);
  expect(styleOf("state-dis")).toBeUndefined();

  // GAP: Selectors L4 §4 (`:read-write`), §10 (`:link`, `:visited`,
  // `:any-link`, `:target`), §11 (`:default`, `:indeterminate`,
  // `:placeholder-shown`, `:optional`, `:valid`, `:invalid`, `:autofill`),
  // plus `:focus-visible` / `:focus-within` from §10.
  // React Native:
  //   - `:read-write` — EXPRESSIBLE but not the negation of `:read-only`: an
  //     element that was never editable is `:read-only` too, and React Native
  //     has no notion of which components those are, so the safe reading is to
  //     drop it rather than answer `!readOnly`.
  //   - `:optional` — the same shape, against `:required`.
  //   - `:indeterminate` — `Switch` has no third state to read.
  //   - `:placeholder-shown` / `:default` — `TextInput` props, reachable.
  //   - `:focus-visible` — RN has no keyboard-vs-pointer focus distinction, so
  //     only approximable.
  //   - `:focus-within` — needs child→parent propagation; not expressible with
  //     downward-only context.
  //   - `:link` / `:visited` / `:target` / `:autofill` — genuinely meaningless:
  //     no document URL, no navigation history, no browser autofill.
  //   - `:valid` / `:invalid` — no constraint-validation model in RN.
  for (const selector of [
    ":indeterminate",
    ":default",
    ":optional",
    ":read-write",
    ":placeholder-shown",
    ":valid",
    ":invalid",
    ":autofill",
    ":focus-visible",
    ":focus-within",
    ":link",
    ":visited",
    ":any-link",
    ":target",
  ]) {
    expect(compiled(`.state-a${selector} { width: 1px; }`)).toStrictEqual({});
  }
});

test(":dir() is dropped as a bare pseudo-class even though [dir] works", () => {
  // GAP: Selectors L4 §7.1 `:dir()`. `parseComponents` has no `dir` case, so
  // `.a:dir(rtl)` is discarded — while the equivalent `.a[dir="rtl"]` compiles
  // (see the `[dir]` test above) and `:is(.a:dir(rtl))` is handled by a
  // SEPARATE code path. Same intent, three different outcomes.
  // React Native: EXPRESSIBLE — `I18nManager.isRTL` already backs the `[dir]`
  // path; `:dir()` just needs the same case added.
  expect(compiled(`.dirp-a:dir(rtl) { width: 1px; }`)).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * Pseudo-elements — CSS Pseudo-Elements Level 4
 * ---------------------------------------------------------------------- */

test("::placeholder and ::selection each retarget one declaration onto an RN prop", () => {
  // A different declaration each, because each names a different thing React
  // Native can paint: `::placeholder { color }` is the placeholder text, and
  // `::selection { background-color }` is the band behind the selected text,
  // which is what `selectionColor` sets. `::selection { color }` is the
  // selected TEXT's colour and has no prop, so it is dropped.
  registerCSS(`.ph1::placeholder { color: red; }`);
  render(<TextInput testID="pe-ph" className="ph1" />);
  expect(screen.getByTestId("pe-ph").props.placeholderTextColor).toBe("#f00");

  registerCSS(`.se1::selection { background-color: red; }`);
  render(<TextInput testID="pe-se" className="se1" />);
  expect(screen.getByTestId("pe-se").props.selectionColor).toBe("#f00");

  // The vendor-prefixed alias normalises to the same thing: the retargeted
  // declaration and nothing beside it. An empty `{}` in front of it would be a
  // style object the rule ships asserting no key at all, which is what the rule
  // carried while a pseudo-element's declarations still landed on the element.
  expect(
    compiled(`.pe-wk::-webkit-input-placeholder { color: red; }`)
      .s?.[0]?.[1]?.[0]?.d,
  ).toStrictEqual([["#f00", ["placeholderTextColor"]]]);
});

test("a declaration a pseudo-element cannot express is dropped, not leaked onto the element", () => {
  // CSS Pseudo-Elements 4 §4.4 / §7.1 — a declaration inside the block styles
  // the pseudo-element, never its originating element. `TextInput` exposes
  // exactly two placeholder/selection knobs — `placeholderTextColor` and
  // `selectionColor` (plus Android's `selectionHandleColor`) — so each
  // pseudo-element retargets the ONE declaration it can express and drops the
  // rest, reported through `compile().warnings()`.
  //
  // Leaking is strictly worse than dropping: `.a::placeholder { font-size:
  // 33px }` resized the input's REAL text, and `.a::selection { color: white }`
  // painted a white band the unchanged text then sat on invisibly.
  registerCSS(`.ph-leak::placeholder { font-size: 33px; }`);
  render(<View testID="pe-leak" className="ph-leak" />);
  expect(styleOf("pe-leak")).toBeUndefined();

  registerCSS(`.se-leak::selection { color: red; }`);
  render(<View testID="pe-leak2" className="se-leak" />);
  expect(styleOf("pe-leak2")).toBeUndefined();
});

test("every other pseudo-element is dropped", () => {
  // GAP: CSS Pseudo-Elements 4 — `::before` / `::after` (§3), `::first-line`
  // and `::first-letter` (§2), `::marker` (§5), `::backdrop` (§6).
  // React Native: NOT expressible as written. There is no generated-content
  // box in RN and no `content` property, no line-box or first-letter
  // addressing in the text engine, no list markers, and no top-layer backdrop.
  // `::before`/`::after` could in principle be emulated by injecting a child
  // component, but that changes the rendered tree rather than its style, so
  // dropping them is the honest behaviour — it just happens silently.
  for (const selector of [
    "::before",
    "::after",
    "::first-line",
    "::first-letter",
    "::marker",
    "::backdrop",
  ]) {
    expect(compiled(`.pe-x${selector} { color: red; }`)).toStrictEqual({});
  }
  expect(compiled(`.pe-y::before { content: "x"; color: red; }`)).toStrictEqual(
    {},
  );
});

/* -------------------------------------------------------------------------
 * @media — Media Queries Level 4 / 5
 * ---------------------------------------------------------------------- */

test("@media dimension, orientation and colour-scheme features work", () => {
  dimensions.set({ ...Dimensions.get("window"), width: 750, height: 1334 });

  registerCSS(`@media (min-width: 1px) { .mq-w { color: red; } }`);
  render(<View testID="mq-w" className="mq-w" />);
  expect(styleOf("mq-w")).toStrictEqual({ color: "#f00" });

  registerCSS(`@media (min-width: 999999px) { .mq-w2 { color: red; } }`);
  render(<View testID="mq-w2" className="mq-w2" />);
  expect(styleOf("mq-w2")).toBeUndefined();

  registerCSS(`@media (width > 1px) { .mq-r { color: red; } }`);
  render(<View testID="mq-r" className="mq-r" />);
  expect(styleOf("mq-r")).toStrictEqual({ color: "#f00" });

  registerCSS(`@media (orientation: portrait) { .mq-o { color: red; } }`);
  render(<View testID="mq-o" className="mq-o" />);
  expect(styleOf("mq-o")).toStrictEqual({ color: "#f00" });

  expect(
    compiled(`@media (prefers-color-scheme: dark) { .mq-d { width: 1px; } }`)
      .s?.[0]?.[1]?.[0]?.m,
  ).toStrictEqual([["=", "prefers-color-scheme", "dark"]]);
});

test("@media boolean-context features evaluate the feature", () => {
  // Compiles to a `!!` condition...
  expect(
    compiled(`@media (hover) { .mqb-a { width: 1px; } }`).s?.[0]?.[1]?.[0]?.m,
  ).toStrictEqual([["!!", "hover"]]);

  // Media Queries L4 §2.4 boolean context — `@media (hover)` means "the
  // feature's value is not `none`/zero". The runtime returned a hard `false`
  // for every `!!` condition, so the boolean form was dead even for features
  // whose value form worked, and `(hover)` contradicted `(hover: hover)`.
  registerCSS(`@media (hover) { .bl { color: red; } }`);
  render(<View testID="mqb" className="bl" />);
  expect(styleOf("mqb")).toStrictEqual({ color: "#f00" });
});

test("@media range-interval syntax matches both bounds", () => {
  // Compiles to a `[]` condition...
  expect(
    compiled(`@media (1px <= width <= 99999px) { .mqi-a { width: 1px; } }`)
      .s?.[0]?.[1]?.[0]?.m,
  ).toStrictEqual([["[]", "width", 1, "<=", 99999, "<="]]);

  // Media Queries L4 §2.4.3 range context with two comparisons. The runtime
  // returned a hard `false` for every `[]` condition, so an always-true
  // interval never applied. Single-ended ranges (`width > 1px`) always worked,
  // which is what made the two-sided form easy to miss.
  dimensions.set({ ...Dimensions.get("window"), width: 750, height: 1334 });
  registerCSS(`@media (1px <= width <= 99999px) { .iv { color: red; } }`);
  render(<View testID="mqi" className="iv" />);
  expect(styleOf("mqi")).toStrictEqual({ color: "#f00" });

  // The START comparison reads with the feature on the RIGHT, so a bound the
  // viewport misses must NOT match.
  registerCSS(`@media (99999px <= width <= 999999px) { .iv2 { color: red; } }`);
  render(<View testID="mqi2" className="iv2" />);
  expect(styleOf("mqi2")).toBeUndefined();
});

test("@media aspect-ratio evaluates against the viewport", () => {
  // Media Queries L4 §4.1 `aspect-ratio`. `parseMediaFeatureValue` had no
  // `ratio` case, so the condition compiled to `undefined`, `parseMediaQuery`
  // bailed before calling `addMediaQuery`, and the rules inside were emitted
  // with NO media condition at all — the most dangerous drop there is, because
  // the styles do not go missing, they go EVERYWHERE.
  //
  // `vw / vh` were already tracked, and the `@container` evaluator computed
  // `aspect-ratio` from exactly those two values, so the media half was the
  // only one missing.
  const sheet = compiled(
    `@media (min-aspect-ratio: 10000/1) { .mar-a { width: 1px; } }`,
  );
  expect(sheet.s?.[0]?.[1]?.[0]?.m).toStrictEqual([
    [">=", "aspect-ratio", 10000],
  ]);

  dimensions.set({ ...Dimensions.get("window"), width: 750, height: 1334 });
  registerCSS(`@media (min-aspect-ratio: 10000/1) { .ar { color: red; } }`);
  render(<View testID="mar" className="ar" />);
  expect(styleOf("mar")).toBeUndefined();

  registerCSS(`@media (min-aspect-ratio: 1/100) { .ar3 { color: red; } }`);
  render(<View testID="mar3" className="ar3" />);
  expect(styleOf("mar3")).toStrictEqual({ color: "#f00" });
});

test("an unrepresentable @media condition makes the rule unmatchable", () => {
  // The other half of the same defect, and the general case: a condition this
  // compiler cannot translate keeps its slot — an unresolved OPERAND as `null`,
  // an unrepresentable FORM as the `["?"]` marker — and the runtime evaluates
  // either as UNKNOWN, so the rule never matches. What it must not do is vanish
  // and leave the rule unconditional.
  const sheet = compiled(
    `@media (min-width: env(safe-area-inset-top)) { .unrep-a { width: 1px; } }`,
  );
  expect(sheet.s?.[0]?.[1]?.[0]?.m).toStrictEqual([[">=", "width", null]]);

  registerCSS(
    `@media (min-width: env(safe-area-inset-top)) { .ar2 { color: blue; } }`,
  );
  render(<View testID="mar2" className="ar2" />);
  expect(styleOf("mar2")).toBeUndefined();

  // ...and it stays unmatchable under `not`, because unknown does not flip.
  registerCSS(
    `@media not (min-width: env(safe-area-inset-top)) { .ar4 { color: blue; } }`,
  );
  render(<View testID="mar4" className="ar4" />);
  expect(styleOf("mar4")).toBeUndefined();

  // An unrepresentable operand does not vanish out of an `and` either: the
  // whole condition stays unknown rather than collapsing to the half that
  // happens to be representable.
  registerCSS(
    `@media (min-width: env(safe-area-inset-top)) and (min-width: 1px) { .ar5 { color: blue; } }`,
  );
  render(<View testID="mar5" className="ar5" />);
  expect(styleOf("mar5")).toBeUndefined();
});

test("@media (hover: …) and (pointer: …) answer, and are complements", () => {
  // Media Queries L4 §10.1 `hover` / §10.2 `pointer`. `hover` answers `hover`
  // on every platform deliberately — React Native synthesises hover through
  // Pressability, so `hover:`-prefixed utilities work on a touch screen where
  // a mobile browser would make them dead CSS. `pointer` has no such synthesis
  // behind it and reports the physical input: coarse on a touch screen.
  //
  // Both used to be unusable in opposite ways: `hover` ignored the value asked
  // for, so `(hover: hover)` and `(hover: none)` BOTH matched, and `pointer`
  // had no case at all, so every value failed.
  registerCSS(`@media (hover: hover) { .hv1 { color: red; } }`);
  render(<View testID="mqh1" className="hv1" />);
  expect(styleOf("mqh1")).toStrictEqual({ color: "#f00" });

  registerCSS(`@media (hover: none) { .hv2 { color: blue; } }`);
  render(<View testID="mqh2" className="hv2" />);
  expect(styleOf("mqh2")).toBeUndefined();

  registerCSS(`@media (pointer: coarse) { .pt1 { color: red; } }`);
  render(<View testID="mqp1" className="pt1" />);
  expect(styleOf("mqp1")).toStrictEqual({ color: "#f00" });

  registerCSS(`@media (pointer: fine) { .pt2 { color: red; } }`);
  render(<View testID="mqp2" className="pt2" />);
  expect(styleOf("mqp2")).toBeUndefined();
});

test("@media prefers-reduced-motion compiles AND answers the OS setting", () => {
  // Compiles to a well-formed condition...
  expect(
    compiled(
      `@media (prefers-reduced-motion: reduce) { .prm-a { width: 1px; } }`,
    ).s?.[0]?.[1]?.[0]?.m,
  ).toStrictEqual([["=", "prefers-reduced-motion", "reduce"]]);

  // ...and both directions are live, backed by
  // `AccessibilityInfo.isReduceMotionEnabled()` plus its `reduceMotionChanged`
  // event — the same reactive shape `colorScheme` uses against `Appearance`.
  // The preference is off in this environment, so `no-preference` matches and
  // `reduce` does not. Evaluating false in BOTH directions is what an
  // unimplemented feature does, and it is the silent shape: every
  // `motion-reduce:` / `motion-safe:` utility compiles cleanly and never fires.
  registerCSS(
    `@media (prefers-reduced-motion: reduce) { .rm1 { color: red; } }`,
  );
  render(<View testID="prm1" className="rm1" />);
  expect(styleOf("prm1")).toBeUndefined();

  registerCSS(
    `@media (prefers-reduced-motion: no-preference) { .rm2 { color: red; } }`,
  );
  render(<View testID="prm2" className="rm2" />);
  expect(styleOf("prm2")).toStrictEqual({ color: "#f00" });
});

test("other Media Queries L5 user-preference features compile but never match", () => {
  // GAP: Media Queries L5 §11 — `prefers-contrast`, `forced-colors`,
  // `inverted-colors`; plus L4 `any-hover`, `any-pointer`, `color-gamut`,
  // `scripting`, `update`. All reach the runtime as well-formed `=` conditions
  // and all fall through `testComparison` to `false`.
  // React Native: PARTIALLY expressible — `AccessibilityInfo` exposes
  // Android's high-text-contrast and iOS's invert-colours / darker-system-
  // colours flags, so `prefers-contrast` and `inverted-colors` are reachable.
  // `color-gamut`, `scripting` and `update` have no RN equivalent.
  //
  // `any-hover` and `any-pointer` are NOT in this list: they describe the input
  // mechanism, which native knows, and they now answer alongside `hover` and
  // `pointer` above.
  const features = [
    "(prefers-contrast: more)",
    "(forced-colors: active)",
    "(inverted-colors: inverted)",
    "(color-gamut: p3)",
    "(scripting: enabled)",
    "(update: fast)",
  ];
  for (const [index, feature] of features.entries()) {
    const className = `mq5-${index}`;
    expect(
      compiled(`@media ${feature} { .${className} { width: 1px; } }`)
        .s?.[0]?.[1]?.[0]?.m,
    ).toBeDefined();
    registerCSS(`@media ${feature} { .${className} { color: red; } }`);
    render(<View testID={className} className={className} />);
    expect(styleOf(className)).toBeUndefined();
  }
});

test("@media resolution maps onto PixelRatio", () => {
  expect(PixelRatio.get()).toBe(2);
  registerCSS(`@media (min-resolution: 2dppx) { .res1 { color: red; } }`);
  render(<View testID="res1" className="res1" />);
  expect(styleOf("res1")).toStrictEqual({ color: "#f00" });

  registerCSS(`@media (min-resolution: 3dppx) { .res2 { color: red; } }`);
  render(<View testID="res2" className="res2" />);
  expect(styleOf("res2")).toBeUndefined();
});

test("an unknown @media TYPE becomes a platform condition", () => {
  // This is the library's own extension: `@media ios {}` / `@media android {}`
  // / `@media web {}` / `@media native {}` compile to a `platform` condition.
  for (const [platform, className] of [
    ["ios", "plat-ios"],
    ["android", "plat-android"],
    ["web", "plat-web"],
    ["native", "plat-native"],
  ] as const) {
    expect(
      compiled(`@media ${platform} { .${className} { width: 1px; } }`)
        .s?.[0]?.[1]?.[0]?.m,
    ).toStrictEqual([["=", "platform", platform]]);
  }

  // The side effect: a REAL CSS media type the library does not know is also
  // reinterpreted as a platform name, and then never matches. Harmless for
  // `speech` (which has no RN meaning) but it means a typo'd media type fails
  // silently rather than loudly.
  expect(
    compiled(`@media speech { .plat-speech { width: 1px; } }`).s?.[0]?.[1]?.[0]
      ?.m,
  ).toStrictEqual([["=", "platform", "speech"]]);

  // `screen` / `all` are treated as unconditional, and `print` is dropped
  // wholesale — both correct for a device with no print target.
  expect(
    compiled(`@media screen { .plat-screen { width: 1px; } }`).s?.[0]?.[1]?.[0]
      ?.m,
  ).toBeUndefined();
  expect(
    compiled(`@media print { .plat-print { width: 1px; } }`),
  ).toStrictEqual({});
  expect(
    compiled(`@media not screen { .plat-not { width: 1px; } }`),
  ).toStrictEqual({});
});

test("@media and / or / not compose", () => {
  expect(
    compiled(
      `@media (min-width: 1px) and (max-width: 9px) { .mqc-a { width: 1px; } }`,
    ).s?.[0]?.[1]?.[0]?.m,
  ).toStrictEqual([
    [
      "&",
      [
        [">=", "width", 1],
        ["<=", "width", 9],
      ],
    ],
  ]);

  // A COMMA list is a union, and the `m` slot intersects — every entry has to
  // hold for the rule to apply — so the branches are combined into one `|`
  // term. Written as two entries they would intersect instead, and
  // `@media (width < 400px), (width > 800px)` would match nothing.
  expect(
    compiled(
      `@media (min-width: 1px), (orientation: landscape) { .mqc-b { width: 1px; } }`,
    ).s?.[0]?.[1]?.[0]?.m,
  ).toStrictEqual([
    [
      "|",
      [
        [">=", "width", 1],
        ["=", "orientation", "landscape"],
      ],
    ],
  ]);

  expect(
    compiled(`@media ios and (min-width: 1px) { .mqc-c { width: 1px; } }`)
      .s?.[0]?.[1]?.[0]?.m,
  ).toStrictEqual([
    [
      "&",
      [
        ["=", "platform", "ios"],
        [">=", "width", 1],
      ],
    ],
  ]);
});

test("@custom-media is not substituted", () => {
  // GAP: Media Queries L5 §3 `@custom-media`. The at-rule is ignored and the
  // reference survives as a boolean feature named `--small`, which the runtime
  // resolves to `false` — so the rule never applies.
  // React Native: EXPRESSIBLE — pure compile-time substitution, no runtime
  // support needed at all.
  expect(
    compiled(
      `@custom-media --small (max-width: 100px); @media (--small) { .cm-a { width: 1px; } }`,
    ).s?.[0]?.[1]?.[0]?.m,
  ).toStrictEqual([["!!", "--small"]]);
});

/* -------------------------------------------------------------------------
 * @supports — CSS Conditional Rules Level 3 §2
 * ---------------------------------------------------------------------- */

test("@supports answers from the declaration parser", () => {
  // CSS Conditional 3 §2 — `@supports` asks whether the UA can render a
  // declaration, so it is answered by COMPILING the declaration.
  //
  // It used to be a lookup table with ONE entry, the `color-mix` probe Tailwind
  // emits, so every genuine feature test answered `false` and discarded its own
  // block — including declarations React Native unambiguously supports.
  expect(
    registeredClassNames(
      `@supports (color: color-mix(in lab, red, red)) { .sup-a { width: 1px; } }`,
    ),
  ).toStrictEqual(["sup-a"]);
  expect(
    registeredClassNames(
      `@supports (display: flex) { .sup-b { width: 1px; } }`,
    ),
  ).toStrictEqual(["sup-b"]);
  expect(
    registeredClassNames(`@supports (color: red) { .sup-c { width: 1px; } }`),
  ).toStrictEqual(["sup-c"]);
  expect(
    registeredClassNames(`@supports (--x: y) { .sup-d { width: 1px; } }`),
  ).toStrictEqual(["sup-d"]);

  // A declaration React Native genuinely cannot render answers `false`, and its
  // block is discarded — which is the entire point of writing the guard.
  expect(
    compiled(`@supports (display: grid) { .sup-i { width: 1px; } }`),
  ).toStrictEqual({});
  expect(
    compiled(`@supports (position: fixed) { .sup-j { width: 1px; } }`),
  ).toStrictEqual({});
  expect(
    compiled(`@supports (float: left) { .sup-k { width: 1px; } }`),
  ).toStrictEqual({});
  expect(
    compiled(`@supports (bananas: 1px) { .sup-l { width: 1px; } }`),
  ).toStrictEqual({});

  // Negation follows, in both directions. A table that answered `false` for
  // everything made every `not` guard admit exactly what it excluded.
  expect(
    registeredClassNames(
      `@supports not (display: grid) { .sup-e { width: 1px; } }`,
    ),
  ).toStrictEqual(["sup-e"]);
  expect(
    compiled(`@supports not (display: flex) { .sup-m { width: 1px; } }`),
  ).toStrictEqual({});

  // ...and `and` / `or` compose over real operands.
  expect(
    registeredClassNames(
      `@supports (display: flex) and (color: red) { .sup-f { width: 1px; } }`,
    ),
  ).toStrictEqual(["sup-f"]);
  expect(
    compiled(
      `@supports (display: grid) and (color: red) { .sup-n { width: 1px; } }`,
    ),
  ).toStrictEqual({});
  expect(
    registeredClassNames(
      `@supports (display: grid) or (color: red) { .sup-g { width: 1px; } }`,
    ),
  ).toStrictEqual(["sup-g"]);

  // GAP: CSS Conditional 4 §3 `selector()`. Answering it needs the selector
  // compiler rather than the declaration parser, so it stays `false` — the
  // conservative direction for a query written to gate on a missing feature.
  expect(
    compiled(`@supports selector(:has(a)) { .sup-h { width: 1px; } }`),
  ).toStrictEqual({});

  // An invalid VALUE answers `false`, because the parser drops it. This
  // assertion needed no change of its own when that landed, which is the whole
  // point of answering `@supports` from the parser rather than from a table.
  expect(
    compiled(`@supports (color: bananas) { .sup-o { width: 1px; } }`),
  ).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * @container — CSS Containment Level 3
 * ---------------------------------------------------------------------- */

test("@container size queries work, named and unnamed", () => {
  expect(
    compiled(
      `.cq-p { container-type: size; } @container (min-width: 100px) { .cq-c { width: 1px; } }`,
    ),
  ).toStrictEqual({
    s: [
      ["cq-p", [{ s: [1, 1], c: ["c:___default___"] }]],
      [
        "cq-c",
        [{ s: [3, 1], cq: [{ m: [">=", "width", 100] }], d: [{ width: 1 }] }],
      ],
    ],
  });

  expect(
    compiled(
      `.cq-n { container-name: box; } @container box (min-width: 100px) { .cq-d { width: 1px; } }`,
    ).s?.[1]?.[1]?.[0]?.cq,
  ).toStrictEqual([{ m: [">=", "width", 100], n: "c:box" }]);

  registerCSS(
    `.ct-p { container-type: size; } .ct-c { @container (width > 100px) { color: red; } }`,
  );
  render(
    <View testID="ct-p" className="ct-p">
      <View testID="ct-c" className="ct-c" />
    </View>,
  );
  fireEvent(screen.getByTestId("ct-p"), "layout", {
    nativeEvent: { layout: { width: 500, height: 500 } },
  });
  expect(styleOf("ct-c")).toStrictEqual({ color: "#f00" });
});

test("@container comparison operators evaluate correctly, boundary included", () => {
  // CSS Containment 3 §3.2 size queries. All four range operators are checked
  // below / AT / above a 100px threshold. The boundary row (width === 100) is
  // the one that separates `>` from `>=` and `<` from `<=`, and it is the case
  // a single shared comparison gets wrong in both directions — so it is the
  // row worth keeping as the regression guard.
  const cases = [
    { operator: ">", matches: { 50: false, 100: false, 500: true } },
    { operator: ">=", matches: { 50: false, 100: true, 500: true } },
    { operator: "<", matches: { 50: true, 100: false, 500: false } },
    { operator: "<=", matches: { 50: true, 100: true, 500: false } },
  ] as const;

  for (const [index, { operator, matches }] of cases.entries()) {
    for (const width of [50, 100, 500] as const) {
      const parentClass = `cop-p-${index}-${width}`;
      const childClass = `cop-c-${index}-${width}`;

      registerCSS(
        `.${parentClass} { container-type: size; }
         .${childClass} { @container (width ${operator} 100px) { color: red; } }`,
      );

      const tree = render(
        <View testID={parentClass} className={parentClass}>
          <View testID={childClass} className={childClass} />
        </View>,
      );
      fireEvent(screen.getByTestId(parentClass), "layout", {
        nativeEvent: { layout: { width, height: width } },
      });

      // The operator and width ride along in the assertion so a failure names
      // the exact row rather than just "expected undefined".
      expect({ operator, width, style: styleOf(childClass) }).toStrictEqual({
        operator,
        width,
        style: matches[width] ? { color: "#f00" } : undefined,
      });

      tree.unmount();
    }
  }
});

test("@container logical-size features resolve to the physical axes", () => {
  // CSS Containment 3 §3.2 — `inline-size` and `block-size` are the logical
  // size features, and `container-type: inline-size` is the containment type
  // most stylesheets use, so a dead `inline-size` would make the common case
  // silently never match.
  //
  // React Native lays out in one writing mode, which is what makes the mapping
  // exact rather than an approximation: inline is horizontal and block is
  // vertical, and both axes are already tracked by `containerWidthFamily` /
  // `containerHeightFamily`.
  expect(
    compiled(`@container (min-inline-size: 100px) { .cls-a { width: 1px; } }`)
      .s?.[0]?.[1]?.[0]?.cq,
  ).toStrictEqual([{ m: [">=", "inline-size", 100] }]);

  registerCSS(
    `.cq-i-p { container-type: inline-size; } .cq-i-c { @container (min-inline-size: 1px) { color: red; } }`,
  );
  render(
    <View testID="cq-i-p" className="cq-i-p">
      <View testID="cq-i-c" className="cq-i-c" />
    </View>,
  );
  fireEvent(screen.getByTestId("cq-i-p"), "layout", {
    nativeEvent: { layout: { width: 500, height: 500 } },
  });
  expect(styleOf("cq-i-c")).toStrictEqual({ color: "#f00" });
});

test("@container style() queries are unrepresentable, so they never match", () => {
  // The condition compiles to the `["?"]` marker, which KEEPS the term rather
  // than dropping the block — a prelude that vanishes applies everywhere.
  expect(
    compiled(`@container style(--theme: dark) { .cs-a { width: 1px; } }`)
      .s?.[0]?.[1]?.[0]?.cq,
  ).toStrictEqual([{ m: ["?"] }]);

  // GAP, but now the safe direction: CSS Containment 3 §5 style queries need
  // the declaring container's computed value, which this runtime does not
  // track. `testContainerQuery` used to SKIP a falsy `query.m`, so the rule
  // applied to any descendant of ANY container whatever the custom property's
  // value — the styles did not go missing, they went everywhere.
  //
  // React Native: EXPRESSIBLE — the library already inherits custom properties
  // down the tree, which is exactly the input a style query needs.
  registerCSS(
    `.cs-p { container-type: size; } .cs-c { @container style(--theme: dark) { color: red; } }`,
  );
  render(
    <View testID="cs-p" className="cs-p">
      <View testID="cs-c" className="cs-c" />
    </View>,
  );
  expect(styleOf("cs-c")).toBeUndefined();
});

/* -------------------------------------------------------------------------
 * @layer — CSS Cascade Level 5 §6
 * ---------------------------------------------------------------------- */

test("@layer blocks are flattened and named-layer order is preserved", () => {
  // `@layer lb, la;` puts `la` LAST, so `la` wins even though `lb`'s rule is
  // later in the source. (Layer sorting happens in lightningcss's own output;
  // the library itself only assigns an incrementing `Order` specificity.)
  registerCSS(`
    @layer lb, la;
    @layer la { .l1 { color: red; } }
    @layer lb { .l1 { color: blue; } }
  `);
  render(<View testID="ly1" className="l1" />);
  expect(styleOf("ly1")).toStrictEqual({ color: "#f00" });

  registerCSS(`
    @layer ma, mb;
    @layer mb { .l2 { color: red; } }
    @layer ma { .l2 { color: blue; } }
  `);
  render(<View testID="ly2" className="l2" />);
  expect(styleOf("ly2")).toStrictEqual({ color: "#f00" });

  expect(
    registeredClassNames(`@layer anon { .ly-a { width: 1px; } }`),
  ).toStrictEqual(["ly-a"]);
  expect(
    registeredClassNames(`@layer { .ly-b { width: 1px; } }`),
  ).toStrictEqual(["ly-b"]);
  expect(
    registeredClassNames(`@layer o { @layer i { .ly-c { width: 1px; } } }`),
  ).toStrictEqual(["ly-c"]);
});

test("unlayered rules outrank layered ones, in either source order", () => {
  // CSS Cascade 5 §6.4.4 — an unlayered normal declaration has HIGHER priority
  // than any layered one, whatever the source order. That is what `@layer`
  // buys: a utility layer sits BENEATH the un-layered author styles, which
  // override it. The compiler gives a layered rule a negative
  // `Specificity.Layer` rank, and `specificityCompareFn` weighs that slot above
  // every specificity slot below it.
  registerCSS(`.l3 { color: blue; } @layer na { .l3 { color: red; } }`);
  render(<View testID="ly3" className="l3" />);
  expect(styleOf("ly3")).toStrictEqual({ color: "#00f" });

  // The reverse source order gives the same answer, which is what separates a
  // layer rank from source order deciding it.
  registerCSS(`@layer nb { .l4 { color: red; } } .l4 { color: blue; }`);
  render(<View testID="ly4" className="l4" />);
  expect(styleOf("ly4")).toStrictEqual({ color: "#00f" });
});

/* -------------------------------------------------------------------------
 * @scope, @property, @font-face, @keyframes and the rest
 * ---------------------------------------------------------------------- */

test("@scope is dropped along with everything inside it", () => {
  // GAP: CSS Cascade 6 §3 `@scope`. `extractRule` lists `"scope"` among the
  // ignored rule types, so both the scoped rules and the scope proximity
  // cascade are lost — the rules do not even survive un-scoped.
  // React Native: EXPRESSIBLE approximately. A scope root is an ancestor
  // condition, which is exactly what the container mechanism behind the
  // descendant combinator already models; the `to` (lower boundary) and the
  // proximity tie-break would be the genuinely new work.
  expect(compiled(`@scope (.sc-a) { .sc-b { width: 1px; } }`)).toStrictEqual(
    {},
  );
  expect(
    compiled(`@scope (.sc-c) to (.sc-d) { .sc-e { width: 1px; } }`),
  ).toStrictEqual({});

  registerCSS(`@scope (.scope-a) { .scope-b { color: red; } }`);
  render(
    <View className="scope-a">
      <View testID="scope" className="scope-b" />
    </View>,
  );
  expect(styleOf("scope")).toBeUndefined();
});

test("@property contributes its initial-value to the registry, not to :root", () => {
  // `vi`, not `vr`. A registered `initial-value` and a `:root` declaration sit
  // at different rungs of the cascade — `:root { --pv: blue }` beats the
  // registered default (css-properties-values-api-1 §2.2) — so they cannot
  // share a slot and still be told apart. `vn` names the properties registered
  // `inherits: false`, which is the flag the runtime cascade reads.
  const sheet = compile(
    `@property --pv { syntax: "<color>"; inherits: false; initial-value: red; } .pa { color: var(--pv); }`,
  ).stylesheet();
  expect(sheet.vr).toBeUndefined();
  expect(sheet.vi).toStrictEqual([["pv", [["#f00"]]]]);
  expect(sheet.vn).toStrictEqual(["pv"]);

  // The number, not `"10px"`: a registered initial value is parsed against the
  // `<length>` its own `syntax` descriptor declares, so the question a declared
  // custom property defers to the runtime is already answered here.
  expect(
    compile(
      `@property --pl { syntax: "<length>"; inherits: false; initial-value: 10px; } .pb { width: var(--pl); }`,
    ).stylesheet().vi,
  ).toStrictEqual([["pl", [[10]]]]);

  // `inherits` is read, and it is the only difference between these two sheets.
  const notInherited = compile(
    `@property --pn { syntax: "<color>"; inherits: false; initial-value: red; }
     .pc { color: var(--pn); }`,
  ).stylesheet();
  const inherited = compile(
    `@property --pn { syntax: "<color>"; inherits: true; initial-value: red; }
     .pc { color: var(--pn); }`,
  ).stylesheet();
  expect(notInherited.vn).toStrictEqual(["pn"]);
  expect(inherited.vn).toBeUndefined();

  // GAP: CSS Properties & Values 1 §2 — `syntax` is read for the initial value
  // and nowhere else, so an out-of-syntax value in a rule is never rejected and
  // an animatable type is not interpolated.
  // React Native: EXPRESSIBLE — compile-time validation the library already has
  // the parsers for.

  // A registered property with no `initial-value` contributes no value.
  expect(
    compiled(
      `@property --pu { syntax: "*"; inherits: false; } .pd { width: 1px; }`,
    ).vi,
  ).toBeUndefined();
});

test("@keyframes is extracted; @font-face and the remaining at-rules are ignored", () => {
  const animation = compiled(
    `@keyframes kf-spin { from { opacity: 0; } to { opacity: 1; } } .kf-a { animation: kf-spin 1s; }`,
  );
  expect(animation.k).toStrictEqual([
    [
      "kf-spin",
      [
        ["from", [{ opacity: 0 }]],
        ["to", [{ opacity: 1 }]],
      ],
    ],
  ]);

  // GAP: CSS Fonts 4 §11 `@font-face`. The rule is ignored — no font is
  // registered and `src:` is never read.
  // React Native: NOT expressible at runtime. RN resolves `fontFamily` against
  // fonts registered natively at build time (Android `assets/fonts`, iOS
  // `UIAppFonts`, or `expo-font` at startup); a stylesheet cannot introduce a
  // new face. `font-family` referring to an already-bundled face works, and
  // that is the whole of what RN can offer.
  const fontFace = compiled(
    `@font-face { font-family: "F"; src: url(f.ttf); } .ff-a { font-family: F; }`,
  );
  expect(
    registeredClassNames(
      `@font-face { font-family: "F2"; src: url(f.ttf); } .ff-b { font-family: F2; }`,
    ),
  ).toStrictEqual(["ff-b"]);
  expect(fontFace.s?.[0]?.[1]?.[0]?.d).toStrictEqual([{ fontFamily: "F" }]);

  // These at-rules are ignored without disturbing their neighbours. Each is
  // genuinely meaningless in React Native: no paged media, no bundler-level
  // stylesheet import at runtime, no list counters, no XML namespaces, no
  // cross-document view transitions, and no starting-style transition origin.
  for (const [atRule, className] of [
    [`@page { margin: 1cm; }`, "at-page"],
    [`@import "other.css";`, "at-import"],
    [`@counter-style cs { system: cyclic; }`, "at-counter"],
    [`@namespace url(http://www.w3.org/1999/xhtml);`, "at-namespace"],
    [`@view-transition { navigation: auto; }`, "at-view"],
  ] as const) {
    expect(
      registeredClassNames(`${atRule} .${className} { width: 1px; }`),
    ).toStrictEqual([className]);
  }

  // GAP: CSS Transitions 2 §3 `@starting-style` — the nested block is dropped,
  // so a transition has no defined origin style.
  // React Native: EXPRESSIBLE in principle (it is just "the style to use on
  // the first frame"), but it needs first-render tracking the library does not
  // currently have.
  expect(
    compiled(`.ss-a { width: 1px; @starting-style { width: 9px; } }`),
  ).toStrictEqual({
    s: [["ss-a", [{ s: [1, 1], d: [{ width: 1 }] }]]],
  });
});

/* -------------------------------------------------------------------------
 * CSS Nesting — CSS Nesting Level 1
 * ---------------------------------------------------------------------- */

test("nesting supports the same selector shapes as the top level", () => {
  // `&` + descendant
  expect(
    registeredClassNames(`.ne-a { width: 1px; & .ne-b { width: 2px; } }`),
  ).toStrictEqual(["ne-a", "ne-b"]);
  // relative bare nesting is equivalent to `& .b`
  expect(
    registeredClassNames(`.ne-c { width: 1px; .ne-d { width: 2px; } }`),
  ).toStrictEqual(["ne-c", "ne-d"]);
  // `&:hover` stays on the same rule set
  const hover = compiled(`.ne-e { width: 1px; &:hover { width: 2px; } }`);
  expect(hover.s?.length).toBe(1);
  expect(hover.s?.[0]?.[1]?.[1]?.p).toStrictEqual({ h: 1 });
  // `&.b` is a compound, not a descendant
  expect(
    compiled(`.ne-f { width: 1px; &.ne-g { width: 2px; } }`).s?.[1]?.[1]?.[0]
      ?.aq,
  ).toStrictEqual([["a", "className", "~=", "ne-f"]]);
  // a nested @media becomes a second rule on the same rule set
  const media = compiled(
    `.ne-h { width: 1px; @media (min-width: 100px) { width: 2px; } }`,
  );
  expect(media.s?.length).toBe(1);
  expect(media.s?.[0]?.[1]?.[1]?.m).toStrictEqual([[">=", "width", 100]]);
});

test("nested child and sibling combinators are dropped like their top-level forms", () => {
  // GAP: CSS Nesting 1 §2 relative selectors. `> .b` / `+ .b` inside a rule
  // are dropped for the same reason their top-level equivalents are — see the
  // combinator tests above for the React Native verdict on each.
  expect(
    registeredClassNames(`.nc-a { width: 1px; > .nc-b { width: 2px; } }`),
  ).toStrictEqual(["nc-a"]);
  expect(
    registeredClassNames(`.nc-c { width: 1px; + .nc-d { width: 2px; } }`),
  ).toStrictEqual(["nc-c"]);
});

/* -------------------------------------------------------------------------
 * Silence
 * ---------------------------------------------------------------------- */

test("no warning is emitted for any dropped selector or at-rule", () => {
  // GAP (diagnostics, not CSS): every drop above is silent. `warnings()` is
  // empty for an id selector, a child combinator, `:has()`, `::before`, a
  // dropped `@supports` block and a dropped `@scope` block alike, so a rule
  // that will never apply is indistinguishable at build time from one that
  // will. This is what makes the "condition dropped, rule kept" cases
  // (`@media (aspect-ratio)`, `@container style()`) hard to notice.
  for (const css of [
    `#warn-a { width: 1px; }`,
    `.warn-b > .warn-c { width: 1px; }`,
    `.warn-d:has(.warn-e) { width: 1px; }`,
    `.warn-f::before { width: 1px; }`,
    `@supports (display: flex) { .warn-g { width: 1px; } }`,
    `@scope (.warn-h) { .warn-i { width: 1px; } }`,
    `@media (min-aspect-ratio: 2/1) { .warn-j { width: 1px; } }`,
  ]) {
    expect(compile(css).warnings()).toStrictEqual({});
  }
});
