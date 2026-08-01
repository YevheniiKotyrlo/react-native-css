import { render, screen } from "@testing-library/react-native";
import { compile } from "react-native-css/compiler";
import { ScrollView } from "react-native-css/components/ScrollView";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { StyleCollection } from "react-native-css/native";

/**
 * The state of `transition-*`, `animation-*` and `@keyframes`.
 *
 * `src/__tests__/native/transitions.test.tsx` and
 * `src/__tests__/native/animations.test.tsx` are `describe.skip`ped, which
 * reads as "nothing works". That is not what is actually true, and this file
 * measures the difference.
 *
 * The pipeline has three hops, and only the last one is missing:
 *
 *  1. **Compile.** `addTransitionValue` / `addAnimationValue`
 *     (`src/compiler/declarations.ts`) and `extractKeyFrames`
 *     (`src/compiler/keyframes.ts`) turn every transition/animation longhand,
 *     both shorthands and every `@keyframes` block into style descriptors.
 *     Durations become milliseconds, property names become React Native keys,
 *     timing functions become `cubicBezier` / `steps` style functions.
 *  2. **Resolve.** At render, `shorthands/animation.ts` looks the keyframes up
 *     in `StyleCollection.keyframes`, runs each frame back through
 *     `calculateProps` (so `var()`, `em` and `transform` resolve) and hands
 *     back an object keyed by frame progress. Any rule carrying a
 *     transition/animation declaration sets `rule.a`, and `useNativeCss` wraps
 *     that component with `createAnimatedComponent`.
 *  3. **Animate.** react-native-css itself never animates. The resolved keys
 *     are the CSS-animation surface of `react-native-reanimated` v4
 *     (`ANIMATION_PROPS` / `TRANSITION_PROPS` in
 *     `node_modules/react-native-reanimated/lib/module/css/constants/settings.js`),
 *     and reanimated's own `AnimatedComponent` lifts them out of `style` into
 *     its native `CSSManager`. That manager is disabled under jest
 *     (`if (!IS_JEST)` in
 *     `node_modules/react-native-reanimated/lib/module/css/component/AnimatedComponent.js`),
 *     which is why nothing here can assert a moving value and why the two
 *     skipped suites — which assert through reanimated's `getAnimatedStyle` —
 *     cannot be revived as written.
 *
 * So the tests below pin hops 1 and 2 exactly, and pin hop 3 only as far as it
 * is observable: the style object handed over, and the fact that it leaves
 * `props.style` afterwards. `// GAP:` marks each thing that compiles but never
 * reaches anything that could render it.
 *
 * Keyframe names are unique across the whole file on purpose — see the last
 * test.
 */

/*****************************************************************************
 * 1. Compiler — transitions
 ****************************************************************************/

test("the transition shorthand expands to all four longhands", () => {
  expect(
    compile(
      `.at-shorthand { transition: width 1s ease-in 200ms; }`,
    ).stylesheet(),
  ).toStrictEqual({
    s: [
      [
        "at-shorthand",
        [
          {
            s: [1, 1],
            a: true,
            d: [
              {
                transitionProperty: ["width"],
                transitionDuration: [1000],
                transitionDelay: [200],
                transitionTimingFunction: "ease-in",
              },
            ],
          },
        ],
      ],
    ],
  });
});

test("the transition longhands compile to the same descriptors as the shorthand", () => {
  expect(
    compile(`
      .at-longhand {
        transition-property: width;
        transition-duration: 1s;
        transition-delay: 200ms;
        transition-timing-function: ease-in;
      }
    `).stylesheet(),
  ).toStrictEqual({
    s: [
      [
        "at-longhand",
        [
          {
            s: [1, 1],
            a: true,
            d: [
              {
                transitionProperty: ["width"],
                transitionDuration: [1000],
                transitionDelay: [200],
                transitionTimingFunction: "ease-in",
              },
            ],
          },
        ],
      ],
    ],
  });
});

