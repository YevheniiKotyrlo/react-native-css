import { compile } from "react-native-css/compiler";
import { INHERIT_VARIABLE_PREFIX } from "react-native-css/utilities";

/**
 * Depth coverage for the PUBLISH half of CSS property inheritance.
 *
 * `inherited-properties.test.ts` pins the happy path — this file pins the
 * edges the happy path cannot see: the closure of the property set, the
 * at-rule and selector shapes the publish has to survive, the CSS-wide
 * keywords, and the places where what an element PUBLISHES diverges from what
 * it RENDERS. That last one is the whole risk of the feature: a descendant
 * cannot tell the difference, so a wrong publish is invisible until someone
 * looks at a subtree.
 */

/** The `[name, value]` variable pairs a class's first rule publishes. */
const variablesFor = (css: string, className = "a") => {
  const sheet = compile(css).stylesheet();
  const rules = sheet.s?.find(([name]) => name === className)?.[1];
  return (rules?.[0] as { v?: [string, unknown][] } | undefined)?.v ?? [];
};

/** Every rule a class carries — a class gets more than one from `@media`, `!important` and `light-dark()`. */
const rulesFor = (css: string, className = "a") => {
  const sheet = compile(css).stylesheet();
  return (sheet.s?.find(([name]) => name === className)?.[1] ?? []) as {
    v?: [string, unknown][];
    d?: unknown[];
  }[];
};

/** The published inherited properties of one rule, keyed by their React Native name. */
const inheritedFrom = (css: string, className = "a", ruleIndex = 0) =>
  Object.fromEntries(
    (rulesFor(css, className)[ruleIndex]?.v ?? [])
      .filter(([name]) => name.startsWith(INHERIT_VARIABLE_PREFIX))
      .map(([name, value]) => [
        name.slice(INHERIT_VARIABLE_PREFIX.length),
        value,
      ]),
  );

/** The static declaration record a rule renders for itself. */
const declaredBy = (css: string, className = "a", ruleIndex = 0) =>
  (rulesFor(css, className)[ruleIndex]?.d?.[0] ?? {}) as Record<
    string,
    unknown
  >;

/** Variables published to the whole document by `:root` / `*`. */
const globalVariables = (css: string, key: "vr" | "vu") =>
  ((compile(css).stylesheet() as Record<string, unknown>)[key] ?? []) as [
    string,
    unknown,
  ][];

/**
 * The whole inherited set, each with the declaration that reaches it and the
 * value it publishes.
 */
const INHERITED_SET: [
  declaration: string,
  published: string,
  value: unknown,
][] = [
  ["color: red", "color", "#f00"],
  ["font-family: Arial", "fontFamily", "Arial"],
  ["font-size: 24px", "fontSize", 24],
  ["font-style: italic", "fontStyle", "italic"],
  ["font-variant: small-caps", "fontVariant", ["small-caps"]],
  ["font-weight: 700", "fontWeight", 700],
  ["letter-spacing: 2px", "letterSpacing", 2],
  ["line-height: 24px", "lineHeight", 24],
  ["text-align: center", "textAlign", "center"],
  ["text-transform: uppercase", "textTransform", "uppercase"],
];

describe("the inherited set", () => {
  test.each(INHERITED_SET)(
    "`%s` publishes %s",
    (declaration, published, value) => {
      expect(variablesFor(`.a { ${declaration}; }`)).toContainEqual([
        `${INHERIT_VARIABLE_PREFIX}${published}`,
        value,
      ]);
    },
  );

  test("the set is CLOSED — one rule declaring all of it publishes exactly these names", () => {
    // The honesty guard on the set, from the other direction. The per-property
    // tests above prove nothing is MISSING; this proves nothing EXTRA slipped
    // in, because a name here is a name every descendant of every element
    // carrying this class has to carry too.
    const everyDeclaration = INHERITED_SET.map(
      ([declaration]) => `${declaration};`,
    ).join(" ");

    expect(
      Object.keys(inheritedFrom(`.a { ${everyDeclaration} }`)).sort(),
    ).toStrictEqual(INHERITED_SET.map(([, published]) => published).sort());
  });

  test("`cursor` is absent from the set BECAUSE the compiler cannot parse it", () => {
    // The set's own comment gives this as the reason for leaving `cursor` out,
    // and this is that reason measured rather than trusted: the declaration is
    // warned and the whole rule is dropped, so a set entry would be dead
    // weight. When upstream teaches the compiler `cursor`, this test fails —
    // which is the signal to add the entry, not to relax the test.
    const compiled = compile(`.a { cursor: pointer; }`);

    expect(compiled.warnings()).toStrictEqual({ properties: ["cursor"] });
    expect(compiled.stylesheet()).toStrictEqual({});
  });

  test("`writing-direction` has no CSS spelling, so nothing reaches the publish under that name", () => {
    // `writingDirection` is a React Native name; CSS spells the property
    // `direction`, and `direction` is deliberately excluded because React
    // Native already cascades it. Both spellings are checked so the exclusion
    // cannot be satisfied by a typo: the plain spelling compiles to nothing,
    // and the `-rn-` escape hatch reaches `addDescriptor` but is not in the
    // set, so it publishes nothing either.
    expect(
      compile(`.a { writing-direction: rtl; }`).stylesheet(),
    ).toStrictEqual({});
    expect(inheritedFrom(`.a { -rn-writing-direction: rtl; }`)).toStrictEqual(
      {},
    );
  });

  test("the `-rn-` prefix is stripped before the set is consulted", () => {
    // `resolveInheritedProperty` runs the declared name through
    // `toRNProperty`, which strips `-rn-`. So a property spelled BOTH ways
    // publishes under one canonical name — a descendant never has to know
    // which spelling the author used.
    expect(inheritedFrom(`.a { -rn-font-size: 24px; }`)).toStrictEqual({
      fontSize: 24,
    });
  });
});

