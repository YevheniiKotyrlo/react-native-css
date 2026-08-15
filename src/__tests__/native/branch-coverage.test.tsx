/**
 * The behaviours this branch decides that no other suite observes.
 *
 * Every neighbouring file owns a grammar: `a11y-media-features.test.tsx` the
 * media-feature inventory, `transform-path-equivalence.test.tsx` the three
 * routes a declaration can take to React Native, `new-properties-spec.test.tsx`
 * the `transform-origin` position grammar, `length-units.test.tsx` the unit
 * ladder. This file carries only the cases those leave unmeasured — each one a
 * decision that can be reversed today without a single assertion noticing.
 *
 * Each block therefore pins the value the current tree produces AND is written
 * so the value it replaced fails: an assertion that merely renders a style is
 * not enough, it has to be the style only this reading produces. Where the
 * compile-time and runtime routes disagree, both values are pinned and the
 * divergence is called out with `SUSPECTED DEFECT` — the convention
 * `transform-path-equivalence.test.tsx` sets.
 *
 * Test environment facts these assertions rest on (`src/jest/index.ts`): the
 * root rem is 14, so `1em` on an element with no declared font size is 14.
 */
import { I18nManager } from "react-native";

import { act, render, screen } from "@testing-library/react-native";
import { compile } from "react-native-css/compiler";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

import {
  highContrast,
  invertedColors,
  reducedTransparency,
  type Observable,
} from "../../native/reactivity";

type Style = Record<string, unknown> | undefined;

const RED = { color: "#f00" };
const GREEN = { color: "#008000" };

let queryCounter = 0;

/**
 * Registers `@media <query> { … }` under a fresh class name and reports whether
 * the guarded declaration reached the rendered element.
 */
function applies(query: string): boolean {
  queryCounter += 1;
  const className = `bc${queryCounter}`;
  registerCSS(`@media ${query} { .${className} { color: red; } }`);
  render(<View testID={className} className={className} />);
  return screen.getByTestId(className).props.style !== undefined;
}

/** The runtime condition the compiler emitted for `@media <query>`. */
function conditionFor(query: string) {
  return compile(`@media ${query} { .probe { color: red; } }`).stylesheet()
    .s?.[0]?.[1]?.[0]?.m;
}

/** Registers one stylesheet and renders one `View` per class name. */
function stylesFor(css: string, ...classNames: string[]): Style[] {
  registerCSS(css);

  return classNames.map((className) => {
    const view = render(<View testID={testID} className={className} />);
    return view.getByTestId(testID).props.style as Style;
  });
}

/** The style one class name resolves to. Each call needs a FRESH name: a
 * repeated selector appends a second rule rather than replacing the first. */
function styleOf(className: string, css: string): Style {
  const [style] = stylesFor(css, className);
  return style;
}

/**
 * Builds a stylesheet exercising the three routes a declaration can take —
 * literal, a single-definition custom property the compiler inlines, and a
 * custom property with a second definition that can only resolve at runtime.
 * `alternate` exists only to give `--deferred` that second definition; the
 * media query never matches under the default (unset) colour scheme.
 */
function threeRoutes(property: string, value: string, alternate: string) {
  return `
    .literal { ${property}: ${value}; }

    :root { --inlinable: ${value}; }
    .inlinable { ${property}: var(--inlinable); }

    :root { --deferred: ${value}; }
    @media (prefers-color-scheme: dark) { :root { --deferred: ${alternate}; } }
    .deferred { ${property}: var(--deferred); }
  `;
}

function transformRoutes(value: string, alternate = "none") {
  return stylesFor(
    threeRoutes("transform", value, alternate),
    "literal",
    "inlinable",
    "deferred",
  );
}

/**
 * Drives one `AccessibilityInfo`-backed observable through its ON state and
 * restores it, so a failure cannot leak the preference into a later test.
 */
function withPreference(flag: Observable<boolean>, body: () => void): void {
  try {
    act(() => {
      flag.set(true);
    });
    body();
  } finally {
    act(() => {
      flag.set(false);
    });
  }
}

/* -------------------------------------------------------------------------- */
/* @media (dir: …) — the layout direction                                     */
/* -------------------------------------------------------------------------- */

