/**
 * `env()`, safe areas and viewport-dependent values.
 *
 * These tests pin the ACTUAL behaviour of `env()` on native. Sibling coverage:
 * - `env.test.ios.tsx` pins `margin-*: env(safe-area-inset-*)` through the provider.
 * - `../vendor/tailwind/safe-area.test.tsx` pins the `tailwindcss-safe-area` utilities
 *   (`p-safe`, `h-screen-safe`, `pb-safe-offset-4`, `pb-safe-or-20`).
 *
 * This file covers everything those two do not: the fallback form, `env()` inside
 * `calc()`/`min()`/`max()`/`clamp()`, `env()` in a custom property, the absence of a
 * provider, the CSS-visible variable escape hatch, and every form that is NOT supported.
 *
 * Fixtures: the jest window is 750x1334, so `100vw` is 750 and `100vh` is 1334.
 */
import { render, screen } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-css/components/SafeAreaProvider";
import { View } from "react-native-css/components/View";
import {
  compileWithAutoDebug,
  registerCSS,
  testID,
} from "react-native-css/jest";

const metrics = {
  insets: { top: 1, bottom: 2, left: 3, right: 4 },
  frame: { x: 0, y: 0, width: 0, height: 0 },
};

function renderWithSafeArea(className: string) {
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <View testID={testID} className={className} />
    </SafeAreaProvider>,
  );
  return screen.getByTestId(testID);
}

function renderWithoutSafeArea(className: string) {
  render(<View testID={testID} className={className} />);
  return screen.getByTestId(testID);
}

/* -------------------------------------------------------------------------- */
/* env(safe-area-inset-*) — the supported surface                             */
/* -------------------------------------------------------------------------- */

test("env(safe-area-inset-*) compiles to a runtime var() lookup", () => {
  const compiled = compileWithAutoDebug(
    `.env-compiles { padding-top: env(safe-area-inset-top); }`,
  );

  // Not a static value: it is a `var()` against a reserved variable name that
  // `SafeAreaProvider` publishes into the VariableContext.
  expect(compiled.stylesheet()).toStrictEqual({
    s: [
      [
        "env-compiles",
        [
          {
            s: [1, 1],
            d: [
              [
                [{}, "var", ["react-native-css-safe-area-inset-top"], 1],
                "paddingTop",
                1,
              ],
            ],
            dv: 1,
          },
        ],
      ],
    ],
  });
});

test("env(safe-area-inset-*) resolves for non-margin properties", () => {
  registerCSS(`.env-padding {
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
  }`);

  expect(renderWithSafeArea("env-padding").props.style).toStrictEqual({
    paddingTop: 1,
    paddingBottom: 2,
    paddingLeft: 3,
    paddingRight: 4,
  });
});

test("env(safe-area-inset-*) resolves for gap, border width and transform", () => {
  registerCSS(`.env-misc {
    gap: env(safe-area-inset-top);
    border-top-width: env(safe-area-inset-bottom);
    transform: translateY(env(safe-area-inset-right));
  }`);

  expect(renderWithSafeArea("env-misc").props.style).toStrictEqual({
    gap: 1,
    borderTopWidth: 2,
    transform: [{ translateY: 4 }],
  });
});

test("env(safe-area-inset-*) with no provider drops the declaration silently", () => {
  registerCSS(`.env-no-provider { padding-top: env(safe-area-inset-top); }`);

  // The variable is simply unset, so the property never lands. No warning is
  // emitted — the style object is present but empty.
  expect(renderWithoutSafeArea("env-no-provider").props.style).toStrictEqual(
    {},
  );
});

/* -------------------------------------------------------------------------- */
/* The fallback form: env(<name>, <fallback>)                                  */
/* -------------------------------------------------------------------------- */

test("env(safe-area-inset-top, 16px) uses the fallback with no provider", () => {
  registerCSS(`.env-fallback { padding-top: env(safe-area-inset-top, 16px); }`);

  expect(renderWithoutSafeArea("env-fallback").props.style).toStrictEqual({
    paddingTop: 16,
  });
});

test("env(safe-area-inset-top, 16px) prefers the inset when a provider exists", () => {
  registerCSS(`.env-fallback-provider {
    padding-top: env(safe-area-inset-top, 16px);
  }`);

  expect(renderWithSafeArea("env-fallback-provider").props.style).toStrictEqual(
    { paddingTop: 1 },
  );
});