test("transition-property renames to React Native keys and drops what cannot be animated", () => {
  const compiled = compile(`
    .at-properties {
      transition-property: width, opacity, background-color, margin-left,
        border-top-width, transform, visibility, not-a-property;
    }
  `);

  expect(compiled.stylesheet().s?.[0]?.[1][0]?.d).toStrictEqual([
    {
      transitionProperty: [
        "width",
        "opacity",
        "backgroundColor",
        "marginLeft",
        "borderTopWidth",
        "transform",
      ],
    },
  ]);
  // `visibility` is excluded by name in `addTransitionValue`, `not-a-property`
  // is excluded because it has no parser. Neither produces a warning, so a
  // typo in a `transition-property` list is silent.
  expect(compiled.warnings()).toStrictEqual({});
});

test("transition-property keeps the `all` and `none` keywords verbatim", () => {
  expect(
    compile(`
      .at-all { transition-property: all; }
      .at-none { transition-property: none; }
    `)
      .stylesheet()
      .s?.map(([name, rules]) => [name, rules[0]?.d]),
  ).toStrictEqual([
    ["at-all", [{ transitionProperty: ["all"] }]],
    ["at-none", [{ transitionProperty: ["none"] }]],
  ]);
});

test("a multi-value transition compiles to parallel arrays, one slot per transition", () => {
  expect(
    compile(
      `.at-multi { transition: width 1s, opacity 2s linear 300ms; }`,
    ).stylesheet().s?.[0]?.[1][0]?.d,
  ).toStrictEqual([
    {
      transitionProperty: ["width", "opacity"],
      transitionDuration: [1000, 2000],
      transitionDelay: [0, 300],
      transitionTimingFunction: ["ease", "linear"],
    },
  ]);
});

test("durations and delays compile to milliseconds, and are not clamped", () => {
  expect(
    compile(`
      .at-times {
        transition-duration: 0s, 1.5s, 250ms;
        transition-delay: -200ms;
      }
    `).stylesheet().s?.[0]?.[1][0]?.d,
  ).toStrictEqual([
    {
      transitionDuration: [0, 1500, 250],
      transitionDelay: [-200],
    },
  ]);
});

test("the predefined timing-function keywords pass through as strings", () => {
  expect(
    compile(`
      .at-linear { transition-timing-function: linear; }
      .at-ease { transition-timing-function: ease; }
      .at-in { transition-timing-function: ease-in; }
      .at-out { transition-timing-function: ease-out; }
      .at-in-out { transition-timing-function: ease-in-out; }
      .at-list { transition-timing-function: ease-in, linear; }
    `)
      .stylesheet()
      .s?.map(([, rules]) => rules[0]?.d?.[0]),
  ).toStrictEqual([
    { transitionTimingFunction: "linear" },
    { transitionTimingFunction: "ease" },
    { transitionTimingFunction: "ease-in" },
    { transitionTimingFunction: "ease-out" },
    { transitionTimingFunction: "ease-in-out" },
    { transitionTimingFunction: ["ease-in", "linear"] },
  ]);
});

test("cubic-bezier() and steps() compile to runtime style functions", () => {
  expect(
    compile(`
      .at-bezier { transition-timing-function: cubic-bezier(0.25, 0.5, 0.75, 1); }
      .at-steps { transition-timing-function: steps(4, end); }
      .at-steps-jump-start { transition-timing-function: steps(4, jump-start); }
      .at-steps-jump-none { transition-timing-function: steps(4, jump-none); }
      .at-steps-bare { transition-timing-function: steps(4); }
      .at-step-start { transition-timing-function: step-start; }
      .at-step-end { transition-timing-function: step-end; }
    `)
      .stylesheet()
      .s?.map(([name, rules]) => [name, rules[0]?.d?.[0]]),
  ).toStrictEqual([
    [
      "at-bezier",
      [[{}, "cubicBezier", [0.25, 0.5, 0.75, 1]], "transitionTimingFunction"],
    ],
    ["at-steps", [[{}, "steps", [4, "end"]], "transitionTimingFunction"]],
    // `jump-start` normalises to `start`, `jump-none` survives verbatim —
    // both spellings are accepted by reanimated's `VALID_STEPS_MODIFIERS`.
    [
      "at-steps-jump-start",
      [[{}, "steps", [4, "start"]], "transitionTimingFunction"],
    ],
    [
      "at-steps-jump-none",
      [[{}, "steps", [4, "jump-none"]], "transitionTimingFunction"],
    ],
    ["at-steps-bare", [[{}, "steps", [4, "end"]], "transitionTimingFunction"]],
    // `step-start` / `step-end` are lightningcss-normalised to steps().
    [
      "at-step-start",
      [[{}, "steps", [1, "start"]], "transitionTimingFunction"],
    ],
    ["at-step-end", [[{}, "steps", [1, "end"]], "transitionTimingFunction"]],
  ]);
});