describe("the excluded properties", () => {
  // Each of these is inherited in CSS, or looks like it should publish, and is
  // deliberately left out. This block is what stops the set growing by
  // accident — a property added to `INHERITED_TEXT_PROPERTIES` without
  // thinking breaks a test here rather than shipping.
  test.each([
    // React Native already cascades `pointerEvents` to descendants itself.
    ["pointer-events: none"],
    // `text-decoration` is NOT inherited in CSS — it propagates by being drawn
    // across descendants, which React Native already does.
    ["text-decoration: underline red"],
    ["text-decoration-line: underline"],
    ["text-decoration-color: red"],
    ["text-decoration-style: solid"],
    // Inherited in CSS. Maps to `opacity` in React Native, which is NOT
    // inherited — publishing it would fade every descendant twice over.
    ["visibility: hidden"],
    // Not inherited, and each is a near neighbour of something that is.
    ["background-color: red"],
    ["vertical-align: middle"],
    ["user-select: none"],
    ["opacity: 0.5"],
  ])("`%s` publishes nothing", (declaration) => {
    expect(inheritedFrom(`.a { ${declaration}; }`)).toStrictEqual({});
  });

  test("`-rn-cursor` reaches the compiler but is still not published", () => {
    // The `-rn-` escape hatch bypasses the property table, so `cursor` DOES
    // become a declaration this way. It must still not publish: the set is the
    // single gate, and an escape-hatch spelling must not be a second door into
    // it.
    expect(declaredBy(`.a { -rn-cursor: pointer; }`)).toStrictEqual({
      cursor: "pointer",
    });
    expect(inheritedFrom(`.a { -rn-cursor: pointer; }`)).toStrictEqual({});
  });

  test("`direction` publishes its OWN cascade variable but no inherited twin", () => {
    // The precise claim: `direction` is excluded from the inherited set, not
    // from publishing altogether. It already had a variable channel
    // (`__rn-css-direction`) before this feature, and the exclusion exists so
    // the two do not double-apply. Asserting only "no inherited twin" would
    // still pass if the pre-existing channel were deleted.
    const names = variablesFor(`.a { direction: rtl; }`).map(([name]) => name);

    expect(names).toStrictEqual(["__rn-css-direction"]);
  });

  test("`text-shadow` emits a NESTED path, which is why it cannot be published", () => {
    // The stated reason for excluding `text-shadow` is that its offset is a
    // nested path a flat variable cannot carry. This asserts that reason is
    // real rather than remembered: the offset arrives as `["&",
    // "textShadowOffset", "width"]` tuples, not as a key on the static record.
    // Publishing colour and radius alone would render a descendant's shadow at
    // offset 0,0 — a WRONG shadow rather than a missing one.
    const rule = rulesFor(`.a { text-shadow: 1px 2px 3px red; }`)[0];

    expect(rule?.d).toStrictEqual([
      { textShadowColor: "#f00", textShadowRadius: 3 },
      [1, ["&", "textShadowOffset", "width"]],
      [2, ["&", "textShadowOffset", "height"]],
    ]);
    expect(rule?.v).toBeUndefined();
  });

  test("a rule with no inherited property carries no `v` key at all", () => {
    // The publish must not materialise an empty array on every rule in the
    // sheet — `v` is shipped to the device, so an empty one is pure payload.
    expect(
      rulesFor(`.a { margin: 10px; padding: 4px; }`)[0]?.v,
    ).toBeUndefined();
  });
});

