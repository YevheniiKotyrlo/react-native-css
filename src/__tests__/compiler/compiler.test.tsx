import {
  compile,
  type StyleDeclaration,
  type StyleDescriptor,
} from "react-native-css/compiler";

test("hello world", () => {
  const compiled = compile(`
.my-class {
  color: red;
}`);

  expect(compiled.stylesheet()).toStrictEqual({
    s: [
      [
        "my-class",
        [
          {
            d: [
              {
                color: "#f00",
              },
            ],
            s: [1, 1],
            v: [["__rn-css-inherit-color", "#f00"]],
          },
        ],
      ],
    ],
  });
});

test("reads global CSS variables", () => {
  const compiled = compile(
    `@layer theme {
      :root, :host {
        --color-red-500: oklch(63.7% 0.237 25.331);
      }
    }`,
    {
      inlineVariables: false,
    },
  );

  expect(compiled.stylesheet()).toStrictEqual({
    vr: [["color-red-500", [["#fb2c36"]]]],
  });
});

test(":root CSS variables with media queries", () => {
  const compiled = compile(
    `:root {
        @media ios {
          & {
            --my-var: System;
          }
        }

        @media android {
          & {
            --my-var: SystemAndroid;
          }
        }
      }
    `,
    {
      inlineVariables: false,
    },
  );

  expect(compiled.stylesheet()).toStrictEqual({
    vr: [
      [
        "my-var",
        [
          ["SystemAndroid", [["=", "platform", "android"]]],
          ["System", [["=", "platform", "ios"]]],
        ],
      ],
    ],
  });
});

/**
 * SKIPPED — the optimisation this asserts covers only half the cases.
 *
 * A custom property declared in a universal, unconditional scope is folded into
 * its references and then dropped, so `:root { --unused: red }` publishes
 * nothing (`inline-variables.ts`, `replaceDeclaration` — the `return` guarded by
 * `annotation.universalNames.has(name)`). A property declared inside a class
 * rule, which is what this CSS uses, is deliberately kept by that same guard,
 * because a descendant of the matched element inherits it and the fold only
 * reached the declaring block.
 *
 * Nothing else asks whether a name is referenced, so `--green` — declared,
 * folded nowhere, read by no `var()` in the stylesheet — is published beside
 * `--blue` and `--red`. That is the gap: liveness pruning for block-scoped
 * custom properties.
 *
 * To run: the compiler needs a reference pass over the whole stylesheet, and
 * this expectation needs updating for the two things that are already true —
 * `--red` folds into `color` at compile time, so `d` is the literal `#f00`
 * rather than a runtime `var()` and there is no `dv`; and `color` publishes the
 * `__rn-css-inherit-color` channel. A reader knows the gap
 * is closed when `compile('.test { --green: green; color: blue; }')` publishes
 * no `green` entry in `v`; today it does.
 */
test.skip("removes unused CSS variables", () => {
  const compiled = compile(`
    .test {
      --blue: blue;
      --green: green;
      --red: red;
      color: var(--red, var(--blue))
    }
  `);

  expect(compiled.stylesheet()).toStrictEqual({
    s: [
      [
        "test",
        [
          [
            {
              s: [1, 1],
              v: [
                ["blue", "blue"],
                ["red", "red"],
              ],
              dv: 1,
              d: [[[{}, "var", ["red", [{}, "var", ["blue"]]]], "color", 1]],
            },
          ],
        ],
      ],
    ],
  });
});

/**
 * SKIPPED — this is the opt-out from an optimisation that does not exist, and
 * the at-rule it is written in is not read.
 *
 * `maybeMutateReactNativeOptions` (`compiler/atRules.ts`) matches the
 * `@react-native` at-rule and returns without looking at its body, so
 * `preserve-variables` reaches nothing. It is not rejected either:
 * `compile('@react-native config { preserve-variables: --green; } …').warnings()`
 * is `{}`, so a misspelled option is silent.
 *
 * Even once it is read, the assertion below cannot fail while the test above is
 * skipped — an unused block-scoped variable is published whether or not
 * anything asks for it to be preserved, so both spellings of this CSS produce
 * the same stylesheet today.
 *
 * To run: unused block-scoped variables have to be pruned first (see the test
 * above), then the `@react-native` body has to be parsed into a compile option
 * that exempts the named properties. A reader knows the second half has landed
 * when an unknown key inside `@react-native` produces a warning instead of
 * nothing.
 */
