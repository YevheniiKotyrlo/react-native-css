import { processColor } from "react-native";

import { render } from "@testing-library/react-native";
import { Image } from "react-native-css/components/Image";
import { ImageBackground } from "react-native-css/components/ImageBackground";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import processBackgroundImage from "react-native/Libraries/StyleSheet/processBackgroundImage";

/**
 * Images and backgrounds: what a CSS author can actually reach.
 *
 * Ground truth for "React Native can express this" is
 * `react-native/Libraries/StyleSheet/StyleSheetTypes.d.ts` (`ViewStyle`,
 * `ImageStyle`, `GradientValue`) cross-checked against the runtime whitelist
 * `react-native/Libraries/Components/View/ReactNativeStyleAttributes.js`, which
 * is the list of style keys React Native forwards to the host view. React
 * Native 0.81.4 is the installed version.
 *
 * Three routes turn up and every test below says which one it is pinning:
 *
 *  1. A real CSS property produces a React Native STYLE key.
 *  2. A real CSS property produces a PROP instead of a style key —
 *     `object-fit` and `object-position` do this, targeting expo-image's
 *     `contentFit` / `contentPosition` rather than React Native's own
 *     `objectFit` style key.
 *  3. Only the `-rn-<key>` escape hatch reaches it. `-rn-` is a pass-through:
 *     `toRNProperty` strips the prefix and camelCases the rest, so
 *     `-rn-tint-color` becomes `tintColor`. It is not portable CSS.
 *
 * `// GAP:` marks a React Native capability no CSS declaration reaches, or
 * reaches in a form React Native cannot consume.
 *
 * EVERY gradient below is asserted twice: the string the compiler emits, and
 * what `processBackgroundImage` — the function
 * `ReactNativeStyleAttributes.js` runs every `experimental_backgroundImage`
 * value through before it reaches the host view — makes of it. The string alone
 * proves nothing. React Native reports an unreadable gradient by returning an
 * EMPTY ARRAY, which renders as no background at all, so a value that looks like
 * CSS and parses to `[]` is indistinguishable from a declaration nobody wrote.
 * The module has no `.d.ts` of its own; `./_process-background-image.d.ts`
 * declares it.
 */

/** The stop colours, as `processColor` renders them: `0xAARRGGBB`. */
const RED = processColor("red");
const GREEN = processColor("green");
const BLUE = processColor("blue");
const YELLOW = processColor("yellow");
const RED_HALF_ALPHA = processColor("#ff000080");
const TRANSPARENT = processColor("#0000");

const styleOfView = (
  className: string,
): Record<string, unknown> | undefined => {
  const element = render(
    <View testID={testID} className={className} />,
  ).getByTestId(testID);

  return element.props.style as Record<string, unknown> | undefined;
};

/** The compiled `background-image`, ready to hand to React Native's parser. */
const backgroundImageOf = (className: string): unknown =>
  styleOfView(className)?.experimental_backgroundImage;

const imagePropsOf = (className: string): Record<string, unknown> => {
  const element = render(
    <Image testID={testID} className={className} source={{ uri: "x.png" }} />,
  ).getByTestId(testID);

  return element.props as Record<string, unknown>;
};

/*****************************************************************************
 * 1. background-image: linear-gradient() — direction
 ****************************************************************************/