describe("shorthands", () => {
  test("the minimal `font` shorthand publishes the longhands it RESETS as well as the ones it sets", () => {
    // `font: 16px Arial` names only size and family, but per CSS a shorthand
    // resets every longhand it covers — style, weight and variant all go to
    // `normal`, which React Native spells as the empty list for the last one.
    // So the publish carries five properties from a two-value declaration, and
    // a descendant's inherited weight is correctly overridden back to normal.
    //
    // Worth pinning because it is the one place the publish is deliberately
    // WIDER than the declaration: dropping the reset longhands would leave a
    // nearer-ancestor `font-weight: bold` leaking through a `font` shorthand
    // that CSS says clears it.
    expect(inheritedFrom(`.a { font: 16px Arial; }`)).toStrictEqual({
      fontFamily: "Arial",
      fontSize: 16,
      fontStyle: "normal",
      fontVariant: [],
      fontWeight: "normal",
    });
  });

  test("the `font` shorthand's slash line-height publishes as an em function", () => {
    // The `24px/1.5` form makes line-height a MULTIPLE of the font size, so
    // the published value is a resolvable function rather than a number. A
    // descendant that overrides `font-size` still gets a proportional line.
    expect(
      inheritedFrom(`.a { font: 24px/1.5 Arial; }`).lineHeight,
    ).toStrictEqual([{}, "em", 1.5, 1]);
  });

  test("the `text-decoration` shorthand leaks no inherited longhand", () => {
    // It expands into `text-decoration-color`, which sits one letter away from
    // `color` in the set. A prefix or substring match would publish it.
    expect(
      inheritedFrom(`.a { text-decoration: underline wavy red; }`),
    ).toStrictEqual({});
  });

  test.each([["inherit"], ["unset"], ["initial"]])(
    "`all: %s` leaks nothing",
    (keyword) => {
      // `all` targets every property including the whole inherited set, so if
      // any expansion reached `addDescriptor` it would publish twelve
      // variables from one declaration. The compiler rejects the property
      // outright, which is the strongest possible version of that guarantee.
      const compiled = compile(`.a { all: ${keyword}; }`);

      expect(compiled.warnings()).toStrictEqual({ properties: ["all"] });
      expect(compiled.stylesheet()).toStrictEqual({});
    },
  );
});