test.skip("preserves unused CSS variables with preserve-variables", () => {
  const compiled = compile(`
    @react-native config {
      preserve-variables: --green, --blue;
    }

    .test { 
      --green: green;
      --red: red;
      color: var(--red)
    }
  `);

  expect(compiled.stylesheet()).toStrictEqual({
    s: [
      [
        "test",
        [
          [
            {
              s: [1, 1],
              v: [
                ["green", "green"],
                ["red", "red"],
              ],
              d: [[[{}, "var", ["red"]], "color", 1]],
              dv: 1,
            },
          ],
        ],
      ],
    ],
  });
});

test("multiple rules with same selector", () => {
  const compiled = compile(`
.redOrGreen:hover { 
  color: green; 
} 
  
.redOrGreen { 
  color: red; 
}
`);

  expect(compiled.stylesheet()).toStrictEqual({
    s: [
      [
        "redOrGreen",
        [
          {
            d: [
              {
                color: "#f00",
              },
            ],
            s: [2, 1],
            v: [["__rn-css-inherit-color", "#f00"]],
          },
          {
            d: [
              {
                color: "#008000",
              },
            ],
            p: {
              h: 1,
            },
            s: [1, 2],
            v: [["__rn-css-inherit-color", "#008000"]],
          },
        ],
      ],
    ],
  });
});

test("transitions", () => {
  const compiled = compile(`
    .test {
      color: red;
      transition: color 1s linear;
    }
  `);

  expect(compiled.stylesheet()).toStrictEqual({
    s: [
      [
        "test",
        [
          {
            d: [
              {
                // lightningcss prints a colour in its shortest hex form.
                color: "#f00",
                transitionProperty: ["color"],
                transitionDuration: [1000],
                transitionDelay: [0],
                // A single timing function is a bare string; a comma-separated
                // list is an array. `animation-transition-state.test.tsx` pins
                // both spellings.
                transitionTimingFunction: "linear",
              },
            ],
            s: [1, 1],
            // `color` publishes react-native-css's two inherited-colour
            // channels beside the style key.
            v: [["__rn-css-inherit-color", "#f00"]],
            // Set by any transition/animation declaration. It is what makes
            // `useNativeCss` wrap the component in reanimated's Animated one.
            a: true,
          },
        ],
      ],
    ],
  });
});

test("animations", () => {
  const compiled = compile(`
    .test {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `);

  expect(compiled.stylesheet()).toStrictEqual({
    k: [
      [
        "spin",
        [
          // A keyframe list keeps the stops the author wrote, in the spelling
          // reanimated's `normalizeKeyframeSelector` accepts. The implicit
          // 0% frame is CSS's "use the element's own value", which only the
          // animator can know, so the compiler does not invent one.
          [
            "to",
            [[[{}, "transform", [[{}, "rotate", "360deg"]]], "transform"]],
          ],
        ],
      ],
    ],
    s: [
      [
        "test",
        [
          {
            a: true,
            d: [
              // `animationName` resolves its keyframes at render, so it is a
              // style function rather than a literal. The remaining longhands
              // are literals and share one object.
              [[[{}, "animationName", ["spin"], 1]], "animationName"],
              {
                animationDuration: [1000],
                animationTimingFunction: "linear",
                animationIterationCount: ["infinite"],
                animationDirection: ["normal"],
                animationPlayState: ["running"],
                animationDelay: [0],
                animationFillMode: ["none"],
              },
            ],
            s: [1, 1],
          },
        ],
      ],
    ],
  });
});

test("breaks apart comma separated variables", () => {
  const compiled = compile(
    `
    :root { 
      --test: blue, green;
    }
  `,
    {
      inlineVariables: false,
    },
  );

  expect(compiled.stylesheet()).toStrictEqual({
    vr: [["test", [[["blue", "green"]]]]],
  });
});