test("a zero inset wins over the fallback", () => {
  registerCSS(`.env-zero { padding-top: env(safe-area-inset-top, 16px); }`);

  render(
    <SafeAreaProvider
      initialMetrics={{
        insets: { top: 0, bottom: 0, left: 0, right: 0 },
        frame: { x: 0, y: 0, width: 0, height: 0 },
      }}
    >
      <View testID={testID} className="env-zero" />
    </SafeAreaProvider>,
  );

  // 0 is a real value, not an absent one — matching the CSS spec.
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    paddingTop: 0,
  });
});

test("a percentage fallback survives as a percentage string", () => {
  registerCSS(`.env-percent { padding-top: env(safe-area-inset-top, 10%); }`);

  expect(renderWithoutSafeArea("env-percent").props.style).toStrictEqual({
    paddingTop: "10%",
  });
});

test("a nested env() fallback resolves", () => {
  registerCSS(`.env-nested {
    padding-top: env(safe-area-inset-top, env(safe-area-inset-bottom, 5px));
    padding-bottom: env(safe-area-inset-nope, env(safe-area-inset-bottom, 5px));
  }`);

  // The outer name resolves, so the inner fallback is never reached. The second
  // declaration has an unknown outer name and is dropped whole — see the
  // "unknown env() names" test below.
  expect(renderWithSafeArea("env-nested").props.style).toStrictEqual({
    paddingTop: 1,
  });
});

test("env() nested in a var() fallback resolves", () => {
  registerCSS(`.env-in-var {
    padding-top: var(--not-set, env(safe-area-inset-top, 7px));
  }`);

  expect(renderWithSafeArea("env-in-var").props.style).toStrictEqual({
    paddingTop: 1,
  });
});

/* -------------------------------------------------------------------------- */
/* env() inside math functions                                                 */
/* -------------------------------------------------------------------------- */

test("env() inside calc() resolves, including a negative product", () => {
  registerCSS(`.env-calc {
    padding-top: calc(env(safe-area-inset-top) + 10px);
    margin-top: calc(env(safe-area-inset-top) * -1);
  }`);

  expect(renderWithSafeArea("env-calc").props.style).toStrictEqual({
    paddingTop: 11,
    marginTop: -1,
  });
});

test("env() inside min(), max() and clamp() resolves", () => {
  registerCSS(`.env-math {
    padding-top: min(env(safe-area-inset-top), 10px);
    padding-bottom: max(env(safe-area-inset-bottom), 20px);
    padding-left: clamp(5px, env(safe-area-inset-left), 10px);
  }`);

  expect(renderWithSafeArea("env-math").props.style).toStrictEqual({
    paddingTop: 1,
    paddingBottom: 20,
    paddingLeft: 5,
  });
});

/* -------------------------------------------------------------------------- */
/* env() in a custom property                                                  */
/* -------------------------------------------------------------------------- */

test("env() assigned to a custom property resolves through var()", () => {
  registerCSS(`.env-custom-prop {
    --inset-top: env(safe-area-inset-top);
    padding-top: var(--inset-top);
  }`);

  expect(renderWithSafeArea("env-custom-prop").props.style).toStrictEqual({
    paddingTop: 1,
  });
});

test("env() in a custom property is inlined into its own block, and still published", () => {
  const compiled = compileWithAutoDebug(`.env-custom-prop-compiles {
    --inset-top: env(safe-area-inset-top);
    padding-top: var(--inset-top);
  }`);

  // Two things, and both are needed.
  //
  // `d` — the env() lookup is substituted directly into `paddingTop`, because
  // the reference sits in the same declaration block as the declaration, which
  // is one of the two scopes a fold can be PROVEN in: an element matching this
  // rule has `--inset-top` by matching it.
  //
  // `v` — the declaration is still published, because a custom property is
  // inherited. Dropping it after a block-scoped fold left a descendant reading
  // `var(--inset-top)` with nothing to read.
  expect(compiled.stylesheet()).toStrictEqual({
    s: [
      [
        "env-custom-prop-compiles",
        [
          {
            s: [1, 1],
            d: [
              [
                [{}, "var", ["react-native-css-safe-area-inset-top"], 1],
                "paddingTop",
                1,
              ],
            ],
            dv: 1,
            v: [
              [
                "inset-top",
                [{}, "var", ["react-native-css-safe-area-inset-top"], 1],
              ],
            ],
          },
        ],
      ],
    ],
  });
});

/* -------------------------------------------------------------------------- */
/* The variable escape hatch                                                   */
/* -------------------------------------------------------------------------- */