describe("at-rules and selectors", () => {
  test("a rule inside `@media` publishes, carrying its own condition", () => {
    // The publish rides `rule.v`, so it inherits the rule's conditions for
    // free — the variable only exists while the query matches. Asserting the
    // condition alongside is what makes that specific rather than incidental.
    const rule = rulesFor(
      `@media (min-width: 100px) { .a { color: red; } }`,
    )[0] as { m?: unknown };

    expect(rule.m).toStrictEqual([[">=", "width", 100]]);
    expect(
      inheritedFrom(`@media (min-width: 100px) { .a { color: red; } }`),
    ).toStrictEqual({ color: "#f00" });
  });

  test("a base rule and its `@media` override each publish their own value", () => {
    // Two rules for one class. The runtime picks by specificity, and each
    // carries the value it renders — the media rule must not publish the base
    // colour while rendering the override.
    const css = `.a { color: red; } @media (min-width: 100px) { .a { color: blue; } }`;

    expect(inheritedFrom(css, "a", 0)).toStrictEqual({ color: "#f00" });
    expect(inheritedFrom(css, "a", 1)).toStrictEqual({ color: "#00f" });
  });

  test("`:root` publishes the inherited variable document-wide", () => {
    // `:root` has no class to attach to, so its variables go to the sheet's
    // root scope. This is how an app-wide default text colour reaches every
    // subtree without a class on the tree at all.
    expect(globalVariables(`:root { color: red; }`, "vr")).toStrictEqual([
      [`${INHERIT_VARIABLE_PREFIX}color`, [["#f00"]]],
    ]);
  });

  test("a `:root` value under a media condition keeps its condition when published", () => {
    // The root scope stores `[value, conditions]` pairs, so a dark-mode
    // override stays conditional rather than collapsing to whichever
    // declaration was parsed last.
    expect(
      globalVariables(
        `:root { color: red; } @media (prefers-color-scheme: dark) { :root { color: blue; } }`,
        "vr",
      )[0],
    ).toStrictEqual([
      `${INHERIT_VARIABLE_PREFIX}color`,
      [["#00f", [["=", "prefers-color-scheme", "dark"]]], ["#f00"]],
    ]);
  });

  test("`:root { font-size }` spawns the rem alias from the em twin, not from the inherited one", () => {
    // The root scope duplicates `__rn-css-em` into `__rn-css-rem`. That
    // duplication is keyed on the exact pre-existing name, so the inherited
    // twin must not spawn a second, differently-named rem.
    expect(
      globalVariables(`:root { font-size: 24px; }`, "vr").map(([name]) => name),
    ).toStrictEqual([
      `${INHERIT_VARIABLE_PREFIX}fontSize`,
      "__rn-css-em",
      "__rn-css-rem",
    ]);
  });

  test("`*` publishes the inherited variable to the universal scope", () => {
    expect(globalVariables(`* { color: red; }`, "vu")).toStrictEqual([
      [`${INHERIT_VARIABLE_PREFIX}color`, [["#f00"]]],
    ]);
  });

  test("a container-query rule publishes, gated on its query", () => {
    const css = `.b { container-type: inline-size; } @container (min-width: 100px) { .a { color: red; } }`;
    const rule = rulesFor(css, "a")[0] as { cq?: unknown };

    expect(rule.cq).toStrictEqual([{ m: [">=", "width", 100] }]);
    expect(inheritedFrom(css)).toStrictEqual({ color: "#f00" });
  });

  test("a pseudo-class rule publishes, gated on the pseudo-class", () => {
    // A hover colour must publish too — otherwise a hovered <View>'s text
    // children keep the un-hovered colour and the subtree visibly splits.
    const rule = rulesFor(`.a:hover { color: red; }`)[0] as { p?: unknown };

    expect(rule.p).toStrictEqual({ h: 1 });
    expect(inheritedFrom(`.a:hover { color: red; }`)).toStrictEqual({
      color: "#f00",
    });
  });

  test("an attribute-selector rule publishes, gated on the attribute", () => {
    const rule = rulesFor(`.a[data-x] { color: red; }`)[0] as { aq?: unknown };

    expect(rule.aq).toStrictEqual([["d", "x"]]);
    expect(inheritedFrom(`.a[data-x] { color: red; }`)).toStrictEqual({
      color: "#f00",
    });
  });

  test("a nested `&:hover` publishes separately from its parent rule", () => {
    const css = `.a { color: red; &:hover { color: blue; } }`;

    expect(inheritedFrom(css, "a", 0)).toStrictEqual({ color: "#f00" });
    expect(inheritedFrom(css, "a", 1)).toStrictEqual({ color: "#00f" });
  });

  test("a descendant selector publishes from the MATCHED class, not the ancestor", () => {
    // `.a .b { color: red }` styles `.b`. The publish belongs on `.b`'s rule,
    // so `.b`'s own descendants inherit it — `.a` is only a container marker
    // and must publish nothing, or every child of `.a` would go red.
    const css = `.a .b { color: red; }`;

    expect(variablesFor(css, "a")).toStrictEqual([]);
    expect(inheritedFrom(css, "b")).toStrictEqual({ color: "#f00" });
  });

  test("a child combinator is dropped whole, so it publishes nothing", () => {
    // `>` is unsupported by the compiler — the rule never reaches
    // `addDescriptor`. Pinned because a silently-dropped rule looks exactly
    // like a publish bug from a subtree that did not change colour.
    expect(compile(`.a > .b { color: red; }`).stylesheet()).toStrictEqual({});
  });

  test("a grouped selector publishes to every class in the group", () => {
    const css = `.a, .b { color: red; }`;

    expect(inheritedFrom(css, "a")).toStrictEqual({ color: "#f00" });
    expect(inheritedFrom(css, "b")).toStrictEqual({ color: "#f00" });
  });

  test("keyframes publish nothing, even for a keyframe full of inherited properties", () => {
    // Goes past the existing single-property case: a keyframe declaring three
    // inherited properties still emits none of them, and the pre-existing
    // currentcolor/em variables are flattened INTO the frame rather than into
    // a `v` channel. Publishing here would leak an animation's intermediate
    // value to every descendant, on every frame.
    const sheet = compile(`
      @keyframes k {
        from { color: red; font-size: 10px; letter-spacing: 2px; }
        to { color: blue; font-size: 20px; letter-spacing: 4px; }
      }
    `).stylesheet();

    expect(JSON.stringify(sheet)).not.toContain(INHERIT_VARIABLE_PREFIX);
    expect(sheet.k?.[0]?.[1]?.[0]?.[1]).toStrictEqual([
      {
        color: "#f00",
        letterSpacing: 2,
        fontSize: 10,
        __rnCssEm: 10,
      },
    ]);
  });

  test("a class that only runs an animation publishes nothing", () => {
    // The animation's own properties are not inherited, and the keyframe's
    // values stay in the keyframe. So `.a` publishes no `v` at all.
    expect(
      rulesFor(
        `@keyframes k { from { color: red; } } .a { animation: k 1s; }`,
      )[0]?.v,
    ).toBeUndefined();
  });

  test("a transitioned inherited property still publishes its declared value", () => {
    // `transition` sits in the same rule and flips `a: true`, which routes the
    // rule through the animation path. The colour must still publish.
    expect(
      inheritedFrom(`.a { color: red; transition: color 1s; }`),
    ).toStrictEqual({ color: "#f00" });
  });
});