// GAP: the `linear()` easing function (CSS Easing Level 2) is dropped with a
// value warning, even though reanimated lists `linear` among its
// `VALID_PARAMETRIZED_TIMING_FUNCTIONS`.
test("linear() easing is dropped with a value warning", () => {
  const compiled = compile(
    `.at-linear-fn { transition-timing-function: linear(0, 0.25, 1); }`,
  );

  expect(compiled.stylesheet()).toStrictEqual({});
  expect(compiled.warnings()).toStrictEqual({
    values: { "transition-timing-function": ["linear()"] },
  });
});

// GAP: `transition-behavior` has no parser, so `allow-discrete` never reaches
// reanimated — which does have a `transitionBehavior` slot in its
// `TRANSITION_PROPS`.
test("transition-behavior is not implemented and warns as an unknown property", () => {
  const compiled = compile(
    `.at-behavior { transition-behavior: allow-discrete; }`,
  );

  expect(compiled.stylesheet()).toStrictEqual({});
  expect(compiled.warnings()).toStrictEqual({
    properties: ["transition-behavior"],
  });
});

/*****************************************************************************
 * 2. Compiler — the `a` flag that turns a component into an Animated one
 ****************************************************************************/

// `rule.a` is decided by the PROPERTY, never by how the value happens to be
// spelled (`stylesheet.ts`, `addDescriptor`). `transition-timing-function` is a
// transition declaration whether it is written `ease-in`, which compiles to a
// literal, or `cubic-bezier(…)`, which compiles to a style function named
// `cubicBezier` — asking the function's name instead left the second spelling
// unflagged and its component unwrapped.
test("a rule carrying any transition/animation longhand is flagged animated, however its value is spelled", () => {
  expect(
    compile(`
      .at-flag-static { transition-duration: 1s; }
      .at-flag-name { animation-name: at-flag-frames; }
      .at-flag-easing { transition-timing-function: cubic-bezier(0.25, 0.5, 0.75, 1); }
      .at-flag-plain { width: 10px; }
    `)
      .stylesheet()
      .s?.map(([name, rules]) => [name, rules[0]?.a]),
  ).toStrictEqual([
    ["at-flag-static", true],
    ["at-flag-name", true],
    ["at-flag-easing", true],
    ["at-flag-plain", undefined],
  ]);
});

/*****************************************************************************
 * 3. Compiler — animations
 ****************************************************************************/

test("the animation shorthand expands to all eight longhands", () => {
  expect(
    compile(
      `.at-anim { animation: at-anim-frames 1s ease-in-out 200ms 3 alternate both paused; }`,
    ).stylesheet(),
  ).toStrictEqual({
    s: [
      [
        "at-anim",
        [
          {
            s: [1, 1],
            a: true,
            d: [
              [[[{}, "animationName", ["at-anim-frames"], 1]], "animationName"],
              {
                animationDuration: [1000],
                animationTimingFunction: "ease-in-out",
                animationIterationCount: [3],
                animationDirection: ["alternate"],
                animationPlayState: ["paused"],
                animationDelay: [200],
                animationFillMode: ["both"],
              },
            ],
          },
        ],
      ],
    ],
  });
});