test("dir matches only the direction the layout is actually in", () => {
  const initial = I18nManager.isRTL;

  try {
    // `dir` reads `I18nManager.isRTL` and compares for EQUALITY, so exactly one
    // of the two values matches at a time. The reading it replaces was
    // `(isRTL && value === "rtl") || value === "ltr"`, under which `(dir: ltr)`
    // matched in BOTH directions — an `@media (dir: ltr)` rule applied to an
    // RTL layout, which is the one thing the feature exists to prevent.
    I18nManager.isRTL = false;
    expect(applies("(dir: ltr)")).toBe(true);
    expect(applies("(dir: rtl)")).toBe(false);

    // `dir` is read at evaluation time and is not an observable, so a rendered
    // element does not restyle when the flag flips — every assertion here
    // renders after the flip rather than mutating a live tree.
    I18nManager.isRTL = true;
    expect(applies("(dir: rtl)")).toBe(true);
    expect(applies("(dir: ltr)")).toBe(false);

    // A value outside the feature's grammar matches neither direction.
    expect(applies("(dir: auto)")).toBe(false);
  } finally {
    I18nManager.isRTL = initial;
  }
});

/* -------------------------------------------------------------------------- */
/* The AccessibilityInfo-backed features in their ON state                    */
/* -------------------------------------------------------------------------- */

test("inverted-colors flips with the observable and restyles in place", () => {
  registerCSS(`
.bc-inverted { color: green; }
@media (inverted-colors: inverted) { .bc-inverted { color: red; } }
`);
  render(<View testID="bc-inverted" className="bc-inverted" />);
  const element = screen.getByTestId("bc-inverted");
  expect(element.props.style).toStrictEqual(GREEN);

  withPreference(invertedColors, () => {
    // The reactive half is the whole reason this is an observable rather than a
    // boot-time snapshot: an element already on screen when the user turns
    // Invert Colours on has to restyle without remounting.
    expect(element.props.style).toStrictEqual(RED);

    expect(applies("(inverted-colors: inverted)")).toBe(true);
    expect(applies("(inverted-colors: none)")).toBe(false);
    // The boolean form reads the same value: `none` is the feature's false
    // state, so anything else makes `(inverted-colors)` true.
    expect(applies("(inverted-colors)")).toBe(true);
    expect(applies("not (inverted-colors: inverted)")).toBe(false);
  });

  expect(element.props.style).toStrictEqual(GREEN);
});

test("prefers-reduced-transparency flips with the observable and restyles in place", () => {
  registerCSS(`
.bc-transparency { color: green; }
@media (prefers-reduced-transparency: reduce) { .bc-transparency { color: red; } }
`);
  render(<View testID="bc-transparency" className="bc-transparency" />);
  const element = screen.getByTestId("bc-transparency");
  expect(element.props.style).toStrictEqual(GREEN);

  withPreference(reducedTransparency, () => {
    expect(element.props.style).toStrictEqual(RED);

    expect(applies("(prefers-reduced-transparency: reduce)")).toBe(true);
    expect(applies("(prefers-reduced-transparency: no-preference)")).toBe(
      false,
    );
    expect(applies("(prefers-reduced-transparency)")).toBe(true);
    expect(applies("not (prefers-reduced-transparency: reduce)")).toBe(false);
  });

  expect(element.props.style).toStrictEqual(GREEN);
});

test("prefers-contrast flips with the observable and restyles in place", () => {
  registerCSS(`
.bc-contrast { color: green; }
@media (prefers-contrast: more) { .bc-contrast { color: red; } }
`);
  render(<View testID="bc-contrast" className="bc-contrast" />);
  const element = screen.getByTestId("bc-contrast");
  expect(element.props.style).toStrictEqual(GREEN);

  withPreference(highContrast, () => {
    expect(element.props.style).toStrictEqual(RED);

    expect(applies("(prefers-contrast: more)")).toBe(true);
    expect(applies("(prefers-contrast: no-preference)")).toBe(false);
    expect(applies("(prefers-contrast)")).toBe(true);

    // React Native reports one bit, so turning the preference ON does not make
    // the other two values MQ5 defines answerable — `less` and `custom` stay
    // false rather than following `more`.
    expect(applies("(prefers-contrast: less)")).toBe(false);
    expect(applies("(prefers-contrast: custom)")).toBe(false);
  });

  expect(element.props.style).toStrictEqual(GREEN);
});