describe("linear-gradient direction", () => {
  test("an omitted direction compiles to the CSS default, `to bottom`", () => {
    registerCSS(
      `.grad-default { background-image: linear-gradient(red, blue); }`,
    );

    expect(styleOfView("grad-default")).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(to bottom, #f00, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("grad-default")),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 180 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  test("`to <side>` survives", () => {
    registerCSS(`
      .grad-right { background-image: linear-gradient(to right, red, blue); }
      .grad-top { background-image: linear-gradient(to top, red, blue); }
    `);

    expect(styleOfView("grad-right")).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(to right, #f00, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("grad-right")),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 90 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);

    expect(styleOfView("grad-top")).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(to top, #f00, #00f)",
    });
    expect(processBackgroundImage(backgroundImageOf("grad-top"))).toStrictEqual(
      [
        {
          type: "linear-gradient",
          direction: { type: "angle", value: 0 },
          colorStops: [
            { color: RED, position: null },
            { color: BLUE, position: null },
          ],
        },
      ],
    );
  });

  test("a corner direction is emitted horizontal-first", () => {
    // `to bottom right` comes back as `to right bottom`. React Native's
    // LINEAR_GRADIENT_DIRECTION_REGEX in processBackgroundImage.js accepts
    // either ordering and canonicalises it, so this is a spelling difference,
    // not a defect — the parse below is the proof.
    registerCSS(`
      .grad-corner { background-image: linear-gradient(to bottom right, red, blue); }
    `);

    expect(styleOfView("grad-corner")).toStrictEqual({
      experimental_backgroundImage:
        "linear-gradient(to right bottom, #f00, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("grad-corner")),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        // A corner is the one direction React Native keeps as a keyword rather
        // than folding to an angle, because the angle depends on the box's
        // aspect ratio and is resolved at paint time.
        direction: { type: "keyword", value: "to bottom right" },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  test("deg angles survive, including negative and zero", () => {
    registerCSS(`
      .grad-deg { background-image: linear-gradient(45deg, red, blue); }
      .grad-negdeg { background-image: linear-gradient(-45deg, red, blue); }
      .grad-zerodeg { background-image: linear-gradient(0deg, red, blue); }
    `);

    for (const [className, css, angle] of [
      ["grad-deg", "linear-gradient(45deg, #f00, #00f)", 45],
      ["grad-negdeg", "linear-gradient(-45deg, #f00, #00f)", -45],
      ["grad-zerodeg", "linear-gradient(0deg, #f00, #00f)", 0],
    ] as const) {
      expect(styleOfView(className)).toStrictEqual({
        experimental_backgroundImage: css,
      });
      expect(
        processBackgroundImage(backgroundImageOf(className)),
      ).toStrictEqual([
        {
          type: "linear-gradient",
          direction: { type: "angle", value: angle },
          colorStops: [
            { color: RED, position: null },
            { color: BLUE, position: null },
          ],
        },
      ]);
    }
  });

  test("rad angles arrive already converted to deg", () => {
    // lightningcss normalises `rad` to `deg` before the compiler sees it, so
    // `parseAngle`'s deg branch handles it. The float is the exact conversion,
    // and React Native carries it through unrounded.
    registerCSS(
      `.grad-rad { background-image: linear-gradient(1.5708rad, red, blue); }`,
    );

    expect(styleOfView("grad-rad")).toStrictEqual({
      experimental_backgroundImage:
        "linear-gradient(90.00019836425781deg, #f00, #00f)",
    });
    expect(processBackgroundImage(backgroundImageOf("grad-rad"))).toStrictEqual(
      [
        {
          type: "linear-gradient",
          direction: { type: "angle", value: 90.00019836425781 },
          colorStops: [
            { color: RED, position: null },
            { color: BLUE, position: null },
          ],
        },
      ],
    );
  });

  // `turn` and `grad` used to be dropped: `parseAngle` has cases only for `deg`
  // and `rad`, so everything else warned and returned undefined, and the
  // gradient rendered with React Native's default 180deg instead of the
  // author's angle. The compiler's `Angle` visitor now normalises both to `deg`
  // before any parser sees them — the same shape as the `Length` visitor's unit
  // folding, and it fixes every angle-taking property at once rather than
  // gradients alone.
  test("turn angles are normalised to degrees", () => {
    const compiled = registerCSS(`
      .grad-turn { background-image: linear-gradient(0.25turn, red, blue); }
    `);

    expect(styleOfView("grad-turn")).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(90deg, #f00, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("grad-turn")),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 90 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
    expect(compiled.warnings()).toStrictEqual({});
  });

  test("grad angles are normalised to degrees", () => {
    const compiled = registerCSS(`
      .grad-grad { background-image: linear-gradient(100grad, red, blue); }
    `);

    expect(styleOfView("grad-grad")).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(90deg, #f00, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("grad-grad")),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 90 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
    expect(compiled.warnings()).toStrictEqual({});
  });

  // GAP: the legacy `-webkit-` form takes a STARTING side, so
  // `-webkit-linear-gradient(left, …)` paints red on the left and is equivalent
  // to the standard `linear-gradient(to right, …)` — 90deg. `parseLineDirection`
  // reads the keyword as an END side and emits `to left`, which React Native
  // resolves to 270deg: the axis is reversed, and the parse below is what makes
  // that measurable rather than a claim.
  test("the -webkit- prefixed form is accepted but its axis is not converted", () => {
    registerCSS(`
      .grad-webkit { background-image: -webkit-linear-gradient(left, red, blue); }
    `);

    expect(styleOfView("grad-webkit")).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(to left, #f00, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("grad-webkit")),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        // 270deg. The `-webkit-` spelling means 90deg.
        direction: { type: "angle", value: 270 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });
});

/*****************************************************************************
 * 2. background-image: linear-gradient() — colour stops
 ****************************************************************************/

describe("linear-gradient colour stops", () => {
  test("percentage stop positions survive", () => {
    registerCSS(`
      .stop-pct {
        background-image: linear-gradient(to right, red 0%, green 50%, blue 100%);
      }
    `);

    expect(styleOfView("stop-pct")).toStrictEqual({
      experimental_backgroundImage:
        "linear-gradient(to right, #f00 0%, #008000 50%, #00f 100%)",
    });
    expect(processBackgroundImage(backgroundImageOf("stop-pct"))).toStrictEqual(
      [
        {
          type: "linear-gradient",
          direction: { type: "angle", value: 90 },
          colorStops: [
            { color: RED, position: "0%" },
            { color: GREEN, position: "50%" },
            { color: BLUE, position: "100%" },
          ],
        },
      ],
    );
  });

  test("pixel stop positions keep their unit", () => {
    // The compiler folds `px` away — every length reaches the runtime as a bare
    // number — so the unit is written back by the gradient resolver.
    // `getPositionFromCSSValue` returns a position only for a value ending in
    // `px` or `%`, and one unreadable stop drops the WHOLE gradient to `[]`, so
    // a bare `100` here would render nothing at all.
    registerCSS(`
      .stop-px { background-image: linear-gradient(to right, red 0px, blue 100px); }
    `);

    expect(styleOfView("stop-px")).toStrictEqual({
      experimental_backgroundImage:
        "linear-gradient(to right, #f00 0px, #00f 100px)",
    });
    expect(processBackgroundImage(backgroundImageOf("stop-px"))).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 90 },
        // React Native strips the `px` back off and keeps a percentage as text,
        // which is how it tells the two apart downstream.
        colorStops: [
          { color: RED, position: 0 },
          { color: BLUE, position: 100 },
        ],
      },
    ]);
  });

  test("a transition hint is emitted bare, between two stops", () => {
    registerCSS(
      `.stop-hint { background-image: linear-gradient(red, 20%, blue); }`,
    );

    expect(styleOfView("stop-hint")).toStrictEqual({
      experimental_backgroundImage:
        "linear-gradient(to bottom, #f00, 20%, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("stop-hint")),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 180 },
        // A `null` colour IS the hint: React Native reads a positioned member
        // with no colour as the midpoint of the transition around it, which is
        // a different gradient from `red 20%, blue`.
        colorStops: [
          { color: RED, position: null },
          { color: null, position: "20%" },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  test("a double-position stop is expanded into two stops", () => {
    registerCSS(
      `.stop-double { background-image: linear-gradient(red 0% 20%, blue); }`,
    );

    expect(styleOfView("stop-double")).toStrictEqual({
      experimental_backgroundImage:
        "linear-gradient(to bottom, #f00 0%, #f00 20%, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("stop-double")),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 180 },
        colorStops: [
          { color: RED, position: "0%" },
          { color: RED, position: "20%" },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  test("alpha colours and `transparent` survive as 8-digit hex", () => {
    registerCSS(`
      .stop-alpha {
        background-image: linear-gradient(to right, rgba(255, 0, 0, 0.5), transparent);
      }
    `);

    expect(styleOfView("stop-alpha")).toStrictEqual({
      experimental_backgroundImage:
        "linear-gradient(to right, #ff000080, #0000)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("stop-alpha")),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 90 },
        colorStops: [
          { color: RED_HALF_ALPHA, position: null },
          { color: TRANSPARENT, position: null },
        ],
      },
    ]);
  });

  test("currentColor in a stop resolves against the rule's own color", () => {
    registerCSS(`
      .stop-current { color: red; background-image: linear-gradient(currentColor, blue); }
    `);

    expect(styleOfView("stop-current")).toStrictEqual({
      color: "#f00",
      experimental_backgroundImage: "linear-gradient(to bottom, #f00, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("stop-current")),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 180 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  test("a var() colour in a stop resolves", () => {
    registerCSS(`
      .stop-var { --stop-var-color: red; background-image: linear-gradient(var(--stop-var-color), blue); }
    `);

    expect(styleOfView("stop-var")).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(to bottom, #f00, #00f)",
    });
    expect(processBackgroundImage(backgroundImageOf("stop-var"))).toStrictEqual(
      [
        {
          type: "linear-gradient",
          direction: { type: "angle", value: 180 },
          colorStops: [
            { color: RED, position: null },
            { color: BLUE, position: null },
          ],
        },
      ],
    );
  });
});

/*****************************************************************************
 * 2b. background-image: linear-gradient() — colour stops supplied by a var()
 ****************************************************************************/

/**
 * A `background-image` declaration compiles two different ways, and both end at
 * the same runtime resolver.
 *
 * With every argument written out, lightningcss parses the gradient and
 * `parseGradient` emits one descriptor argument per gradient argument — a stop
 * with a position as the pair `[<color>, <position>]`. With a `var()` anywhere
 * inside it the declaration is UNPARSED, and the arguments reach
 * `native/styles/functions/gradient-functions.ts` as the raw token list the
 * `-rn-` escape hatch (section 6) also travels on.
 *
 * Nothing in that token list marks where one stop ends and the next begins. A
 * custom property is stored as comma groups of space-separated tokens with a
 * singleton collapsed at each level, so `--stops: red, blue` (two one-token
 * groups) and `--stop: red 10%` (one two-token group) are the SAME two-string
 * array. The boundary is therefore recovered from the stop-list grammar: a
 * member is a position if it is a number or a percentage and a colour
 * otherwise, and every colour opens a stop.
 */
describe("gradient arguments supplied by a var()", () => {
  test("a var() holding the whole stop list resolves to two stops", () => {
    registerCSS(`
      .stop-listvar-owner { --stop-list: red, blue; }
      .stop-listvar { background-image: linear-gradient(to right, var(--stop-list)); }
      .stop-listlit { -rn-experimental_background-image: linear-gradient(to right, red, blue); }
      .stop-listparsed { background-image: linear-gradient(to right, red, blue); }
    `);

    const style = styleOfView("stop-listvar-owner stop-listvar");

    expect(style).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(to right, red, blue)",
    });

    // The reference is the same gradient with the stop list written out. Both
    // spellings take the unparsed route — `-rn-` is a pass-through, so its value
    // reaches this resolver too — and they produce the same string, character
    // for character.
    expect(styleOfView("stop-listlit")).toStrictEqual(style);

    const parsedGradient = [
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 90 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ];

    // Which is the point: React Native reads it.
    expect(
      processBackgroundImage(style?.experimental_backgroundImage),
    ).toStrictEqual(parsedGradient);

    // The same declaration with no `var()` in it takes the PARSED route, which
    // reaches the same resolver by a different road: lightningcss has already
    // minified each colour to a hex, so the two strings differ, and React Native
    // parses them into the same gradient. That equality is the contract — a
    // route that renders and a route that does not is the failure this pair
    // guards against.
    expect(styleOfView("stop-listparsed")).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(to right, #f00, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("stop-listparsed")),
    ).toStrictEqual(parsedGradient);
  });

  test("a var() holding one positioned stop is one stop, not two", () => {
    // The token stream is `["red", "10%"]`, exactly as long as the two-colour
    // list above. The grammar is what tells them apart: `10%` is a position, so
    // it completes the stop `red` opened rather than starting a second one.
    registerCSS(`
      .stop-onevar-owner { --one-stop: red 10%; }
      .stop-onevar { background-image: linear-gradient(to right, var(--one-stop)); }
    `);

    const style = styleOfView("stop-onevar-owner stop-onevar");

    expect(style).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(to right, red 10%)",
    });
    expect(
      processBackgroundImage(style?.experimental_backgroundImage),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 90 },
        colorStops: [{ color: RED, position: "10%" }],
      },
    ]);
  });

  test("a var() holding several positioned stops keeps each position with its colour", () => {
    registerCSS(`
      .stop-manyvar-owner { --many-stops: red 0%, green 50%, blue 100%; }
      .stop-manyvar { background-image: linear-gradient(to right, var(--many-stops)); }
    `);

    const style = styleOfView("stop-manyvar-owner stop-manyvar");

    expect(style).toStrictEqual({
      experimental_backgroundImage:
        "linear-gradient(to right, red 0%, green 50%, blue 100%)",
    });
    expect(
      processBackgroundImage(style?.experimental_backgroundImage),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 90 },
        colorStops: [
          { color: RED, position: "0%" },
          { color: GREEN, position: "50%" },
          { color: BLUE, position: "100%" },
        ],
      },
    ]);
  });

  test("a var() holding a pixel stop position keeps its unit", () => {
    // The deferred twin of "pixel stop positions keep their unit": here the
    // number never passed through the compiler's length folding at all, and the
    // same rule applies — React Native needs the unit or it drops the gradient.
    registerCSS(`
      .stop-pxvar-owner { --px-stop: red 10px; }
      .stop-pxvar { background-image: linear-gradient(to right, var(--px-stop), blue); }
    `);

    const style = styleOfView("stop-pxvar-owner stop-pxvar");

    expect(style).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(to right, red 10px, blue)",
    });
    expect(
      processBackgroundImage(style?.experimental_backgroundImage),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 90 },
        colorStops: [
          { color: RED, position: 10 },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  test("a gradient with no prelude reads every argument as a stop", () => {
    // `to right` is what makes argument 0 a prelude. Without it the first
    // argument is a colour, so the whole list is stops and React Native supplies
    // its own `to bottom` default.
    registerCSS(`
      .stop-noprelude-owner { --noprelude-stops: red, blue; }
      .stop-noprelude { background-image: linear-gradient(var(--noprelude-stops)); }
    `);

    const style = styleOfView("stop-noprelude-owner stop-noprelude");

    expect(style).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(red, blue)",
    });
    expect(
      processBackgroundImage(style?.experimental_backgroundImage),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 180 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  test("a var() stop list joins the stops written beside it", () => {
    registerCSS(`
      .stop-mixvar-owner { --mix-stops: red, blue; }
      .stop-mixvar { background-image: linear-gradient(to right, var(--mix-stops), green); }
    `);

    const style = styleOfView("stop-mixvar-owner stop-mixvar");

    expect(style).toStrictEqual({
      experimental_backgroundImage:
        "linear-gradient(to right, red, blue, green)",
    });
    expect(
      processBackgroundImage(style?.experimental_backgroundImage),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 90 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
          { color: GREEN, position: null },
        ],
      },
    ]);
  });

  test("an angle prelude survives whether it is written out or comes from a var()", () => {
    registerCSS(`
      .grad-anglevar-owner { --grad-angle: 45deg; --angle-stops: red, blue; }
      .grad-anglevar { background-image: linear-gradient(var(--grad-angle), var(--angle-stops)); }
      .grad-anglelit { background-image: linear-gradient(45deg, var(--angle-stops)); }
    `);

    const parsedGradient = [
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 45 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ];

    for (const className of [
      "grad-anglevar-owner grad-anglevar",
      "grad-anglevar-owner grad-anglelit",
    ]) {
      expect(styleOfView(className)).toStrictEqual({
        experimental_backgroundImage: "linear-gradient(45deg, red, blue)",
      });
      expect(
        processBackgroundImage(backgroundImageOf(className)),
      ).toStrictEqual(parsedGradient);
    }
  });

  test("radial-gradient keeps its shape prelude, written out or from a var()", () => {
    registerCSS(`
      .rad-var-owner { --rad-shape: circle at center; --rad-stops: red, blue; }
      .rad-varlit { background-image: radial-gradient(circle at center, var(--rad-stops)); }
      .rad-varshape { background-image: radial-gradient(var(--rad-shape), var(--rad-stops)); }
    `);

    const style = styleOfView("rad-var-owner rad-varlit");

    expect(style).toStrictEqual({
      experimental_backgroundImage:
        "radial-gradient(circle at center, red, blue)",
    });
    // The prelude arrives as three separate tokens through the variable and as
    // one already-joined string when written out, and both are one member of the
    // comma-separated list — so it is space-joined, never comma-joined.
    expect(styleOfView("rad-var-owner rad-varshape")).toStrictEqual(style);
    expect(
      processBackgroundImage(style?.experimental_backgroundImage),
    ).toStrictEqual([
      {
        type: "radial-gradient",
        shape: "circle",
        size: "farthest-corner",
        position: { top: "50%", left: "50%" },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  test("a var() that resolves to nothing drops the declaration", () => {
    // A prelude on its own is not a gradient, so resolving the prelude and
    // losing the stops has to drop the whole declaration — emitting
    // `linear-gradient(to right)` would hand React Native's parser a string it
    // has to reject.
    registerCSS(`
      .stop-novar { background-image: linear-gradient(to right, var(--never-defined)); }
      .stop-novar-noprelude { background-image: linear-gradient(var(--never-defined)); }
    `);

    expect(styleOfView("stop-novar")).toStrictEqual({});
    expect(styleOfView("stop-novar-noprelude")).toStrictEqual({});
    expect(
      processBackgroundImage(backgroundImageOf("stop-novar")),
    ).toStrictEqual([]);
    expect(
      processBackgroundImage(backgroundImageOf("stop-novar-noprelude")),
    ).toStrictEqual([]);
  });

  test("a hint standing alone in a var() is read as a hint", () => {
    // The argument boundary is what carries the distinction: the variable holds
    // ONE member and it is a position, so it opens its own argument and cannot
    // be the position of the colour before it.
    registerCSS(`
      .stop-hintlone-owner { --lone-hint: 20%; }
      .stop-hintlone { background-image: linear-gradient(red, var(--lone-hint), blue); }
    `);

    const style = styleOfView("stop-hintlone-owner stop-hintlone");

    expect(style).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(red, 20%, blue)",
    });
    expect(
      processBackgroundImage(style?.experimental_backgroundImage),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 180 },
        colorStops: [
          { color: RED, position: null },
          { color: null, position: "20%" },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  // GAP: the comma that separates a transition hint from the stop before it is
  // exactly what the singleton collapse discards, so inside ONE variable
  // `red, 20%, blue` and `red 20%, blue` are the same token stream and the
  // grammar reads both as the positioned stop. The two cases above are the ones
  // that survive it: a hint written out in the gradient, and a hint held in a
  // variable of its own, each open an argument the collapse cannot reach.
  test("a transition hint inside a var() reads as a stop position", () => {
    registerCSS(`
      .stop-hintvar-owner { --hint-stops: red, 20%, blue; }
      .stop-hintvar { background-image: linear-gradient(to right, var(--hint-stops)); }
    `);

    const style = styleOfView("stop-hintvar-owner stop-hintvar");

    expect(style).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(to right, red 20%, blue)",
    });
    expect(
      processBackgroundImage(style?.experimental_backgroundImage),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 90 },
        // The hint would have been `{color: null, position: "20%"}` standing
        // between the two stops.
        colorStops: [
          { color: RED, position: "20%" },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });
});

/*****************************************************************************
 * 3. The emitted shape — what React Native accepts, and what it does not
 ****************************************************************************/

describe("what React Native does with the emitted background-image", () => {
  // `ReactNativeStyleAttributes.js` declares
  // `experimental_backgroundImage: {process: processBackgroundImage}`, so the
  // emitted value is handed straight to
  // `react-native/Libraries/StyleSheet/processBackgroundImage`. Its contract
  // (`ViewStyle.experimental_backgroundImage`) is
  // `ReadonlyArray<GradientValue> | string`, and those two halves are not
  // interchangeable: the array branch reads `.colorStops.length` off each
  // member, so an array member that is a STRING is a TypeError, not a parse
  // failure. `background-image` is a comma-separated list in CSS and is emitted
  // as one string, which is the half that accepts a layer list as text.
  test("the emitted value is one CSS string, not a list of them", () => {
    registerCSS(
      `.rn-consume { background-image: linear-gradient(red, blue); }`,
    );

    const value = backgroundImageOf("rn-consume");

    expect(typeof value).toBe("string");
    expect(processBackgroundImage(value)).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 180 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  test("the same gradient wrapped in an array makes processBackgroundImage throw", () => {
    // Why the string half is the one to emit, stated as a fact about React
    // Native rather than a preference: a gradient string inside an array is
    // read as a `GradientValue` object and its missing `.colorStops` throws
    // before any parsing happens.
    registerCSS(
      `.rn-consume-array { background-image: linear-gradient(red, blue); }`,
    );

    expect(() =>
      processBackgroundImage([backgroundImageOf("rn-consume-array")]),
    ).toThrow(TypeError);
  });

  test("a function React Native does not know yields no gradient", () => {
    // The other half of the same contract, and the reason a stop is written as
    // plain CSS: `processBackgroundImage` parses the string with its own
    // grammar, and anything outside that grammar takes the whole gradient with
    // it. There is no partial success and no error — just an empty array and a
    // view with no background.
    expect(
      processBackgroundImage(
        "linear-gradient(to bottom, @colorStop(#f00), @colorStop(#00f))",
      ),
    ).toStrictEqual([]);
    expect(
      processBackgroundImage("linear-gradient(to bottom, #f00, #00f)"),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 180 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  test("`background-image: none` is emitted as the CSS keyword", () => {
    registerCSS(`.rn-none { background-image: none; }`);

    expect(styleOfView("rn-none")).toStrictEqual({
      experimental_backgroundImage: "none",
    });
    // `none` is a layer that paints nothing, so no gradient is the right answer
    // — the empty array here is the outcome the author asked for, not a loss.
    expect(processBackgroundImage(backgroundImageOf("rn-none"))).toStrictEqual(
      [],
    );
  });
});

/*****************************************************************************
 * 4. Multiple layers
 ****************************************************************************/

describe("layered background-image", () => {
  test("two gradients produce two entries, in source order", () => {
    registerCSS(`
      .layer-two {
        background-image: linear-gradient(red, blue), linear-gradient(green, yellow);
      }
    `);

    expect(styleOfView("layer-two")).toStrictEqual({
      experimental_backgroundImage:
        "linear-gradient(to bottom, #f00, #00f), linear-gradient(to bottom, #008000, #ff0)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("layer-two")),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 180 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 180 },
        colorStops: [
          { color: GREEN, position: null },
          { color: YELLOW, position: null },
        ],
      },
    ]);
  });

  test("`none` mixed with a gradient keeps both entries", () => {
    registerCSS(`
      .layer-none { background-image: none, linear-gradient(red, blue); }
    `);

    expect(styleOfView("layer-none")).toStrictEqual({
      experimental_backgroundImage:
        "none, linear-gradient(to bottom, #f00, #00f)",
    });
    // The `none` layer is dropped by React Native's own parser rather than by
    // the compiler, which is what keeps the layer ORDER faithful up to the point
    // React Native takes over.
    expect(
      processBackgroundImage(backgroundImageOf("layer-none")),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 180 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });
});

/*****************************************************************************
 * 5. Gradient functions that produce nothing
 ****************************************************************************/

describe("background-image gradient families", () => {
  // React Native 0.81+ supports radial gradients — `processBackgroundImage` has
  // a full `radial-gradient` branch with shape / size / position handling, and
  // `parseRadialGradientCSSString` parses the string form. The compiler's
  // `parseGradient` had only a `case "linear"`, so radial fell through to
  // `undefined`, `flatMap` dropped it, and NO warning was emitted.
  test("radial-gradient compiles, with its shape, size and position", () => {
    const compiled = registerCSS(`
      .drop-radial { background-image: radial-gradient(red, blue); }
    `);

    expect(styleOfView("drop-radial")).toStrictEqual({
      experimental_backgroundImage:
        "radial-gradient(ellipse farthest-corner at center center, #f00, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("drop-radial")),
    ).toStrictEqual([
      {
        type: "radial-gradient",
        shape: "ellipse",
        size: "farthest-corner",
        position: { top: "50%", left: "50%" },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
    expect(compiled.warnings()).toStrictEqual({});
  });

  test("a positioned radial-gradient keeps its shape and position", () => {
    registerCSS(`
      .drop-radial-circle {
        background-image: radial-gradient(circle at center, red, blue);
      }
    `);

    expect(styleOfView("drop-radial-circle")).toStrictEqual({
      experimental_backgroundImage:
        "radial-gradient(circle farthest-corner at center center, #f00, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("drop-radial-circle")),
    ).toStrictEqual([
      {
        type: "radial-gradient",
        shape: "circle",
        size: "farthest-corner",
        position: { top: "50%", left: "50%" },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  test("an explicit radial size survives, in both the circle and ellipse forms", () => {
    registerCSS(`
      .rad-circle-radius { background-image: radial-gradient(circle 50px, red, blue); }
      .rad-ellipse-size { background-image: radial-gradient(ellipse 50px 20px, red, blue); }
      .rad-extent { background-image: radial-gradient(closest-side, red, blue); }
    `);

    const colorStops = [
      { color: RED, position: null },
      { color: BLUE, position: null },
    ];

    expect(styleOfView("rad-circle-radius")).toStrictEqual({
      experimental_backgroundImage:
        "radial-gradient(circle 50px at center center, #f00, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("rad-circle-radius")),
    ).toStrictEqual([
      {
        type: "radial-gradient",
        shape: "circle",
        // A single radius becomes both axes — React Native has no scalar size.
        size: { x: 50, y: 50 },
        position: { top: "50%", left: "50%" },
        colorStops,
      },
    ]);

    expect(styleOfView("rad-ellipse-size")).toStrictEqual({
      experimental_backgroundImage:
        "radial-gradient(ellipse 50px 20px at center center, #f00, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("rad-ellipse-size")),
    ).toStrictEqual([
      {
        type: "radial-gradient",
        shape: "ellipse",
        size: { x: 50, y: 20 },
        position: { top: "50%", left: "50%" },
        colorStops,
      },
    ]);

    expect(styleOfView("rad-extent")).toStrictEqual({
      experimental_backgroundImage:
        "radial-gradient(ellipse closest-side at center center, #f00, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("rad-extent")),
    ).toStrictEqual([
      {
        type: "radial-gradient",
        shape: "ellipse",
        size: "closest-side",
        position: { top: "50%", left: "50%" },
        colorStops,
      },
    ]);
  });

  // GAP: no React Native equivalent for conic gradients —
  // `processBackgroundImage` handles only `linear-gradient` and
  // `radial-gradient`. The drop is correct; it is now at least announced.
  test("conic-gradient is emitted as written, and says it will not paint yet", () => {
    const compiled = registerCSS(`
      .drop-conic { background-image: conic-gradient(from 45deg at 30% 70%, red 10deg, blue 90deg); }
    `);

    // Emitted, not dropped. React Native's parser answers an empty list for
    // this family — INERT rather than fatal — so the faithful value costs
    // nothing today and starts painting the day the parser learns the
    // function, with no change here. `native-support-census.test.ts` holds
    // that verdict against React Native's own module.
    //
    // The text is exact CSS, including the `from <angle> at <position>`
    // prelude and the ANGLE stop positions this family measures its stops in.
    expect(styleOfView("drop-conic")).toStrictEqual({
      experimental_backgroundImage:
        "conic-gradient(from 45deg at 30% 70%, #f00 10deg, #00f 90deg)",
    });
    // The warning stays: emitted is not the same as rendered, and the author
    // has no other way to learn that this one paints nothing today.
    expect(compiled.warnings()).toStrictEqual({
      values: { "background-image": ["conic-gradient()"] },
    });
  });

  // React Native has no repeating-gradient primitive, so this one is a genuine
  // platform limit — but a limit in the TARGET, not a reason to stop compiling
  // the CSS. Each family is emitted and each names itself in a warning.
  test("every repeating-* gradient is emitted, each naming itself", () => {
    const compiled = registerCSS(`
      .drop-rep-linear { background-image: repeating-linear-gradient(45deg, red, blue 20px); }
      .drop-rep-radial { background-image: repeating-radial-gradient(red, blue); }
      .drop-rep-conic { background-image: repeating-conic-gradient(red, blue); }
    `);

    // Each is emitted as its own family rather than collapsed onto the
    // non-repeating one it resembles: a `repeating-` gradient that silently
    // rendered as a single pass would be a wrong picture, where an unpainted
    // one is an absent picture the warning already names.
    expect(styleOfView("drop-rep-linear")).toStrictEqual({
      experimental_backgroundImage:
        "repeating-linear-gradient(45deg, #f00, #00f 20px)",
    });
    expect(styleOfView("drop-rep-radial")).toStrictEqual({
      experimental_backgroundImage:
        "repeating-radial-gradient(ellipse farthest-corner at center center, #f00, #00f)",
    });
    expect(styleOfView("drop-rep-conic")).toStrictEqual({
      experimental_backgroundImage: "repeating-conic-gradient(#f00, #00f)",
    });
    expect(compiled.warnings()).toStrictEqual({
      values: {
        "background-image": [
          "repeating-linear-gradient()",
          "repeating-radial-gradient()",
          "repeating-conic-gradient()",
        ],
      },
    });
  });

  // GAP: `url()` has no React Native style equivalent — an image source is a
  // `source` PROP on `<Image>`, never a style key — so dropping it is right.
  // Dropping it without a warning is not: the author cannot tell.
  test("url() produces no style key and no warning", () => {
    const compiled = registerCSS(`
      .drop-url { background-image: url("https://example.com/x.png"); }
    `);

    expect(styleOfView("drop-url")).toBeUndefined();
    expect(compiled.warnings()).toStrictEqual({});
  });

  test("image-set() produces no style key", () => {
    registerCSS(`
      .drop-imageset { background-image: image-set("a.png" 1x, "b.png" 2x); }
    `);

    expect(styleOfView("drop-imageset")).toBeUndefined();
  });

  test("a url() layer is dropped from a list while the gradient layer survives", () => {
    registerCSS(`
      .drop-url-layer {
        background-image: url("a.png"), linear-gradient(red, blue);
      }
    `);

    expect(styleOfView("drop-url-layer")).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(to bottom, #f00, #00f)",
    });
    expect(
      processBackgroundImage(backgroundImageOf("drop-url-layer")),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 180 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });
});

/*****************************************************************************
 * 5b. The census — every gradient in this file, through React Native's parser
 ****************************************************************************/

interface GradientCase {
  /**
   * The full CSS. A `var()` case needs a second rule to hold the custom
   * property, because one declared in the same rule is inlined at compile time
   * and the declaration takes the parsed route instead.
   */
  readonly css: string;
  /** The classes applied together, space-separated as `className` takes them. */
  readonly className: string;
  /** One entry per gradient React Native must parse out of the value. */
  readonly gradients: readonly ("linear-gradient" | "radial-gradient")[];
}

const LINEAR = ["linear-gradient"] as const;
const RADIAL = ["radial-gradient"] as const;

/**
 * Every gradient this file compiles, in one table.
 *
 * The tests above pin each string and each parse exactly; this walks all of them
 * at once to hold the floor beneath them — that React Native answers a gradient
 * at all. `[]` is the failure it guards: React Native reports an unreadable
 * stop, angle or shape by dropping the WHOLE declaration and rendering no
 * background, so a case that compiles to a plausible string and parses to
 * nothing looks exactly like one nobody wrote.
 */
const GRADIENT_CASES: readonly GradientCase[] = [
  {
    css: ".c-default { background-image: linear-gradient(red, blue); }",
    className: "c-default",
    gradients: LINEAR,
  },
  {
    css: ".c-side { background-image: linear-gradient(to right, red, blue); }",
    className: "c-side",
    gradients: LINEAR,
  },
  {
    css: ".c-side-top { background-image: linear-gradient(to top, red, blue); }",
    className: "c-side-top",
    gradients: LINEAR,
  },
  {
    css: ".c-corner { background-image: linear-gradient(to bottom right, red, blue); }",
    className: "c-corner",
    gradients: LINEAR,
  },
  {
    css: ".c-deg { background-image: linear-gradient(45deg, red, blue); }",
    className: "c-deg",
    gradients: LINEAR,
  },
  {
    css: ".c-negdeg { background-image: linear-gradient(-45deg, red, blue); }",
    className: "c-negdeg",
    gradients: LINEAR,
  },
  {
    css: ".c-zerodeg { background-image: linear-gradient(0deg, red, blue); }",
    className: "c-zerodeg",
    gradients: LINEAR,
  },
  {
    css: ".c-rad { background-image: linear-gradient(1.5708rad, red, blue); }",
    className: "c-rad",
    gradients: LINEAR,
  },
  {
    css: ".c-turn { background-image: linear-gradient(0.25turn, red, blue); }",
    className: "c-turn",
    gradients: LINEAR,
  },
  {
    css: ".c-grad { background-image: linear-gradient(100grad, red, blue); }",
    className: "c-grad",
    gradients: LINEAR,
  },
  {
    css: ".c-webkit { background-image: -webkit-linear-gradient(left, red, blue); }",
    className: "c-webkit",
    gradients: LINEAR,
  },
  {
    css: ".c-pct { background-image: linear-gradient(to right, red 0%, green 50%, blue 100%); }",
    className: "c-pct",
    gradients: LINEAR,
  },
  {
    css: ".c-px { background-image: linear-gradient(to right, red 0px, blue 100px); }",
    className: "c-px",
    gradients: LINEAR,
  },
  {
    css: ".c-hint { background-image: linear-gradient(red, 20%, blue); }",
    className: "c-hint",
    gradients: LINEAR,
  },
  {
    css: ".c-double { background-image: linear-gradient(red 0% 20%, blue); }",
    className: "c-double",
    gradients: LINEAR,
  },
  {
    css: ".c-alpha { background-image: linear-gradient(to right, rgba(255, 0, 0, 0.5), transparent); }",
    className: "c-alpha",
    gradients: LINEAR,
  },
  {
    css: ".c-current { color: red; background-image: linear-gradient(currentColor, blue); }",
    className: "c-current",
    gradients: LINEAR,
  },
  {
    css: ".c-colorvar { --c-color: red; background-image: linear-gradient(var(--c-color), blue); }",
    className: "c-colorvar",
    gradients: LINEAR,
  },
  {
    css: ".c-two { background-image: linear-gradient(red, blue), linear-gradient(green, yellow); }",
    className: "c-two",
    gradients: ["linear-gradient", "linear-gradient"],
  },
  {
    css: ".c-none-layer { background-image: none, linear-gradient(red, blue); }",
    className: "c-none-layer",
    gradients: LINEAR,
  },
  {
    css: `.c-url-layer { background-image: url("a.png"), linear-gradient(red, blue); }`,
    className: "c-url-layer",
    gradients: LINEAR,
  },
  {
    css: ".c-radial { background-image: radial-gradient(red, blue); }",
    className: "c-radial",
    gradients: RADIAL,
  },
  {
    css: ".c-radial-circle { background-image: radial-gradient(circle at center, red, blue); }",
    className: "c-radial-circle",
    gradients: RADIAL,
  },
  {
    css: ".c-radial-radius { background-image: radial-gradient(circle 50px, red, blue); }",
    className: "c-radial-radius",
    gradients: RADIAL,
  },
  {
    css: ".c-radial-size { background-image: radial-gradient(ellipse 50px 20px, red, blue); }",
    className: "c-radial-size",
    gradients: RADIAL,
  },
  {
    css: ".c-radial-extent { background-image: radial-gradient(closest-side, red, blue); }",
    className: "c-radial-extent",
    gradients: RADIAL,
  },
  {
    css: `
      .c-listvar-owner { --c-list: red, blue; }
      .c-listvar { background-image: linear-gradient(to right, var(--c-list)); }
    `,
    className: "c-listvar-owner c-listvar",
    gradients: LINEAR,
  },
  {
    css: ".c-hatch { -rn-experimental_background-image: linear-gradient(to right, red, blue); }",
    className: "c-hatch",
    gradients: LINEAR,
  },
  {
    css: `
      .c-onevar-owner { --c-one: red 10%; }
      .c-onevar { background-image: linear-gradient(to right, var(--c-one)); }
    `,
    className: "c-onevar-owner c-onevar",
    gradients: LINEAR,
  },
  {
    css: `
      .c-pxvar-owner { --c-px: red 10px; }
      .c-pxvar { background-image: linear-gradient(to right, var(--c-px), blue); }
    `,
    className: "c-pxvar-owner c-pxvar",
    gradients: LINEAR,
  },
  {
    css: `
      .c-manyvar-owner { --c-many: red 0%, green 50%, blue 100%; }
      .c-manyvar { background-image: linear-gradient(to right, var(--c-many)); }
    `,
    className: "c-manyvar-owner c-manyvar",
    gradients: LINEAR,
  },
  {
    css: `
      .c-nopre-owner { --c-nopre: red, blue; }
      .c-nopre { background-image: linear-gradient(var(--c-nopre)); }
    `,
    className: "c-nopre-owner c-nopre",
    gradients: LINEAR,
  },
  {
    css: `
      .c-mixvar-owner { --c-mix: red, blue; }
      .c-mixvar { background-image: linear-gradient(to right, var(--c-mix), green); }
    `,
    className: "c-mixvar-owner c-mixvar",
    gradients: LINEAR,
  },
  {
    css: `
      .c-anglevar-owner { --c-angle: 45deg; --c-angle-stops: red, blue; }
      .c-anglevar { background-image: linear-gradient(var(--c-angle), var(--c-angle-stops)); }
    `,
    className: "c-anglevar-owner c-anglevar",
    gradients: LINEAR,
  },
  {
    css: `
      .c-hintvar-owner { --c-hint: red, 20%, blue; }
      .c-hintvar { background-image: linear-gradient(to right, var(--c-hint)); }
    `,
    className: "c-hintvar-owner c-hintvar",
    gradients: LINEAR,
  },
  {
    css: `
      .c-lonehint-owner { --c-lone: 20%; }
      .c-lonehint { background-image: linear-gradient(red, var(--c-lone), blue); }
    `,
    className: "c-lonehint-owner c-lonehint",
    gradients: LINEAR,
  },
  {
    css: `
      .c-radvar-owner { --c-shape: circle at center; --c-rad-stops: red, blue; }
      .c-radvar { background-image: radial-gradient(var(--c-shape), var(--c-rad-stops)); }
    `,
    className: "c-radvar-owner c-radvar",
    gradients: RADIAL,
  },
  {
    css: ".c-hatch-radial { -rn-experimental_background-image: radial-gradient(red, blue); }",
    className: "c-hatch-radial",
    gradients: RADIAL,
  },
];

test("every gradient in this file parses into gradients with colour stops", () => {
  registerCSS(GRADIENT_CASES.map(({ css }) => css).join("\n"));

  for (const { className, gradients } of GRADIENT_CASES) {
    const parsed = processBackgroundImage(backgroundImageOf(className));

    // `className` rides inside the assertion so a failure names the case rather
    // than an index, and the stop count comes along because a gradient with no
    // stops paints nothing either.
    expect({
      className,
      gradients: parsed.map(({ type }) => type),
      stopCounts: parsed.map(({ colorStops }) => colorStops.length > 0),
    }).toStrictEqual({
      className,
      gradients,
      stopCounts: gradients.map(() => true),
    });
  }
});

/*****************************************************************************
 * 6. The escape hatch that also reaches a renderable gradient
 ****************************************************************************/

describe("-rn-experimental_background-image", () => {
  // `toRNProperty` strips `-rn-` and camelCases what is left, and the
  // underscore survives — `-rn-experimental_background-image` is the one
  // spelling that lands on React Native's `experimental_backgroundImage` key.
  // The value goes through `parseUnparsed`, which has explicit cases for
  // `linear-gradient` and `radial-gradient` ("React Native requires the '-' in
  // their name"), so it reaches the same runtime resolver the CSS property does
  // and produces the same `string` half of React Native's contract.
  test("the hatch emits a plain string React Native can parse", () => {
    registerCSS(`
      .hatch-linear { -rn-experimental_background-image: linear-gradient(to right, #f00, #00f); }
    `);

    const style = styleOfView("hatch-linear");

    // lightningcss minifies each colour to its shortest spelling, so the `#f00`
    // written above comes back as `red`.
    expect(style).toStrictEqual({
      experimental_backgroundImage: "linear-gradient(to right, red, #00f)",
    });
    expect(
      processBackgroundImage(style?.experimental_backgroundImage),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 90 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  test("the hatch reaches radial-gradient, as the CSS property does", () => {
    registerCSS(`
      .hatch-radial { -rn-experimental_background-image: radial-gradient(#f00, #00f); }
    `);

    const style = styleOfView("hatch-radial");

    expect(style).toStrictEqual({
      experimental_backgroundImage: "radial-gradient(red, #00f)",
    });
    expect(
      processBackgroundImage(style?.experimental_backgroundImage),
    ).toStrictEqual([
      {
        type: "radial-gradient",
        shape: "ellipse",
        size: "farthest-corner",
        position: { top: "50%", left: "50%" },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  test("the camelCased spelling produces a key React Native ignores", () => {
    // `-rn-experimental-background-image` camelCases the whole tail, so it
    // lands on `experimentalBackgroundImage` — not a React Native style key.
    registerCSS(`
      .hatch-wrong { -rn-experimental-background-image: linear-gradient(#f00, #00f); }
    `);

    expect(styleOfView("hatch-wrong")).toStrictEqual({
      experimentalBackgroundImage: "linear-gradient(red, #00f)",
    });
  });
});

/*****************************************************************************
 * 7. The other background longhands, and the shorthand
 ****************************************************************************/

describe("background longhands", () => {
  test("background-color is the one longhand that maps to a style key", () => {
    registerCSS(`.bg-color { background-color: red; }`);

    expect(styleOfView("bg-color")).toStrictEqual({ backgroundColor: "#f00" });
  });

  // GAP (partial): `background-size: cover` / `contain` name the same two
  // fits React Native exposes as `objectFit` / `resizeMode` on `<Image>`.
  // Nothing routes them, and the length form (`100px 50px`) has no React
  // Native equivalent at all.
  test("background-size warns and produces nothing", () => {
    const compiled = registerCSS(`
      .bg-size-cover { background-size: cover; }
      .bg-size-len { background-size: 100px 50px; }
    `);

    expect(styleOfView("bg-size-cover")).toBeUndefined();
    expect(styleOfView("bg-size-len")).toBeUndefined();
    expect(compiled.warnings()).toStrictEqual({
      properties: ["background-size", "background-size"],
    });
  });

  // GAP (partial): `background-repeat: repeat` names the same behaviour React
  // Native exposes as the `repeat` value of `resizeMode` (ImageStyle) — but
  // only on `<Image>`, never on a `<View>` background.
  test("background-repeat warns and produces nothing", () => {
    const compiled = registerCSS(
      `.bg-repeat { background-repeat: no-repeat; }`,
    );

    expect(styleOfView("bg-repeat")).toBeUndefined();
    expect(compiled.warnings()).toStrictEqual({
      properties: ["background-repeat"],
    });
  });

  test("background-position warns and produces nothing", () => {
    const compiled = registerCSS(
      `.bg-position { background-position: center; }`,
    );

    expect(styleOfView("bg-position")).toBeUndefined();
    expect(compiled.warnings()).toStrictEqual({
      properties: ["background-position"],
    });
  });

  test("background-clip, -origin and -attachment warn and produce nothing", () => {
    // No React Native equivalent exists for any of the three, so warning is
    // the correct outcome.
    const compiled = registerCSS(`
      .bg-clip { background-clip: padding-box; }
      .bg-origin { background-origin: content-box; }
      .bg-attachment { background-attachment: fixed; }
    `);

    expect(styleOfView("bg-clip")).toBeUndefined();
    expect(styleOfView("bg-origin")).toBeUndefined();
    expect(styleOfView("bg-attachment")).toBeUndefined();
    expect(compiled.warnings()).toStrictEqual({
      properties: [
        "background-clip",
        "background-origin",
        "background-attachment",
      ],
    });
  });

  test("background-blend-mode warns and produces nothing", () => {
    // React Native has `mixBlendMode` in ViewStyle, but that is
    // `mix-blend-mode`; there is no per-background-layer blend equivalent.
    const compiled = registerCSS(
      `.bg-blend { background-blend-mode: multiply; }`,
    );

    expect(styleOfView("bg-blend")).toBeUndefined();
    expect(compiled.warnings()).toStrictEqual({
      properties: ["background-blend-mode"],
    });
  });

  // GAP: the `background` shorthand is rejected whole, so even
  // `background: red` — whose only component is a colour React Native fully
  // supports as `backgroundColor` — produces nothing. The shorthand is the
  // spelling most CSS is written in, and `background-color` already works, so
  // splitting the colour component out of it is reachable today.
  test("the background shorthand is rejected whole, colour included", () => {
    const compiled = registerCSS(`
      .bg-short-color { background: red; }
      .bg-short-grad { background: linear-gradient(red, blue); }
      .bg-short-full { background: linear-gradient(red, blue) no-repeat center / cover; }
    `);

    expect(styleOfView("bg-short-color")).toBeUndefined();
    expect(styleOfView("bg-short-grad")).toBeUndefined();
    expect(styleOfView("bg-short-full")).toBeUndefined();
    expect(compiled.warnings()).toStrictEqual({
      properties: ["background", "background", "background"],
    });
  });
});

/*****************************************************************************
 * 8. Image styles — object-fit and object-position go to PROPS
 ****************************************************************************/

describe("object-fit and object-position", () => {
  // GAP: React Native has `objectFit` as a real ImageStyle key and it is in the
  // runtime whitelist (`ReactNativeStyleAttributes.js`: `objectFit: true`).
  // `parseObjectFit` instead registers a mapping to the `contentFit` PROP,
  // which is expo-image's API, so `object-fit` never reaches React Native's own
  // `<Image>`.
  test("object-fit produces both the contentFit prop and the objectFit style key", () => {
    // The `contentFit` PROP is expo-image's API; `objectFit` is React Native's
    // own style key, which nothing used to reach. Both are emitted, because CSS's
    // `fill | contain | cover | none | scale-down` is exactly React Native's
    // `objectFit` union AND exactly expo-image's `ImageContentFit` — so neither
    // consumer sees a value it cannot read.
    registerCSS(`
      .fit-cover { object-fit: cover; }
      .fit-contain { object-fit: contain; }
      .fit-fill { object-fit: fill; }
      .fit-none { object-fit: none; }
      .fit-scaledown { object-fit: scale-down; }
    `);

    for (const [className, expected] of [
      ["fit-cover", "cover"],
      ["fit-contain", "contain"],
      ["fit-fill", "fill"],
      ["fit-none", "none"],
      ["fit-scaledown", "scale-down"],
    ] as const) {
      const props = imagePropsOf(className);
      expect(props.style).toStrictEqual({ objectFit: expected });
      expect(props.contentFit).toBe(expected);
    }
  });

  test("the contentFit prop is emitted on any component, not just an image", () => {
    // GAP: the mapping is declared by the compiler, not by the component, so a
    // `<View>` carrying `object-fit` gets a `contentFit` prop it cannot use.
    // The `objectFit` style key beside it is at least harmless on a View.
    registerCSS(`.fit-on-view { object-fit: contain; }`);

    const props = render(
      <View testID={testID} className="fit-on-view" />,
    ).getByTestId(testID).props;

    expect(props.style).toStrictEqual({ objectFit: "contain" });
    expect(props.contentFit).toBe("contain");
  });

  test("-rn-object-fit reaches React Native's objectFit style key without the prop", () => {
    registerCSS(`.fit-hatch { -rn-object-fit: scale-down; }`);

    expect(imagePropsOf("fit-hatch").style).toStrictEqual({
      objectFit: "scale-down",
    });
  });

  test("the two routes coexist without either winning", () => {
    registerCSS(`.fit-both { object-fit: contain; -rn-object-fit: cover; }`);

    const props = imagePropsOf("fit-both");

    expect(props.style).toStrictEqual({ objectFit: "cover" });
    expect(props.contentFit).toBe("contain");
  });

  // GAP: React Native has no `objectPosition` style key at all, so the prop is
  // the only place this could go — but it is expo-image's `contentPosition`,
  // not anything React Native's own `<Image>` reads.
  test("object-position produces a contentPosition prop, space-joined", () => {
    registerCSS(`
      .pos-center { object-position: center; }
      .pos-len { object-position: 10px 20px; }
      .pos-pct { object-position: 50% 25%; }
      .pos-keyword { object-position: right bottom; }
    `);

    expect(imagePropsOf("pos-center").contentPosition).toBe("center");
    // GAP: the `px` unit is stripped, so a consumer receives `10 20`.
    expect(imagePropsOf("pos-len").contentPosition).toBe("10 20");
    expect(imagePropsOf("pos-pct").contentPosition).toBe("50% 25%");
    expect(imagePropsOf("pos-keyword").contentPosition).toBe("right bottom");
  });
});

/*****************************************************************************
 * 9. The remaining ImageStyle keys
 ****************************************************************************/

describe("ImageStyle keys reachable only through -rn-", () => {
  // GAP: `tint-color`, `overlay-color` and `resize-mode` are not CSS
  // properties, so there is nothing to route — but React Native's `tintColor`
  // is what CSS spells `-webkit-mask` / an SVG `fill` recolour, and
  // `resizeMode` overlaps `object-fit` exactly. Only the escape hatch reaches
  // them, and a stylesheet that names React Native keys is no longer portable
  // CSS.
  test("tintColor, overlayColor and resizeMode are reachable through -rn-", () => {
    registerCSS(`
      .img-tint { -rn-tint-color: red; }
      .img-overlay { -rn-overlay-color: blue; }
      .img-resize { -rn-resize-mode: repeat; }
    `);

    expect(imagePropsOf("img-tint").style).toStrictEqual({ tintColor: "red" });
    expect(imagePropsOf("img-overlay").style).toStrictEqual({
      overlayColor: "blue",
    });
    expect(imagePropsOf("img-resize").style).toStrictEqual({
      resizeMode: "repeat",
    });
  });

  test("the CSS-looking spellings of those keys warn as unknown properties", () => {
    const compiled = registerCSS(`
      .img-tint-css { tint-color: red; }
      .img-resize-css { resize-mode: cover; }
    `);

    expect(imagePropsOf("img-tint-css").style).toBeUndefined();
    expect(imagePropsOf("img-resize-css").style).toBeUndefined();
    expect(compiled.warnings()).toStrictEqual({
      properties: ["tint-color", "resize-mode"],
    });
  });

  // GAP: `resizeMethod` and `blurRadius` are React Native `<Image>` PROPS, not
  // style keys — neither appears in `ReactNativeStyleAttributes.js`. The `-rn-`
  // hatch only ever writes into `style`, so it lands them on a style object
  // React Native drops. There is no `nativeStyleMapping` on
  // `components/Image.tsx` to hoist them to props the way
  // `components/ImageBackground.tsx` hoists `backgroundColor`.
  test("resizeMethod and blurRadius land in style, where React Native ignores them", () => {
    registerCSS(`
      .img-method { -rn-resize-method: resize; }
      .img-blurradius { -rn-blur-radius: 4; }
    `);

    expect(imagePropsOf("img-method").style).toStrictEqual({
      resizeMethod: "resize",
    });
    expect(imagePropsOf("img-method").resizeMethod).toBeUndefined();

    expect(imagePropsOf("img-blurradius").style).toStrictEqual({
      blurRadius: 4,
    });
    expect(imagePropsOf("img-blurradius").blurRadius).toBeUndefined();
  });

  // `filter: blur()` is the CSS route to a blurred image. It compiles to the
  // `filter` style key, which React Native's whitelist accepts on any host
  // view — so this works, and `<Image>`'s dedicated `blurRadius` prop is not
  // needed for it. (React Native's `ImageStyle` TypeScript interface does not
  // declare `filter`; the runtime whitelist does.)
  test("filter: blur() reaches the filter style key on an Image", () => {
    registerCSS(`
      .img-blur { filter: blur(4px); }
      .img-blur-multi { filter: blur(2px) grayscale(50%); }
    `);

    expect(imagePropsOf("img-blur").style).toStrictEqual({
      filter: [{ blur: 4 }],
    });
    expect(imagePropsOf("img-blur-multi").style).toStrictEqual({
      filter: [{ blur: 2 }, { grayscale: "50%" }],
    });
  });
});

/*****************************************************************************
 * 10. <ImageBackground> — two style surfaces, one className
 ****************************************************************************/

describe("ImageBackground", () => {
  // `components/ImageBackground.tsx` declares
  // `nativeStyleMapping: { backgroundColor: true }`, which DELETES
  // `backgroundColor` from the style object and re-emits it as a top-level
  // prop.
  //
  // GAP: React Native's `ImageBackgroundProps` has no `backgroundColor` prop.
  // `ImageBackground.js` puts `style` on the outer `<View>` and spreads every
  // remaining prop onto the inner `<Image>`, so the hoisted `backgroundColor`
  // lands on the image layer — the one place a background colour cannot sit
  // behind the image. Left in the style object it would have been a valid
  // `ViewStyle.backgroundColor` on the container.
  test("background-color is hoisted off the container style onto the inner Image", () => {
    registerCSS(
      `.ib-color { background-color: red; width: 10px; height: 20px; }`,
    );

    const tree = render(
      <ImageBackground className="ib-color" source={{ uri: "x.png" }} />,
    ).toJSON();

    expect(tree).toMatchObject({
      type: "View",
      props: { style: { width: 10, height: 20 } },
      children: [
        {
          type: "Image",
          props: { backgroundColor: "#f00" },
        },
      ],
    });
  });

  test("every other style key stays on the container View", () => {
    registerCSS(`.ib-grad { background-image: linear-gradient(red, blue); }`);

    const tree = render(
      <ImageBackground className="ib-grad" source={{ uri: "x.png" }} />,
    ).toJSON();

    expect(tree).toMatchObject({
      type: "View",
      props: {
        style: {
          experimental_backgroundImage:
            "linear-gradient(to bottom, #f00, #00f)",
        },
      },
    });
    // The container is a host `<View>`, so the value it carries goes through
    // `processBackgroundImage` exactly as it does on a plain `<View>`.
    expect(
      processBackgroundImage("linear-gradient(to bottom, #f00, #00f)"),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 180 },
        colorStops: [
          { color: RED, position: null },
          { color: BLUE, position: null },
        ],
      },
    ]);
  });

  // GAP: `ImageBackgroundProps.imageStyle` is a second, Image-only style
  // surface — it is where `tintColor`, `resizeMode` and the rest of
  // `ImageStyle` have to go to affect the image rather than the container.
  // `className` only targets `style`, and no second mapping key exposes
  // `imageStyle`, so an Image-only style lands on the container `<View>`
  // instead, where React Native drops it.
  test("Image-only styles land on the container View, not on imageStyle", () => {
    registerCSS(`.ib-tint { -rn-tint-color: red; object-fit: contain; }`);

    const tree = render(
      <ImageBackground className="ib-tint" source={{ uri: "x.png" }} />,
    ).toJSON();

    expect(tree).toMatchObject({
      type: "View",
      props: { style: { tintColor: "red" } },
      children: [
        {
          type: "Image",
          // The prop-routed half does reach the Image, because props are
          // spread; the style-routed half does not.
          props: { contentFit: "contain" },
        },
      ],
    });
  });
});

/*****************************************************************************
 * 11. Neighbouring image properties with no React Native equivalent
 ****************************************************************************/

test("mask-image, image-rendering and shape-outside warn and produce nothing", () => {
  // None of the three has a React Native style key, so warning is correct.
  const compiled = registerCSS(`
    .misc-mask { mask-image: linear-gradient(red, blue); }
    .misc-rendering { image-rendering: pixelated; }
    .misc-shape { shape-outside: circle(); }
  `);

  expect(styleOfView("misc-mask")).toBeUndefined();
  expect(styleOfView("misc-rendering")).toBeUndefined();
  expect(styleOfView("misc-shape")).toBeUndefined();
  expect(compiled.warnings()).toStrictEqual({
    properties: ["mask-image", "image-rendering", "shape-outside"],
  });
});