test("var(--react-native-css-safe-area-inset-*) reads the provider directly", () => {
  registerCSS(`.env-escape-read {
    padding-top: var(--react-native-css-safe-area-inset-top);
    padding-bottom: var(--react-native-css-safe-area-inset-bottom);
  }`);

  // This is the only `-rn-`-style escape hatch: SafeAreaProvider publishes the four
  // insets as ordinary CSS variables, so plain `var()` reaches them without `env()`.
  expect(renderWithSafeArea("env-escape-read").props.style).toStrictEqual({
    paddingTop: 1,
    paddingBottom: 2,
  });
});

test("a CSS-authored --react-native-css-safe-area-inset-* feeds env() too", () => {
  registerCSS(`
    .env-escape-set { --react-native-css-safe-area-inset-top: 42px; }
    .env-escape-via-var { padding-top: var(--react-native-css-safe-area-inset-top); }
    .env-escape-via-env { padding-bottom: env(safe-area-inset-top); }
  `);

  render(
    <View className="env-escape-set">
      <View testID={testID} className="env-escape-via-var env-escape-via-env" />
    </View>,
  );

  // `env(safe-area-inset-top)` compiles to `var(--react-native-css-safe-area-
  // inset-top)`, so the two spellings read ONE name and must give one answer.
  // A declaration of that name is published to descendants like any other
  // custom property, which is what lets a stylesheet stub the insets — useful
  // in a gallery or a test, where no SafeAreaProvider is mounted.
  //
  // The reserved `--react-native-css-` prefix is what makes this deliberate
  // rather than accidental: an author writing that exact name is reaching for
  // the mechanism `env()` is built on.
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    paddingTop: 42,
    paddingBottom: 42,
  });
});

/* -------------------------------------------------------------------------- */
/* Provider wiring                                                             */
/* -------------------------------------------------------------------------- */

test("a nested SafeAreaProvider overrides the outer insets", () => {
  registerCSS(
    `.env-nested-provider { padding-top: env(safe-area-inset-top); }`,
  );

  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <SafeAreaProvider
        initialMetrics={{
          insets: { top: 50, bottom: 0, left: 0, right: 0 },
          frame: { x: 0, y: 0, width: 0, height: 0 },
        }}
      >
        <View testID={testID} className="env-nested-provider" />
      </SafeAreaProvider>
    </SafeAreaProvider>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    paddingTop: 50,
  });
});

/* -------------------------------------------------------------------------- */
/* GAP: env() names other than the four safe-area insets                       */
/* -------------------------------------------------------------------------- */

test("unknown env() names drop the declaration, fallback included", () => {
  registerCSS(`.env-unknown-ua {
    padding-top: env(titlebar-area-height, 10px);
    padding-bottom: 5px;
  }`);

  // GAP: the compiler only recognises the four `safe-area-inset-*` names. Every other
  // UA name loses its declaration entirely — the author-supplied fallback, which the
  // CSS spec guarantees for exactly this "UA does not know this variable" case, is
  // thrown away with it. No warning is emitted either.
  expect(renderWithoutSafeArea("env-unknown-ua").props.style).toStrictEqual({
    paddingBottom: 5,
  });
});

test("custom env() variables drop the declaration, fallback included", () => {
  registerCSS(`.env-custom-name {
    padding-top: env(--my-inset, 10px);
    padding-bottom: 5px;
  }`);

  // GAP: `env(<custom-ident>, <fallback>)` is dropped. Since the runtime already
  // resolves env() through the VariableContext, a custom env name could simply map
  // onto the same variable lookup and honour its fallback.
  expect(renderWithoutSafeArea("env-custom-name").props.style).toStrictEqual({
    paddingBottom: 5,
  });
});

test("env(viewport-segment-*) drops the declaration, fallback included", () => {
  registerCSS(`.env-viewport-segment {
    padding-top: env(viewport-segment-width 0 0, 10px);
    padding-bottom: 5px;
  }`);

  // GAP is narrow here: React Native has no foldable-viewport-segment concept, so the
  // value itself is not expressible — but the fallback is, and it is discarded too.
  expect(
    renderWithoutSafeArea("env-viewport-segment").props.style,
  ).toStrictEqual({ paddingBottom: 5 });
});

/* -------------------------------------------------------------------------- */
/* GAP: env() in a condition                                                   */
/* -------------------------------------------------------------------------- */