describe("declaration-level edge cases", () => {
  test("`!important` splits into its own rule, and each rule publishes its own value", () => {
    // Two rules with different specificity vectors. If the important rule
    // published the non-important value, a subtree would render the losing
    // colour while the element itself rendered the winning one.
    const css = `.a { color: red; color: blue !important; }`;
    const rules = rulesFor(css) as { s?: unknown }[];

    expect(rules.map((rule) => rule.s)).toStrictEqual([
      [1, 1],
      [1, 1, 1],
    ]);
    expect(inheritedFrom(css, "a", 0)).toStrictEqual({ color: "#f00" });
    expect(inheritedFrom(css, "a", 1)).toStrictEqual({ color: "#00f" });
  });

  test("an `!important` declaration on its own publishes normally", () => {
    expect(inheritedFrom(`.a { color: red !important; }`)).toStrictEqual({
      color: "#f00",
    });
  });

  test("the same inherited property declared twice publishes ONCE, with the winner", () => {
    // Duplicate declarations in one rule are collapsed before the compiler
    // sees them, so the publish cannot accumulate. This matters because
    // `rule.v` is an ARRAY, not a map — two entries under one name would ship
    // twice and leave the resolution order to whoever reads it.
    const published = variablesFor(`.a { color: red; color: blue; }`).filter(
      ([name]) => name === `${INHERIT_VARIABLE_PREFIX}color`,
    );

    expect(published).toStrictEqual([
      [`${INHERIT_VARIABLE_PREFIX}color`, "#00f"],
    ]);
  });

  test("the same property declared twice in DIFFERENT value shapes still publishes once", () => {
    // A hex and a functional colour are different parse paths into the same
    // property; the collapse is on the property name, not the value shape.
    expect(
      inheritedFrom(`.a { color: red; color: rgb(0 0 0 / 50%); }`),
    ).toStrictEqual({ color: "#00000080" });
  });

  test("each inherited twin is emitted immediately BEFORE its pre-existing partner", () => {
    // `v` is a positional array, so the order is the contract for any consumer
    // that reduces it left to right. Two things are pinned: the twin always
    // precedes the channel it accompanies, and the pairs stay grouped per
    // property rather than being batched.
    //
    // Note the order is the COMPILER's declaration order, not the source order
    // — `color` is declared second here and published first, because
    // lightningcss normalises the declaration block before the builder sees
    // it. Asserting source order would be asserting a fact about lightningcss.
    expect(
      variablesFor(`.a { font-size: 24px; color: red; }`).map(([name]) => name),
    ).toStrictEqual([
      `${INHERIT_VARIABLE_PREFIX}color`,
      `${INHERIT_VARIABLE_PREFIX}fontSize`,
      "__rn-css-em",
    ]);
  });

  test("a value React Native cannot express drops the rule, so nothing is published", () => {
    // `text-align: match-parent` is valid CSS with no React Native form. The
    // publish must never carry a value the descendant would then have to
    // reject — here the whole declaration is refused upstream of the publish.
    //
    // NOT `start`, which reads like the same case and is not: React Native's
    // `left`/`right` are already logical, so `start` maps exactly and renders.
    const compiled = compile(`.a { text-align: match-parent; }`);

    expect(compiled.warnings()).toStrictEqual({
      values: { "text-align": ["match-parent"] },
    });
    expect(compiled.stylesheet()).toStrictEqual({});
  });
});

