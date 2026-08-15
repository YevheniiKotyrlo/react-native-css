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
            v: [
              ["__rn-css-inherit-color", "#f00"],
              ["__rn-css-color", "#f00"],
            ],
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
 * `__rn-css-inherit-color` / `__rn-css-color` channels. A reader knows the gap
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
            v: [
              ["__rn-css-inherit-color", "#f00"],
              ["__rn-css-color", "#f00"],
            ],
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
            v: [
              ["__rn-css-inherit-color", "#008000"],
              ["__rn-css-color", "#008000"],
            ],
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
            v: [
              ["__rn-css-inherit-color", "#f00"],
              ["__rn-css-color", "#f00"],
            ],
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
            v: [
              ["__rn-css-inherit-color", "#f00"],
              ["__rn-css-color", "#f00"],
            ],
          },
          {
            d: [
              {
                color: "#00f",
              },
            ],
            m: [[">=", "width", 600]],
            s: [2, 1],
            v: [
              ["__rn-css-inherit-color", "#00f"],
              ["__rn-css-color", "#00f"],
            ],
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
            v: [
              ["__rn-css-inherit-color", "#00f"],
              ["__rn-css-color", "#00f"],
            ],
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
    // The ABSENCE of a `v` entry is the no-self-reference guarantee: publishing
    // this value as its own --__rn-css-color seeds a cycle a descendant then
    // recurses into (see "never publishes a self-referential" below).
    expect(stylesheetFor("inherit")).toStrictEqual({
      s: [
        [
          "child",
          [
            {
              s: [1, 1],
              d: [[[{}, "var", "__rn-css-color"], "color", 1]],
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
              d: [[[{}, "var", "__rn-css-color"], "color", 1]],
              dv: 1,
            },
          ],
        ],
      ],
    });
  });

  test("PIN: a normal color publishes --__rn-css-color to descendants", () => {
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
              v: [["__rn-css-color", "#f00"]],
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
    // nothing. Only `color` seeds --__rn-css-color, so only `color` can read it
    // back as `inherit`.
    expect(
      compile(`.child { border-color: inherit; }`).stylesheet(),
    ).toStrictEqual({});
  });

  test("color: initial is still dropped (different semantics, out of scope)", () => {
    expect(stylesheetFor("initial")).toStrictEqual({});
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

  test("PIN: currentColor (camelCase) resolves like currentcolor", () => {
    // A pin of behaviour that predates this change. Case folding here is
    // lightningcss's, not ours — it parses either spelling into the same
    // CssColor before this package sees it.
    expect(stylesheetFor("currentColor")).toStrictEqual(
      stylesheetFor("currentcolor"),
    );
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
              d: [[[{}, "var", "__rn-css-color"], "borderColor", 1]],
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
              d: [[[{}, "var", "__rn-css-color"], "color", 1]],
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
              d: [[[{}, "var", "__rn-css-color"], "color", 1]],
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
              d: [[[{}, "var", "__rn-css-color"], "color", 1]],
              dv: 1,
              p: { h: 1 },
            },
          ],
        ],
      ],
    });
  });

  test.each([
    ["placeholder", "placeholderTextColor"],
    ["selection", "selectionColor"],
  ])("color: inherit on ::%s targets %s", (pseudoElement, targetProp) => {
    // A pseudo-element rule retargets the declaration off `style`, so the
    // inherited-color lookup has to survive the retarget.
    expect(
      declarationsFor(`.child::${pseudoElement} { color: inherit; }`),
    ).toStrictEqual([[[{}, "var", "__rn-css-color"], [targetProp], 1]]);
  });

  test.each(["revert", "revert-layer"])(
    "color: %s is dropped rather than published as a literal",
    (keyword) => {
      // React Native has no cascade origins to revert to, so the keyword has no
      // computed value here. Emitting the literal string put `color: "revert"`
      // in the style AND published it as --__rn-css-color, handing every
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
 * Every value any rule in `css` publishes as `--__rn-css-color`.
 *
 * Derived from the compiled output rather than restated, so a new rule shape
 * that publishes the variable is covered without editing the reader.
 */
function publishedInheritedColors(css: string): StyleDescriptor[] {
  return (compile(css).stylesheet().s ?? []).flatMap(([, ruleSet]) =>
    ruleSet.flatMap((rule) =>
      (rule.v ?? [])
        .filter(([name]) => name === "__rn-css-color")
        .map(([, value]) => value),
    ),
  );
}

describe("the inherited-color variable is never self-referential", () => {
  /**
   * Each of these makes `color` READ --__rn-css-color from somewhere below the
   * top level of the descriptor, which is what a guard comparing only the top
   * level misses. Publishing any of them as --__rn-css-color hands a descendant
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
    "light-dark(currentcolor, blue)",
  ];

  test("the census is not empty", () => {
    expect(selfReferentialColors.length).toBeGreaterThan(0);
  });

  test.each(selfReferentialColors)("color: %s publishes no `v`", (value) => {
    expect(publishedInheritedColors(`.child { color: ${value}; }`)).toEqual([]);
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