test("the animation shorthand fills every omitted longhand with its CSS initial value", () => {
  expect(
    compile(`.at-anim-short { animation: at-short-frames 1s; }`).stylesheet()
      .s?.[0]?.[1][0]?.d,
  ).toStrictEqual([
    [[[{}, "animationName", ["at-short-frames"], 1]], "animationName"],
    {
      animationDuration: [1000],
      animationTimingFunction: "ease",
      animationIterationCount: [1],
      animationDirection: ["normal"],
      animationPlayState: ["running"],
      animationDelay: [0],
      animationFillMode: ["none"],
    },
  ]);
});

test("the animation longhands compile individually, without filling in defaults", () => {
  expect(
    compile(`
      .at-anim-long {
        animation-name: at-long-frames;
        animation-duration: 1s;
        animation-delay: 100ms;
        animation-iteration-count: infinite;
        animation-direction: alternate-reverse;
        animation-fill-mode: both;
        animation-play-state: paused;
        animation-timing-function: ease-out;
      }
    `).stylesheet().s?.[0]?.[1][0]?.d,
  ).toStrictEqual([
    [[[{}, "animationName", ["at-long-frames"], 1]], "animationName"],
    {
      animationDuration: [1000],
      animationTimingFunction: "ease-out",
      animationIterationCount: ["infinite"],
      animationDirection: ["alternate-reverse"],
      animationPlayState: ["paused"],
      animationDelay: [100],
      animationFillMode: ["both"],
    },
  ]);
});

test("every animation-direction and animation-fill-mode keyword survives compilation", () => {
  expect(
    compile(`
      .at-dir { animation-direction: normal, reverse, alternate, alternate-reverse; }
      .at-fill { animation-fill-mode: none, forwards, backwards, both; }
      .at-state { animation-play-state: running, paused; }
      .at-count { animation-iteration-count: 2, infinite, 0.5; }
    `)
      .stylesheet()
      .s?.map(([, rules]) => rules[0]?.d?.[0]),
  ).toStrictEqual([
    {
      animationDirection: [
        "normal",
        "reverse",
        "alternate",
        "alternate-reverse",
      ],
    },
    { animationFillMode: ["none", "forwards", "backwards", "both"] },
    { animationPlayState: ["running", "paused"] },
    { animationIterationCount: [2, "infinite", 0.5] },
  ]);
});

test("a multi-value animation compiles to parallel arrays, one slot per animation", () => {
  expect(
    compile(
      `.at-anim-multi { animation: at-multi-a 1s, at-multi-b 2s linear infinite; }`,
    ).stylesheet().s?.[0]?.[1][0]?.d,
  ).toStrictEqual([
    [
      [
        [{}, "animationName", ["at-multi-a"], 1],
        [{}, "animationName", ["at-multi-b"], 1],
      ],
      "animationName",
    ],
    {
      animationDuration: [1000, 2000],
      animationTimingFunction: ["ease", "linear"],
      animationIterationCount: [1, "infinite"],
      animationDirection: ["normal", "normal"],
      animationPlayState: ["running", "running"],
      animationDelay: [0, 0],
      animationFillMode: ["none", "none"],
    },
  ]);
});

test("animation-name: none compiles to a plain static value, not a style function", () => {
  expect(
    compile(`.at-anim-off { animation-name: none; }`).stylesheet()
      .s?.[0]?.[1][0]?.d,
  ).toStrictEqual([{ animationName: ["none"] }]);
});

test("an animation shorthand that lightningcss cannot type takes the runtime-parsed path", () => {
  expect(
    compile(
      `.at-anim-var { animation: var(--at-unknown) 2s linear; }`,
    ).stylesheet().s?.[0]?.[1][0],
  ).toStrictEqual({
    s: [1, 1],
    d: [
      [
        [{}, "animation", [[{}, "var", "at-unknown", 1], 2000, "linear"]],
        "animation",
        1,
      ],
    ],
    a: true,
    // `dv` marks the rule as depending on a variable, so it re-resolves.
    dv: 1,
  });
});