test("a @media condition containing env() makes the rule unmatchable", () => {
  registerCSS(`
    @media (max-width: env(safe-area-inset-top)) { .env-media-drop { color: red; } }
    @media (max-width: 1px) { .env-media-control { background-color: blue; } }
  `);

  // This was the dangerous shape. `parseMediaFeatureValue` returns undefined for
  // an `env()` value, and `parseMediaQuery` bailed BEFORE calling
  // `addMediaQuery` — so the rule was still emitted, now with no condition at
  // all. The viewport is 750 wide, so `max-width: 1px` correctly suppressed the
  // control rule while the `env()` rule that should be equally false applied to
  // everything. Styles were not merely lost, they were applied where the author
  // said they must not be.
  //
  // The condition is now the `["?"]` marker, which evaluates to unknown, so
  // neither rule applies.
  expect(
    renderWithoutSafeArea("env-media-drop env-media-control").props.style,
  ).toBeUndefined();
});

test("the unmatchable @media condition survives a fallback and the `not` qualifier", () => {
  registerCSS(`
    @media (max-width: env(safe-area-inset-top, 10px)) { .env-media-fb { color: red; } }
    @media not (min-width: env(safe-area-inset-top)) { .env-media-not { background-color: blue; } }
  `);

  // Both conditions are false in CSS terms (viewport 750 is neither <= 10 nor
  // <= 1), and both rules used to apply — `not` was dropped along with the
  // condition it negated. Unknown does not flip under `not`, so the second one
  // stays unmatchable too.
  expect(
    renderWithoutSafeArea("env-media-fb env-media-not").props.style,
  ).toBeUndefined();
});

test("an `and`-combined env() condition instead makes the rule never apply", () => {
  registerCSS(`
    @media (min-width: 1px) and (min-width: env(safe-area-inset-top)) {
      .env-media-and { color: red; }
    }
  `);

  // GAP, and the opposite failure mode from the single-condition case: inside an
  // `and`, the undefined feature value is retained in the compiled condition, and the
  // runtime comparison rejects any non-number. Both halves are true here (750 >= 1),
  // so the rule should apply — it never can.
  expect(renderWithSafeArea("env-media-and").props.style).toBeUndefined();
});

test("the `and` env() condition compiles to a null feature value", () => {
  const compiled = compileWithAutoDebug(
    `@media (min-width: 1px) and (min-width: env(safe-area-inset-top)) {
      .env-media-and-compiles { color: red; }
    }`,
  );

  const [rule] = compiled.stylesheet().s?.[0]?.[1] ?? [];

  expect(rule?.m).toStrictEqual([
    [
      "&",
      [
        [">=", "width", 1],
        // `null`, not `undefined`: the marker has to survive `JSON.stringify`
        // on the way into a bundle, and a hole inside an array does not.
        [">=", "width", null],
      ],
    ],
  ]);
});

test("a @media feature value of calc(env(...)) drops only its own rule", () => {
  // lightningcss rejects `calc()` around `env()` in a media feature value. The
  // error used to be thrown out of `compile()`, so one such rule took the entire
  // stylesheet down; `errorRecovery` degrades it to a dropped rule, which is
  // what CSS asks for.
  registerCSS(
    `@media (min-width: calc(env(safe-area-inset-top) + 100px)) {
      .env-media-calc { color: red; }
    }
    .env-media-sibling { width: 3px; }`,
  );

  expect(renderWithoutSafeArea("env-media-calc").props.style).toBeUndefined();
  expect(renderWithoutSafeArea("env-media-sibling").props.style).toStrictEqual({
    width: 3,
  });
});

test("a @container condition containing env() makes the rule unmatchable", () => {
  registerCSS(`
    .env-container-host { container-type: size; width: 50px; }
    @container (min-width: env(safe-area-inset-top)) { .env-container-drop { color: red; } }
    @container (min-width: 100000px) { .env-container-control { background-color: blue; } }
  `);

  render(
    <View className="env-container-host">
      <View
        testID={testID}
        className="env-container-drop env-container-control"
      />
    </View>,
  );

  // The same shape as @media, and the same fix. The `env()` condition used to
  // compile to an EMPTY container query, which matched any container ancestor;
  // it is now the `["?"]` marker, which never matches. The control's impossible
  // condition suppresses its rule either way.
  expect(screen.getByTestId(testID).props.style).toBeUndefined();
});

test("a @supports condition containing env() answers truthfully", () => {
  registerCSS(
    `@supports (padding-top: env(safe-area-inset-top)) { .env-supports { color: red; } }`,
  );

  // `env()` in a `padding-top` IS supported here, so the guarded block applies.
  // `@supports` used to be unsupported wholesale — not merely for `env()` — so a
  // stylesheet could not ask whether safe-area insets were honoured at all, and
  // the answer it did get was the wrong one.
  expect(renderWithoutSafeArea("env-supports").props.style).toStrictEqual({
    color: "#f00",
  });
});