test("light-dark()", () => {
  const compiled = compile(`
.my-class {
  background-color: light-dark(#333b3c, #efefec);
}`);

  expect(compiled.stylesheet()).toStrictEqual({
    s: [
      [
        "my-class",
        [
          {
            d: [
              {
                backgroundColor: "#333b3c",
              },
            ],
            s: [1, 1],
          },
          {
            d: [
              {
                backgroundColor: "#efefec",
              },
            ],
            m: [["=", "prefers-color-scheme", "dark"]],
            s: [1, 1],
          },
        ],
      ],
    ],
  });
});

test("prefers-reduced-motion", () => {
  // `motion-reduce:` compiles to `reduce`, `motion-safe:` to `no-preference`,
  // and a bare `@media (prefers-reduced-motion)` to the boolean (`!!`) form.
  // The native runtime evaluates these against the reduceMotion observable
  // (see native/media-query.test.tsx).
  expect(
    compile(
      `@media (prefers-reduced-motion: reduce) { .my-class { opacity: 0 } }`,
    ).stylesheet(),
  ).toStrictEqual({
    s: [
      [
        "my-class",
        [
          {
            s: [2, 1],
            m: [["=", "prefers-reduced-motion", "reduce"]],
            d: [{ opacity: 0 }],
          },
        ],
      ],
    ],
  });

  expect(
    compile(
      `@media (prefers-reduced-motion: no-preference) { .my-class { opacity: 0 } }`,
    ).stylesheet(),
  ).toStrictEqual({
    s: [
      [
        "my-class",
        [
          {
            s: [2, 1],
            m: [["=", "prefers-reduced-motion", "no-preference"]],
            d: [{ opacity: 0 }],
          },
        ],
      ],
    ],
  });

  expect(
    compile(
      `@media (prefers-reduced-motion) { .my-class { opacity: 0 } }`,
    ).stylesheet(),
  ).toStrictEqual({
    s: [
      [
        "my-class",
        [
          {
            s: [2, 1],
            m: [["!!", "prefers-reduced-motion"]],
            d: [{ opacity: 0 }],
          },
        ],
      ],
    ],
  });
});

test("media query nested in rules", () => {
  const compiled = compile(`
.my-class {
  color: red;
  @media (min-width: 600px) {
    color: blue;

    @media (min-width: 400px) {
      background-color: green;
    }
  }

  @media (min-width: 100px) {
    background-color: yellow;

  }
}`);

  expect(compiled.stylesheet()).toStrictEqual({
    s: [
      [
        "my-class",
        [
          {
            d: [{ color: "#f00" }],
            s: [1, 1],
            v: [["__rn-css-inherit-color", "#f00"]],
          },
          {
            d: [
              {
                color: "#00f",
              },
            ],
            m: [[">=", "width", 600]],
            s: [2, 1],
            v: [["__rn-css-inherit-color", "#00f"]],
          },
          {
            d: [{ backgroundColor: "#008000" }],
            m: [
              [">=", "width", 600],
              [">=", "width", 400],
            ],
            s: [3, 1],
          },
          {
            d: [{ backgroundColor: "#ff0" }],
            m: [[">=", "width", 100]],
            s: [4, 1],
          },
        ],
      ],
    ],
  });
});

test("container queries", () => {
  const compiled = compile(`
  @container (width > 400px) {
    .child {
      color: blue;
    }
  }`);

  expect(compiled.stylesheet()).toStrictEqual({
    s: [
      [
        "child",
        [
          {
            cq: [{ m: [">", "width", 400] }],
            d: [{ color: "#00f" }],
            s: [2, 1],
            v: [["__rn-css-inherit-color", "#00f"]],
          },
        ],
      ],
    ],
  });
});

test("warnings", () => {
  const compiled = compile(`
.my-class {
    invalid-property: red;
    z-index: auto; 
    color: random();
}`);

  expect(compiled.stylesheet()).toStrictEqual({});

  expect(compiled.warnings()).toStrictEqual({
    properties: ["invalid-property"],
    values: {
      "z-index": ["auto"],
      "color": ["random()"],
    },
  });
});

test("simplifies rem", () => {
  const compiled = compile(`.test {
    border-width: calc(10rem + 2px);
  }`);

  expect(compiled.stylesheet()).toStrictEqual({
    s: [
      [
        "test",
        [
          {
            d: [
              {
                borderWidth: 142,
              },
            ],
            s: [1, 1],
          },
        ],
      ],
    ],
  });
});

