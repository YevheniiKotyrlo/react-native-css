/**
 * Selector constructs that compiled to nothing, or compiled to the wrong thing,
 * even though every signal they need is already reaching the runtime.
 *
 * Each block states the behaviour before the fix in a comment, so the reason a
 * value changed is readable without the diff. `src/__tests__/native/
 * selector-support.test.tsx` is the wider census of what CSS survives the
 * compile; this file is the subset that was closable.
 */
import { render, screen } from "@testing-library/react-native";
import { compile } from "react-native-css/compiler";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

/** The whole compiled stylesheet. `{}` means every rule in `css` was dropped. */
function compiled(css: string) {
  return compile(css).stylesheet();
}

/** The class names the compiler actually registered a rule set under. */
function registeredClassNames(css: string): string[] {
  return (compiled(css).s ?? []).map(([className]) => className);
}

/** The attribute queries of the first rule of the first registered rule set. */
function attributeQueriesOf(css: string) {
  return compiled(css).s?.[0]?.[1]?.[0]?.aq;
}

function styleOf(id: string): unknown {
  return screen.getByTestId(id).props.style;
}

const RED = { color: "#f00" };

/* -------------------------------------------------------------------------
 * :not() — Selectors Level 4 §9.3
 * ---------------------------------------------------------------------- */

test(":not() compiles to a negated query", () => {
  // BEFORE: `parseComponents` had no `not` case, so the pseudo-class fell to
  // the `default` branch and the WHOLE rule was discarded — `compiled()`
  // returned `{}` for every form below.
  expect(compiled(`.not-1:not(.not-2) { width: 1px; }`)).toStrictEqual({
    s: [
      [
        "not-1",
        [
          {
            s: [1, 2],
            d: [{ width: 1 }],
            aq: [["!", ["a", "className", "~=", "not-2"]]],
          },
        ],
      ],
    ],
  });

  // A class inside `:not()` is matched as a TOKEN of `className`, which is what
  // a class selector means. (The compound path `.a.b` still uses a `*=`
  // substring test — that is a separate defect, pinned by
  // selector-support.test.tsx, and is not what this rule reaches.)
  registerCSS(`.nt-a:not(.nt-b) { color: red; }`);
  render(<View testID="not-alone" className="nt-a" />);
  expect(styleOf("not-alone")).toStrictEqual(RED);

  render(<View testID="not-both" className="nt-a nt-b" />);
  expect(styleOf("not-both")).toBeUndefined();

  // A class that merely CONTAINS the negated name is a different token.
  render(<View testID="not-substring" className="nt-a nt-b-suffix" />);
  expect(styleOf("not-substring")).toStrictEqual(RED);
});

test(":not() with a selector list negates every argument", () => {
  // `:not(a, b)` is `not(a) and not(b)`, so it stays a conjunction of queries.
  expect(
    attributeQueriesOf(`.not-3:not(.x, .y) { width: 1px; }`),
  ).toStrictEqual([
    ["!", ["a", "className", "~=", "x"]],
    ["!", ["a", "className", "~=", "y"]],
  ]);

  registerCSS(`.nl-a:not(.nl-x, .nl-y) { color: red; }`);
  render(<View testID="not-list-none" className="nl-a" />);
  expect(styleOf("not-list-none")).toStrictEqual(RED);
  render(<View testID="not-list-x" className="nl-a nl-x" />);
  expect(styleOf("not-list-x")).toBeUndefined();
  render(<View testID="not-list-y" className="nl-a nl-y" />);
  expect(styleOf("not-list-y")).toBeUndefined();
});

test(":not() with a compound argument negates the conjunction", () => {
  // `:not(.x.y)` is `not(x and y)` — it excludes only the element carrying
  // BOTH. A flat list of negated queries would be `not(x) and not(y)`, which is
  // a different (and stricter) selector, so the compound needs the `&` group.
  expect(attributeQueriesOf(`.not-4:not(.x.y) { width: 1px; }`)).toStrictEqual([
    [
      "!",
      [
        "&",
        [
          ["a", "className", "~=", "x"],
          ["a", "className", "~=", "y"],
        ],
      ],
    ],
  ]);

  registerCSS(`.nc-a:not(.nc-x.nc-y) { color: red; }`);
  render(<View testID="not-cmp-one" className="nc-a nc-x" />);
  expect(styleOf("not-cmp-one")).toStrictEqual(RED);
  render(<View testID="not-cmp-both" className="nc-a nc-x nc-y" />);
  expect(styleOf("not-cmp-both")).toBeUndefined();
});

