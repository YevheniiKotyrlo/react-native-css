import { render } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

import * as gradientFunctions from "../../native/styles/functions/gradient-functions";
import { GRADIENT_FUNCTION_NAMES } from "../../native/styles/functions/gradient-functions";
import { renderRoutes, ROUTE_NAMES } from "./_routes/harness";

/**
 * All six CSS gradient families, and what each one reaches React Native as.
 *
 * The families split two ways, and the split decides the handling rather than
 * the other way round:
 *
 * - **linear and radial** — React Native's `processBackgroundImage` parses
 *   both, so they paint today.
 * - **conic and the three repeating ones** — valid CSS a browser paints, and
 *   React Native answers an empty list for them. Empty is INERT rather than
 *   fatal, so the faithful value is emitted anyway: it costs nothing now and
 *   starts painting the day the parser learns the function, with no change
 *   here. `native-support-census.test.ts` holds that verdict against React
 *   Native's own module so it cannot quietly stop being true.
 *
 * Every family therefore emits, and the four that do not paint also WARN —
 * emitted is not the same as rendered, and the warning is the author's only
 * signal that a declaration is inert on this target.
 */

/** The `experimental_backgroundImage` a class compiles to. */
function backgroundImageOf(css: string, className: string): unknown {
  registerCSS(css);

  const style = render(
    <View testID={testID} className={className} />,
  ).getByTestId(testID).props.style as
    | { experimental_backgroundImage?: unknown }
    | undefined;

  return style?.experimental_backgroundImage;
}

/* -------------------------------------------------------------------------
 * Every family emits, as exact CSS text
 * ---------------------------------------------------------------------- */

test("the two families React Native paints emit and stay silent", () => {
  const compiled = registerCSS(`
    .g-linear { background-image: linear-gradient(to right, red, blue); }
    .g-radial { background-image: radial-gradient(circle, red, blue); }
  `);

  expect(
    backgroundImageOf(
      `.a { background-image: linear-gradient(to right, red, blue); }`,
      "a",
    ),
  ).toBe("linear-gradient(to right, #f00, #00f)");
  expect(compiled.warnings()).toStrictEqual({});
});

test("conic-gradient emits its own prelude and ANGLE stop positions", () => {
  // The one family whose stops are measured around a circle rather than along
  // a line, which is why it needs its own stop reader: `10deg` is a position
  // here where every other family's positions are lengths.
  expect(
    backgroundImageOf(
      `.a { background-image: conic-gradient(from 45deg at 30% 70%, red 10deg, blue 90deg); }`,
      "a",
    ),
  ).toBe("conic-gradient(from 45deg at 30% 70%, #f00 10deg, #00f 90deg)");
});

test("a conic prelude naming only its defaults is omitted", () => {
  // `from 0deg` and `at center center` are the initial values, so a prelude
  // spelling them out is noise a reader has to check against the grammar to
  // discover says nothing. The absence means exactly those values.
  expect(
    backgroundImageOf(
      `.a { background-image: conic-gradient(red, blue); }`,
      "a",
    ),
  ).toBe("conic-gradient(#f00, #00f)");
});

test("each repeating family emits under its OWN name", () => {
  // Not collapsed onto the non-repeating family it resembles: a `repeating-`
  // gradient that silently rendered as a single pass would be a WRONG picture,
  // where an unpainted one is an absent picture the warning already names.
  expect(
    backgroundImageOf(
      `.a { background-image: repeating-linear-gradient(45deg, red, blue 20px); }`,
      "a",
    ),
  ).toBe("repeating-linear-gradient(45deg, #f00, #00f 20px)");

  expect(
    backgroundImageOf(
      `.b { background-image: repeating-conic-gradient(red 0deg, blue 30deg); }`,
      "b",
    ),
  ).toBe("repeating-conic-gradient(#f00 0deg, #00f 30deg)");
});

/* -------------------------------------------------------------------------
 * Emitted is not the same as rendered
 * ---------------------------------------------------------------------- */

test("every family React Native cannot paint names itself in a warning", () => {
  const compiled = registerCSS(`
    .w-conic { background-image: conic-gradient(red, blue); }
    .w-rep-linear { background-image: repeating-linear-gradient(red, blue); }
    .w-rep-radial { background-image: repeating-radial-gradient(red, blue); }
    .w-rep-conic { background-image: repeating-conic-gradient(red, blue); }
  `);

  expect(compiled.warnings()).toStrictEqual({
    values: {
      "background-image": [
        "conic-gradient()",
        "repeating-linear-gradient()",
        "repeating-radial-gradient()",
        "repeating-conic-gradient()",
      ],
    },
  });
});