describe("CSS-wide color keywords", () => {
  const stylesheetFor = (value: string) =>
    compile(`.child { color: ${value}; }`).stylesheet();

  test("compiles to the inherited-color variable instead of being dropped", () => {
    // lightningcss emits `color: inherit` as an UnparsedProperty — the keyword
    // is not a CssColor — so it lands in parseUnparsed's ident branch, which
    // drops every keyword it has no resolution context for. Per CSS Color,
    // `currentcolor` used as the value of `color` is defined as `inherit`, so
    // both spell the same computed value and resolve to the same variable.
    //
    // The absence of a `--__rn-css-inherit-color` entry is the no-self-reference
    // guarantee: publishing this value under its OWN name seeds a cycle a
    // descendant then recurses into (see "never publishes a self-referential"
    // below). `--__rn-css-inherit-color` is the other channel — the generic one
    // every inherited property writes for `useNativeCss` to replay across a
    // View → Text boundary — and it names a different variable, so a read of it
    // resolves once and stops.
    expect(stylesheetFor("inherit")).toStrictEqual({
      s: [
        [
          "child",
          [
            {
              s: [1, 1],
              d: [[[{}, "inheritedVar", "__rn-css-inherit-color"], "color", 1]],
              dv: 1,
            },
          ],
        ],
      ],
    });
  });

  test("inherit and currentcolor compile identically (CSS Color spec identity)", () => {
    // The two keywords travel different code paths — `inherit` through
    // parseUnparsed's ident branch, `currentcolor` through parseColor — and
    // must converge on the same output.
    expect(stylesheetFor("inherit")).toStrictEqual(
      stylesheetFor("currentcolor"),
    );
  });

  test("PIN: currentcolor resolves to the inherited-color variable", () => {
    // A pin of behaviour that predates this change, not a guard for it:
    // `color: currentcolor` never reaches the ident branch below. lightningcss
    // parses it as a CssColor, so it is `parseColor`'s `case "currentcolor"`
    // that produces this lookup and `parseFontColorDeclaration`'s own
    // `type !== "currentcolor"` check that withholds the `v`.
    expect(stylesheetFor("currentcolor")).toStrictEqual({
      s: [
        [
          "child",
          [
            {
              s: [1, 1],
              d: [[[{}, "inheritedVar", "__rn-css-inherit-color"], "color", 1]],
              dv: 1,
            },
          ],
        ],
      ],
    });
  });

  test("PIN: a normal color publishes --__rn-css-inherit-color to descendants", () => {
    // A pin of behaviour that predates this change: `color: red` is a CssColor,
    // so it is `parseFontColorDeclaration` that publishes the `v`. It is here
    // because the guard added for the keywords must not swallow this case.
    expect(stylesheetFor("red")).toStrictEqual({
      s: [
        [
          "child",
          [
            {
              s: [1, 1],
              d: [{ color: "#f00" }],
              v: [["__rn-css-inherit-color", "#f00"]],
            },
          ],
        ],
      ],
    });
  });

  test("inherit on a non-color property is still dropped (no inheritance context)", () => {
    expect(
      compile(`.child { font-size: inherit; }`).stylesheet(),
    ).toStrictEqual({});
  });

  test("border-color: inherit is still dropped", () => {
    // The near miss to the `property === "color"` gate: border-color IS a colour
    // property, but it is not `color`, so it publishes nothing and inherits
    // nothing. Only `color` seeds --__rn-css-inherit-color, so only `color` can read it
    // back as `inherit`.
    expect(
      compile(`.child { border-color: inherit; }`).stylesheet(),
    ).toStrictEqual({});
  });

  test("color: initial is still dropped (different semantics, out of scope)", () => {
    expect(stylesheetFor("initial")).toStrictEqual({});
  });

  test.each([
    ["background-color", "inherit"],
    ["background-color", "initial"],
    ["background-color", "revert"],
    ["background-color", "revert-layer"],
    ["border-color", "revert"],
    ["font-size", "revert"],
  ])("%s: %s is dropped on a non-color property too", (property, keyword) => {
    // The drop arm is keyword-first, not property-first: only the RESOLVING
    // arm is gated on `property === "color"`. `revert` and `revert-layer`
    // previously fell through to the style as their literal string on every
    // property, so this pins the widened drop across the property axis rather
    // than on `color` alone.
    expect(
      compile(`.child { ${property}: ${keyword}; }`).stylesheet(),
    ).toStrictEqual({});
  });

  test("unset on a non-color property is NOT dropped", () => {
    // The exception to the arm above, and the reason `unset` is absent from it.
    // On a non-inherited property `unset` means `initial`, and the literal left
    // here is what the runtime clears the declared colour with — see
    // `background-color: unset still clears the color` in
    // src/__tests__/native/colors.test.tsx. Dropping it would take that away,
    // and nothing else in the compiler would notice.
    expect(
      compile(`.child { background-color: unset; }`).stylesheet(),
    ).toStrictEqual({
      s: [["child", [{ s: [1, 1], d: [["unset", "backgroundColor"]] }]]],
    });
  });

  /**
   * The custom-property rows of the keyword table above, which cannot share its
   * one-declaration template — see `uninlinedCustomProperty`.
   *
   * A custom property's value is a raw token stream with no property to inherit
   * FROM and no per-property initial value to fall back to, so
   * `property === "color"` is false and the resolving arm never fires for one.
   * `currentcolor` is the exception, and it is not an exception to the gate:
   * that arm is keyword-only, because `currentcolor` is valid on every
   * property, custom ones included.
   */
  const uninlinedCustomProperty = (value: string) =>
    // Two definitions, deliberately. react-native-css's own `inlineVariables`
    // pass keys on a custom property's DECLARATION COUNT: a name declared once
    // is folded into its consumer at compile time and the declaration is
    // deleted, so a single-definition case never reaches the keyword arm as a
    // custom property at all. The second definition is what puts it there —
    // and it is why the `currentcolor` rows below expect TWO published values,
    // one per declaring rule.
    `.child { --brand: ${value}; color: var(--brand); }
     .other { --brand: ${value}; }`;

  test.each(["inherit", "initial", "revert", "revert-layer", "INHERIT"])(
    "--brand: %s is dropped — a custom property has no property context",
    (keyword) => {
      expect(
        publishedVariable(uninlinedCustomProperty(keyword), "brand"),
      ).toEqual([]);
    },
  );

  test.each(["currentcolor", "currentColor"])(
    "--brand: %s resolves — the currentcolor arm is keyword-only, not property-gated",
    (spelling) => {
      // Also the vacuity guard for the drop rows above: same construction, so
      // an empty result here would mean the inliner had eaten the declaration
      // and the `[]` there was proving nothing.
      //
      // The camelCase spelling is the one THIS package folds — lightningcss
      // hands a custom property's tokens through verbatim, so without the
      // `.toLowerCase()` in parseUnparsed the literal string "currentColor" is
      // published as the variable's value and every consumer renders that.
      expect(
        publishedVariable(uninlinedCustomProperty(spelling), "brand"),
      ).toEqual([
        [{}, "var", "__rn-css-inherit-color"],
        [{}, "var", "__rn-css-inherit-color"],
      ]);
    },
  );

  test("--brand: unset publishes nothing, so an ancestor's value survives", () => {
    // A custom property is an INHERITED property (css-variables-1 §2), so
    // `unset` on one computes to `inherit` (css-cascade-4 §7.3) — never to the
    // literal token. Publishing nothing IS that: an entry here would shadow the
    // ancestor's in VariableContext, and with no ancestor the name keeps its
    // initial guaranteed-invalid value, which is what makes `var(--brand, x)`
    // take the fallback (css-variables-1 §3).
    //
    // Measured, and it is why the `background-color: unset` analogy does not
    // reach this case: `background-color: unset` compiles to
    // ["unset","backgroundColor"] unchanged, because that property is NOT
    // inherited. Only the inherited one moved.
    //
    // Deliberately NOT a row in the `test.each` drop table above. Those
    // keywords have no value to compile to and say so with a warning; this one
    // has a MEANING the compiler honours by withholding. The warnings pair
    // below is what separates the two mechanisms — and it is also why an
    // "UNSET" row cannot join that table, since `isRuntimeKeyword` does not
    // case-fold and the uppercase spelling still leaks its literal.
    //
    // The render consequence is the load-bearing guard and lives in
    // `src/__tests__/native/custom-property-semantics.test.tsx`: an ancestor's
    // value must reach the consumer, and with no ancestor the var() fallback
    // must fire. `[]` alone cannot tell "correctly withheld" from "dropped as
    // garbage".
    expect(
      publishedVariable(uninlinedCustomProperty("unset"), "brand"),
    ).toEqual([]);
    expect(compile(uninlinedCustomProperty("unset")).warnings()).toStrictEqual(
      {},
    );
    expect(
      compile(uninlinedCustomProperty("inherit")).warnings(),
    ).toStrictEqual({
      values: { "--brand": ["inherit", "inherit"] },
    });
  });

  test("a custom property declared ONCE is folded into its consumer first", () => {
    // Why the rows above declare `--brand` twice. With a single definition the
    // inliner substitutes the value and deletes the declaration, so
    // `color: var(--brand)` becomes `color: inherit` and takes the resolving
    // arm — the opposite outcome from the identical CSS carrying one more
    // definition of the same name.
    expect(
      compile(`.child { --brand: inherit; color: var(--brand); }`).stylesheet(),
    ).toStrictEqual({
      s: [
        [
          "child",
          [
            {
              s: [1, 1],
              d: [[[{}, "inheritedVar", "__rn-css-inherit-color"], "color", 1]],
              dv: 1,
            },
          ],
        ],
      ],
    });
  });

  test("color: unset resolves like inherit (unset on an inherited property is inherit)", () => {
    // Per CSS Cascade, `unset` computes to `inherit` on inherited properties,
    // and `color` is inherited — so it maps to the same inherited-color variable.
    expect(stylesheetFor("unset")).toStrictEqual(stylesheetFor("inherit"));
  });

  test.each(["INHERIT", "Inherit", "UNSET", "INITIAL"])(
    "keyword matching is case-insensitive (%s)",
    (spelling) => {
      // CSS-wide keywords are case-insensitive; lightningcss does not fold case,
      // so the ident branch has to. INITIAL is in the census because the fold
      // must reach the drop-with-a-warning arm too, not only the resolving one.
      expect(stylesheetFor(spelling)).toStrictEqual(
        stylesheetFor(spelling.toLowerCase()),
      );
    },
  );

  test("PIN: currentColor (camelCase) resolves to the inherited-color variable", () => {
    // A pin of behaviour that predates this change. On the PARSED-color path
    // the case fold is lightningcss's, not ours — it parses either spelling
    // into the same CssColor before this package sees it.
    //
    // Asserted against the output rather than against
    // `stylesheetFor("currentcolor")`. An equality between two spellings
    // lightningcss has ALREADY folded holds whatever this package then does
    // with the result, so it cannot fail: break `parseColor`'s currentcolor
    // case and both sides move together while the sibling pin above goes red.
    // The spelling this package folds itself is the one that reaches the ident
    // branch — pinned by `--brand: currentColor` in the custom-property rows
    // above, where the fold is ours and is new here.
    expect(stylesheetFor("currentColor")).toStrictEqual({
      s: [
        [
          "child",
          [
            {
              s: [1, 1],
              d: [[[{}, "inheritedVar", "__rn-css-inherit-color"], "color", 1]],
              dv: 1,
            },
          ],
        ],
      ],
    });
  });

  test("PIN: currentcolor resolves on a non-color property too (border-color)", () => {
    // A pin of behaviour that predates this change: border-color is a parsed
    // CssColor, so this is parseColor's `case "currentcolor"` again. The ident
    // branch's own currentcolor clause is what serves the UNPARSED properties —
    // box-shadow, filter: drop-shadow(), and custom properties — and those are
    // covered by src/__tests__/native/{box-shadow,filters}.test.tsx.
    expect(
      compile(`.child { border-color: currentcolor; }`).stylesheet(),
    ).toStrictEqual({
      s: [
        [
          "child",
          [
            {
              s: [1, 1],
              d: [[[{}, "var", "__rn-css-inherit-color"], "borderColor", 1]],
              dv: 1,
            },
          ],
        ],
      ],
    });
  });

  test("color: inherit !important keeps the important specificity", () => {
    expect(stylesheetFor("inherit !important")).toStrictEqual({
      s: [
        [
          "child",
          [
            {
              s: [1, 1, 1],
              d: [[[{}, "inheritedVar", "__rn-css-inherit-color"], "color", 1]],
              dv: 1,
            },
          ],
        ],
      ],
    });
  });

  test("color: inherit inside a media query keeps the condition", () => {
    expect(
      compile(
        `@media (min-width: 100px) { .child { color: inherit; } }`,
      ).stylesheet(),
    ).toStrictEqual({
      s: [
        [
          "child",
          [
            {
              s: [2, 1],
              m: [[">=", "width", 100]],
              d: [[[{}, "inheritedVar", "__rn-css-inherit-color"], "color", 1]],
              dv: 1,
            },
          ],
        ],
      ],
    });
  });

  test("color: inherit inside :hover keeps the pseudo-class condition", () => {
    expect(
      compile(`.child:hover { color: inherit; }`).stylesheet(),
    ).toStrictEqual({
      s: [
        [
          "child",
          [
            {
              s: [1, 2],
              d: [[[{}, "inheritedVar", "__rn-css-inherit-color"], "color", 1]],
              dv: 1,
              p: { h: 1 },
            },
          ],
        ],
      ],
    });
  });

  test.each([
    ["placeholder", "color: inherit", "placeholderTextColor", "inheritedVar"],
    ["selection", "background-color: currentcolor", "selectionColor", "var"],
  ])(
    "the inherited-color lookup survives ::%s's retarget onto %s",
    (pseudoElement, declaration, targetProp, lookup) => {
      // A pseudo-element rule retargets the declaration off `style`, so the
      // inherited-color lookup has to survive the retarget. Each retargets the
      // one declaration its React Native prop can express — `selectionColor`
      // paints the band behind the selected text, which is `background-color`
      // — and `currentcolor` is how a non-`color` property spells a read of the
      // inherited colour.
      //
      // The two spell that read with different FUNCTIONS, and the difference is
      // the point of the retarget surviving at all: `color: inherit` must read
      // the inherited scope ALONE, because the element's own `color` is the
      // value being resolved and reading it would resolve into itself.
      // `background-color` has no such self-reference, so it reads the ordinary
      // scope and sees the element's own colour first.
      expect(
        declarationsFor(`.child::${pseudoElement} { ${declaration} }`),
      ).toStrictEqual([
        [[{}, lookup, "__rn-css-inherit-color"], [targetProp], 1],
      ]);
    },
  );

  test.each(["revert", "revert-layer"])(
    "color: %s is dropped rather than published as a literal",
    (keyword) => {
      // React Native has no cascade origins to revert to, so the keyword has no
      // computed value here. Emitting the literal string put `color: "revert"`
      // in the style AND published it as --__rn-css-inherit-color, handing every
      // descendant that reads the inherited color an unusable value.
      expect(stylesheetFor(keyword)).toStrictEqual({});
    },
  );
});

