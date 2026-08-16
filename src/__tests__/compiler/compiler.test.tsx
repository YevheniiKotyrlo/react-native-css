import { compile } from "react-native-css/compiler";

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