describe("value forms", () => {
  test("a `calc()` is folded before publishing", () => {
    // The descendant receives the computed number, not an expression it would
    // have to evaluate.
    expect(inheritedFrom(`.a { font-size: calc(10px + 2px); }`)).toStrictEqual({
      fontSize: 12,
    });
  });

  test("`currentcolor` reads the channel and publishes nothing back into it", () => {
    // On `color` itself the keyword IS `inherit` (css-color-4 §6.2), so the
    // read has to skip the element's own scope — an ordinary `var()` would
    // find whatever colour another rule on this same element published and
    // return that instead of the ancestor's.
    //
    // And the rule publishes NOTHING. An entry holding its own lookup shadows
    // the ancestor's real colour with a reference to itself, so a descendant
    // resolves nothing where CSS gives it the ancestor's value. Withholding
    // leaves the ancestor's entry standing, which is what the keyword asks for.
    expect(
      variablesFor(`.a { color: currentcolor; }`).map(([name]) => name),
    ).toStrictEqual([]);
    expect(rulesFor(`.a { color: currentcolor; }`)[0]?.d).toStrictEqual([
      [[{}, "inheritedVar", `${INHERIT_VARIABLE_PREFIX}color`], "color", 1],
    ]);
  });

  test("a `var()` with a fallback publishes the fallback chain intact", () => {
    // The fallback has to survive the publish, or a descendant resolving an
    // undefined variable gets nothing instead of the author's default.
    expect(
      inheritedFrom(`.a { color: var(--missing, green); }`).color,
    ).toStrictEqual([{}, "var", ["missing", "green"], 1]);
  });

  test("an unresolvable `var()` publishes the reference rather than a value", () => {
    // A second definition stops the compiler inlining `--brand`, so what the
    // ancestor publishes is the lookup itself. The descendant has to resolve
    // that in the ANCESTOR's scope — `inheritedVar` is what makes it do so.
    const css = `
      :root { --brand: red; }
      @media (prefers-color-scheme: dark) { :root { --brand: blue; } }
      .a { color: var(--brand); }
    `;
    const published = Object.fromEntries(variablesFor(css));

    expect(published[`${INHERIT_VARIABLE_PREFIX}color`]).toStrictEqual([
      {},
      "var",
      "brand",
      1,
    ]);
  });

  test("`color: inherit` reads the channel and does not republish it", () => {
    // `inherit` and `currentcolor` are identical on `color` (css-color-4 §6.2)
    // and compile to the same read. What the rule must NOT do is publish that
    // channel for its own subtree: an entry holding its own lookup shadows the
    // ancestor's real colour with a reference to itself, so `inherit` would
    // inherit nothing.
    expect(
      variablesFor(`.a { color: inherit; }`).map(([name]) => name),
    ).toStrictEqual([]);
    expect(rulesFor(`.a { color: inherit; }`)[0]?.d).toStrictEqual(
      rulesFor(`.a { color: currentcolor; }`)[0]?.d,
    );
  });

  test("`color: initial` publishes nothing", () => {
    expect(compile(`.a { color: initial; }`).stylesheet()).toStrictEqual({});
  });

  test("an `em` value publishes as a function, so it resolves against the DESCENDANT's font size", () => {
    // The unresolved function is the point: baking `0.5em` to a number at
    // publish time would size a descendant's letter-spacing against the
    // ANCESTOR's font size.
    expect(
      inheritedFrom(`.a { letter-spacing: 0.5em; }`).letterSpacing,
    ).toStrictEqual([{}, "em", 0.5, 1]);
  });

  test("a unitless `line-height` publishes as an em function", () => {
    expect(inheritedFrom(`.a { line-height: 1.5; }`).lineHeight).toStrictEqual([
      {},
      "em",
      1.5,
      1,
    ]);
  });

  test("a font-family stack publishes the single family React Native gets", () => {
    // React Native takes one family, not a stack. The published value has to
    // be the same single family the element renders — a descendant resolving a
    // comma-joined string would render nothing.
    expect(
      inheritedFrom(`.a { font-family: "Helvetica Neue", Arial, sans-serif; }`),
    ).toStrictEqual({ fontFamily: "Helvetica Neue" });
  });

  test.each([["letter-spacing: normal"], ["line-height: normal"]])(
    "`%s` publishes nothing — the keyword means 'no value'",
    (declaration) => {
      expect(compile(`.a { ${declaration}; }`).stylesheet()).toStrictEqual({});
    },
  );
});