// GAP: none of the newer animation longhands has a parser. Reanimated has no
// slot for them either, so this is a shared ceiling rather than a lag.
test("animation-composition, animation-timeline and animation-range are not implemented", () => {
  const compiled = compile(`
    .at-anim-extra {
      animation-composition: add;
      animation-timeline: scroll();
      animation-range: normal;
    }
  `);

  expect(compiled.stylesheet()).toStrictEqual({});
  expect(compiled.warnings()).toStrictEqual({
    properties: [
      "animation-composition",
      "animation-timeline",
      "animation-range",
    ],
  });
});

/*****************************************************************************
 * 4. Compiler — @keyframes
 ****************************************************************************/

test("@keyframes compiles to its own `k` section, keyed by name", () => {
  expect(
    compile(`
      @keyframes at-kf-slide {
        from { margin-left: 100%; }
        to { margin-left: 0%; }
      }
    `).stylesheet(),
  ).toStrictEqual({
    k: [
      [
        "at-kf-slide",
        [
          ["from", [{ marginLeft: "100%" }]],
          ["to", [{ marginLeft: "0%" }]],
        ],
      ],
    ],
  });
});

test("a percentage stop compiles to its fraction, as a string", () => {
  expect(
    compile(`
      @keyframes at-kf-pulse {
        0% { opacity: 0; }
        50% { opacity: 0.5; }
        100% { opacity: 1; }
      }
    `).stylesheet().k,
  ).toStrictEqual([
    [
      "at-kf-pulse",
      [
        ["0", [{ opacity: 0 }]],
        ["0.5", [{ opacity: 0.5 }]],
        ["1", [{ opacity: 1 }]],
      ],
    ],
  ]);
});

test("a grouped selector keeps its percentages and its comma", () => {
  // Deliberately a different shape from the single-selector case above: a
  // grouped frame stays a percentage list because reanimated's
  // `normalizeKeyframeSelector` splits on the comma and accepts both spellings.
  expect(
    compile(`
      @keyframes at-kf-grouped {
        0%, 100% { opacity: 0; }
        50% { opacity: 1; }
      }
    `).stylesheet().k,
  ).toStrictEqual([
    [
      "at-kf-grouped",
      [
        ["0%, 100%", [{ opacity: 0 }]],
        ["0.5", [{ opacity: 1 }]],
      ],
    ],
  ]);
});

test("a keyframe carries as many properties as it likes, including transforms", () => {
  expect(
    compile(`
      @keyframes at-kf-many {
        0% { opacity: 0; width: 10px; transform: scale(0.5); }
        100% { opacity: 1; width: 20px; transform: scale(1); }
      }
    `).stylesheet().k,
  ).toStrictEqual([
    [
      "at-kf-many",
      [
        [
          "0",
          [
            { opacity: 0, width: 10 },
            [
              [
                {},
                "transform",
                [
                  [{}, "scaleX", 0.5],
                  [{}, "scaleY", 0.5],
                ],
              ],
              "transform",
            ],
          ],
        ],
        [
          "1",
          [
            { opacity: 1, width: 20 },
            [
              [
                {},
                "transform",
                [
                  [{}, "scaleX", 1],
                  [{}, "scaleY", 1],
                ],
              ],
              "transform",
            ],
          ],
        ],
      ],
    ],
  ]);
});

test("a per-keyframe animation-timing-function compiles into the frame", () => {
  expect(
    compile(`
      @keyframes at-kf-easing {
        from { opacity: 0; animation-timing-function: ease-in; }
        to { opacity: 1; }
      }
    `).stylesheet().k,
  ).toStrictEqual([
    [
      "at-kf-easing",
      [
        ["from", [{ opacity: 0, animationTimingFunction: "ease-in" }]],
        ["to", [{ opacity: 1 }]],
      ],
    ],
  ]);
});