test("React Native still answers nothing for each of them", () => {
  // The assertion that makes emitting them safe. If any of these stops being
  // empty, the target has learned the function and the warning above should
  // come off — which is the only signal anywhere that it happened.
  const processBackgroundImage = jest.requireActual<{
    default: (value: unknown) => unknown[];
  }>("react-native/Libraries/StyleSheet/processBackgroundImage").default;

  for (const gradient of [
    "conic-gradient(red, blue)",
    "repeating-linear-gradient(45deg, red, blue 10px)",
    "repeating-radial-gradient(red, blue 10px)",
    "repeating-conic-gradient(red, blue 10deg)",
  ]) {
    expect({
      gradient,
      layers: processBackgroundImage(gradient),
    }).toStrictEqual({
      gradient,
      layers: [],
    });
  }
});

/* -------------------------------------------------------------------------
 * The percentage a 32-bit float came back as
 * ---------------------------------------------------------------------- */

test("a percentage in a prelude is written as the author wrote it", () => {
  // lightningcss stores a percentage as a 32-bit float, so `30%` arrives as
  // `0.30000001192092896` and the naive `x * 100` wrote
  // `at 30.000001192092896% 69.9999988079071%` into the gradient text — which
  // is what shipped. Six significant digits is past any precision a stylesheet
  // can express and short of the noise.
  expect(
    backgroundImageOf(
      `.a { background-image: radial-gradient(at 30% 70%, red, blue); }`,
      "a",
    ),
  ).toBe("radial-gradient(ellipse farthest-corner at 30% 70%, #f00, #00f)");
});

test("a percentage that genuinely repeats keeps its precision", () => {
  // The rounding must not turn a real value into a wrong one: a third is not
  // 33%, and six significant digits is chosen to be past what a stylesheet can
  // express rather than to tidy the output.
  // The `50%` is written `center` because lightningcss normalises a position's
  // midpoint to the keyword before the compiler ever sees it — a fact about the
  // parser, not about the rounding, and worth pinning here so a reader does not
  // mistake it for one.
  expect(
    backgroundImageOf(
      `.a { background-image: radial-gradient(at 33.3333% 50%, red, blue); }`,
      "a",
    ),
  ).toBe(
    "radial-gradient(ellipse farthest-corner at 33.3333% center, #f00, #00f)",
  );
});

test("a conic stop's percentage is written the same way", () => {
  // The conic reader has its own percentage path — the stop positions are
  // angles-or-percentages rather than lengths — so it needs its own assertion
  // that it goes through the same serialiser.
  expect(
    backgroundImageOf(
      `.a { background-image: conic-gradient(red 25%, blue 75%); }`,
      "a",
    ),
  ).toBe("conic-gradient(#f00 25%, #00f 75%)");
});

/* -------------------------------------------------------------------------
 * Every family survives every render route
 * ---------------------------------------------------------------------- */

/** The `experimental_backgroundImage` each route delivers for one declaration. */
function backgroundImageByRoute(gradient: string): Record<string, unknown> {
  const renders = renderRoutes({
    property: "background-image",
    value: gradient,
    alternate: "linear-gradient(to left, #0f0, #ff0)",
  });

  return Object.fromEntries(
    ROUTE_NAMES.map((route) => [
      route,
      (renders[route].style as { experimental_backgroundImage?: unknown })
        .experimental_backgroundImage,
    ]),
  );
}

test("no family is dropped on the routes that resolve at runtime", () => {
  // The compile-time route serialises a gradient from lightningcss's parsed
  // form; the runtime route rebuilds one from descriptor tokens, because a
  // `var()` anywhere inside the declaration means the compiler never sees the
  // value. Two implementations of one output, and only this asserts both run.
  //
  // The failure was that they disagreed about WHICH families exist: the
  // runtime path named linear and radial and dropped the other four, so a
  // conic gradient written out compiled and the same conic gradient through a
  // variable vanished. Nothing else could see it — an unpainted family and a
  // dropped one are both an empty picture on a device today.
  for (const gradient of [
    "conic-gradient(#f00, #00f)",
    "repeating-linear-gradient(45deg, #f00, #00f 20px)",
    "repeating-radial-gradient(circle, #f00, #00f 20px)",
    "repeating-conic-gradient(#f00 0deg, #00f 30deg)",
    "radial-gradient(circle, #f00, #00f)",
    "linear-gradient(to right, #f00, #00f)",
  ]) {
    const byRoute = backgroundImageByRoute(gradient);
    const family = gradient.slice(0, gradient.indexOf("("));

    // Every route delivers a value, and it is a gradient of the SAME family.
    // Asserting the family rather than the exact string is deliberate — see
    // the next test for why the two spellings legitimately differ.
    expect({ family, byRoute }).toStrictEqual({
      family,
      byRoute: Object.fromEntries(
        ROUTE_NAMES.map((route) => [
          route,
          expect.stringContaining(`${family}(`) as unknown,
        ]),
      ),
    });
  }
});