describe("coexistence with the pre-existing variable channels", () => {
  test("`color` publishes ONE channel, which `currentcolor` also reads", () => {
    // `color` is an inherited property like any other, so it needs no channel
    // of its own: the one `addDescriptor` publishes for every inherited
    // property is the one `currentcolor` resolves against. A second channel
    // beside it was a second copy of the same value, and the two could
    // disagree — `font-size` below keeps its `em` twin because that one is a
    // DIFFERENT value (the resolved pixel size a relative length multiplies),
    // not a copy.
    expect(variablesFor(`.a { color: red; }`)).toStrictEqual([
      [`${INHERIT_VARIABLE_PREFIX}color`, "#f00"],
    ]);
  });

  test("`font-size` publishes the inherited twin ALONGSIDE `__rn-css-em`", () => {
    // `--__rn-css-em` drives every `em` unit in the subtree. Replacing it
    // rather than sitting beside it would break every relative length in the
    // sheet, which no inheritance test would catch.
    //
    // This is also the CONTROL for the `em`-valued case below: it is what
    // proves `publishEmVariable`'s skip is narrow — scoped to a self-
    // referential value, not to `font-size` generally.
    expect(variablesFor(`.a { font-size: 24px; }`)).toStrictEqual([
      [`${INHERIT_VARIABLE_PREFIX}fontSize`, 24],
      ["__rn-css-em", 24],
    ]);
  });

  test.each([
    ["px", 24],
    ["rem", 2],
  ])("a font-size in `%s` publishes both channels", (unit, value) => {
    // Every unit that folds to a NUMBER publishes both. A skip that grows to
    // cover `rem` or a plain length breaks here rather than in a subtree nobody
    // is looking at. The two PARENT-relative spellings are the exception —
    // `em` in the marker below, and `%`, which compiles to the same function,
    // at the end of the file.
    expect(
      variablesFor(`.a { font-size: ${value}${unit}; }`).map(([name]) => name),
    ).toStrictEqual([`${INHERIT_VARIABLE_PREFIX}fontSize`, "__rn-css-em"]);
  });

  test("SUSPECTED DEFECT: an em-valued font-size publishes the inherited twin but NOT `__rn-css-em`", () => {
    // Expected: `--__rn-css-em` carries the size this element COMPUTES, so an
    //           `em` length elsewhere on the element sizes against it.
    // Actual:   only `__rn-css-inherit-fontSize` is published; `__rn-css-em`
    //           is skipped by `publishEmVariable` in `declarations.ts`.
    //
    // The measured cost, for `.p { font-size: 20px }` wrapping
    // `.c { font-size: 2em; width: 3em }`: the child renders
    // `{ fontSize: 40, width: 60 }`. `fontSize` is right — `2em` reads the
    // PARENT's 20 — but `width` should be `3 x 40 = 120` and is `3 x 20 = 60`,
    // because the element's own `em` lengths read the same inherited variable
    // its font-size did.
    //
    // The skip is NOT protection against a `RangeError`. `varResolver`'s
    // `variableHistory` guard (`native/styles/variables.ts`) terminates a
    // self-referential variable by returning nothing on re-entry, so a
    // hand-written `.x { --__rn-css-em: 2em; width: 3em }` renders
    // `{ width: 84 }` rather than throwing.
    //
    // Publishing the unresolved function is still wrong, for a different
    // reason: the element's own declarations consult `inlineVariables` before
    // the inherited context, so `font-size: 2em` would read the value it just
    // published and apply itself twice — the same child measures
    // `{ fontSize: 56, width: 84 }` once the variable is added by hand.
    //
    // The fix is a two-phase resolution, not a wider publish: resolve
    // `font-size` first, write its NUMERIC result into
    // `inlineVariables["__rn-css-em"]`, then resolve the remaining
    // declarations against it. Then `font-size` reads the parent's size and
    // every other `em` reads this element's, with no self-reference to guard.
    expect(variablesFor(`.a { font-size: 2em; }`)).toStrictEqual([
      [`${INHERIT_VARIABLE_PREFIX}fontSize`, [{}, "em", 2, 1]],
    ]);
  });

  test("SUSPECTED DEFECT: the `font` shorthand skips `__rn-css-em` for an em size too", () => {
    // The same skip lives in `parseFont`, so the shorthand and the longhand
    // agree with each other while both disagree with the non-`em` case. Pinned
    // separately because a fix applied to only one parser would leave the two
    // spellings of one property publishing different variable sets — and the
    // two-phase fix the longhand case describes has to reach both.
    expect(
      variablesFor(`.a { font: 2em Arial; }`).map(([name]) => name),
    ).toStrictEqual([
      `${INHERIT_VARIABLE_PREFIX}fontFamily`,
      `${INHERIT_VARIABLE_PREFIX}fontSize`,
      `${INHERIT_VARIABLE_PREFIX}fontStyle`,
      `${INHERIT_VARIABLE_PREFIX}fontVariant`,
      `${INHERIT_VARIABLE_PREFIX}fontWeight`,
    ]);
  });

  test("the published value matches what the same rule renders", () => {
    // The core invariant of the feature: a descendant is told exactly what its
    // ancestor drew. Everywhere this holds, a subtree is consistent with its
    // root; the `light-dark()` case below is where it does not.
    const css = `.a { color: red; font-size: 24px; letter-spacing: 2px; text-align: center; }`;

    expect(inheritedFrom(css)).toStrictEqual(declaredBy(css));
  });
});

/**
 * The value shapes where the two channels can disagree: a rule gated on a
 * colour scheme, the CSS-wide keywords, and a unit React Native has no
 * spelling for.
 *
 * A `SUSPECTED DEFECT` title marks a case that is still wrong. Every other
 * test here pins a case that is right and is easy to break.
 */