test("a keyframe is filtered by the same property rules as a normal declaration", () => {
  const compiled = compile(`
    @keyframes at-kf-filtered {
      from { float: left; position: fixed; opacity: 0; }
      to { opacity: 1; }
    }
  `);

  expect(compiled.stylesheet().k).toStrictEqual([
    [
      "at-kf-filtered",
      [
        ["from", [{ opacity: 0 }]],
        ["to", [{ opacity: 1 }]],
      ],
    ],
  ]);
  expect(compiled.warnings()).toStrictEqual({
    properties: ["float"],
    values: { position: ["fixed"] },
  });
});

// GAP: `color` inside a keyframe also publishes react-native-css's internal
// currentcolor channel, so the frame handed to reanimated carries a
// `__rnCssColor` key that no style builder knows.
test("a color inside a keyframe leaks the internal currentcolor key into the frame", () => {
  expect(
    compile(`@keyframes at-kf-color { from { color: red; } }`).stylesheet().k,
  ).toStrictEqual([
    ["at-kf-color", [["from", [{ color: "#f00", __rnCssColor: "#f00" }]]]],
  ]);
});

// GAP: `@keyframes` nested in an at-rule is hoisted to the flat, global `k`
// map with its condition discarded, so two same-named blocks under different
// conditions silently collapse into whichever compiled last.
test("@keyframes inside a media query is hoisted and loses its condition", () => {
  expect(
    compile(`
      @media (min-width: 100px) {
        @keyframes at-kf-scoped { from { opacity: 0; } }
      }
    `).stylesheet(),
  ).toStrictEqual({
    k: [["at-kf-scoped", [["from", [{ opacity: 0 }]]]]],
  });
});

/*****************************************************************************
 * 5. Runtime — what actually reaches the rendered element
 ****************************************************************************/

test("an animated rule wraps the component and hands its animation config to reanimated", () => {
  registerCSS(`
    .at-run-anim { animation: at-run-frames 1s; }
    .at-run-plain { width: 10px; }
    @keyframes at-run-frames { from { opacity: 0; } to { opacity: 1; } }
  `);

  render(<View testID={testID} className="at-run-anim" />);
  const animated = screen.getByTestId(testID).props;

  // GAP (by design, not by defect): react-native-css does not animate. Every
  // key it computed is lifted out of `style` by reanimated's
  // `filterNonCSSStyleProps`, and reanimated's own CSS manager — the only
  // thing that could act on them — is disabled under jest. Nothing this
  // library owns can observe an animation frame in a test.
  expect(animated.style).toStrictEqual({});
  // `collapsable: false` is the marker that reanimated's Animated wrapper
  // rendered — the wrapping half of the feature does work.
  expect(animated.collapsable).toBe(false);

  screen.rerender(<View testID={testID} className="at-run-plain" />);
  const plain = screen.getByTestId(testID).props;
  expect(plain.style).toStrictEqual({ width: 10 });
  expect(plain.collapsable).toBeUndefined();
});

test("the resolved animation config is complete when it is not routed through `style`", () => {
  // `contentContainerStyle` is not the prop reanimated filters, so a
  // ScrollView is the one public window onto the object react-native-css
  // actually computed.
  registerCSS(`
    .at-cc-anim { animation: at-cc-frames 1s ease-in-out 200ms 3 alternate both; }
    @keyframes at-cc-frames {
      from { margin-left: 100%; }
      to { margin-left: 0%; }
    }
  `);

  render(<ScrollView testID={testID} contentContainerClassName="at-cc-anim" />);

  expect(screen.getByTestId(testID).props.contentContainerStyle).toStrictEqual({
    // `animationName` is resolved all the way to reanimated's keyframes-object
    // shape — an array so a multi-animation list lines up with the other
    // longhand arrays.
    animationName: [{ from: { marginLeft: "100%" }, to: { marginLeft: "0%" } }],
    animationDuration: [1000],
    animationTimingFunction: "ease-in-out",
    animationIterationCount: [3],
    animationDirection: ["alternate"],
    animationPlayState: ["running"],
    animationDelay: [200],
    animationFillMode: ["both"],
  });
});

