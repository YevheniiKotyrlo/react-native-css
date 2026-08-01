import { processColor } from "react-native";

import { render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import {
  compileWithAutoDebug,
  registerCSS,
  testID,
} from "react-native-css/jest";
import { StyleCollection } from "react-native-css/native";
import { VariableContextProvider } from "react-native-css/runtime";

/**
 * The runtime resolution of a value the compiler could not fold away.
 *
 * Every case here needs a `var()` (or a runtime-supplied variable) to survive
 * into the stylesheet, because that is what selects the runtime resolvers in
 * `native/styles/` over the compile-time parsers in `compiler/declarations.ts`.
 * The two are meant to produce the same style for the same CSS, and each test
 * below names the value the OTHER route produces.
 */

/**
 * CSS for a variable the compiler CANNOT inline.
 *
 * `inlineVariables` only substitutes a variable defined exactly once, so a
 * dark-scheme override — the most ordinary reason a design token is written
 * twice — leaves the `var()` in the declaration for the runtime to resolve.
 */
const twoDefinitions = (name: string, light: string, dark: string) =>
  `:root { ${name}: ${light}; }
   @media (prefers-color-scheme: dark) { :root { ${name}: ${dark}; } }`;

type Style = Record<string, unknown>;

const styleOf = (css: string, className: string): Style => {
  registerCSS(css);

  return render(<Text testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style as Style;
};

const viewStyleOf = (css: string, className: string): Style => {
  registerCSS(css);

  return render(<View testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style as Style;
};

/* -------------------------------------------------------------------------- */
/* line-height: the unit has to survive resolution                            */
/* -------------------------------------------------------------------------- */

test("an em-valued variable is absolute, not multiplied a second time", () => {
  // WAS 433.5 — the resolver multiplied the already-correct 25.5 by the font
  // size again. `1.5em` at a 17px font size IS 25.5, which is what the literal
  // `line-height: 1.5em` produces.
  expect(
    styleOf(
      `${twoDefinitions("--leading", "1.5em", "2em")}
       .a { font-size: 17px; line-height: var(--leading); }`,
      "a",
    ),
  ).toStrictEqual({ fontSize: 17, lineHeight: 25.5 });
});

test("a viewport-unit variable is absolute too", () => {
  // WAS 1275. 10vw of the 750px test window is 75.
  expect(
    styleOf(
      `${twoDefinitions("--leading", "10vw", "12vw")}
       .a { font-size: 17px; line-height: var(--leading); }`,
      "a",
    ),
  ).toStrictEqual({ fontSize: 17, lineHeight: 75 });
});

test("a calc() containing a length is a length", () => {
  // WAS 467.5 (27.5 x 17). `calc(1.5em + 2px)` at 17px is 25.5 + 2.
  expect(
    styleOf(
      `${twoDefinitions("--leading", "1.5em", "2em")}
       .a { font-size: 17px; line-height: calc(var(--leading) + 2px); }`,
      "a",
    ),
  ).toStrictEqual({ fontSize: 17, lineHeight: 27.5 });
});

test("a percentage variable is that percentage of the font size", () => {
  // WAS dropped with no warning at all — quieter than the literal route, which
  // at least reports itself. css-inline-3 §2.2 makes `150%` of a 20px font 30,
  // which React Native can express.
  expect(
    styleOf(
      `${twoDefinitions("--leading", "150%", "160%")}
       .a { font-size: 20px; line-height: var(--leading); }`,
      "a",
    ),
  ).toStrictEqual({ fontSize: 20, lineHeight: 30 });
});

test("a unitless variable still multiplies the font size", () => {
  // UNCHANGED, and the reason the fix cannot simply stop multiplying: a bare
  // number in `line-height` position IS a ratio. 1.25 x 20 = 25.
  expect(
    styleOf(
      `${twoDefinitions("--leading", "1.25", "1.4")}
       .a { font-size: 20px; line-height: var(--leading); }`,
      "a",
    ),
  ).toStrictEqual({ fontSize: 20, lineHeight: 25 });
});

test("a calc() over bare numbers is still a ratio", () => {
  // UNCHANGED. `calc(1.25 * 2)` is 2.5, and 2.5 x 20 is what a unitless
  // line-height means.
  expect(
    styleOf(
      `${twoDefinitions("--ratio", "1.25", "1.5")}
       .a { font-size: 20px; line-height: calc(var(--ratio) * 2); }`,
      "a",
    ),
  ).toStrictEqual({ fontSize: 20, lineHeight: 50 });
});

test("a variable declared as a px length is supplied with its unit intact", () => {
  // The provider half. A variable handed to `VariableContextProvider` keeps the
  // string the author wrote, so the unit is still there when the resolver asks
  // — and 22px is absolute. Read as a ratio it would be 22 x 17 = 374.
  registerCSS(`.a { font-size: 17px; line-height: var(--leading); }`);

  const component = render(
    <VariableContextProvider value={{ "--leading": "22px" }}>
      <Text testID={testID} className="a" />
    </VariableContextProvider>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ fontSize: 17, lineHeight: 22 });
});

test("a runtime-supplied unitless variable is still a ratio", () => {
  registerCSS(`.a { font-size: 20px; line-height: var(--leading); }`);

  const component = render(
    <VariableContextProvider value={{ "--leading": 1.25 }}>
      <Text testID={testID} className="a" />
    </VariableContextProvider>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ fontSize: 20, lineHeight: 25 });
});

test("a stylesheet px length is absolute, exactly as a provider-supplied one is", () => {
  // The stylesheet half, and the reason the two agree: `asDeclaredLength`
  // (`compiler/declarations.ts`) emits the STRING `"22px"` for a length written
  // into a custom property, so both entry points hand the classifier one
  // representation. Folded to the number 22 it was indistinguishable from the
  // ratio 22 — and lightningcss rewrites `rem` to `px` ahead of the compiler, so
  // `1.375rem` arrived by the same door. `resolveValue`'s `PIXEL_LENGTH` branch
  // turns the string back into 22 for every other consumer.
  expect(
    styleOf(
      `${twoDefinitions("--leading", "22px", "24px")}
       .a { font-size: 17px; line-height: var(--leading); }`,
      "a",
    ),
  ).toStrictEqual({ fontSize: 17, lineHeight: 22 });
});

test("a zero-valued variable keeps the lineHeight key", () => {
  // Pinned so a future guard that conflates 0 with absent is a deliberate
  // change: 0 x the font size is 0, and `applyValue` only skips `undefined`.
  expect(
    styleOf(
      `${twoDefinitions("--leading", "0px", "0")}
       .a { font-size: 17px; line-height: var(--leading); }`,
      "a",
    ),
  ).toStrictEqual({ fontSize: 17, lineHeight: 0 });
});

test("a keyword variable produces no lineHeight", () => {
  expect(
    styleOf(
      `${twoDefinitions("--leading", "normal", "normal")}
       .a { font-size: 17px; line-height: var(--leading); }`,
      "a",
    ),
  ).toStrictEqual({ fontSize: 17 });
});

test("a variable that points at another variable is classified through both hops", () => {
  // The classifier reads the descriptor the variable resolves to, so an
  // indirection does not lose the unit. WAS 433.5.
  expect(
    styleOf(
      `${twoDefinitions("--base", "1.5em", "2em")}
       ${twoDefinitions("--leading", "var(--base)", "var(--base)")}
       .a { font-size: 17px; line-height: var(--leading); }`,
      "a",
    ),
  ).toStrictEqual({ fontSize: 17, lineHeight: 25.5 });
});

test("a variable's fallback is classified when the variable is absent", () => {
  // Zero definitions is also not-inlinable, so the fallback reaches the runtime
  // resolver. An `em` fallback is a length. WAS 433.5.
  expect(
    styleOf(`.a { font-size: 17px; line-height: var(--nope, 1.5em); }`, "a"),
  ).toStrictEqual({ fontSize: 17, lineHeight: 25.5 });
});

/* -------------------------------------------------------------------------- */
/* Colour functions: each grammar serialised by its own rules                  */
/* -------------------------------------------------------------------------- */

/**
 * React Native's own colour parser, which answers `undefined` for a string it
 * cannot read. Half the defects below produced a plausible-looking CSS colour
 * that failed exactly here, so asserting the STRING alone would not have caught
 * them.
 */
const isReadableByReactNative = (color: unknown) =>
  typeof processColor(color as string) === "number";

test("a variable supplying rgb channels serialises to the legacy comma form", () => {
  // WAS "rgba(255 0 0, 0.5)" — three space-separated channels then a comma,
  // which is neither grammar. `@react-native/normalize-colors` returns null for
  // it, so the colour was silently absent.
  const style = styleOf(
    `${twoDefinitions("--channels", "255 0 0", "0 0 255")}
     .a { color: rgba(var(--channels), 0.5); }`,
    "a",
  );

  expect(style).toStrictEqual({ color: "rgba(255, 0, 0, 0.5)" });
  expect(isReadableByReactNative(style.color)).toBe(true);
});

test("the modern slash form reaches the same colour", () => {
  // WAS "rgb(255 0 0, 50%)" — the `/` was filtered out and the alpha comma
  // joined, so React Native read null.
  const style = styleOf(
    `${twoDefinitions("--channels", "255 0 0", "0 0 255")}
     .a { color: rgb(var(--channels) / 50%); }`,
    "a",
  );

  expect(style).toStrictEqual({ color: "rgba(255, 0, 0, 0.5)" });
  expect(isReadableByReactNative(style.color)).toBe(true);
});

test("hsl keeps its percentages and gains its commas", () => {
  // WAS "hsla(0 100% 50%, 0.5)" — same hybrid, same null.
  const style = styleOf(
    `${twoDefinitions("--channels", "0 100% 50%", "240 100% 50%")}
     .a { color: hsla(var(--channels), 0.5); }`,
    "a",
  );

  expect(style).toStrictEqual({ color: "hsla(0, 100%, 50%, 0.5)" });
  expect(isReadableByReactNative(style.color)).toBe(true);
});

test("a three-channel variable with no alpha is unchanged", () => {
  expect(
    styleOf(
      `${twoDefinitions("--channels", "255 0 0", "0 0 255")}
       .a { color: rgb(var(--channels)); }`,
      "a",
    ),
  ).toStrictEqual({ color: "rgb(255, 0, 0)" });
});

test("a percentage channel is scaled to the 0-255 range React Native parses", () => {
  // React Native's `rgb` pattern has no `%` in its channel positions, so a
  // percentage channel was unreadable however it was joined.
  const style = styleOf(
    `${twoDefinitions("--channels", "100% 0% 0%", "0% 0% 100%")}
     .a { color: rgb(var(--channels)); }`,
    "a",
  );

  expect(style).toStrictEqual({ color: "rgb(255, 0, 0)" });
  expect(isReadableByReactNative(style.color)).toBe(true);
});

test("relative colour syntax over a variable is computed, not stringified", () => {
  // WAS "rgb(from, red, r, g, b, 50%)" — the generic comma-join, which React
  // Native reads as null. The literal `rgb(from red r g b / 50%)` is folded by
  // lightningcss to #ff000080, the same colour.
  const style = styleOf(
    `${twoDefinitions("--base", "red", "blue")}
     .a { color: rgb(from var(--base) r g b / 50%); }`,
    "a",
  );

  expect(style).toStrictEqual({ color: "rgba(255, 0, 0, 0.5)" });
  expect(isReadableByReactNative(style.color)).toBe(true);
});

test("relative colour syntax with no alpha keeps the origin's own", () => {
  // WAS "rgb(from, red, r, g, b)".
  expect(
    styleOf(
      `${twoDefinitions("--base", "red", "blue")}
       .a { color: rgb(from var(--base) r g b); }`,
      "a",
    ),
  ).toStrictEqual({ color: "rgba(255, 0, 0, 1)" });
});

test("relative colour syntax can reorder and replace channels", () => {
  // `b g 0` swaps two channels and replaces the third outright.
  expect(
    styleOf(
      `${twoDefinitions("--base", "rgb(10 20 30)", "rgb(30 20 10)")}
       .a { color: rgb(from var(--base) b g 0); }`,
      "a",
    ),
  ).toStrictEqual({ color: "rgba(30, 20, 0, 1)" });
});

test("relative colour syntax over currentcolor resolves the inherited colour", () => {
  registerCSS(
    `.p { color: green; }
     .c { background-color: rgb(from currentcolor r g b / 50%); }`,
  );

  const component = render(
    <View className="p">
      <Text testID={testID} className="c" />
    </View>,
  ).getByTestId(testID);

  // The inherited `color` and the element's own rule are separate style objects.
  expect(component.props.style).toStrictEqual([
    { color: "#008000" },
    { backgroundColor: "rgba(0, 128, 0, 0.5)" },
  ]);
});

test("an origin that resolves to nothing drops the declaration instead of shipping a token", () => {
  // WAS "rgb(from, [object Object], r, g, b, 50%)" — an unresolved descriptor
  // stringified into the middle of a colour.
  expect(
    styleOf(`.a { background-color: rgb(from var(--nope) r g b / 50%); }`, "a"),
  ).toStrictEqual({});
});

/* -------------------------------------------------------------------------- */
/* color-mix()                                                                */
/* -------------------------------------------------------------------------- */

test("a variable mixed with transparent is no longer dropped", () => {
  // WAS {} — the compiler folds the right-hand `transparent` away and, with no
  // percentage written, leaves a hole that `resolveValue` filters out. The
  // resolver demanded three arguments and got two. The literal
  // `color-mix(in srgb, red, transparent)` compiles to #ff000080.
  const style = viewStyleOf(
    `${twoDefinitions("--brand", "red", "blue")}
     .a { background-color: color-mix(in srgb, var(--brand), transparent); }`,
    "a",
  );

  expect(style).toStrictEqual({ backgroundColor: "rgba(255, 0, 0, 0.5)" });
  expect(isReadableByReactNative(style.backgroundColor)).toBe(true);
});

test("an explicit weight against transparent still works", () => {
  expect(
    viewStyleOf(
      `${twoDefinitions("--brand", "red", "blue")}
       .a { background-color: color-mix(in srgb, var(--brand) 30%, transparent); }`,
      "a",
    ),
  ).toStrictEqual({ backgroundColor: "rgba(255, 0, 0, 0.3)" });
});

test("transparent on the LEFT interpolates premultiplied, so it does not darken", () => {
  // WAS "rgba(127.5, 0, 0, 0.5)" — half of black mixed into the red, because
  // colorjs defaults premultiplied alpha OFF while css-color-4 §12.3 requires
  // it. lightningcss gives #ff000080 for the literal.
  expect(
    viewStyleOf(
      `${twoDefinitions("--brand", "red", "blue")}
       .a { background-color: color-mix(in srgb, transparent, var(--brand)); }`,
      "a",
    ),
  ).toStrictEqual({ backgroundColor: "rgba(255, 0, 0, 0.5)" });
});

test("a wide-gamut mix lands inside sRGB in a form React Native can read", () => {
  // WAS "rgba(187.51603067837462, -2.2860879855812755e-13, 187.51603067837462,
  // 1)". React Native's number pattern has no exponent, so the whole colour
  // parsed to null — registering the wide spaces bought nothing while their
  // output was unreadable.
  const style = viewStyleOf(
    `${twoDefinitions("--a", "red", "green")}
     ${twoDefinitions("--b", "blue", "yellow")}
     .a { background-color: color-mix(in xyz, var(--a), var(--b)); }`,
    "a",
  );

  expect(style).toStrictEqual({ backgroundColor: "rgba(188, 0, 188, 1)" });
  expect(isReadableByReactNative(style.backgroundColor)).toBe(true);
});

test("channels are rounded, so the two routes agree on the byte", () => {
  // WAS "rgba(127.5, 0, 127.5, 1)". React Native reads channels with `parseInt`,
  // which TRUNCATES — 127.5 became 0x7f where the compile-time route gives
  // 0x80.
  expect(
    viewStyleOf(
      `${twoDefinitions("--a", "red", "green")}
       ${twoDefinitions("--b", "blue", "yellow")}
       .a { background-color: color-mix(in srgb, var(--a), var(--b)); }`,
      "a",
    ),
  ).toStrictEqual({ backgroundColor: "rgba(128, 0, 128, 1)" });
});

/* -------------------------------------------------------------------------- */
/* The Metro shape: an argument hole is `null`, not `undefined`               */
/* -------------------------------------------------------------------------- */

/**
 * `registerCSS` injects the compiled stylesheet as a live object, so an argument
 * the compiler left out stays `undefined`. A real build serialises it with
 * `JSON.stringify` (`metro/injection-code.ts`), and JSON has no `undefined` —
 * every hole becomes `null`.
 *
 * That difference is invisible to every other test in this repo and decides
 * whether a positional resolver reads the right argument in production.
 */
const registerAsMetroWould = (css: string) => {
  const compiled = compileWithAutoDebug(css);

  StyleCollection.inject(
    JSON.parse(JSON.stringify(compiled.stylesheet())) as ReturnType<
      typeof compiled.stylesheet
    >,
  );
};

test("a color-mix() survives the JSON round trip a Metro build performs", () => {
  registerAsMetroWould(
    `${twoDefinitions("--a", "red", "green")}
     ${twoDefinitions("--b", "blue", "yellow")}
     .a { background-color: color-mix(in srgb, var(--a), var(--b)); }`,
  );

  expect(
    render(<View testID={testID} className="a" />).getByTestId(testID).props
      .style,
  ).toStrictEqual({ backgroundColor: "rgba(128, 0, 128, 1)" });
});

/* -------------------------------------------------------------------------- */
/* The deferred-resolution placeholder                                        */
/* -------------------------------------------------------------------------- */

test("a variable supplying both translate components is read as a list", () => {
  // WAS { transform: [{ translate: true }] } — the sentinel
  // `calculate-props.ts` parks while a transform waits for the other styles.
  //
  // TWO faults, in a chain. `translate`'s resolver only read a component list
  // written out as separate arguments, so one `var()` standing in for the whole
  // list failed both validity checks and returned `undefined`; and `applyValue`
  // reads `undefined` as "set nothing", which left the already-placed sentinel
  // as the rendered style. The literal `translate: 10px 20px` gives the value
  // below.
  expect(
    viewStyleOf(
      `${twoDefinitions("--offset", "10px 20px", "5px 5px")}
       .a { translate: var(--offset); }`,
      "a",
    ),
  ).toStrictEqual({ transform: [{ translateX: 10 }, { translateY: 20 }] });
});

test("a scale variable supplying two components splits into scaleX/scaleY", () => {
  // WAS { transform: [{ scale: [2, 3] }] } — an array where React Native wants
  // one number, so it rendered nothing.
  expect(
    viewStyleOf(
      `${twoDefinitions("--factor", "2 3", "4 5")}
       .a { scale: var(--factor); }`,
      "a",
    ),
  ).toStrictEqual({ transform: [{ scaleX: 2 }, { scaleY: 3 }] });
});

test("a rotate variable naming an axis rotates about that axis", () => {
  // WAS { transform: [{ rotate: ["x", "45deg"] }] }. The literal
  // `rotate: x 45deg` gives the value below.
  expect(
    viewStyleOf(
      `${twoDefinitions("--turn", "x 45deg", "y 90deg")}
       .a { rotate: var(--turn); }`,
      "a",
    ),
  ).toStrictEqual({ transform: [{ rotateX: "45deg" }] });
});

test("a transform that genuinely cannot resolve removes the key instead of shipping the sentinel", () => {
  // WAS { transform: [{ translate: true }] }. The sentinel must not survive
  // even when nothing replaces it: a variable with no declaration and no
  // fallback resolves to nothing, and the placeholder has to go with it.
  expect(
    viewStyleOf(`.a { translate: var(--undeclared); }`, "a"),
  ).toStrictEqual({ transform: [] });
});

test("a deferred translate composes with a deferred transform", () => {
  // WAS { transform: [{ translate: true }] } — nothing renderable at all. The
  // `translate` placeholder was written into `target.transform`, which is where
  // the `transform` declaration had parked ITS placeholder, so `transform`'s
  // read-back no longer recognised what it found and the declaration was
  // dropped on top of the sentinel being shipped.
  //
  // The order matches the all-static spelling of the same rule
  // (`transform: scaleX(2); translate: 10px 20px`), which this library composes
  // in SOURCE order rather than in the order css-transforms-2 §3 specifies.
  // That ordering is a separate question and is not changed here.
  expect(
    viewStyleOf(
      `${twoDefinitions("--transform", "scaleX(2)", "scaleX(3)")}
       ${twoDefinitions("--offset", "10px 20px", "1px 2px")}
       .a { transform: var(--transform); translate: var(--offset); }`,
      "a",
    ),
  ).toStrictEqual({
    transform: [{ scaleX: 2 }, { translateX: 10 }, { translateY: 20 }],
  });
});

/* -------------------------------------------------------------------------- */
/* calc() unit mixing: the two routes still disagree, and why                 */
/* -------------------------------------------------------------------------- */

test("RESIDUAL — a literal calc() over mixed units produces nothing", () => {
  // NOT FIXED, and not fixable in `native/styles/`: the declaration never
  // reaches the runtime. `parseLength`'s `case "calc"` returns undefined behind
  // a `// TODO: Add the calc polyfill`, and
  // `parseDimensionPercentageFor_LengthValue` does the same — so a `calc`
  // lightningcss could not simplify is dropped at compile time, with no rule
  // emitted at all.
  //
  // The runtime resolvers these values need already exist and already compute
  // them; the test below proves it with the identical arithmetic. The compiler
  // half is to lower a `calc` value into `[{}, "calc", args]`, exactly as
  // `parseCalcFn` does on the unparsed route.
  registerCSS(`
    .a { width: calc(10vw + 2px); }
    .b { font-size: 14px; width: calc(2em + 2px); }
    .c { width: min(10vw, 20px); }
    .d { font-size: 14px; width: max(2em, 20px); }
    .e { font-size: 14px; width: clamp(1em, 10vw, 100px); }
  `);

  const widths = ["a", "b", "c", "d", "e"].map(
    (name) =>
      (
        render(<View testID={testID} className={name} />).getByTestId(testID)
          .props.style as { width?: number } | undefined
      )?.width,
  );

  expect(widths).toStrictEqual([
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

test("the same arithmetic through a var() computes, so only the compiler is missing", () => {
  registerCSS(`
    ${twoDefinitions("--vwv", "10vw", "12vw")}
    ${twoDefinitions("--emv", "2em", "3em")}
    .a { width: calc(var(--vwv) + 2px); }
    .b { font-size: 14px; width: calc(var(--emv) + 2px); }
    .c { width: min(var(--vwv), 20px); }
    .d { font-size: 14px; width: max(var(--emv), 20px); }
    .e { font-size: 14px; width: clamp(1em, var(--vwv), 100px); }
  `);

  const widths = ["a", "b", "c", "d", "e"].map(
    (name) =>
      (
        render(<View testID={testID} className={name} />).getByTestId(testID)
          .props.style as { width?: number }
      ).width,
  );

  // 10vw of 750 is 75, and 2em of 14 is 28.
  expect(widths).toStrictEqual([77, 30, 20, 28, 75]);
});

test("RESIDUAL — a percentage mixed with a length resolves on neither route", () => {
  // Both routes answer `undefined`, so they already AGREE. React Native has no
  // layout-time length arithmetic, so `calc(100% - 10px)` has no value to
  // produce; this pins the agreement rather than asking for one.
  registerCSS(`
    ${twoDefinitions("--pad", "10px", "12px")}
    .literal { width: calc(100% - 10px); }
    .runtime { width: calc(100% - var(--pad)); }
  `);

  for (const name of ["literal", "runtime"]) {
    const style = render(<View testID={testID} className={name} />).getByTestId(
      testID,
    ).props.style as { width?: number } | undefined;

    expect(style?.width).toBeUndefined();
  }
});
