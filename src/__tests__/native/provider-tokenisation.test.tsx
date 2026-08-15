import { render, screen } from "@testing-library/react-native";
import type { StyleDescriptor } from "react-native-css/compiler";
import { ScrollView } from "react-native-css/components/ScrollView";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import {
  compileWithAutoDebug,
  registerCSS,
  testID,
} from "react-native-css/jest";
// The NATIVE provider, whose value is a `StyleDescriptor`. `react-native-css`
// resolves to the web build under `tsc`, and that one takes `string | number`.
import { VariableContextProvider } from "react-native-css/native-internal";
import processFilter from "react-native/Libraries/StyleSheet/processFilter";
import processTransform from "react-native/Libraries/StyleSheet/processTransform";

import { parseVariableValue } from "../../native/styles/parse-value";

/**
 * What a `VariableContextProvider` value MEANS.
 *
 * A custom property declared in CSS reaches the runtime already broken into
 * component values: lightningcss tokenises `--x: 10px 20px` and the compiler
 * lowers each token, so the descriptor is the list `[10, 20]`. A value supplied
 * through `VariableContextProvider` is CSS source text written in JavaScript,
 * and it is the same declaration by another spelling — so it has to arrive as
 * the same descriptor.
 *
 * The reference for every expectation here is therefore the compiler: what
 * `--x: <value>` compiles to is what `{"--x": "<value>"}` must produce. That is
 * checked property by property by the route-equivalence census
 * (`route-equivalence-census.test.tsx`, the `provider` route); this file pins
 * the boundary itself — the shapes the tokeniser has to get right, and the
 * values it must leave alone.
 *
 * `src/native/styles/parse-value.ts` is the boundary, called from the two
 * places a JavaScript-authored variable enters the system:
 * `VariableContextProvider` (`src/native-internal/variables.tsx`) and the
 * deprecated `vars()` (`src/native/api.tsx`).
 */

/** The style a declaration renders when its variable comes from the provider. */
function provided(
  css: string,
  className: string,
  value: StyleDescriptor,
  surface: "view" | "text" = "view",
): Record<string, unknown> | undefined {
  registerCSS(css);

  const element = (
    <VariableContextProvider value={{ "--p": value }}>
      {surface === "text" ? (
        <Text testID={testID} className={className} />
      ) : (
        <View testID={testID} className={className} />
      )}
    </VariableContextProvider>
  );

  return render(element).getByTestId(testID).props.style as
    | Record<string, unknown>
    | undefined;
}

