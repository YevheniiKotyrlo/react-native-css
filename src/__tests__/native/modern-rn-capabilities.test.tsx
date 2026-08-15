import { processColor } from "react-native";

import { render } from "@testing-library/react-native";
import { Image } from "react-native-css/components/Image";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

/**
 * Modern React Native style capabilities, and which of them a CSS author can
 * actually drive.
 *
 * React Native 0.74 → 0.86 grew a large CSS-shaped surface — `filter`,
 * `experimental_backgroundImage` gradients, `boxShadow`, `outline*`,
 * `mixBlendMode`, `isolation`, `boxSizing`, `display: contents`, logical border
 * radii, `pointerEvents` and `cursor` as styles. This suite walks that surface
 * and pins, for each capability, what CSS produces today.
 *
 * The ground truth is React Native's own source, not its documentation:
 * `node_modules/react-native/Libraries/StyleSheet/StyleSheetTypes.d.ts` for the
 * accepted shape of each key, and the `process*` modules the view config runs
 * every value through (`ReactNativeStyleAttributes.js`,
 * `BaseViewConfig.android.js`) for what that shape has to be to survive.
 *
 * Emitting a plausible-looking style object is therefore not the bar. Several
 * tests below take the value this library emits and hand it to the very
 * processor React Native would, because that is the only way to tell a working
 * declaration from one that renders nothing. Jest's native side is mocked, so a
 * value that is fatal on a device looks perfectly healthy in `props.style`.
 *
 * `// GAP:` marks a capability React Native supports that CSS cannot reach. Each
 * one names the React Native style key, the CSS that should produce it, and what
 * is produced instead.
 */

/** React Native's own `filter` processor — the array branch is what runs here. */
const processFilter = jest.requireActual<{
  default: (filter: unknown) => unknown[];
}>("react-native/Libraries/StyleSheet/processFilter").default;

/** React Native's own `experimental_backgroundImage` processor. */
const processBackgroundImage = jest.requireActual<{
  default: (backgroundImage: unknown) => unknown[];
}>("react-native/Libraries/StyleSheet/processBackgroundImage").default;

/** React Native's own `boxShadow` processor. */
const processBoxShadow = jest.requireActual<{
  default: (boxShadow: unknown) => unknown[];
}>("react-native/Libraries/StyleSheet/processBoxShadow").default;

/**
 * The raw `style` prop a class produces — `undefined` when the class compiled
 * to nothing at all, which several declarations below deliberately do.
 */