test(":not() negates attributes, ids and prop-backed pseudo-classes", () => {
  expect(
    attributeQueriesOf(`.not-5:not([data-open]) { width: 1px; }`),
  ).toStrictEqual([["!", ["d", "open"]]]);
  expect(
    attributeQueriesOf(`.not-6:not([data-state="open"]) { width: 1px; }`),
  ).toStrictEqual([["!", ["d", "state", "=", "open"]]]);
  expect(attributeQueriesOf(`.not-7:not(#top) { width: 1px; }`)).toStrictEqual([
    ["!", ["a", "id", "=", "top"]],
  ]);
  expect(
    attributeQueriesOf(`.not-8:not(:disabled) { width: 1px; }`),
  ).toStrictEqual([["!", ["a", "disabled"]]]);

  registerCSS(`.nd-a:not([data-open]) { color: red; }`);
  render(<View testID="not-attr-off" className="nd-a" {...{ dataSet: {} }} />);
  expect(styleOf("not-attr-off")).toStrictEqual(RED);
  render(
    <View
      testID="not-attr-on"
      className="nd-a"
      {...{ dataSet: { open: 1 } }}
    />,
  );
  expect(styleOf("not-attr-on")).toBeUndefined();
});

test(":not() survives nesting and :is() wrapping", () => {
  // BEFORE: both of these compiled to `{}` as well.
  expect(
    attributeQueriesOf(`.not-9 { &:not(.n9b) { width: 1px; } }`),
  ).toStrictEqual([["!", ["a", "className", "~=", "n9b"]]]);
  expect(
    attributeQueriesOf(`.not-10:is(:not(.n10b)) { width: 1px; }`),
  ).toStrictEqual([["!", ["a", "className", "~=", "n10b"]]]);
});