/** The same declaration with the value written out in the stylesheet. */
function literal(
  css: string,
  className: string,
): Record<string, unknown> | undefined {
  registerCSS(css);

  return render(<View testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style as Record<string, unknown> | undefined;
}

/**
 * The resolved animation/transition config, which never reaches `props.style`.
 *
 * `contentContainerStyle` is not the prop reanimated filters, so a ScrollView is
 * the one public window onto the object react-native-css computed.
 */
function providedAnimationConfig(
  css: string,
  className: string,
  value: StyleDescriptor,
): Record<string, unknown> | undefined {
  registerCSS(css);

  render(
    <VariableContextProvider value={{ "--p": value }}>
      <ScrollView testID={testID} contentContainerClassName={className} />
    </VariableContextProvider>,
  );

  return screen.getByTestId(testID).props.contentContainerStyle as
    | Record<string, unknown>
    | undefined;
}

/* -------------------------------------------------------------------------
 * A multi-value shorthand is a LIST, not one opaque string
 * ---------------------------------------------------------------------- */

test("a two-value box shorthand expands to its longhands", () => {
  expect(
    provided(`.pt-margin { margin: var(--p); }`, "pt-margin", "10px 20px"),
  ).toStrictEqual({
    marginTop: 10,
    marginRight: 20,
    marginBottom: 10,
    marginLeft: 20,
  });
});

test("`flex-flow` splits into direction and wrap", () => {
  expect(
    provided(`.pt-flow { flex-flow: var(--p); }`, "pt-flow", "row wrap"),
  ).toStrictEqual({ flexDirection: "row", flexWrap: "wrap" });
});

test("`flex` expands to grow, shrink and basis", () => {
  expect(
    provided(`.pt-flex { flex: var(--p); }`, "pt-flex", "1 1 0%"),
  ).toStrictEqual({ flexGrow: 1, flexShrink: 1, flexBasis: "0%" });
});

test("`border` expands to its three renderable longhands", () => {
  expect(
    provided(`.pt-border { border: var(--p); }`, "pt-border", "1px solid red"),
  ).toStrictEqual({
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "red",
  });
});

test("`place-content` gives each axis its own keyword", () => {
  expect(
    provided(
      `.pt-place { place-content: var(--p); }`,
      "pt-place",
      "center space-between",
    ),
  ).toStrictEqual({
    alignContent: "center",
    justifyContent: "space-between",
  });
});

test("`margin-inline` keeps `auto` beside a length", () => {
  expect(
    provided(`.pt-mi { margin-inline: var(--p); }`, "pt-mi", "12px auto"),
  ).toStrictEqual({ marginInlineStart: 12, marginInlineEnd: "auto" });
});

/* -------------------------------------------------------------------------
 * A numeric token is a NUMBER, whether or not it carries a unit
 * ---------------------------------------------------------------------- */

test("a unitless numeric string becomes a number", () => {
  // React Native types `flexGrow`/`zIndex`/`opacity` as numbers and runs no
  // processor over them, so a string reaches the native side unconverted.
  expect(
    provided(`.pt-grow { flex-grow: var(--p); }`, "pt-grow", "2"),
  ).toStrictEqual({ flexGrow: 2 });

  expect(provided(`.pt-z { z-index: var(--p); }`, "pt-z", "10")).toStrictEqual({
    zIndex: 10,
  });

  expect(
    provided(`.pt-opacity { opacity: var(--p); }`, "pt-opacity", "0.5"),
  ).toStrictEqual({ opacity: 0.5 });
});

test("a percentage stays the string React Native reads", () => {
  expect(
    provided(`.pt-pct { width: var(--p); }`, "pt-pct", "50%"),
  ).toStrictEqual({ width: "50%" });
});

/* -------------------------------------------------------------------------
 * Values React Native THROWS on, rather than ignoring
 * ---------------------------------------------------------------------- */

test("`scale` and `translate` produce transforms React Native accepts", () => {
  const scale = provided(`.pt-scale { scale: var(--p); }`, "pt-scale", "2 3");
  const translate = provided(
    `.pt-translate { translate: var(--p); }`,
    "pt-translate",
    "10px 20px",
  );

  expect(scale).toStrictEqual({ transform: [{ scaleX: 2 }, { scaleY: 3 }] });
  expect(translate).toStrictEqual({
    transform: [{ translateX: 10 }, { translateY: 20 }],
  });

  // The assertion that matters: `processTransform` throws out of render on a
  // transform whose component is not a number — it does not drop the style — so
  // an untokenised `{scale: "2 3"}` unmounts the tree.
  expect(() => processTransform(scale?.transform)).not.toThrow();
  expect(() => processTransform(translate?.transform)).not.toThrow();
});

test("a transform list keeps every function", () => {
  expect(
    provided(
      `.pt-transform { transform: var(--p); }`,
      "pt-transform",
      "translateX(10px) scale(2)",
    ),
  ).toStrictEqual({ transform: [{ translateX: 10 }, { scale: 2 }] });
});

test("`transform-origin` reaches React Native's three-value form", () => {
  expect(
    provided(
      `.pt-origin { transform-origin: var(--p); }`,
      "pt-origin",
      "left top 30px",
    ),
  ).toStrictEqual({ transformOrigin: ["0%", "0%", 30] });
});

test("`animation-iteration-count` is a number reanimated accepts", () => {
  // `normalizeIterationCount` (react-native-reanimated
  // `src/css/native/normalization/animation/settings.ts:47`) throws
  // `ReanimatedError: Invalid iteration count "3"` for anything `isNumber`
  // rejects, so the string form is a crash rather than a dropped setting.
  expect(
    providedAnimationConfig(
      `.pt-iter { animation-iteration-count: var(--p); }`,
      "pt-iter",
      "3",
    ),
  ).toStrictEqual({ animationIterationCount: 3 });
});

test("`animation-timing-function` resolves to an easing, not a string", () => {
  // `normalizeTimingFunction` throws on a string it cannot read, so the raw
  // `"cubic-bezier(…)"` is the same class of crash as the iteration count. The
  // reference is the literal route's own easing instance.
  const provider = providedAnimationConfig(
    `.pt-timing { animation-timing-function: var(--p); }`,
    "pt-timing",
    "cubic-bezier(0.25, 0.5, 0.75, 1)",
  );

  registerCSS(
    `.pt-timing-l { animation-timing-function: cubic-bezier(0.25, 0.5, 0.75, 1); }`,
  );
  render(
    <ScrollView testID={testID} contentContainerClassName="pt-timing-l" />,
  );

  expect(provider).toStrictEqual(
    screen.getByTestId(testID).props.contentContainerStyle,
  );
  expect(provider).toEqual({
    animationTimingFunction: { x1: 0.25, y1: 0.5, x2: 0.75, y2: 1 },
  });
});

/* -------------------------------------------------------------------------
 * What must NOT be split
 * ---------------------------------------------------------------------- */

test("a function keeps its arguments, commas and all", () => {
  expect(
    provided(
      `.pt-rgb { background-color: var(--p); }`,
      "pt-rgb",
      "rgb(1, 2, 3)",
    ),
  ).toStrictEqual({ backgroundColor: "rgb(1, 2, 3)" });
});

test("a quoted string is one token", () => {
  expect(
    provided(
      `.pt-quoted { font-family: var(--p); }`,
      "pt-quoted",
      '"Helvetica Neue"',
      "text",
    ),
  ).toStrictEqual({ fontFamily: "Helvetica Neue" });
});

test("a ratio keeps its solidus", () => {
  // `reduceParseUnparsed`'s `<ratio>` case: a group of numbers around a `/` is
  // joined back into one string rather than carried as a list.
  expect(
    provided(`.pt-ratio { aspect-ratio: var(--p); }`, "pt-ratio", "16 / 9"),
  ).toStrictEqual({ aspectRatio: "16 / 9" });
});

test("a comma separates groups, exactly as it does at compile time", () => {
  // `--p: Georgia, serif` compiles to the two-group list `["Georgia", "serif"]`
  // — the descriptor asserted in the compiler-parity table below. React Native's
  // `fontFamily` holds ONE family, and the runtime `font-family` resolver
  // narrows the list to its first entry, so both spellings of the declaration
  // land on the same rendered value.
  expect(
    provided(
      `.pt-stack { font-family: var(--p); }`,
      "pt-stack",
      "Georgia, serif",
      "text",
    ),
  ).toStrictEqual({ fontFamily: "Georgia" });

  expect(
    literal(
      `:root { --pt-stack-d: Georgia, serif; }
       @media (prefers-color-scheme: dark) { :root { --pt-stack-d: Verdana, sans-serif; } }
       .pt-stack-d { font-family: var(--pt-stack-d); }`,
      "pt-stack-d",
    ),
  ).toStrictEqual({ fontFamily: "Georgia" });
});

test("a nested var() resolves through the provider", () => {
  expect(
    provided(
      `.pt-nested { --pt-q: 5px; width: var(--p); }`,
      "pt-nested",
      "var(--pt-q)",
    ),
  ).toStrictEqual({ width: 5 });
});

test("a var() fallback inside a provider value is used", () => {
  expect(
    provided(
      `.pt-nested-fb { width: var(--p); }`,
      "pt-nested-fb",
      "var(--pt-never-declared, 7px)",
    ),
  ).toStrictEqual({ width: 7 });
});

/* -------------------------------------------------------------------------
 * The boundary itself, against the compiler
 * ---------------------------------------------------------------------- */

/** What the compiler makes of `--x: <value>`, read out of the stylesheet. */
function compiledVariable(value: string): StyleDescriptor {
  return compileWithAutoDebug(`.probe { --x: ${value}; }`).stylesheet()
    .s?.[0]?.[1][0]?.v?.[0]?.[1];
}

test("the tokeniser produces the descriptor the compiler produces", () => {
  // The whole contract in one assertion per value, measured against the
  // compiler rather than transcribed from it — a hand-written expectation here
  // would be a second copy of `parseUnparsed`'s behaviour and would drift from
  // it silently, which is the failure this boundary exists to remove.
  //
  // `vars()` and `VariableContextProvider` both call `parseVariableValue`, so
  // this is the shared half of both channels.
  const values = [
    "10px 20px",
    "row wrap",
    "2",
    "0.5",
    "1 1 0%",
    "1px solid red",
    "center space-between",
    "16 / 9",
    "left top 30px",
    "2 3",
    "underline line-through",
    "italic 12px/30px Georgia",
    "Georgia, serif",
    '"Helvetica Neue"',
    "cubic-bezier(0.25, 0.5, 0.75, 1)",
    "steps(4, end)",
    "translateX(10px) scale(2)",
    "blur(4px) brightness(0.5)",
    "1.5s",
    "200ms",
    "0.25turn",
    "45deg",
    "12pt",
    "1em",
    "50%",
    "auto",
    "none",
    "linear-gradient(to right, #123456 0%, #654321 100%)",
  ];

  expect(
    values.map((value) => [value, parseVariableValue(value)] as const),
  ).toStrictEqual(
    values.map((value) => [value, compiledVariable(value)] as const),
  );
});

test("a `px` length keeps its unit on both sides of the boundary", () => {
  // The suffix is what carries the UNIT. Lowering `22px` to the number `22`
  // makes it indistinguishable from the ratio `22`, so a `--leading: 22px` used
  // in a `line-height` reads as twenty-two font sizes. Keeping it carries the
  // unit to `resolveDimension`, the one reader that asks what a value MEANS
  // rather than what it is worth; every other reader goes through `resolveValue`
  // and gets the number.
  expect(parseVariableValue("10px 20px")).toStrictEqual(["10px", "20px"]);
  expect(compiledVariable("10px 20px")).toStrictEqual(["10px", "20px"]);

  registerCSS(`.pt-lh { font-size: 17px; line-height: var(--p); }`);
  expect(
    render(
      <VariableContextProvider value={{ "--p": "22px" }}>
        <Text testID={testID} className="pt-lh" />
      </VariableContextProvider>,
    ).getByTestId(testID).props.style,
  ).toStrictEqual({ fontSize: 17, lineHeight: 22 });

  // The absolute units fold into the same representation.
  expect(parseVariableValue("12pt")).toBe("16px");
  expect(compiledVariable("12pt")).toBe("16px");
});

test("a math function's arguments keep their unit on both routes", () => {
  // A term of a stored `calc()` is a stored length like any other, so it carries
  // its unit for the same reason the value around it does: a unit-sensitive
  // reader has to be able to tell a `calc()` worth ten PIXELS from one worth the
  // ratio ten. `classifyNumeric` keeps the suffix on every numeric token of a
  // provider-supplied value, and `asDeclaredLength` now reaches inside a math
  // function under the same `ValueUse` the value around it carries — so one
  // declaration reaches one resolver in one shape.
  expect(parseVariableValue("min(10px, 20px)")).toStrictEqual([
    {},
    "min",
    ["10px", "20px"],
  ]);
  expect(compiledVariable("min(10px, 20px)")).toStrictEqual([
    {},
    "min",
    ["10px", "20px"],
  ]);

  expect(parseVariableValue("calc(100% - 10px)")).toStrictEqual([
    {},
    "calc",
    ["100%", "-", "10px"],
  ]);
  expect(compiledVariable("calc(100% - 10px)")).toStrictEqual([
    {},
    "calc",
    ["100%", "-", "10px"],
  ]);

  // The arithmetic reads either shape as the same number, so the rendered value
  // is what it always was on both routes.
  expect(
    provided(`.pt-min { width: var(--p); }`, "pt-min", "min(10px, 20px)"),
  ).toStrictEqual({ width: 10 });
  expect(
    literal(
      `:root { --pt-min-d: min(10px, 20px); }
       @media (prefers-color-scheme: dark) { :root { --pt-min-d: min(1px, 2px); } }
       .pt-min-d { width: var(--pt-min-d); }`,
      "pt-min-d",
    ),
  ).toStrictEqual({ width: 10 });
});

test("`rem` is the one unit kept as a function rather than folded", () => {
  // The compiler folds `rem` at build time against its `inlineRem` option,
  // which has no runtime equivalent. The function form defers the same
  // multiplication to `--__rn-css-rem`, which `src/native-internal/root.ts`
  // seeds to the 14 that option defaults to — so the two agree on the rendered
  // number, and this one tracks a root font size the stylesheet sets.
  expect(parseVariableValue("2rem")).toStrictEqual([{}, "rem", 2]);
  expect(compiledVariable("2rem")).toBe("28px");
  expect(
    provided(`.pt-rem-eq { width: var(--p); }`, "pt-rem-eq", "2rem"),
  ).toStrictEqual({ width: 28 });
});

test("a value that is already a descriptor is handed back unchanged", () => {
  const list: StyleDescriptor = [10, 20];
  const styleFunction: StyleDescriptor = [{}, "em", 2, 1];

  expect(parseVariableValue(list)).toBe(list);
  expect(parseVariableValue(styleFunction)).toBe(styleFunction);
  expect(parseVariableValue(88)).toBe(88);
  expect(parseVariableValue(true)).toBe(true);
  expect(parseVariableValue(undefined)).toBeUndefined();
});

/* -------------------------------------------------------------------------
 * Already a descriptor — tokenising is a no-op
 * ---------------------------------------------------------------------- */

test("a descriptor list passes through untouched", () => {
  expect(
    provided(`.pt-list { margin: var(--p); }`, "pt-list", [10, 20]),
  ).toStrictEqual({
    marginTop: 10,
    marginRight: 20,
    marginBottom: 10,
    marginLeft: 20,
  });
});

test("a number passes through untouched", () => {
  expect(
    provided(`.pt-number { width: var(--p); }`, "pt-number", 88),
  ).toStrictEqual({ width: 88 });
});

test("a style function passes through untouched", () => {
  expect(
    provided(`.pt-fn { width: var(--p); }`, "pt-fn", [{}, "em", 2, 1]),
  ).toStrictEqual({ width: 28 });
});

test("a single keyword is still a keyword", () => {
  expect(
    provided(`.pt-keyword { position: var(--p); }`, "pt-keyword", "absolute"),
  ).toStrictEqual({ position: "absolute" });
});

test("a px length is still a number", () => {
  expect(
    provided(`.pt-px { width: var(--p); }`, "pt-px", "12px"),
  ).toStrictEqual({ width: 12 });
});

/* -------------------------------------------------------------------------
 * Units the compiler folds, folded the same way
 * ---------------------------------------------------------------------- */

test("the units a custom property can carry resolve as the compiler resolves them", () => {
  expect(
    provided(`.pt-rem { width: var(--p); }`, "pt-rem", "2rem"),
  ).toStrictEqual({ width: 28 });
  expect(
    provided(`.pt-pt { width: var(--p); }`, "pt-pt", "12pt"),
  ).toStrictEqual({ width: 16 });
  expect(
    provided(`.pt-turn { rotate: var(--p); }`, "pt-turn", "0.25turn"),
  ).toStrictEqual({ transform: [{ rotate: "90deg" }] });
});

test("a time is milliseconds", () => {
  expect(
    providedAnimationConfig(
      `.pt-delay { animation-delay: var(--p); }`,
      "pt-delay",
      "1.5s",
    ),
  ).toStrictEqual({ animationDelay: 1500 });
});

/* -------------------------------------------------------------------------
 * `varResolver` resolves a fallback ONCE
 * ---------------------------------------------------------------------- */

test("a var() fallback that is itself a list is not resolved twice", () => {
  // `varResolver` reads `[name, fallback]` as one argument list. Resolving that
  // list up front turns the fallback into a VALUE, and resolving a value again
  // is not idempotent: a resolved `filter` list is an array of objects, which
  // `resolveValue` reads as a style function whose name is the object
  // `{brightness: 0.5}` — a name no resolver answers, so it warns and drops the
  // whole declaration.
  const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

  try {
    const fallback = literal(
      `.pt-fb-filter { filter: var(--pt-fb-missing, blur(4px) brightness(0.5)); }`,
      "pt-fb-filter",
    );
    const deferred = literal(
      `:root { --pt-fb: blur(4px) brightness(0.5); }
       @media (prefers-color-scheme: dark) { :root { --pt-fb: grayscale(1); } }
       .pt-fb-deferred { filter: var(--pt-fb); }`,
      "pt-fb-deferred",
    );

    expect(warn).not.toHaveBeenCalled();

    // The fallback route carries the same value as the variable route, which is
    // the claim: a fallback is resolved once, like any other source.
    expect(fallback).toStrictEqual(deferred);
    expect(fallback).toStrictEqual({
      filter: [{ blur: 4 }, { brightness: 0.5 }],
    });
  } finally {
    warn.mockRestore();
  }
});

test("the flat `filter` shape is what React Native can read", () => {
  // Why the flatness above is the requirement rather than a preference. React
  // Native's processor reads `Object.entries(entry)[0]` for every element
  // (`StyleSheet/processFilter.js`), so an extra level of nesting names the
  // first filter `"0"`, finds no amount for it, and applies NONE of the filters.
  expect(processFilter([{ blur: 4 }, { brightness: 0.5 }])).toStrictEqual([
    { blur: 4 },
    { brightness: 0.5 },
  ]);
  expect(processFilter([[{ blur: 4 }, { brightness: 0.5 }]])).toStrictEqual([]);
});