/* -------------------------------------------------------------------------- */
/* Three-valued OR — MQ4 §3.1                                                 */
/* -------------------------------------------------------------------------- */

test("or is Kleene, so a known-true beats an unknown and an unknown poisons a false", () => {
  // `monochrome` is unimplemented, so it answers UNKNOWN rather than `false`.
  // `hover` answers `hover` on every React Native platform.
  expect(conditionFor("((monochrome: 0) or (hover: hover))")).toStrictEqual([
    [
      "|",
      [
        ["=", "monochrome", 0],
        ["=", "hover", "hover"],
      ],
    ],
  ]);

  // unknown ∨ true is TRUE — the definite answer settles the disjunction, so a
  // feature nobody has implemented cannot suppress a rule guarded by one that
  // is. Short-circuiting on the first non-true answer would lose this.
  expect(applies("((monochrome: 0) or (hover: hover))")).toBe(true);

  // unknown ∨ false is UNKNOWN, and only a definite `true` matches.
  expect(applies("((monochrome: 0) or (hover: none))")).toBe(false);

  // …and unknown does not flip. Collapsing the disjunction to `false` here
  // would make its negation `true` and ship the guarded rule to everyone,
  // which is the ALWAYS MATCHES shape the three-valued logic exists to close.
  expect(applies("not ((monochrome: 0) or (hover: none))")).toBe(false);

  // Both sides definite and false, so the whole disjunction is a definite
  // false — the unknown-tracking does not leak into ordinary logic.
  expect(applies("((hover: none) or (prefers-contrast: more))")).toBe(false);
  expect(applies("not ((hover: none) or (prefers-contrast: more))")).toBe(true);

  // Both sides definite, one true.
  expect(applies("((hover: hover) or (prefers-contrast: more))")).toBe(true);

  registerCSS(`
.bc-or { color: green; }
@media not ((monochrome: 0) or (hover: none)) { .bc-or { color: red; } }
`);
  render(<View testID="bc-or" className="bc-or" />);
  expect(screen.getByTestId("bc-or").props.style).toStrictEqual(GREEN);
});

/* -------------------------------------------------------------------------- */
/* matrix() / matrix3d() across all three routes                              */
/* -------------------------------------------------------------------------- */

test("matrix() expands to the column-major 3x3 on all three routes", () => {
  const [literal, inlinable, deferred] = transformRoutes(
    "matrix(1, 2, 3, 4, 5, 6)",
  );

  // The two routes arrive at the resolver with different arities — the
  // compiler has already expanded CSS's six values into React Native's nine,
  // the runtime hands over the six raw arguments — and both have to land on the
  // same nine. Six elements fails `processTransform`'s arity assertion outright.
  const expected = { transform: [{ matrix: [1, 2, 0, 3, 4, 0, 5, 6, 1] }] };

  expect(literal).toStrictEqual(expected);
  expect(inlinable).toStrictEqual(expected);
  expect(deferred).toStrictEqual(expected);
});

test("matrix3d() passes its 16 values through on all three routes", () => {
  const [literal, inlinable, deferred] = transformRoutes(
    "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1)",
  );

  // CSS's `m11..m44` order IS column-major, so both routes copy rather than
  // rearrange. The runtime route reaches the same resolver as `matrix` and is
  // distinguished only by arity.
  const expected = {
    transform: [
      { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1] },
    ],
  };

  expect(literal).toStrictEqual(expected);
  expect(inlinable).toStrictEqual(expected);
  expect(deferred).toStrictEqual(expected);
});

/* -------------------------------------------------------------------------- */
/* translate3d / scale3d / rotate3d across all three routes                   */
/* -------------------------------------------------------------------------- */

test("translate3d() keeps its x/y on all three routes", () => {
  const [literal, inlinable, deferred] = transformRoutes(
    "translate3d(1px, 2px, 3px)",
  );

  // React Native has no `translateZ`, so the x/y half is the closest exact
  // rendering and the z is named in a warning rather than dropped in silence.
  //
  // The three 3D shorthands were handled by `parseTransform`'s compile-time
  // switch and absent from `parseUnparsed`'s function allow-list, so the moment
  // the value had to resolve at runtime the whole function was warned about and
  // dropped — leaving an EMPTY transform array where the other two routes
  // rendered the translation.
  const expected = { transform: [{ translateX: 1 }, { translateY: 2 }] };
  expect(literal).toStrictEqual(expected);
  expect(inlinable).toStrictEqual(expected);
  expect(deferred).toStrictEqual(expected);

  // Only the two COMPILE-TIME routes can warn about the dropped z: the runtime
  // resolver has no builder to warn through, so its z goes silently.
  expect(
    registerCSS(
      threeRoutes("transform", "translate3d(1px, 2px, 3px)", "none"),
    ).warnings(),
  ).toStrictEqual({
    values: {
      transform: ["translate3d(<z>)", "translate3d(<z>)"],
    },
  });
});