function styleProp(className: string): Record<string, unknown> | undefined {
  return render(<View testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style as Record<string, unknown> | undefined;
}

/**
 * The style a class produces, for the classes that are expected to produce one.
 * Use `styleProp` when the point of the test is that nothing compiled.
 */
function styleOf(className: string): Record<string, unknown> {
  const style = styleProp(className);
  if (style === undefined) {
    throw new Error(`.${className} compiled to no style at all`);
  }
  return style;
}

/*****************************************************************************
 * 1. `filter` — ViewStyle.filter: ReadonlyArray<FilterFunction> | string
 *
 * `FilterFunction` is a single-key object, and `processFilter` reads that key
 * with `Object.entries(filterFunction)[0]` then switches on it. Any key the
 * switch does not know returns `undefined` from `_getFilterAmount`, and the
 * processor's response to one bad entry is `return []` — every filter in the
 * declaration is thrown away, not just the offending one.
 ****************************************************************************/

test("blur() compiles to the blur filter and survives React Native's processor", () => {
  registerCSS(`.mod-filter-blur { filter: blur(5px); }`);

  const style = styleOf("mod-filter-blur");

  expect(style).toStrictEqual({ filter: [{ blur: 5 }] });
  expect(processFilter(style.filter)).toStrictEqual([{ blur: 5 }]);
});

test("the seven amount filters compile as numbers", () => {
  registerCSS(`
    .mod-filter-amounts {
      filter: brightness(0.5) contrast(2) grayscale(0.8) invert(0.3)
              opacity(0.25) saturate(3) sepia(0.6);
    }
  `);

  const style = styleOf("mod-filter-amounts");

  expect(style).toStrictEqual({
    filter: [
      { brightness: 0.5 },
      { contrast: 2 },
      { grayscale: 0.8 },
      { invert: 0.3 },
      { opacity: 0.25 },
      { saturate: 3 },
      { sepia: 0.6 },
    ],
  });
  expect(processFilter(style.filter)).toStrictEqual(style.filter);
});

// A percentage is forwarded as the string React Native's `_getFilterAmount`
// expects, and divided by 100 there. `100%` is the one that never arrives as a
// string: lightningcss normalises a full-strength percentage to `1` first.
test("percentage amounts reach React Native as strings and are normalised there", () => {
  registerCSS(`
    .mod-filter-pct {
      filter: brightness(150%) contrast(200%) grayscale(80%) invert(50%)
              opacity(25%) saturate(300%) sepia(60%);
    }
    .mod-filter-pct-full { filter: invert(100%) grayscale(100%); }
  `);

  const style = styleOf("mod-filter-pct");

  expect(style).toStrictEqual({
    filter: [
      { brightness: "150%" },
      { contrast: "200%" },
      { grayscale: "80%" },
      { invert: "50%" },
      { opacity: "25%" },
      { saturate: "300%" },
      { sepia: "60%" },
    ],
  });
  expect(processFilter(style.filter)).toStrictEqual([
    { brightness: 1.5 },
    { contrast: 2 },
    { grayscale: 0.8 },
    { invert: 0.5 },
    { opacity: 0.25 },
    { saturate: 3 },
    { sepia: 0.6 },
  ]);

  expect(styleOf("mod-filter-pct-full")).toStrictEqual({
    filter: [{ invert: 1 }, { grayscale: 1 }],
  });
});

test("drop-shadow() compiles to dropShadow and survives React Native's processor", () => {
  registerCSS(`.mod-filter-drop { filter: drop-shadow(0 4px 6px #000); }`);

  const style = styleOf("mod-filter-drop");

  expect(style).toStrictEqual({
    filter: [
      {
        dropShadow: {
          offsetX: 0,
          offsetY: 4,
          standardDeviation: 6,
          color: "#000",
        },
      },
    ],
  });
  expect(processFilter(style.filter)).toStrictEqual([
    {
      dropShadow: {
        offsetX: 0,
        offsetY: 4,
        standardDeviation: 6,
        color: 4278190080,
      },
    },
  ]);
});

// `filter: hue-rotate()` is the one filter function whose CSS and React Native
// spellings differ — `FilterFunction` declares `hueRotate` — so it is the only
// one that needs `toRNProperty`. It used to emit the CSS name verbatim, which
// `processFilter`'s switch has no case for; `_getFilterAmount` returned
// `undefined` and the processor answered by discarding the whole array. The
// `-rn-` escape hatch could not rescue it either, because `filter` takes a list
// of objects rather than a scalar.
test("hue-rotate() emits the key React Native declares", () => {
  registerCSS(`.mod-filter-hue { filter: hue-rotate(90deg); }`);

  const style = styleOf("mod-filter-hue");

  expect(style).toStrictEqual({ filter: [{ hueRotate: "90deg" }] });
  expect(processFilter(style.filter)).toStrictEqual([{ hueRotate: 90 }]);
});

// The same defect used to take every other filter down with it: `processFilter`
// bails on the first entry it cannot read, so one `hue-rotate()` anywhere in the
// list made the entire declaration render nothing — `filter: blur(2px)
// hue-rotate(45deg)` was not "blur, minus the hue rotation", it was no blur
// either.
test("hue-rotate() composes with the other filters in the same declaration", () => {
  registerCSS(`
    .mod-filter-poison { filter: blur(2px) hue-rotate(45deg); }
    .mod-filter-clean { filter: blur(2px) brightness(0.5); }
  `);

  const combined = styleOf("mod-filter-poison");
  expect(combined).toStrictEqual({
    filter: [{ blur: 2 }, { hueRotate: "45deg" }],
  });
  expect(processFilter(combined.filter)).toStrictEqual([
    { blur: 2 },
    { hueRotate: 45 },
  ]);

  // The identical declaration without hue-rotate() keeps both filters.
  const clean = styleOf("mod-filter-clean");
  expect(processFilter(clean.filter)).toStrictEqual([
    { blur: 2 },
    { brightness: 0.5 },
  ]);
});

// `rad` is converted to `deg` at compile time, and now lands under the key
// React Native reads.
test("hue-rotate() in radians converts to degrees", () => {
  registerCSS(`.mod-filter-rad { filter: hue-rotate(1.5708rad); }`);

  const style = styleOf("mod-filter-rad");

  expect(style).toStrictEqual({
    filter: [{ hueRotate: expect.stringMatching(/^90\.\d+deg$/) }],
  });
  expect(processFilter(style.filter)).toStrictEqual([
    { hueRotate: expect.closeTo(90, 2) },
  ]);
});

// `turn` and `grad` are now converted to `deg` the way lightningcss already
// converts `rad`. The filter entry used to be emitted with its value stripped to
// `undefined`, which React Native's `_getFilterAmount` rejects — discarding the
// whole filter list, not just the one function.
test("turn and grad angles reach the filter as degrees", () => {
  const turn = registerCSS(
    `.mod-filter-turn { filter: hue-rotate(0.25turn); }`,
  );

  const style = styleOf("mod-filter-turn");

  expect(style).toStrictEqual({ filter: [{ hueRotate: "90deg" }] });
  expect(turn.warnings()).toStrictEqual({});
  // Fed through React Native's own processor, so "compiles" and "renders" are
  // told apart rather than assumed. `processFilter` normalises the angle to a
  // bare number of degrees; the empty array it used to return is what a
  // rejected value looks like.
  expect(processFilter(style.filter)).toStrictEqual([{ hueRotate: 90 }]);

  const grad = registerCSS(`.mod-filter-grad { filter: hue-rotate(200grad); }`);
  expect(styleOf("mod-filter-grad")).toStrictEqual({
    filter: [{ hueRotate: "180deg" }],
  });
  expect(grad.warnings()).toStrictEqual({});
});

// GAP: an `em` length inside `filter` leaks the library's own unresolved
// runtime descriptor into the style. `rem` resolves at compile time and `px`
// is trivial, but `em` stays a descriptor array even when the same rule sets
// `font-size`, and `_getFilterAmount` rejects a non-string non-number by
// returning `undefined` — so, as with hue-rotate, the whole filter list is
// discarded. No warning is emitted.
test("an em length inside filter() leaks an unresolved descriptor", () => {
  const compiled = registerCSS(`
    .mod-filter-em { font-size: 20px; filter: blur(1em); }
    .mod-filter-rem { filter: blur(1rem); }
  `);

  const style = styleOf("mod-filter-em");

  // `blur` holds a descriptor ARRAY rather than the number React Native needs.
  expect(style).toStrictEqual({
    fontSize: 20,
    filter: [{ blur: expect.any(Array) }],
  });
  expect(processFilter(style.filter)).toStrictEqual([]);
  expect(compiled.warnings()).toStrictEqual({});

  // rem, by contrast, is resolved to a number at compile time.
  expect(styleOf("mod-filter-rem")).toStrictEqual({ filter: [{ blur: 14 }] });
});

// `filter: none` clears the filter properly: the key is emitted holding
// `undefined`, which `processFilter` short-circuits to an empty list. Contrast
// `background-image: none` below, which emits `["none"]` and throws instead.
test("filter: none emits the key holding undefined, which clears the filter", () => {
  registerCSS(`.mod-filter-none { filter: none; }`);

  const style = styleOf("mod-filter-none");

  expect(style).toStrictEqual({ filter: undefined });
  expect(processFilter(style.filter)).toStrictEqual([]);
});

test("filter: url() compiles to an empty list rather than a broken entry", () => {
  registerCSS(`.mod-filter-url { filter: url(#blurry); }`);

  const style = styleOf("mod-filter-url");

  expect(style).toStrictEqual({ filter: [] });
  expect(processFilter(style.filter)).toStrictEqual([]);
});

test("filter applies to Text and Image, not only View", () => {
  registerCSS(`.mod-filter-any { filter: blur(3px); }`);

  expect(
    render(<Text testID={testID} className="mod-filter-any" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ filter: [{ blur: 3 }] });

  expect(
    render(
      <Image
        testID={testID}
        className="mod-filter-any"
        source={{ uri: "x" }}
      />,
    ).getByTestId(testID).props.style,
  ).toStrictEqual({ filter: [{ blur: 3 }] });
});

// GAP: `backdrop-filter` has no route to anything. React Native has no backdrop
// filter style key either, so this is a React Native limit rather than a
// mapping one — recorded because the declaration warns rather than silently
// compiling to `filter`.
test("backdrop-filter is refused outright", () => {
  const compiled = registerCSS(`.mod-backdrop { backdrop-filter: blur(4px); }`);

  expect(styleProp("mod-backdrop")).toBeUndefined();
  expect(compiled.warnings()).toStrictEqual({
    properties: ["backdrop-filter"],
  });
});

/*****************************************************************************
 * 2. Gradients — ViewStyle.experimental_backgroundImage:
 *    ReadonlyArray<GradientValue> | string
 *
 * `GradientValue` is `{ type: 'linear-gradient'; direction?: string;
 * colorStops: { color, positions? }[] }`. The string form is parsed by
 * `parseBackgroundImageCSSString`. Those are the only two shapes
 * `processBackgroundImage` handles, and its array branch reaches straight for
 * `bgImage.colorStops.length` — so an array of STRINGS is neither shape and
 * throws rather than degrading.
 *
 * This library emits the STRING form: one comma-separated CSS value holding
 * every layer, which is what `background-image` is in CSS.
 *
 * Every gradient below is asserted twice — the string, and what
 * `processBackgroundImage` makes of it. React Native reports an unreadable
 * gradient by returning an EMPTY ARRAY, which renders as no background at all,
 * so a value that looks like CSS and parses to `[]` is indistinguishable from a
 * declaration nobody wrote.
 ****************************************************************************/

/** The stop colours, as `processColor` renders them: `0xAARRGGBB`. */
const RED = processColor("red");
const GREEN = processColor("green");
const BLUE = processColor("blue");
const YELLOW = processColor("yellow");
const RED_HALF_ALPHA = processColor("#ff000080");
const TRANSPARENT = processColor("#0000");

/** The compiled `background-image`, ready to hand to React Native's parser. */
function backgroundImageOf(className: string): unknown {
  return styleOf(className).experimental_backgroundImage;
}

test("a linear-gradient compiles to the CSS string React Native parses", () => {
  registerCSS(
    `.mod-gradient-basic { background-image: linear-gradient(red, blue); }`,
  );

  const style = styleOf("mod-gradient-basic");

  expect(style).toStrictEqual({
    experimental_backgroundImage: "linear-gradient(to bottom, #f00, #00f)",
  });
  expect(
    processBackgroundImage(style.experimental_backgroundImage),
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

  // The OBJECT form React Native also accepts, for contrast: the same gradient,
  // and the same parse.
  expect(
    processBackgroundImage([
      {
        type: "linear-gradient",
        direction: "to bottom",
        colorStops: [{ color: "#f00" }, { color: "#00f" }],
      },
    ]),
  ).toStrictEqual(processBackgroundImage(style.experimental_backgroundImage));

  // And the shape that is neither: a LIST of strings, which the array branch
  // takes `.colorStops.length` off.
  expect(() =>
    processBackgroundImage([style.experimental_backgroundImage]),
  ).toThrow(TypeError);
});

// Every gradient feature survives into the string AND back out of React
// Native's parser — the direction keyword, the angle, the stop positions in
// both units, the transition hint, alpha, and `currentcolor` already resolved.
test("direction, angle, positions and hints all survive the round trip", () => {
  registerCSS(`
    .mod-gradient-dir { background-image: linear-gradient(to right, red, blue); }
    .mod-gradient-angle { background-image: linear-gradient(45deg, red, blue); }
    .mod-gradient-corner { background-image: linear-gradient(to bottom right, red, blue); }
    .mod-gradient-stops { background-image: linear-gradient(red 0%, green 50%, blue 100%); }
    .mod-gradient-px { background-image: linear-gradient(red 10px, blue 100px); }
    .mod-gradient-hint { background-image: linear-gradient(red, 20%, blue); }
    .mod-gradient-alpha { background-image: linear-gradient(rgba(255, 0, 0, 0.5), transparent); }
    .mod-gradient-current { color: red; background-image: linear-gradient(currentcolor, blue); }
  `);

  expect(backgroundImageOf("mod-gradient-dir")).toBe(
    "linear-gradient(to right, #f00, #00f)",
  );
  expect(
    processBackgroundImage(backgroundImageOf("mod-gradient-dir")),
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

  expect(backgroundImageOf("mod-gradient-angle")).toBe(
    "linear-gradient(45deg, #f00, #00f)",
  );
  expect(
    processBackgroundImage(backgroundImageOf("mod-gradient-angle")),
  ).toStrictEqual([
    {
      type: "linear-gradient",
      direction: { type: "angle", value: 45 },
      colorStops: [
        { color: RED, position: null },
        { color: BLUE, position: null },
      ],
    },
  ]);

  // A corner is the one direction React Native keeps as a keyword rather than
  // resolving to an angle — it cannot, without the box's aspect ratio. Note it
  // normalises the side order, so the emitted `to right bottom` comes back as
  // `to bottom right`.
  expect(backgroundImageOf("mod-gradient-corner")).toBe(
    "linear-gradient(to right bottom, #f00, #00f)",
  );
  expect(
    processBackgroundImage(backgroundImageOf("mod-gradient-corner")),
  ).toStrictEqual([
    {
      type: "linear-gradient",
      direction: { type: "keyword", value: "to bottom right" },
      colorStops: [
        { color: RED, position: null },
        { color: BLUE, position: null },
      ],
    },
  ]);

  expect(backgroundImageOf("mod-gradient-stops")).toBe(
    "linear-gradient(to bottom, #f00 0%, #008000 50%, #00f 100%)",
  );
  expect(
    processBackgroundImage(backgroundImageOf("mod-gradient-stops")),
  ).toStrictEqual([
    {
      type: "linear-gradient",
      direction: { type: "angle", value: 180 },
      colorStops: [
        { color: RED, position: "0%" },
        { color: GREEN, position: "50%" },
        { color: BLUE, position: "100%" },
      ],
    },
  ]);

  // The `px` on a stop position has to survive the compiler's usual lowering of
  // lengths to bare numbers: `getPositionFromCSSValue` accepts only `px` or `%`,
  // and ONE unreadable stop drops the whole declaration to `[]`.
  expect(backgroundImageOf("mod-gradient-px")).toBe(
    "linear-gradient(to bottom, #f00 10px, #00f 100px)",
  );
  expect(
    processBackgroundImage(backgroundImageOf("mod-gradient-px")),
  ).toStrictEqual([
    {
      type: "linear-gradient",
      direction: { type: "angle", value: 180 },
      colorStops: [
        { color: RED, position: 10 },
        { color: BLUE, position: 100 },
      ],
    },
  ]);

  // A transition hint is a stop of its own — a position with no colour — rather
  // than a position belonging to the stop before it.
  expect(backgroundImageOf("mod-gradient-hint")).toBe(
    "linear-gradient(to bottom, #f00, 20%, #00f)",
  );
  expect(
    processBackgroundImage(backgroundImageOf("mod-gradient-hint")),
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

  expect(backgroundImageOf("mod-gradient-alpha")).toBe(
    "linear-gradient(to bottom, #ff000080, #0000)",
  );
  expect(
    processBackgroundImage(backgroundImageOf("mod-gradient-alpha")),
  ).toStrictEqual([
    {
      type: "linear-gradient",
      direction: { type: "angle", value: 180 },
      colorStops: [
        { color: RED_HALF_ALPHA, position: null },
        { color: TRANSPARENT, position: null },
      ],
    },
  ]);

  expect(backgroundImageOf("mod-gradient-current")).toBe(
    "linear-gradient(to bottom, #f00, #00f)",
  );
  expect(
    processBackgroundImage(backgroundImageOf("mod-gradient-current")),
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

test("multiple comma-separated gradients are one string of two layers", () => {
  registerCSS(`
    .mod-gradient-multi {
      background-image: linear-gradient(red, blue), linear-gradient(green, yellow);
    }
  `);

  expect(backgroundImageOf("mod-gradient-multi")).toBe(
    "linear-gradient(to bottom, #f00, #00f), linear-gradient(to bottom, #008000, #ff0)",
  );
  expect(
    processBackgroundImage(backgroundImageOf("mod-gradient-multi")),
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

// React Native's `processBackgroundImage` has a full `radial-gradient` branch —
// shape, size, position, colour stops. `conic-gradient()` and the `repeating-*`
// family are shared limits rather than mapping gaps: React Native implements
// neither, so they compile to nothing and say so.
test("radial gradients compile; conic and repeating drop with a warning", () => {
  const compiled = registerCSS(`
    .mod-gradient-radial { background-image: radial-gradient(red, blue); }
    .mod-gradient-radial-at { background-image: radial-gradient(circle at center, red, blue); }
    .mod-gradient-conic { background-image: conic-gradient(red, blue); }
    .mod-gradient-repeat { background-image: repeating-linear-gradient(red, blue 20px); }
    .mod-gradient-url { background-image: url(texture.png); }
  `);

  // The shape, size and position are all written out, because React Native's
  // string parser has no defaults of its own to fall back on.
  expect(styleOf("mod-gradient-radial")).toStrictEqual({
    experimental_backgroundImage:
      "radial-gradient(ellipse farthest-corner at center center, #f00, #00f)",
  });
  expect(
    processBackgroundImage(backgroundImageOf("mod-gradient-radial")),
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

  expect(styleOf("mod-gradient-radial-at")).toStrictEqual({
    experimental_backgroundImage:
      "radial-gradient(circle farthest-corner at center center, #f00, #00f)",
  });
  expect(
    processBackgroundImage(backgroundImageOf("mod-gradient-radial-at")),
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

  // The families React Native does not paint are EMITTED anyway, and the
  // assertion below is the reason that is safe: its own parser answers an
  // empty list for them, so the value is inert rather than fatal. Emitting it
  // costs nothing today and starts painting the day the parser learns the
  // function.
  for (const className of ["mod-gradient-conic", "mod-gradient-repeat"]) {
    const emitted = styleProp(className) as {
      experimental_backgroundImage: string;
    };

    expect(typeof emitted.experimental_backgroundImage).toBe("string");
    expect(
      processBackgroundImage(emitted.experimental_backgroundImage),
    ).toStrictEqual([]);
  }

  // `url()` is different in kind and still drops: an image SOURCE is a prop on
  // `<Image>`, never a style key, so there is no faithful style value to emit.
  expect(styleProp("mod-gradient-url")).toBeUndefined();

  // GAP: `url()` is still dropped silently — it is an image SOURCE prop rather
  // than a style key, so it has no gradient family to warn from.
  expect(compiled.warnings()).toStrictEqual({
    values: {
      "background-image": ["conic-gradient()", "repeating-linear-gradient()"],
    },
  });
});

// `deg` is the only angle unit React Native's `LINEAR_GRADIENT_DIRECTION_REGEX`
// matches, so an unconverted `turn` or `grad` would leave the gradient with no
// direction and silently fall back to `to bottom`.
test("turn and grad gradient angles are normalised to degrees", () => {
  const compiled = registerCSS(`
    .mod-gradient-turn { background-image: linear-gradient(0.25turn, red, blue); }
  `);

  expect(backgroundImageOf("mod-gradient-turn")).toBe(
    "linear-gradient(90deg, #f00, #00f)",
  );
  expect(
    processBackgroundImage(backgroundImageOf("mod-gradient-turn")),
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

// GAP: `background: linear-gradient(...)` — the shorthand almost every
// stylesheet actually writes — has no entry in the parser table at all, so the
// gradient never reaches `background-image` in the first place.
test("the background shorthand cannot carry a gradient", () => {
  const compiled = registerCSS(
    `.mod-gradient-shorthand { background: linear-gradient(red, blue); }`,
  );

  expect(styleProp("mod-gradient-shorthand")).toBeUndefined();
  expect(compiled.warnings()).toStrictEqual({ properties: ["background"] });
});

// Two routes that bypass the gradient parser entirely: a value held in a
// runtime variable, and the `-rn-` escape hatch. Both forward the author's own
// text verbatim rather than re-serialising it, so the colour keywords survive
// where the compiled route normalises them to hex. React Native's string parser
// reads either.
test("a runtime variable and the -rn- hatch both emit a string React Native parses", () => {
  registerCSS(
    `.mod-gradient-runtime {
      --grad: linear-gradient(to right, red, blue);
      background-image: var(--grad);
    }`,
    { inlineVariables: false },
  );
  registerCSS(
    `.mod-gradient-hatch {
      -rn-experimental_background-image: linear-gradient(to right, red, blue);
    }`,
  );

  const parsed = [
    {
      type: "linear-gradient",
      direction: { type: "angle", value: 90 },
      colorStops: [
        { color: 4294901760, position: null },
        { color: 4278190335, position: null },
      ],
    },
  ];

  const runtime = styleOf("mod-gradient-runtime");
  expect(runtime).toStrictEqual({
    experimental_backgroundImage: "linear-gradient(to right, red, blue)",
  });
  expect(
    processBackgroundImage(runtime.experimental_backgroundImage),
  ).toStrictEqual(parsed);

  const hatch = styleOf("mod-gradient-hatch");
  expect(hatch).toStrictEqual({
    experimental_backgroundImage: "linear-gradient(to right, red, blue)",
  });
  expect(
    processBackgroundImage(hatch.experimental_backgroundImage),
  ).toStrictEqual(parsed);
});

// `background-image: none` is how a later rule clears a gradient an earlier one
// set, so it has to reach React Native as a value rather than as an absence: the
// key must be present and parse to no layers.
test("background-image: none clears the gradient", () => {
  registerCSS(`.mod-gradient-clear { background-image: none; }`);

  const style = styleOf("mod-gradient-clear");

  expect(style).toStrictEqual({ experimental_backgroundImage: "none" });
  expect(
    processBackgroundImage(style.experimental_backgroundImage),
  ).toStrictEqual([]);
});

/*****************************************************************************
 * 3. `box-shadow` — ViewStyle.boxShadow:
 *    ReadonlyArray<BoxShadowValue> | string
 *
 * The one modern capability that is completely wired up. Every form below is
 * round-tripped through `processBoxShadow` to prove the emitted objects are
 * the shape React Native consumes, not merely the shape it declares.
 ****************************************************************************/

test("offset, blur, spread, inset and multiple shadows all reach React Native", () => {
  registerCSS(`
    .mod-shadow-full { box-shadow: 0 4px 6px -1px #000; }
    .mod-shadow-inset { box-shadow: inset 0 2px 4px 0 #000; }
    .mod-shadow-multi { box-shadow: 0 1px red, inset 0 2px green; }
  `);

  const full = styleOf("mod-shadow-full");
  expect(full).toStrictEqual({
    boxShadow: [
      {
        color: "#000",
        offsetX: 0,
        offsetY: 4,
        blurRadius: 6,
        spreadDistance: -1,
      },
    ],
  });
  expect(processBoxShadow(full.boxShadow)).toStrictEqual([
    {
      offsetX: 0,
      offsetY: 4,
      color: 4278190080,
      blurRadius: 6,
      spreadDistance: -1,
    },
  ]);

  const inset = styleOf("mod-shadow-inset");
  expect(processBoxShadow(inset.boxShadow)).toStrictEqual([
    {
      offsetX: 0,
      offsetY: 2,
      color: 4278190080,
      blurRadius: 4,
      spreadDistance: 0,
      inset: true,
    },
  ]);

  const multi = styleOf("mod-shadow-multi");
  expect(processBoxShadow(multi.boxShadow)).toStrictEqual([
    {
      offsetX: 0,
      offsetY: 1,
      color: 4294901760,
      blurRadius: 0,
      spreadDistance: 0,
    },
    {
      offsetX: 0,
      offsetY: 2,
      color: 4278222848,
      blurRadius: 0,
      spreadDistance: 0,
      inset: true,
    },
  ]);
});

// Unlike `background-image: none`, `box-shadow: none` reaches React Native in a
// shape it handles — the `string` half of the union — and clears the shadow.
test("box-shadow: none reaches React Native as the string form and clears", () => {
  registerCSS(`.mod-shadow-none { box-shadow: none; }`);

  const style = styleOf("mod-shadow-none");

  expect(style).toStrictEqual({ boxShadow: "none" });
  expect(processBoxShadow(style.boxShadow)).toStrictEqual([]);
});

/*****************************************************************************
 * 4. `outline*` — ViewStyle.outlineColor / outlineStyle / outlineWidth /
 *    outlineOffset
 ****************************************************************************/

test("each outline longhand compiles on its own, offsets included", () => {
  registerCSS(`
    .mod-outline-width { outline-width: 3px; }
    .mod-outline-color { outline-color: red; }
    .mod-outline-style { outline-style: dotted; }
    .mod-outline-offset { outline-offset: 4px; }
    .mod-outline-offset-neg { outline-offset: -2px; }
  `);

  expect(styleOf("mod-outline-width")).toStrictEqual({ outlineWidth: 3 });
  expect(styleOf("mod-outline-color")).toStrictEqual({ outlineColor: "#f00" });
  expect(styleOf("mod-outline-style")).toStrictEqual({
    outlineStyle: "dotted",
  });
  expect(styleOf("mod-outline-offset")).toStrictEqual({ outlineOffset: 4 });
  expect(styleOf("mod-outline-offset-neg")).toStrictEqual({
    outlineOffset: -2,
  });
});

// A complete outline — `outlineColor` + `outlineStyle` + `outlineWidth` — used
// to be UNREACHABLE. lightningcss folds all three longhands into the `outline`
// shorthand, `outline` had no parser entry, and the whole set was dropped with
// one unknown-property warning. Writing the shorthand directly failed the same
// way. Any TWO of the three compiled, so it failed in the least predictable
// direction possible: adding the third declaration removed the other two.
test("all three outline longhands together compile, as does the shorthand", () => {
  const triple = registerCSS(`
    .mod-outline-triple {
      outline-color: #123456;
      outline-style: dotted;
      outline-width: 2px;
    }
  `);

  expect(styleOf("mod-outline-triple")).toStrictEqual({
    outlineColor: "#123456",
    outlineStyle: "dotted",
    outlineWidth: 2,
  });
  expect(triple.warnings()).toStrictEqual({});

  const shorthand = registerCSS(
    `.mod-outline-shorthand { outline: 2px solid red; }`,
  );
  expect(styleOf("mod-outline-shorthand")).toStrictEqual({
    outlineColor: "#f00",
    outlineStyle: "solid",
    outlineWidth: 2,
  });
  expect(shorthand.warnings()).toStrictEqual({});

  // ...and two of the three still behave, unchanged.
  registerCSS(`
    .mod-outline-pair { outline-color: #123456; outline-width: 2px; }
  `);
  expect(styleOf("mod-outline-pair")).toStrictEqual({
    outlineColor: "#123456",
    outlineWidth: 2,
  });
});

// `outline-offset` is the one longhand lightningcss does NOT fold into the
// shorthand. It used to be the ONLY part of a complete outline that survived
// being written next to the others — an offset with nothing to offset.
test("outline-offset composes with a folded outline", () => {
  const compiled = registerCSS(`
    .mod-outline-orphan { outline: 2px dashed blue; outline-offset: 2px; }
  `);

  expect(styleOf("mod-outline-orphan")).toStrictEqual({
    outlineColor: "#00f",
    outlineStyle: "dashed",
    outlineWidth: 2,
    outlineOffset: 2,
  });
  expect(compiled.warnings()).toStrictEqual({});
});

// `outline-style: none` and the CSS keyword widths are refused. React Native's
// `outlineStyle` is `'solid' | 'dotted' | 'dashed'` with no `none`, and
// `outlineWidth` is numeric with no keyword scale, so these are shared limits
// rather than mapping gaps — recorded because both warn loudly rather than
// compiling to something surprising.
test("outline-style: none and keyword outline widths warn rather than guess", () => {
  const compiled = registerCSS(`
    .mod-outline-nostyle { outline-style: none; }
    .mod-outline-thin { outline-width: thin; }
    .mod-outline-medium { outline-width: medium; }
    .mod-outline-thick { outline-width: thick; }
  `);

  expect(styleProp("mod-outline-nostyle")).toBeUndefined();
  expect(styleProp("mod-outline-thin")).toBeUndefined();
  expect(styleProp("mod-outline-medium")).toBeUndefined();
  expect(styleProp("mod-outline-thick")).toBeUndefined();
  expect(compiled.warnings()).toStrictEqual({
    values: {
      "outline-style": ["none"],
      "outline-width": ["thin", "medium", "thick"],
    },
  });
});

/*****************************************************************************
 * 5. Logical border radii — borderStartStartRadius and family
 ****************************************************************************/

test("all four logical border radii are reachable from their CSS properties", () => {
  registerCSS(`
    .mod-radius-logical {
      border-start-start-radius: 1px;
      border-start-end-radius: 2px;
      border-end-start-radius: 3px;
      border-end-end-radius: 4px;
    }
  `);

  expect(styleOf("mod-radius-logical")).toStrictEqual({
    borderStartStartRadius: 1,
    borderStartEndRadius: 2,
    borderEndStartRadius: 3,
    borderEndEndRadius: 4,
  });
});

test("logical border radii accept percentages", () => {
  registerCSS(`.mod-radius-pct { border-start-start-radius: 50%; }`);

  expect(styleOf("mod-radius-pct")).toStrictEqual({
    borderStartStartRadius: "50%",
  });
});

test("the border-radius shorthand expands to the physical corners", () => {
  registerCSS(`
    .mod-radius-one { border-radius: 4px; }
    .mod-radius-four { border-radius: 1px 2px 3px 4px; }
  `);

  expect(styleOf("mod-radius-one")).toStrictEqual({ borderRadius: 4 });
  expect(styleOf("mod-radius-four")).toStrictEqual({
    borderTopLeftRadius: 1,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 3,
    borderBottomLeftRadius: 4,
  });
});

/*****************************************************************************
 * 6. `borderCurve`, `boxSizing`, `display: contents`
 ****************************************************************************/

test("borderCurve is reachable from corner-shape's round and squircle keywords", () => {
  registerCSS(`
    .mod-curve-round { corner-shape: round; }
    .mod-curve-squircle { corner-shape: squircle; }
  `);

  expect(styleOf("mod-curve-round")).toStrictEqual({ borderCurve: "circular" });
  expect(styleOf("mod-curve-squircle")).toStrictEqual({
    borderCurve: "continuous",
  });
});

// React Native's `borderCurve` has only the two values, so `bevel`, `scoop`,
// `notch` and `superellipse()` have nowhere to go. They are dropped SILENTLY,
// with no warning — unlike every other unrepresentable value in this file,
// which is the part worth pinning: a stylesheet using them gets no signal.
test("the other corner-shape keywords produce no style, and say so", () => {
  // React Native's `borderCurve` is `'circular' | 'continuous'`, so these four
  // are valid CSS with nowhere to land. Each is reported: the declaration is
  // spelled correctly, so a rule that produced no style and no diagnostic left
  // an author with nothing to look at.
  const compiled = registerCSS(`
    .mod-curve-bevel { corner-shape: bevel; }
    .mod-curve-scoop { corner-shape: scoop; }
    .mod-curve-notch { corner-shape: notch; }
    .mod-curve-super { corner-shape: superellipse(2); }
  `);

  expect(styleProp("mod-curve-bevel")).toBeUndefined();
  expect(styleProp("mod-curve-scoop")).toBeUndefined();
  expect(styleProp("mod-curve-notch")).toBeUndefined();
  expect(styleProp("mod-curve-super")).toBeUndefined();
  expect(compiled.warnings()).toStrictEqual({
    values: {
      "corner-shape": ["bevel", "scoop", "notch", "superellipse()"],
    },
  });
});

test("boxSizing is reachable from box-sizing on View and Text alike", () => {
  registerCSS(`
    .mod-sizing-border { box-sizing: border-box; }
    .mod-sizing-content { box-sizing: content-box; }
  `);

  expect(styleOf("mod-sizing-border")).toStrictEqual({
    boxSizing: "border-box",
  });
  expect(styleOf("mod-sizing-content")).toStrictEqual({
    boxSizing: "content-box",
  });
  expect(
    render(<Text testID={testID} className="mod-sizing-border" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ boxSizing: "border-box" });
});

test("display: contents is reachable", () => {
  registerCSS(`.mod-display-contents { display: contents; }`);

  expect(styleOf("mod-display-contents")).toStrictEqual({
    display: "contents",
  });
});

// React Native's `display` is `'none' | 'flex' | 'contents'`, so the CSS box
// keywords have no target. They warn rather than falling back to `flex`.
test("display: block, inline and grid warn rather than falling back to flex", () => {
  const compiled = registerCSS(`
    .mod-display-block { display: block; }
    .mod-display-inline { display: inline; }
    .mod-display-grid { display: grid; }
  `);

  expect(styleProp("mod-display-block")).toBeUndefined();
  expect(styleProp("mod-display-inline")).toBeUndefined();
  expect(styleProp("mod-display-grid")).toBeUndefined();
  expect(compiled.warnings()).toStrictEqual({
    values: { display: ["block", "inline", "grid"] },
  });
});

/*****************************************************************************
 * 7. `pointerEvents`, `cursor`, `userSelect`, `isolation`, `mixBlendMode`,
 *    `transformOrigin`
 ****************************************************************************/

// `pointerEvents` moved from a prop to a style key; all four React Native
// values are reachable, including `box-none` and `box-only`, which are not CSS
// keywords at all and are passed straight through.
test("pointerEvents as a style key reaches all four React Native values", () => {
  registerCSS(`
    .mod-pe-auto { pointer-events: auto; }
    .mod-pe-none { pointer-events: none; }
    .mod-pe-box-none { pointer-events: box-none; }
    .mod-pe-box-only { pointer-events: box-only; }
  `);

  expect(styleOf("mod-pe-auto")).toStrictEqual({ pointerEvents: "auto" });
  expect(styleOf("mod-pe-none")).toStrictEqual({ pointerEvents: "none" });
  expect(styleOf("mod-pe-box-none")).toStrictEqual({
    pointerEvents: "box-none",
  });
  expect(styleOf("mod-pe-box-only")).toStrictEqual({
    pointerEvents: "box-only",
  });
});

// GAP: `cursor` (ViewStyle, `'auto' | 'pointer'`) has no CSS route. The
// property has no parser entry, so `cursor: pointer` warns as unknown; only the
// `-rn-` escape hatch reaches the style key.
test("cursor is unreachable from CSS and only the -rn- hatch produces it", () => {
  const compiled = registerCSS(`
    .mod-cursor-css { cursor: pointer; }
    .mod-cursor-hatch { -rn-cursor: pointer; }
  `);

  expect(styleProp("mod-cursor-css")).toBeUndefined();
  expect(compiled.warnings()).toStrictEqual({ properties: ["cursor"] });
  expect(styleOf("mod-cursor-hatch")).toStrictEqual({ cursor: "pointer" });
});

test("userSelect reaches all five React Native values", () => {
  registerCSS(`
    .mod-select-auto { user-select: auto; }
    .mod-select-none { user-select: none; }
    .mod-select-text { user-select: text; }
    .mod-select-contain { user-select: contain; }
    .mod-select-all { user-select: all; }
  `);

  expect(styleOf("mod-select-auto")).toStrictEqual({ userSelect: "auto" });
  expect(styleOf("mod-select-none")).toStrictEqual({ userSelect: "none" });
  expect(styleOf("mod-select-text")).toStrictEqual({ userSelect: "text" });
  expect(styleOf("mod-select-contain")).toStrictEqual({
    userSelect: "contain",
  });
  expect(styleOf("mod-select-all")).toStrictEqual({ userSelect: "all" });
});

// Both halves of React Native's `isolation?: 'auto' | 'isolate'` union.
// `auto` is the one that turns isolation back off, which is what the keyword
// exists for, so a rule cannot undo `isolate` without it.
test("isolation reaches both isolate and auto", () => {
  const compiled = registerCSS(`
    .mod-isolation-isolate { isolation: isolate; }
    .mod-isolation-auto { isolation: auto; }
  `);

  expect(styleOf("mod-isolation-isolate")).toStrictEqual({
    isolation: "isolate",
  });
  expect(styleOf("mod-isolation-auto")).toStrictEqual({ isolation: "auto" });
  expect(compiled.warnings()).toStrictEqual({});
});

test("mixBlendMode reaches React Native's blend keywords", () => {
  registerCSS(`
    .mod-blend-normal { mix-blend-mode: normal; }
    .mod-blend-multiply { mix-blend-mode: multiply; }
    .mod-blend-color-dodge { mix-blend-mode: color-dodge; }
    .mod-blend-luminosity { mix-blend-mode: luminosity; }
  `);

  expect(styleOf("mod-blend-normal")).toStrictEqual({ mixBlendMode: "normal" });
  expect(styleOf("mod-blend-multiply")).toStrictEqual({
    mixBlendMode: "multiply",
  });
  expect(styleOf("mod-blend-color-dodge")).toStrictEqual({
    mixBlendMode: "color-dodge",
  });
  expect(styleOf("mod-blend-luminosity")).toStrictEqual({
    mixBlendMode: "luminosity",
  });
});

// `plus-lighter` IS in React Native's `BlendMode` union and in
// `blendModeFromString` (`ReactCommon/react/renderer/graphics/BlendMode.h`); it
// was dropped here by an allow-list that stopped one value short.
// `plus-darker` is the CSS mode React Native genuinely lacks — see
// `spec-conformance.test.tsx`.
test("plus-lighter reaches React Native", () => {
  const compiled = registerCSS(
    `.mod-blend-plus { mix-blend-mode: plus-lighter; }`,
  );

  expect(styleOf("mod-blend-plus")).toStrictEqual({
    mixBlendMode: "plus-lighter",
  });
  expect(compiled.warnings()).toStrictEqual({});
});

test("transformOrigin reaches the two- and three-value forms", () => {
  registerCSS(`
    .mod-origin-two { transform-origin: 10px 20px; }
    .mod-origin-three { transform-origin: 1px 2px 3px; }
  `);

  expect(styleOf("mod-origin-two")).toStrictEqual({
    transformOrigin: [10, 20, 0],
  });
  expect(styleOf("mod-origin-three")).toStrictEqual({
    transformOrigin: [1, 2, 3],
  });
});