test("the compile-time and runtime spellings paint the SAME picture", () => {
  // The two routes produce different TEXT and that is correct, not a defect
  // left standing: the compiler writes lightningcss's normalised form
  // (`radial-gradient(circle farthest-corner at center center, …)`), while the
  // runtime rebuilds only what the author wrote, from a custom property
  // lightningcss has already minified (`#f00` stored as `red`).
  //
  // Byte-identity is therefore the wrong invariant — it would demand the
  // runtime reproduce a normalisation it has no parser for. What must agree is
  // what React Native makes of the two strings, which is what this asserts,
  // against React Native's own module rather than against an idea of it.
  const processBackgroundImage = jest.requireActual<{
    default: (value: unknown) => unknown[];
  }>("react-native/Libraries/StyleSheet/processBackgroundImage").default;

  for (const gradient of [
    "linear-gradient(to right, #f00, #00f)",
    "linear-gradient(45deg, #f00 10%, #00f 90%)",
    "radial-gradient(circle, #f00, #00f)",
    "radial-gradient(at 30% 70%, #f00, #00f 20px)",
  ]) {
    const byRoute = backgroundImageByRoute(gradient);
    const literalLayers = processBackgroundImage(byRoute.literal);

    // A non-empty literal is the guard that keeps the comparison honest: two
    // routes that both parsed to nothing would agree perfectly.
    expect({ gradient, layers: literalLayers.length }).toStrictEqual({
      gradient,
      layers: 1,
    });

    for (const route of ROUTE_NAMES) {
      expect({
        gradient,
        route,
        layers: processBackgroundImage(byRoute[route]),
      }).toStrictEqual({ gradient, route, layers: literalLayers });
    }
  }
});

/* -------------------------------------------------------------------------
 * The three copies of the six names
 * ---------------------------------------------------------------------- */

test("every site that decides a gradient BY NAME knows all six", () => {
  // The defect this exists to prevent, stated as the thing that went wrong:
  // the six-name set is spelled out in three places, and two of them said
  // "linear and radial".
  //
  // It is three copies rather than one import because the tier boundary is
  // real — `compiler/` pulls in lightningcss, a build-time native dependency
  // that cannot exist in an app bundle, which is why `parse-value.ts` mirrors
  // the compiler rather than calling it. So the copies cannot be removed, and
  // the honest alternative is to make them CHECKABLE. That is this test.
  //
  // Each copy answers the same question — "is this name a gradient, and must
  // it therefore survive un-camelCased?" — and a copy that answers with a
  // subset drops the difference with no error anywhere: the name is
  // camelCased, matches no resolver, and the declaration disappears.
  const expected = [
    "conic-gradient",
    "linear-gradient",
    "radial-gradient",
    "repeating-conic-gradient",
    "repeating-linear-gradient",
    "repeating-radial-gradient",
  ];

  // Copy 1 — the resolver registrations. The names a gradient can actually be
  // resolved under, and the census the other two answer to.
  const registered = Object.keys(gradientFunctions).filter((name) =>
    name.endsWith("-gradient"),
  );
  expect(registered.toSorted()).toStrictEqual(expected);

  // Copy 2 — the runtime string parser's set, read from the same module.
  expect([...GRADIENT_FUNCTION_NAMES].toSorted()).toStrictEqual(expected);

  // Copy 3 — the compiler's unparsed-value switch. Read by BEHAVIOUR rather
  // than by parsing the source: what matters is that a gradient of each family
  // survives the route that switch governs, which is the only thing a reader
  // of that file cannot verify by eye.
  for (const name of expected) {
    // TWO definitions of the custom property, so the compiler cannot fold the
    // value into the reference — that fold is what makes a one-definition
    // variable compile as a literal and skip the switch entirely.
    expect({
      name,
      resolved: backgroundImageOf(
        `:root { --g: ${name}(#f00, #00f); }
         @media (prefers-color-scheme: dark) { :root { --g: linear-gradient(#0f0, #ff0); } }
         .b { background-image: var(--g); }`,
        "b",
      ),
    }).toStrictEqual({
      name,
      resolved: expect.stringContaining(`${name}(`) as unknown,
    });
  }
});