test("scale3d() keeps its x/y on all three routes", () => {
  const [literal, inlinable, deferred] = transformRoutes("scale3d(1, 2, 3)");

  const expected = { transform: [{ scaleX: 1 }, { scaleY: 2 }] };
  expect(literal).toStrictEqual(expected);
  expect(inlinable).toStrictEqual(expected);
  expect(deferred).toStrictEqual(expected);

  expect(
    registerCSS(
      threeRoutes("transform", "scale3d(1, 2, 3)", "none"),
    ).warnings(),
  ).toStrictEqual({
    values: { transform: ["scale3d(<z>)", "scale3d(<z>)"] },
  });
});

test("rotate3d() becomes an Euler rotation on all three routes", () => {
  const [literal, inlinable, deferred] = transformRoutes(
    "rotate3d(0, 0, 1, 45deg)",
  );

  // A unit axis is EXACT — `rotate3d(0, 0, 1, 45deg)` IS `rotateZ(45deg)` — so
  // this was the one of the three where the runtime route lost a transform the
  // library could otherwise express perfectly.
  const expected = { transform: [{ rotateZ: "45deg" }] };
  expect(literal).toStrictEqual(expected);
  expect(inlinable).toStrictEqual(expected);
  expect(deferred).toStrictEqual(expected);

  // A unit axis has nothing to warn about, on any route.
  expect(
    registerCSS(
      threeRoutes("transform", "rotate3d(0, 0, 1, 45deg)", "none"),
    ).warnings(),
  ).toStrictEqual({});
});

/* -------------------------------------------------------------------------- */
/* skew()'s one-argument form                                                 */
/* -------------------------------------------------------------------------- */

test("the one-argument skew() defaults its y-angle to zero on all three routes", () => {
  const [literal, inlinable, deferred] = transformRoutes("skew(10deg)");

  // css-transforms-1 §11: the second angle defaults to `0`. React Native has no
  // `skew`, so both routes expand it into the pair — and the pair has to be
  // FLAT, since `processTransform` takes exactly one property per entry.
  const expected = { transform: [{ skewX: "10deg" }, { skewY: "0deg" }] };
  expect(literal).toStrictEqual(expected);
  expect(inlinable).toStrictEqual(expected);
  expect(deferred).toStrictEqual(expected);
});

/* -------------------------------------------------------------------------- */
/* rotate3d() about a negative axis                                           */
/* -------------------------------------------------------------------------- */

test("a negative rotate3d axis negates the angle", () => {
  // Rotating about −Z by 45° is rotating about +Z by −45°. The axis MAGNITUDE
  // carries no information — `rotate3d(0, 0, 2, 45deg)` is the same rotation as
  // `rotate3d(0, 0, 1, 45deg)` — but its SIGN does, so a sign-blind mapping
  // rotates the element the wrong way with nothing to warn about.
  expect(
    styleOf("neg-z", `.neg-z { transform: rotate3d(0, 0, -1, 45deg); }`),
  ).toStrictEqual({ transform: [{ rotateZ: "-45deg" }] });
  expect(
    styleOf("neg-x", `.neg-x { transform: rotate3d(-1, 0, 0, 45deg); }`),
  ).toStrictEqual({ transform: [{ rotateX: "-45deg" }] });
  expect(
    styleOf("neg-y", `.neg-y { transform: rotate3d(0, -1, 0, 45deg); }`),
  ).toStrictEqual({ transform: [{ rotateY: "-45deg" }] });

  // A negative axis with an already-negative angle is the positive rotation,
  // so the negation is a flip rather than a prefix.
  expect(
    styleOf("neg-both", `.neg-both { transform: rotate3d(0, 0, -1, -45deg); }`),
  ).toStrictEqual({ transform: [{ rotateZ: "45deg" }] });

  // The magnitude is still ignored — only the sign reaches the result.
  expect(
    styleOf("neg-mag", `.neg-mag { transform: rotate3d(0, 0, -2, 45deg); }`),
  ).toStrictEqual({ transform: [{ rotateZ: "-45deg" }] });
});