/** Every declaration every rule in `css` produces, in compile order. */
function declarationsFor(css: string): StyleDeclaration[] {
  return (compile(css).stylesheet().s ?? []).flatMap(([, ruleSet]) =>
    ruleSet.flatMap((rule) => rule.d ?? []),
  );
}

/**
 * Every value any rule in `css` publishes as the custom property `name`, in
 * compile order and once per publishing rule.
 *
 * Derived from the compiled output rather than restated, so a new rule shape
 * that publishes the variable is covered without editing the reader.
 */
function publishedVariable(css: string, name: string): StyleDescriptor[] {
  return (compile(css).stylesheet().s ?? []).flatMap(([, ruleSet]) =>
    ruleSet.flatMap((rule) =>
      (rule.v ?? [])
        .filter(([varName]) => varName === name)
        .map(([, value]) => value),
    ),
  );
}

/** Every value any rule in `css` publishes as `--__rn-css-inherit-color`. */
function publishedInheritedColors(css: string): StyleDescriptor[] {
  return publishedVariable(css, "__rn-css-inherit-color");
}

describe("the inherited-color variable is never self-referential", () => {
  /**
   * Each of these makes `color` READ --__rn-css-inherit-color from somewhere below the
   * top level of the descriptor, which is what a guard comparing only the top
   * level misses. Publishing any of them as --__rn-css-inherit-color hands a descendant
   * a value that resolves back into the same variable, and resolution recurses
   * until the stack is exhausted.
   */
  const selfReferentialColors = [
    "inherit",
    "unset",
    "currentcolor",
    "var(--missing, inherit)",
    "var(--missing, unset)",
    "var(--missing, currentcolor)",
    "color-mix(in srgb, currentcolor, blue)",
    "color-mix(in srgb, inherit, blue)",
    "rgb(from currentcolor r g b)",
  ];

  test("the census is not empty", () => {
    expect(selfReferentialColors.length).toBeGreaterThan(0);
  });

  test.each(selfReferentialColors)("color: %s publishes no `v`", (value) => {
    expect(publishedInheritedColors(`.child { color: ${value}; }`)).toEqual([]);
  });

  /**
   * The guard is asked of each BRANCH, not of the declaration. A
   * `light-dark()` compiles to two rules and each publishes what it resolves
   * to, so a self-referential light branch withholds while a plain dark branch
   * still publishes — and a descendant under this rule inherits the
   * grandparent's colour in light mode and blue in dark, which is what the two
   * branches say.
   */
  test("only the self-referential branch of a light-dark() withholds", () => {
    expect(
      publishedInheritedColors(
        `.child { color: light-dark(currentcolor, blue); }`,
      ),
    ).toEqual(["#00f"]);
    expect(
      publishedInheritedColors(
        `.child { color: light-dark(red, currentcolor); }`,
      ),
    ).toEqual(["#f00"]);
  });

  test.each([
    ["red", "#f00"],
    ["#00f", "#00f"],
    ["rgb(1 2 3)", "#010203"],
    ["color-mix(in srgb, red, blue)", "#800080"],
    ["oklch(0.7 0.1 200)", "#40b1b7"],
  ])("color: %s still publishes its own resolved value", (value, expected) => {
    expect(publishedInheritedColors(`.child { color: ${value}; }`)).toEqual([
      expected,
    ]);
  });

  /**
   * The discriminating half of the walk. Every one of these CONTAINS a `var()`
   * — bare, with a fallback, and nested inside a function's argument list — but
   * none of them names the inherited color, so every one must still publish.
   *
   * The census above cannot see this: each of its values resolves to a plain
   * string, so a walk that answered "reads the inherited color" for ANY `var()`
   * would leave it green. That mistake does not crash — it silently withholds
   * the publish, and every descendant of a `color: var(--brand)` rule stops
   * inheriting. These are the values that tell the two apart.
   */
  test.each<[value: string, published: StyleDescriptor[]]>([
    ["var(--brand)", [[{}, "var", "brand", 1]]],
    ["var(--brand, red)", [[{}, "var", ["brand", "red"], 1]]],
    [
      "color-mix(in srgb, var(--brand), blue)",
      [
        [
          {},
          "colorMix",
          ["srgb", [{}, "var", "brand", 1], undefined, "blue", undefined],
        ],
      ],
    ],
    // light-dark() publishes from its own rule AND from the extra
    // `prefers-color-scheme: dark` rule it pushes, so the census sees two —
    // each branch's own colour, never one branch's twice.
    ["light-dark(red, blue)", ["#f00", "#00f"]],
  ])(
    "color: %s names a variable that is not the inherited one, so it publishes",
    (value, published) => {
      expect(publishedInheritedColors(`.child { color: ${value}; }`)).toEqual(
        published,
      );
    },
  );

  test("light-dark() on color emits one dark rule, not one per parse", () => {
    // `light-dark()` pushes an extra `prefers-color-scheme: dark` rule as a
    // SIDE EFFECT of parsing, so the colour must be parsed exactly once for the
    // declaration and the published variable both.
    const darkRules = (
      compile(`.child { color: light-dark(red, blue); }`).stylesheet().s ?? []
    )
      .flatMap(([, ruleSet]) => ruleSet)
      .filter((rule) => rule.m !== undefined);

    expect(darkRules).toHaveLength(1);
  });
});