/* -------------------------------------------------------------------------- */
/* env() inside a multi-value shorthand                                        */
/* -------------------------------------------------------------------------- */

test("env() as the sole value of a shorthand resolves", () => {
  registerCSS(`.env-shorthand-single { padding: env(safe-area-inset-top); }`);

  expect(renderWithSafeArea("env-shorthand-single").props.style).toStrictEqual({
    padding: 1,
  });
});

test("env() in a multi-value shorthand expands to the four longhands", () => {
  registerCSS(
    `.env-shorthand-multi { padding: env(safe-area-inset-top) 10px; }`,
  );

  // A shorthand holding a runtime-resolved value is expanded by the same
  // positional rules the compiler applies to a literal: two values are the
  // vertical pair then the horizontal pair. The top inset is 1, so the vertical
  // pair is 1 and the horizontal pair the literal 10. React Native's `padding`
  // is a single `DimensionValue`, so the longhands are the only shape it reads.
  expect(renderWithSafeArea("env-shorthand-multi").props.style).toStrictEqual({
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 10,
    paddingRight: 10,
  });
});

test("the inset shorthand of four env() values expands to the four longhands", () => {
  registerCSS(`.env-inset-shorthand {
    inset: env(safe-area-inset-top) env(safe-area-inset-right)
           env(safe-area-inset-bottom) env(safe-area-inset-left);
  }`);

  // `inset: <4 insets>` is the most natural safe-area declaration there is, and
  // it lands on the same four keys the longhand spelling below produces —
  // clockwise from the top, so 1 / 4 / 2 / 3 for these metrics.
  expect(renderWithSafeArea("env-inset-shorthand").props.style).toStrictEqual({
    top: 1,
    right: 4,
    bottom: 2,
    left: 3,
  });
});

test("the four inset longhands produce the same four keys as the shorthand", () => {
  registerCSS(`.env-inset-longhand {
    top: env(safe-area-inset-top);
    right: env(safe-area-inset-right);
    bottom: env(safe-area-inset-bottom);
    left: env(safe-area-inset-left);
  }`);

  expect(renderWithSafeArea("env-inset-longhand").props.style).toStrictEqual({
    top: 1,
    right: 4,
    bottom: 2,
    left: 3,
  });
});

/* -------------------------------------------------------------------------- */
/* Viewport units under a safe area                                            */
/* -------------------------------------------------------------------------- */

test("vh/vw measure the window and ignore the safe-area frame", () => {
  registerCSS(`.env-viewport { height: 100vh; width: 100vw; }`);

  render(
    <SafeAreaProvider
      initialMetrics={{
        insets: { top: 20, bottom: 30, left: 0, right: 0 },
        frame: { x: 0, y: 0, width: 400, height: 800 },
      }}
    >
      <View testID={testID} className="env-viewport" />
    </SafeAreaProvider>,
  );

  // `vh`/`vw` come from `Dimensions.get("window")` (750x1334 here) and never from the
  // provider's 400x800 frame. react-native-safe-area-context supplies that frame, so
  // a frame-relative viewport is available and simply unused.
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    height: 1334,
    width: 750,
  });
});

test("the small/large/dynamic viewport units are unsupported", () => {
  const compiled = compileWithAutoDebug(`.env-dvh {
    height: 10dvh;
    max-height: 10svh;
    min-height: 10lvh;
    width: 10dvw;
  }`);

  // GAP: only `vh`/`vw` exist. On native `svh` and `lvh` are exactly the distinction a
  // safe area draws — `lvh` is the full window and `svh` is the window minus the top
  // and bottom insets — so both are computable from data the provider already holds.
  // Today all four are dropped with a warning.
  expect(compiled.stylesheet()).toStrictEqual({});
  expect(compiled.warnings()).toStrictEqual({
    values: {
      "height": ["10dvh"],
      "max-height": ["10svh"],
      "min-height": ["10lvh"],
      "width": ["10dvw"],
    },
  });
});

test("calc(100vh - env(...)) is the working stand-in for svh", () => {
  registerCSS(`.env-svh-manual {
    height: calc(100vh - (env(safe-area-inset-top) + env(safe-area-inset-bottom)));
  }`);

  expect(renderWithSafeArea("env-svh-manual").props.style).toStrictEqual({
    height: 1331,
  });
});