test(":not() over a state pseudo-class is still dropped", () => {
  // `PseudoClassesQuery` is a set of `1` flags with no polarity — there is no
  // way to spell "not hovered" in it — and it is read in
  // src/native/conditions/index.ts, outside this change. Dropping the rule is
  // the same answer as before; it is recorded here so the residual is visible.
  expect(compiled(`.not-11:not(:hover) { width: 1px; }`)).toStrictEqual({});
  // A descendant inside `:not()` (Selectors L4 complex negation) is likewise
  // out of reach: it would need "has no ancestor .x", and the container context
  // only answers the positive question.
  expect(compiled(`.not-12:not(.a .b) { width: 1px; }`)).toStrictEqual({});
  // `:not(*)` matches nothing, so the rule is unreachable and dropped.
  expect(compiled(`.not-13:not(*) { width: 1px; }`)).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * #id — Selectors Level 4 §5.2
 * ---------------------------------------------------------------------- */

test("#id compiles to a query on the `id` prop", () => {
  // BEFORE: `case "id"` returned `null`, so any rule containing an id was
  // dropped — even though `.a[id="b"]` already compiled to exactly this query.
  expect(attributeQueriesOf(`.id-1#top { width: 1px; }`)).toStrictEqual([
    ["a", "id", "=", "top"],
  ]);

  registerCSS(`.id-a#hero { color: red; }`);
  render(<View testID="id-match" className="id-a" id="hero" />);
  expect(styleOf("id-match")).toStrictEqual(RED);
  render(<View testID="id-miss" className="id-a" id="other" />);
  expect(styleOf("id-miss")).toBeUndefined();
  render(<View testID="id-absent" className="id-a" />);
  expect(styleOf("id-absent")).toBeUndefined();

  // An id outranks any number of classes, so it needs its own specificity slot
  // rather than the class one every attribute query shares.
  expect(compiled(`.id-2#top { width: 1px; }`).s?.[0]?.[1]?.[0]?.s).toEqual([
    1,
    1,
    undefined,
    undefined,
    undefined,
    1,
  ]);
});

test("a standalone #id is still dropped", () => {
  // Not a missing branch: the runtime looks rule sets up BY class name, so a
  // rule with no class in it has no key to be found under. This is the same
  // constraint that drops a standalone `[data-open] {}`, and closing it needs a
  // second index in stylesheet.ts + src/native/react, not a selector branch.
  expect(compiled(`#lonely { width: 1px; }`)).toStrictEqual({});
  // ...and an id ancestor cannot be a container, for the same reason: a
  // container is registered under the class name that declares it.
  expect(compiled(`#lonely .id-3 { width: 1px; }`)).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * Attribute case-sensitivity flag — Selectors Level 4 §6.3
 * ---------------------------------------------------------------------- */

test("the `i` flag reaches the query and makes the match case-insensitive", () => {
  // BEFORE: `caseSensitivity` was never read, so the flag was dropped and
  // `[data-state="OPEN" i]` compiled to ["d","state","=","OPEN"] — identical to
  // the unflagged selector, and so never matched a differently-cased value.
  expect(
    attributeQueriesOf(`.ci-1[data-state="OPEN" i] { width: 1px; }`),
  ).toStrictEqual([["d", "state", "=", "OPEN", "i"]]);

  registerCSS(`.ci-a[data-state="OPEN" i] { color: red; }`);
  render(
    <View
      testID="ci-on"
      className="ci-a"
      {...{ dataSet: { state: "open" } }}
    />,
  );
  expect(styleOf("ci-on")).toStrictEqual(RED);

  // Without the flag the comparison stays case-sensitive.
  registerCSS(`.ci-b[data-state="OPEN"] { color: red; }`);
  render(
    <View
      testID="ci-off"
      className="ci-b"
      {...{ dataSet: { state: "open" } }}
    />,
  );
  expect(styleOf("ci-off")).toBeUndefined();
});

test("the `i` flag applies to every attribute operator", () => {
  const cases = [
    { operator: "~=", test: "B", value: "a b c" },
    { operator: "|=", test: "EN", value: "en-GB" },
    { operator: "^=", test: "PRE", value: "prefix" },
    { operator: "$=", test: "FIX", value: "prefix" },
    { operator: "*=", test: "EFI", value: "prefix" },
  ] as const;

  for (const [index, { operator, test: testValue, value }] of cases.entries()) {
    const className = `ci-op-${index}`;
    registerCSS(
      `.${className}[data-v${operator}"${testValue}" i] { color: red; }`,
    );
    render(
      <View
        testID={className}
        className={className}
        {...{ dataSet: { v: value } }}
      />,
    );
    expect({ operator, style: styleOf(className) }).toStrictEqual({
      operator,
      style: RED,
    });
  }
});

test("the explicit `s` flag and the HTML-conditional default stay case-sensitive", () => {
  // `s` is the default in a document with no HTML element, so it adds nothing
  // to the query rather than emitting a redundant marker.
  expect(
    attributeQueriesOf(`.ci-2[data-state="OPEN" s] { width: 1px; }`),
  ).toStrictEqual([["d", "state", "=", "OPEN"]]);

  // lightningcss reports `ascii-case-insensitive-if-in-html-element-in-html-
  // document` for attributes HTML case-folds, such as `type`. React Native has
  // no HTML document, so that condition is never met and the match stays
  // case-sensitive.
  expect(attributeQueriesOf(`.ci-3[type="B"] { width: 1px; }`)).toStrictEqual([
    ["a", "type", "=", "B"],
  ]);
});

/* -------------------------------------------------------------------------
 * [a|=b] — Selectors Level 4 §6.2
 * ---------------------------------------------------------------------- */

test("[a|=b] matches the exact value as well as the dash-prefixed one", () => {
  // BEFORE: the runtime only tested `startsWith(value + "-")`, so the exact
  // half of the dash-match — `[lang|="en"]` against `en` — never matched.
  registerCSS(`.dm-a[data-lang|="en"] { color: red; }`);

  render(
    <View
      testID="dm-exact"
      className="dm-a"
      {...{ dataSet: { lang: "en" } }}
    />,
  );
  expect(styleOf("dm-exact")).toStrictEqual(RED);

  render(
    <View
      testID="dm-dashed"
      className="dm-a"
      {...{ dataSet: { lang: "en-GB" } }}
    />,
  );
  expect(styleOf("dm-dashed")).toStrictEqual(RED);

  // A longer word that merely starts with the value is NOT a dash match.
  render(
    <View
      testID="dm-prefix"
      className="dm-a"
      {...{ dataSet: { lang: "eng" } }}
    />,
  );
  expect(styleOf("dm-prefix")).toBeUndefined();
});

/* -------------------------------------------------------------------------
 * [class] — Selectors Level 4 §6.2
 * ---------------------------------------------------------------------- */

test("[class] targets the `className` prop", () => {
  // BEFORE: the attribute name went through unchanged, so the query read a prop
  // literally called `class`, which no React Native component has — the rule
  // compiled and could never match.
  expect(
    attributeQueriesOf(`.cls-1[class~="foo"] { width: 1px; }`),
  ).toStrictEqual([["a", "className", "~=", "foo"]]);
  expect(attributeQueriesOf(`.cls-2[class] { width: 1px; }`)).toStrictEqual([
    ["a", "className"],
  ]);

  registerCSS(`.cls-a[class~="wanted"] { color: red; }`);
  render(<View testID="cls-token" className="cls-a wanted" />);
  expect(styleOf("cls-token")).toStrictEqual(RED);

  render(<View testID="cls-missing" className="cls-a" />);
  expect(styleOf("cls-missing")).toBeUndefined();

  // `=` keeps its CSS meaning: the WHOLE class attribute must equal the value.
  registerCSS(`.cls-b[class="cls-b"] { color: red; }`);
  render(<View testID="cls-exact" className="cls-b" />);
  expect(styleOf("cls-exact")).toStrictEqual(RED);
  render(<View testID="cls-exact-extra" className="cls-b other" />);
  expect(styleOf("cls-exact-extra")).toBeUndefined();
});

/* -------------------------------------------------------------------------
 * :where() / :is() with a compound argument — Selectors Level 4 §9.1, §9.2
 * ---------------------------------------------------------------------- */

test(":where() with a compound argument matches the SAME element", () => {
  // BEFORE: every class inside `:is()` / `:where()` became an ancestor
  // container query, so `.a:where(.b)` compiled to `cq: [{ n: "g:b" }]` and
  // matched `.a` nested inside `.b` while failing on the element with both.
  // (`:is(.b)` escapes this only because lightningcss's printer collapses a
  // single-argument `:is()` back into a compound before the compiler sees it.)
  expect(compiled(`.wh-1:where(.wh-2) { width: 1px; }`)).toStrictEqual({
    s: [
      [
        "wh-1",
        [
          {
            // `:where()` still contributes no specificity.
            s: [1, 1],
            d: [{ width: 1 }],
            aq: [["a", "className", "~=", "wh-2"]],
          },
        ],
      ],
    ],
  });

  registerCSS(`.wa:where(.wb) { color: red; }`);
  render(<View testID="wh-same" className="wa wb" />);
  expect(styleOf("wh-same")).toStrictEqual(RED);

  render(
    <View className="wb">
      <View testID="wh-desc" className="wa" />
    </View>,
  );
  expect(styleOf("wh-desc")).toBeUndefined();
});

test(":where() keeps the descendant form as an ancestor container query", () => {
  // The `:is(.dark *)` shape Tailwind emits for `dark:` is the reason `:is()` /
  // `:where()` are supported at all, and it is unchanged: a trailing `*` means
  // the subject is the descendant.
  expect(compiled(`.wh-3:is(.dark *) { width: 1px; }`)).toStrictEqual({
    s: [
      ["dark", [{ s: [0], c: ["g:dark"] }]],
      ["wh-3", [{ s: [1, 2], d: [{ width: 1 }], cq: [{ n: "g:dark" }] }]],
    ],
  });

  registerCSS(`.wd-c:where(.wd-p *) { color: red; }`);
  render(
    <View className="wd-p">
      <View testID="wh-anc" className="wd-c" />
    </View>,
  );
  expect(styleOf("wh-anc")).toStrictEqual(RED);
  render(<View testID="wh-anc-out" className="wd-c" />);
  expect(styleOf("wh-anc-out")).toBeUndefined();
});

test(":where() / :is() compound arguments keep their inner conditions", () => {
  expect(attributeQueriesOf(`.wh-4:where(.a.b) { width: 1px; }`)).toStrictEqual(
    [
      ["a", "className", "~=", "a"],
      ["a", "className", "~=", "b"],
    ],
  );

  // Attributes and prop-backed pseudo-classes inside the compound land on the
  // element too, not on an ancestor.
  expect(
    attributeQueriesOf(`.wh-5:where([data-open]:disabled) { width: 1px; }`),
  ).toStrictEqual([
    ["d", "open"],
    ["a", "disabled"],
  ]);

  // ...and a state pseudo-class becomes the element's own pseudo-class query
  // rather than an ancestor's.
  expect(
    compiled(`.wh-6:where(:hover) { width: 1px; }`).s?.[0]?.[1]?.[0]?.p,
  ).toStrictEqual({ h: 1 });

  registerCSS(`.wm-a:where(.wm-b.wm-c) { color: red; }`);
  render(<View testID="wh-cmp-all" className="wm-a wm-b wm-c" />);
  expect(styleOf("wh-cmp-all")).toStrictEqual(RED);
  render(<View testID="wh-cmp-part" className="wm-a wm-b" />);
  expect(styleOf("wh-cmp-part")).toBeUndefined();
});

test(":is() with multiple compound arguments fans out on the same element", () => {
  // Each argument is an alternative, so it stays one rule per argument — but
  // each is now a condition on the element, not on an ancestor.
  expect(
    registeredClassNames(`.wh-7:is(.p.q, .r) { width: 1px; }`),
  ).toStrictEqual(["wh-7"]);

  registerCSS(`.fo-a:is(.fo-p.fo-q, .fo-r) { color: red; }`);
  render(<View testID="fan-first" className="fo-a fo-p fo-q" />);
  expect(styleOf("fan-first")).toStrictEqual(RED);
  render(<View testID="fan-second" className="fo-a fo-r" />);
  expect(styleOf("fan-second")).toStrictEqual(RED);
  render(<View testID="fan-partial" className="fo-a fo-p" />);
  expect(styleOf("fan-partial")).toBeUndefined();
});

/* -------------------------------------------------------------------------
 * Form-state pseudo-classes — Selectors Level 4 §4, §11
 * ---------------------------------------------------------------------- */

test("the form-state pseudo-classes compile to prop queries", () => {
  // BEFORE: each of these hit the `default` branch and dropped the whole rule.
  // `:disabled` was the only one wired up; these follow it exactly — one prop,
  // tested for truthiness.
  expect(attributeQueriesOf(`.fs-1:enabled { width: 1px; }`)).toStrictEqual([
    ["a", "disabled", "!"],
  ]);
  expect(attributeQueriesOf(`.fs-2:checked { width: 1px; }`)).toStrictEqual([
    ["a", "checked"],
  ]);
  expect(attributeQueriesOf(`.fs-3:read-only { width: 1px; }`)).toStrictEqual([
    ["a", "readOnly"],
  ]);
  expect(attributeQueriesOf(`.fs-4:required { width: 1px; }`)).toStrictEqual([
    ["a", "required"],
  ]);
});

test("a new prop condition on an ANCESTOR drops the rule", () => {
  // The runtime does not evaluate a container query's attribute conditions:
  // `testContainerQuery` in src/native/conditions/container-query.ts leaves
  // that check out, because the container context holds the container's
  // identity rather than its props. A condition emitted there is never read, so
  // the rule applies to EVERY descendant instead of none — which is why none of
  // these compile rather than compiling into a condition nobody checks.
  expect(compiled(`.anc-1:checked .anc-2 { width: 1px; }`)).toStrictEqual({});
  expect(compiled(`.anc-3:not(.x) .anc-4 { width: 1px; }`)).toStrictEqual({});
  expect(compiled(`.anc-5#x .anc-6 { width: 1px; }`)).toStrictEqual({});
  expect(
    compiled(`.anc-7:where(.q:required) .anc-8 { width: 1px; }`),
  ).toStrictEqual({});
  // Tailwind's `group-checked:` shape, which puts the state on the ancestor
  // compound inside `:is()`.
  expect(
    compiled(`.anc-9:is(:where(.group):checked *) { width: 1px; }`),
  ).toStrictEqual({});

  // `:disabled` and `:empty` are the two that already emit into that slot, and
  // they keep doing so — this pins them so the divergence is deliberate rather
  // than accidental. They are unenforced, exactly like a plain `[attr]` on an
  // ancestor.
  expect(
    compiled(`.anc-10:disabled .anc-11 { width: 1px; }`).s?.[1]?.[1]?.[0]?.cq,
  ).toStrictEqual([{ a: [["a", "disabled"]], n: "g:anc-10" }]);
});

test("the form-state pseudo-classes match at runtime", () => {
  registerCSS(`.st-en:enabled { color: red; }`);
  render(<View testID="st-enabled" className="st-en" />);
  expect(styleOf("st-enabled")).toStrictEqual(RED);
  render(
    <View testID="st-disabled" className="st-en" {...{ disabled: true }} />,
  );
  expect(styleOf("st-disabled")).toBeUndefined();

  registerCSS(`.st-ck:checked { color: red; }`);
  render(<View testID="st-checked" className="st-ck" {...{ checked: true }} />);
  expect(styleOf("st-checked")).toStrictEqual(RED);
  render(<View testID="st-unchecked" className="st-ck" />);
  expect(styleOf("st-unchecked")).toBeUndefined();

  registerCSS(`.st-ro:read-only { color: red; }`);
  render(
    <View testID="st-readonly" className="st-ro" {...{ readOnly: true }} />,
  );
  expect(styleOf("st-readonly")).toStrictEqual(RED);
  render(<View testID="st-writable" className="st-ro" />);
  expect(styleOf("st-writable")).toBeUndefined();

  registerCSS(`.st-rq:required { color: red; }`);
  render(
    <View testID="st-required" className="st-rq" {...{ required: true }} />,
  );
  expect(styleOf("st-required")).toStrictEqual(RED);
  render(<View testID="st-optional" className="st-rq" />);
  expect(styleOf("st-optional")).toBeUndefined();
});

test("the form-state pseudo-classes survive :is() / :where() and :not()", () => {
  expect(
    attributeQueriesOf(`.fs-5:where(:checked) { width: 1px; }`),
  ).toStrictEqual([["a", "checked"]]);
  expect(
    attributeQueriesOf(`.fs-6:not(:checked) { width: 1px; }`),
  ).toStrictEqual([["!", ["a", "checked"]]]);
});

/* -------------------------------------------------------------------------
 * @supports selector() — CSS Conditional Rules Level 4 §3
 * ---------------------------------------------------------------------- */

test("@supports selector() answers from the selector compiler", () => {
  // BEFORE: every `selector()` query answered a hard `false`. That dropped
  // blocks guarded on selectors this library DOES support, and — through `not`
  // — admitted blocks written to exclude them.
  expect(
    registeredClassNames(
      `@supports selector(:hover) { .sup-1 { width: 1px; } }`,
    ),
  ).toStrictEqual(["sup-1"]);
  expect(
    registeredClassNames(
      `@supports selector(.a .b) { .sup-2 { width: 1px; } }`,
    ),
  ).toStrictEqual(["sup-2"]);
  expect(
    registeredClassNames(
      `@supports selector(::placeholder) { .sup-3 { width: 1px; } }`,
    ),
  ).toStrictEqual(["sup-3"]);
  // The two selectors this change adds answer for themselves.
  expect(
    registeredClassNames(`@supports selector(#id) { .sup-4 { width: 1px; } }`),
  ).toStrictEqual(["sup-4"]);
  expect(
    registeredClassNames(
      `@supports selector(:not(.a)) { .sup-5 { width: 1px; } }`,
    ),
  ).toStrictEqual(["sup-5"]);

  // A selector the compiler genuinely cannot represent still answers `false`,
  // which is the entire point of writing the guard.
  expect(
    compiled(`@supports selector(:has(a)) { .sup-6 { width: 1px; } }`),
  ).toStrictEqual({});
  expect(
    compiled(`@supports selector(.a > .b) { .sup-7 { width: 1px; } }`),
  ).toStrictEqual({});
  expect(
    compiled(`@supports selector(::before) { .sup-8 { width: 1px; } }`),
  ).toStrictEqual({});
  expect(
    compiled(`@supports selector(:nth-child(2)) { .sup-9 { width: 1px; } }`),
  ).toStrictEqual({});

  // Negation follows in both directions.
  expect(
    registeredClassNames(
      `@supports not selector(:has(a)) { .sup-10 { width: 1px; } }`,
    ),
  ).toStrictEqual(["sup-10"]);
  expect(
    compiled(`@supports not selector(:hover) { .sup-11 { width: 1px; } }`),
  ).toStrictEqual({});

  // ...and it composes with a declaration query.
  expect(
    registeredClassNames(
      `@supports selector(:hover) and (display: flex) { .sup-12 { width: 1px; } }`,
    ),
  ).toStrictEqual(["sup-12"]);
  expect(
    compiled(
      `@supports selector(:has(a)) and (display: flex) { .sup-13 { width: 1px; } }`,
    ),
  ).toStrictEqual({});
});