/* -------------------------------------------------------------------------- */
/* transform-origin — the z-rescue's refusal paths                            */
/* -------------------------------------------------------------------------- */

test("transform-origin: a percentage z is not rescued", () => {
  // The z-component is a `<length>` (css-transforms-1 §3), so `left top 30%` is
  // invalid CSS. The rescue therefore has to REFUSE it and leave lightningcss's
  // `<position>` reading in place rather than manufacture a three-value origin
  // out of a declaration that has none.
  expect(
    styleOf("o-pct-z", `.o-pct-z { transform-origin: left top 30%; }`),
  ).toStrictEqual({ transformOrigin: ["0%", "30%", 0] });
});

test("transform-origin: a length x with a keyword y still rescues the z", () => {
  // The rescue is keyed on which component carries lightningcss's OFFSET, not
  // on the components being keywords — `50% top 30px` has a `<length-percentage>`
  // in x and still folds its z onto the y.
  expect(
    styleOf("o-len-x", `.o-len-x { transform-origin: 50% top 30px; }`),
  ).toStrictEqual({ transformOrigin: ["50%", "0%", 30] });
});

test("transform-origin: the z rescue accepts every length unit", () => {
  // Restricting the rescue to `px` left the commonest spelling unfixed: `rem`
  // is what Tailwind emits, so `left top 2rem` still shipped lightningcss's
  // corrupted `<position>` parse. `rem` folds at compile time against the root
  // font size (14) and `em` resolves at runtime against the element's own.
  expect(
    styleOf("o-rem-z", `.o-rem-z { transform-origin: left top 2rem; }`),
  ).toStrictEqual({ transformOrigin: ["0%", "0%", 28] });
  expect(
    styleOf("o-em-z", `.o-em-z { transform-origin: left top 2em; }`),
  ).toStrictEqual({ transformOrigin: ["0%", "0%", 28] });
  expect(
    styleOf(
      "o-em-font",
      `.o-em-font { font-size: 20px; transform-origin: left top 2em; }`,
    ),
  ).toStrictEqual({ fontSize: 20, transformOrigin: ["0%", "0%", 40] });
});

/* -------------------------------------------------------------------------- */
/* Absolute units beyond the properties already measured                      */
/* -------------------------------------------------------------------------- */

test("absolute units convert on any property the Length visitor reaches", () => {
  // css-values-4 §6.2 fixes all six units against the inch, so the conversion is
  // lossless and happens in the compiler's `Length` visitor. That visitor sees
  // LENGTHS rather than declarations, which is the claim under test: nothing
  // about the property is consulted, so a property nobody enumerated converts
  // too. Every one of these used to reach `parseLength` — which knows only
  // px/rem/%/em/vw/vh — and lose the WHOLE declaration.
  const compiled = registerCSS(`
    .abs-letter { letter-spacing: 12pt; }
    .abs-border { border-width: 1pc; }
    .abs-gap { gap: 1cm; }
    .abs-max { max-height: 1in; }
    .abs-margin { margin: 40Q; }
    .abs-inset { inset: 10mm; }
  `);

  const styleOfRegistered = (className: string): Style =>
    render(<View testID={className} className={className} />).getByTestId(
      className,
    ).props.style as Style;

  // 12pt is 16px, 1pc is 16px, 1in is 96px, and 1cm / 40Q / 10mm are the same
  // length written three ways.
  expect(styleOfRegistered("abs-letter")).toStrictEqual({ letterSpacing: 16 });
  expect(styleOfRegistered("abs-border")).toStrictEqual({ borderWidth: 16 });
  expect(styleOfRegistered("abs-gap")).toStrictEqual({ gap: 37.7953 });
  expect(styleOfRegistered("abs-max")).toStrictEqual({ maxHeight: 96 });
  expect(styleOfRegistered("abs-margin")).toStrictEqual({ margin: 37.7953 });
  expect(styleOfRegistered("abs-inset")).toStrictEqual({ inset: 37.7953 });

  expect(compiled.warnings()).toStrictEqual({});
});