describe("mode-gated rules, CSS-wide keywords and unit shapes", () => {
  test("`light-dark()` publishes, from each rule, the value that rule renders", () => {
    // `createRuleFromPartial` clones the base rule for each extra rule and
    // replaces `v` from the partial, exactly as it replaces `d`. Both rules
    // apply and the runtime assigns variables in rule order, so the dark
    // rule's entries override the base rule's — an element under
    // `prefers-color-scheme: dark` renders blue and publishes blue.
    const css = `.a { color: light-dark(red, blue); }`;

    // Rule 0 is the light rule.
    expect(declaredBy(css, "a", 0)).toStrictEqual({ color: "#f00" });
    expect(inheritedFrom(css, "a", 0)).toStrictEqual({ color: "#f00" });

    // Rule 1 is the dark rule: renders blue, publishes blue.
    expect(declaredBy(css, "a", 1)).toStrictEqual({ color: "#00f" });
    expect(inheritedFrom(css, "a", 1)).toStrictEqual({ color: "#00f" });
    expect(inheritedFrom(css, "a", 1)).toStrictEqual(declaredBy(css, "a", 1));
  });

  test("`light-dark()` emits exactly one dark rule, carrying only its override", () => {
    // One base rule plus one dark rule. The dark rule declares only what it
    // overrides; the base rule supplies everything else, because both apply.
    //
    // Two, not three: `parseColor` is not pure, so parsing `color` a second
    // time registers a second extra rule. One parse feeds the declaration and
    // the publish alike.
    const css = `.a { font-size: 10px; color: light-dark(red, blue); }`;
    const rules = rulesFor(css);

    expect(rules).toHaveLength(2);
    expect(declaredBy(css, "a", 0)).toStrictEqual({
      color: "#f00",
      fontSize: 10,
    });
    expect(declaredBy(css, "a", 1)).toStrictEqual({ color: "#00f" });

    // The base rule publishes both properties. The dark rule publishes ONLY
    // the one it overrides — the same layering its `d` uses. Both rules apply
    // and the runtime assigns variables in rule order, so a descendant in dark
    // mode reads `color` from the dark rule and `fontSize` from the base one.
    expect(inheritedFrom(css, "a", 0)).toStrictEqual({
      fontSize: 10,
      color: "#f00",
    });
    expect(inheritedFrom(css, "a", 1)).toStrictEqual({ color: "#00f" });
  });

  test("`color: unset` publishes nothing, so the ancestor's colour is the one that reaches a descendant", () => {
    // `unset` computes to `inherit` on an inherited property (css-cascade-4
    // §7.3), so the value a descendant needs is the ancestor's — and an entry
    // holding the keyword would hide it. `resolveValue` maps the string
    // `"unset"` to `null` (`native/styles/resolve.ts`), and `null` is a VALUE:
    // React Native reads it as a transparent colour rather than as an absence,
    // so under `.g { color: red }` wrapping `.m { color: unset }` a Text inside
    // `.m` would draw invisible where CSS draws it red. Publishing nothing
    // leaves the ancestor's entry in place, which is what the keyword asks for.
    const css = `.a { color: unset; }`;

    // The channel is NOT republished — that is what leaves the ancestor's
    // entry in place for the descendant to read.
    expect(variablesFor(css).map(([name]) => name)).toStrictEqual([]);
    // And the element's own colour is the inherited-scope lookup, so it
    // renders the ancestor's colour rather than the `null` the bare keyword
    // used to resolve to — which React Native reads as transparent, not as an
    // absence.
    expect(rulesFor(css)[0]?.d).toStrictEqual([
      [[{}, "inheritedVar", `${INHERIT_VARIABLE_PREFIX}color`], "color", 1],
    ]);
  });

  test("`revert` is dropped with a warning on both channels", () => {
    // A CSS-wide keyword with no runtime form is an instruction to the cascade
    // that nothing downstream can turn into a style, so `parseUnparsed` rejects
    // `revert` and `revert-layer` beside `inherit` and `initial`. Falling
    // through as its own text put the colour string `"revert"` on the element
    // and, through the inheritance channel, on every descendant — a value React
    // Native cannot draw.
    const css = `.a { color: revert; }`;

    expect(compile(css).warnings()).toStrictEqual({
      values: { color: ["revert"] },
    });
    expect(inheritedFrom(css)).toStrictEqual({});
    expect(declaredBy(css)).toStrictEqual({});
  });

  test("`font-variant-caps` and `font-variant` publish the same array shape", () => {
    // React Native types `fontVariant` as `FontVariant[]`, so both spellings
    // publish an array. A bare string from either one would hand a descendant
    // a value of the wrong shape.
    expect(inheritedFrom(`.a { font-variant: small-caps; }`)).toStrictEqual({
      fontVariant: ["small-caps"],
    });
    expect(
      inheritedFrom(`.a { font-variant-caps: small-caps; }`),
    ).toStrictEqual({
      fontVariant: ["small-caps"],
    });
  });

  test("a percentage font-size is the `em` multiplier it names, on both channels", () => {
    // A `<percentage>` font size is measured against the PARENT's computed size
    // (css-fonts-4 §3.5), which is the quantity `em` measures — so `150%` and
    // `1.5em` are one declaration written two ways, and `parseFontSize`
    // compiles both to the same style function. React Native types `fontSize`
    // as a number, so the `"150%"` string the generic length formatter produces
    // reached the element and every descendant as a value it drops.
    const css = `.a { font-size: 150%; }`;
    const asEm = [{}, "em", 1.5, 1];

    expect(inheritedFrom(css)).toStrictEqual({ fontSize: asEm });
    // A style function is resolved at render, so the element's own declaration
    // is the descriptor TUPLE rather than an entry in the static record — and
    // it carries the same function the publish does.
    expect(rulesFor(css)[0]?.d).toStrictEqual([[asEm, "fontSize", 1]]);

    // Landing in the `em` shape puts a percentage under `publishEmVariable`'s
    // skip, so this is the second spelling of the still-open marker above:
    // `--__rn-css-em` is not published, and an `em` length elsewhere on the
    // element sizes against the parent rather than against this size.
    expect(variablesFor(css).map(([name]) => name)).toStrictEqual([
      `${INHERIT_VARIABLE_PREFIX}fontSize`,
    ]);
  });
});