test("the resolved transition config is complete too", () => {
  registerCSS(`.at-cc-trans { transition: width 1s ease-in 200ms; }`);

  render(
    <ScrollView testID={testID} contentContainerClassName="at-cc-trans" />,
  );

  expect(screen.getByTestId(testID).props.contentContainerStyle).toStrictEqual({
    transitionProperty: ["width"],
    transitionDuration: [1000],
    transitionDelay: [200],
    transitionTimingFunction: "ease-in",
  });
});

test("a keyframe body resolves var(), em units and transforms at render time", () => {
  registerCSS(`
    :root { --at-kf-width: 42px; }
    .at-cc-resolve { animation: at-resolve-frames 1s; font-size: 10px; }
    @keyframes at-resolve-frames {
      0% { width: var(--at-kf-width); transform: scale(0.5) translateX(10px); }
      100% { width: 2em; transform: scale(1); }
    }
  `);

  render(
    <ScrollView testID={testID} contentContainerClassName="at-cc-resolve" />,
  );

  expect(
    screen.getByTestId(testID).props.contentContainerStyle.animationName,
  ).toStrictEqual([
    {
      "0": {
        width: 42,
        transform: [{ scaleX: 0.5 }, { scaleY: 0.5 }, { translateX: 10 }],
      },
      "1": { width: 20, transform: [{ scaleX: 1 }, { scaleY: 1 }] },
    },
  ]);
});

// GAP: an `animation-name` with no matching `@keyframes` produces an empty
// frame object rather than being dropped. Nothing warns at compile time and
// nothing warns at render time; reanimated silently discards the whole
// animation because `isCSSKeyframesObject({})` is false.
test("an animation naming keyframes that do not exist resolves to an empty frame set", () => {
  registerCSS(`.at-cc-missing { animation: at-does-not-exist 1s; }`);

  render(
    <ScrollView testID={testID} contentContainerClassName="at-cc-missing" />,
  );

  expect(
    screen.getByTestId(testID).props.contentContainerStyle.animationName,
  ).toStrictEqual([{}]);
});

// The compiler's `a` flag seen from the other end. A class carrying nothing but
// a parametrized easing wraps its component, which is what routes the easing to
// reanimated — `collapsable: false` is the wrapper's signature. The easing
// object stays out of `props.style`, where React Native would see a style key
// it does not know.
test.each([
  ["at-run-easing", "cubic-bezier(0.25, 0.5, 0.75, 1)"],
  ["at-run-steps", "steps(4, end)"],
])(
  "a bare %s easing wraps its component and stays out of props.style",
  (className, easing) => {
    registerCSS(`.${className} { transition-timing-function: ${easing}; }`);

    render(<View testID={testID} className={className} />);
    const props = screen.getByTestId(testID).props;

    expect(props.collapsable).toBe(false);
    expect(props.style).toStrictEqual({});
  },
);

test("will-change-animation pre-wraps a component so adding an animation later does not remount it", () => {
  // The `will-change-*` classes are (re)installed by `StyleCollection.inject`,
  // so they only exist once a stylesheet has been registered.
  registerCSS(`.at-will-change-noop { width: 1px; }`);

  render(<View testID={testID} className="will-change-animation" />);

  expect(screen.getByTestId(testID).props.collapsable).toBe(false);
});

// GAP: `src/jest/index.ts` clears `StyleCollection.styles` between tests but
// not `StyleCollection.keyframes`, so a `@keyframes` block registered by one
// test is still resolvable in the next. Every keyframe name in this file is
// unique for that reason.
test("registered keyframes outlive the per-test stylesheet reset", () => {
  registerCSS(`@keyframes at-kf-sticky { from { opacity: 0; } }`);

  StyleCollection.styles.clear();

  expect(StyleCollection.keyframes("at-kf-sticky").get()).toStrictEqual([
    ["from", [{ opacity: 0 }]],
  ]);
});