test("absolute units convert inside a transform and a filter value", () => {
  // A transform or filter function's argument is a length like any other, so
  // the same `Length` visitor reaches inside the function and the conversion is
  // done before either `parseTransform` or `parseFilter` sees a value. These are
  // the nested positions the property-level cases above cannot cover.
  expect(
    styleOf("abs-tx", `.abs-tx { transform: translateX(1in); }`),
  ).toStrictEqual({ transform: [{ translateX: 96 }] });
  expect(
    styleOf(
      "abs-perspective",
      `.abs-perspective { transform: perspective(1pc); }`,
    ),
  ).toStrictEqual({ transform: [{ perspective: 16 }] });
  expect(styleOf("abs-blur", `.abs-blur { filter: blur(1pc); }`)).toStrictEqual(
    { filter: [{ blur: 16 }] },
  );
});

/* -------------------------------------------------------------------------- */
/* clamp()'s non-array guard                                                  */
/* -------------------------------------------------------------------------- */

test("a clamp() that resolves to a bare number returns nothing rather than throwing", () => {
  // `resolveValue` hands back a SCALAR for a single-argument call, and the
  // destructure that reads `[minimum, value, maximum]` throws a `TypeError` on
  // a non-iterable. That throw leaves `calculateProps` during render, so it
  // unmounts the tree rather than dropping one declaration — which is why the
  // array guard has to sit BEFORE the destructure rather than below it.
  //
  // `clamp(1em)` is the reachable spelling: `em` defers to the runtime, so the
  // declaration compiles to `[{}, "clamp", [[{}, "em", 1, 1]]]` and the
  // resolver is genuinely entered. The declaration itself lands nothing.
  expect(
    styleOf("clamp-one", `.clamp-one { width: clamp(1em); }`),
  ).toStrictEqual({});

  // The sibling is what separates "guarded" from "never reached": a throw would
  // take the whole rule's props with it, so a surviving `color` is the proof
  // the render completed.
  expect(
    styleOf(
      "clamp-sibling",
      `.clamp-sibling { color: red; width: clamp(1em); }`,
    ),
  ).toStrictEqual(RED);

  // The well-formed three-argument call still resolves, so the guard rejects
  // the non-iterable rather than the function. css-values-4 §10.3 orders the
  // arguments `clamp(MIN, VAL, MAX)`.
  expect(
    styleOf("clamp-three", `.clamp-three { width: clamp(1em, 2em, 3em); }`),
  ).toStrictEqual({ width: 28 });
});

/* -------------------------------------------------------------------------- */
/* @supports — the catch fallback                                             */
/* -------------------------------------------------------------------------- */

test("@supports answers false for a declaration lightningcss cannot parse", () => {
  // `declarationCompiles` calls lightningcss WITHOUT `errorRecovery`, unlike
  // both main passes, so a declaration that is a SYNTAX error throws out of the
  // compile rather than returning an empty stylesheet. That makes its `catch`
  // the only branch an unparsable declaration can reach, and the only one no
  // other suite exercises.
  //
  // `(color: var())` is a spelling that reaches it. lightningcss parses the
  // condition itself happily, as
  // `{type: "declaration", propertyId: {property: "color"}, value: "var()"}`,
  // so the declaration branch is entered — and compiling `.s{color:var()}`
  // then raises `SyntaxError: Unexpected end of input` from the argument-less
  // `var()`. Unsupported is the only safe reading of "this engine cannot even
  // read it", and without the catch the throw takes the WHOLE stylesheet down
  // rather than the guarded block.
  expect(
    styleOf(
      "sup-throw",
      `@supports (color: var()) { .sup-throw { color: red; } }`,
    ),
  ).toBeUndefined();

  // …and the negated form is the half that makes the DIRECTION load-bearing: a
  // thrown parse answering anything but `false` admits the block written to
  // exclude exactly this engine.
  expect(
    styleOf(
      "sup-not-throw",
      `@supports not (color: var()) { .sup-not-throw { color: red; } }`,
    ),
  ).toStrictEqual(RED);

  // The contrast is a declaration that parses and compiles: the same branch,
  // reached without a throw, still answers `true`. Both halves have to hold, or
  // "unsupported" would just be what `@supports` always says.
  expect(
    styleOf("sup-ok", `@supports (color: red) { .sup-ok { color: red; } }`),
  ).toStrictEqual(RED);
});
