import { act, render } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { colorScheme } from "react-native-css/runtime";

/**
 * Spec conformance for `transform-origin`, `isolation` and `mix-blend-mode`.
 *
 * `unmapped-properties.test.tsx` proves each property reaches React Native at
 * all, and `spec-conformance.test.tsx` covers the common value forms. This file
 * walks the rest of the grammar each property's spec permits — the forms a
 * parser written against the commit-message example will get wrong — plus the
 * cascade contexts (`@media`, `!important`, a dark colour scheme) that decide
 * whether the value survives to the element.
 *
 * Findings marked `SUSPECTED DEFECT` assert the measured value so the suite
 * stays green; the comment records what the spec asks for instead.
 *
 * The default rem in tests is 14, the viewport 750x1334.
 */

/** Each call must use a FRESH class name: re-registering a selector inside one
 * test appends a second rule rather than replacing the first, so a repeated name
 * silently measures the earlier declaration. */
const styleOf = (className: string, css: string): unknown => {
  registerCSS(css);
  return render(<View testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style as unknown;
};

const warningsOf = (css: string): unknown => registerCSS(css).warnings();

/* -------------------------------------------------------------------------- */
/* transform-origin — css-transforms-1 §3, the <position> grammar              */
/* -------------------------------------------------------------------------- */

test("transform-origin: a lone vertical keyword centres the horizontal axis", () => {
  // The one-value form is NOT "x only" — a vertical keyword binds to y and x
  // falls back to `center`, so `top` and `left` land on different axes.
  expect(styleOf("a1", `.a1 { transform-origin: top; }`)).toStrictEqual({
    transformOrigin: ["50%", "0%", 0],
  });
  expect(styleOf("a2", `.a2 { transform-origin: bottom; }`)).toStrictEqual({
    transformOrigin: ["50%", "100%", 0],
  });
});

test("transform-origin: a lone percentage sets x and centres y", () => {
  expect(styleOf("a3", `.a3 { transform-origin: 100%; }`)).toStrictEqual({
    transformOrigin: ["100%", "50%", 0],
  });
});

test("transform-origin: a keyword pair may be written in either axis order", () => {
  // The `[left|center|right] && [top|center|bottom]` branch is order-free, so
  // the parser must sort by axis rather than by position.
  expect(styleOf("a4", `.a4 { transform-origin: top center; }`)).toStrictEqual({
    transformOrigin: ["50%", "0%", 0],
  });
  expect(styleOf("a5", `.a5 { transform-origin: center left; }`)).toStrictEqual(
    {
      transformOrigin: ["0%", "50%", 0],
    },
  );
});

test("transform-origin: a length in x with a keyword in y", () => {
  expect(styleOf("a6", `.a6 { transform-origin: 10px bottom; }`)).toStrictEqual(
    {
      transformOrigin: [10, "100%", 0],
    },
  );
});

test("transform-origin: a two-value form is unaffected by the z rescue", () => {
  // `left 10px` is the ordinary two-value form — `left` for x, `10px` for y.
  // lightningcss reports no offset for it, so the z rescue never sees it.
  expect(styleOf("a7", `.a7 { transform-origin: left 10px; }`)).toStrictEqual({
    transformOrigin: ["0%", 10, 0],
  });
});

test("transform-origin: a percentage offset from a far side is expressible", () => {
  // `right 10%` is 10% in from the right, which is 90% from the left. The
  // px form is `calc(100% - 10px)`, which React Native's transformOrigin has
  // no syntax for, so that one is dropped — with a warning, because dropping
  // it silently is what made this class of defect invisible.
  expect(
    styleOf("a8", `.a8 { transform-origin: right 10% bottom 20%; }`),
  ).toStrictEqual({ transformOrigin: ["90%", "80%", 0] });
  expect(
    styleOf("a9", `.a9 { transform-origin: right 10px bottom 20px; }`),
  ).toBeUndefined();
  expect(
    warningsOf(`.a10 { transform-origin: right 10px bottom 20px; }`),
  ).toStrictEqual({
    values: { "transform-origin": ["right <offset>", "bottom <offset>"] },
  });
});

test("transform-origin: calc() folds when every term shares a type", () => {
  expect(
    styleOf("a11", `.a11 { transform-origin: calc(10px + 5px) 20px; }`),
  ).toStrictEqual({ transformOrigin: [15, 20, 0] });
  expect(
    styleOf("a12", `.a12 { transform-origin: calc(2 * 5px) 0; }`),
  ).toStrictEqual({ transformOrigin: [10, "0%", 0] });
  expect(
    styleOf("a13", `.a13 { transform-origin: calc(25% * 2) 0; }`),
  ).toStrictEqual({ transformOrigin: ["50%", "0%", 0] });
});

test("transform-origin: a calc() mixing percentage and length emits nothing", () => {
  // React Native has no percentage-plus-length origin, and there is no layout
  // pass at compile time to resolve one, so the declaration cannot survive.
  expect(
    styleOf("a14", `.a14 { transform-origin: calc(100% - 10px) 0; }`),
  ).toBeUndefined();
  expect(
    styleOf("a15", `.a15 { transform-origin: calc(50% + 10px) 0; }`),
  ).toBeUndefined();
});

test("transform-origin: negative and fractional values are legal positions", () => {
  // An origin outside the box is valid CSS — nothing may clamp it to 0..100%.
  expect(
    styleOf("a16", `.a16 { transform-origin: -1.5px 0.25px; }`),
  ).toStrictEqual({ transformOrigin: [-1.5, 0.25, 0] });
  expect(styleOf("a17", `.a17 { transform-origin: -25% 150%; }`)).toStrictEqual(
    { transformOrigin: ["-25%", "150%", 0] },
  );
});

test("transform-origin: keywords are ASCII case-insensitive", () => {
  expect(styleOf("a18", `.a18 { transform-origin: CENTER; }`)).toStrictEqual({
    transformOrigin: ["50%", "50%", 0],
  });
  expect(
    styleOf("a19", `.a19 { transform-origin: RIGHT BOTTOM; }`),
  ).toStrictEqual({ transformOrigin: ["100%", "100%", 0] });
});

test("transform-origin: absolute units convert like any other length", () => {
  // The compiler's `Length` visitor folds every absolute unit to px before a
  // parser sees it, so this is no longer a transform-origin question at all —
  // it is pinned here because it used to be, and because it is the call site
  // that would notice a regression first. 12pt is 16px.
  expect(styleOf("a20", `.a20 { transform-origin: 12pt 20px; }`)).toStrictEqual(
    { transformOrigin: [16, 20, 0] },
  );
  expect(warningsOf(`.a21 { transform-origin: 12pt 20px; }`)).toStrictEqual({});
});

test("transform-origin: rem folds at compile time against the root font size", () => {
  expect(styleOf("a22", `.a22 { transform-origin: 1rem 2rem; }`)).toStrictEqual(
    {
      transformOrigin: [14, 28, 0],
    },
  );
});

test("transform-origin: a var() known at compile time is inlined", () => {
  expect(
    styleOf("a23", `.a23 { --o: 10px 20px; transform-origin: var(--o); }`),
  ).toStrictEqual({ transformOrigin: [10, 20, 0] });
  expect(
    styleOf(
      "a24",
      `:root { --ro: 25% 75%; } .a24 { transform-origin: var(--ro); }`,
    ),
  ).toStrictEqual({ transformOrigin: ["25%", "75%", 0] });
});

test("transform-origin: units resolved at runtime keep their own style key", () => {
  // `em`/`vw`/`vh` cannot fold at compile time, so they compile to a deferred
  // style function and are resolved during `calculateProps`. That second path
  // has to arrive at the same key the folded path does — `transformOrigin` is a
  // style key in its own right, not a transform function that composes into
  // React Native's `transform` array.
  expect(styleOf("a25", `.a25 { transform-origin: 1em 2em; }`)).toStrictEqual({
    transformOrigin: [14, 28, 0],
  });
  expect(styleOf("a26", `.a26 { transform-origin: 1em 20px; }`)).toStrictEqual({
    transformOrigin: [14, 20, 0],
  });
  expect(
    styleOf("a27", `.a27 { font-size: 20px; transform-origin: 1em 2em; }`),
  ).toStrictEqual({ transformOrigin: [20, 40, 0], fontSize: 20 });
  expect(styleOf("a28", `.a28 { transform-origin: 10vw 10vh; }`)).toStrictEqual(
    { transformOrigin: [75, 133.4, 0] },
  );
});

test("transform-origin: a deferred origin leaves a real transform untouched", () => {
  // The pairing that makes the distinction load-bearing: every entry in React
  // Native's `transform` array must be a single-key transform object, so an
  // origin resolved into that array would be both a lost origin and a corrupt
  // transform. The two must stay separate keys.
  expect(
    styleOf("a29", `.a29 { transform: scale(2); transform-origin: 1em 2em; }`),
  ).toStrictEqual({
    transformOrigin: [14, 28, 0],
    transform: [{ scaleX: 2 }, { scaleY: 2 }],
  });
});

test("transform-origin: a var() unresolvable at compile time still resolves", () => {
  // A `var()` always defers, so this is the deferred path reached without any
  // unit involved — the fallback resolves at runtime and lands on the property.
  // It arrives with the same three-element arity as the static route, because
  // `native/styles/transform-origin.ts` assembles it rather than the generic
  // unparsed machinery forwarding the declaration's own token count.
  expect(
    styleOf("a30", `.a30 { transform-origin: var(--missing, 10px 20px); }`),
  ).toStrictEqual({ transformOrigin: [10, 20, 0] });
  expect(
    styleOf("a30b", `.a30b { transform-origin: var(--missing, 10px); }`),
  ).toStrictEqual({ transformOrigin: [10, "50%", 0] });
  expect(
    styleOf(
      "a30c",
      `.a30c { transform-origin: var(--missing, 10px 20px 30px); }`,
    ),
  ).toStrictEqual({ transformOrigin: [10, 20, 30] });
});

test("transform-origin: the CSS-wide keywords", () => {
  // `inherit` and `initial` correctly reach React Native as nothing — neither
  // has a meaning React Native can hold.
  expect(styleOf("a31", `.a31 { transform-origin: inherit; }`)).toBeUndefined();
  expect(styleOf("a32", `.a32 { transform-origin: initial; }`)).toBeUndefined();

  // `unset` differs from its two siblings on purpose. lightningcss elides
  // `inherit` and `initial` before the compiler sees them, so those rules carry
  // no declaration at all; `unset` survives and reaches the runtime, where it
  // means "remove this value" — which is exactly what the resolver does. The
  // rule therefore exists and owns no key, rather than owning an empty one.
  const unsetStyle = styleOf("a33", `.a33 { transform-origin: unset; }`) as
    | Record<string, unknown>
    | undefined;
  expect(unsetStyle).toStrictEqual({});
  expect(Object.keys(unsetStyle ?? {})).toStrictEqual([]);
});

test("transform-origin: the three-value form keeps a length z-offset", () => {
  // `<length-percentage> <length-percentage> <length>` — React Native's
  // transformOrigin does take a third element, so passing z through is right.
  expect(
    styleOf("a34", `.a34 { transform-origin: 10px 20px 30px; }`),
  ).toStrictEqual({ transformOrigin: [10, 20, 30] });
  expect(
    styleOf("a35", `.a35 { transform-origin: 10px 20px 0; }`),
  ).toStrictEqual({ transformOrigin: [10, 20, 0] });
  expect(
    styleOf("a36", `.a36 { transform-origin: 50% 50% 30px; }`),
  ).toStrictEqual({ transformOrigin: ["50%", "50%", 30] });
});

test("transform-origin: a keyword pair plus a z-offset keeps all three", () => {
  // lightningcss parses this property with the `<position>` grammar, which has
  // no z — it re-reads the third value as an offset on one of the other two and
  // then SERIALISES it that way, so by the second compiler pass `left top 30px`
  // has become `0 30px`. The rescue in `compiler/transform-origin.ts` runs in
  // the first pass, before that serialisation, which is the only point where
  // the original parse still exists.
  expect(
    styleOf("a37", `.a37 { transform-origin: left top 30px; }`),
  ).toStrictEqual({ transformOrigin: ["0%", "0%", 30] });
  expect(
    styleOf("a38", `.a38 { transform-origin: left top -5px; }`),
  ).toStrictEqual({ transformOrigin: ["0%", "0%", -5] });
  expect(
    styleOf("a39", `.a39 { transform-origin: left top 0; }`),
  ).toStrictEqual({ transformOrigin: ["0%", "0%", 0] });
});

test("transform-origin: the keyword pair may be written in either axis order", () => {
  // `[[center | left | right] && [center | top | bottom]] <length>?` — the `&&`
  // is what makes these two the same origin. lightningcss folds the z onto
  // whichever component was written LAST, so the two orders arrive with the
  // offset on opposite components and both have to be recognised.
  expect(
    styleOf("a37b", `.a37b { transform-origin: top left 30px; }`),
  ).toStrictEqual({ transformOrigin: ["0%", "0%", 30] });
  expect(
    styleOf("a37c", `.a37c { transform-origin: center left 10px; }`),
  ).toStrictEqual({ transformOrigin: ["0%", "50%", 10] });
});

test("transform-origin: far-side keywords plus a z-offset keep all three", () => {
  expect(
    styleOf("a40", `.a40 { transform-origin: right bottom 30px; }`),
  ).toStrictEqual({ transformOrigin: ["100%", "100%", 30] });
  expect(
    styleOf("a40b", `.a40b { transform-origin: right top 8px; }`),
  ).toStrictEqual({ transformOrigin: ["100%", "0%", 8] });
  expect(
    styleOf("a40c", `.a40c { transform-origin: center bottom 5px; }`),
  ).toStrictEqual({ transformOrigin: ["50%", "100%", 5] });
});

test("transform-origin: `center center` plus a z-offset resolves both keywords", () => {
  expect(
    styleOf("a41", `.a41 { transform-origin: center center 30px; }`),
  ).toStrictEqual({ transformOrigin: ["50%", "50%", 30] });
});

test("transform-origin: a vertical keyword in the x slot resolves by axis", () => {
  // `bottom 12px` is invalid CSS — the first value of the two-value form must
  // come from `left | center | right | <length-percentage>`. lightningcss reads
  // it as a background position and hands over `x: 12px, y: bottom`, which is
  // the only reading available by the time it arrives. What matters for React
  // Native is that a KEYWORD never reaches it: `"bottom"` is neither a number
  // nor a percentage, and `processTransformOrigin` rejects it outright.
  expect(
    styleOf("a42", `.a42 { transform-origin: bottom 12px; }`),
  ).toStrictEqual({ transformOrigin: [12, "100%", 0] });
});

/* -------------------------------------------------------------------------- */
/* mix-blend-mode — css-compositing-1 §5                                       */
/* -------------------------------------------------------------------------- */

test("mix-blend-mode: keywords are case-insensitive and canonicalised", () => {
  // CSS keywords are ASCII case-insensitive, and React Native's `BlendMode`
  // union is lowercase-only — so matching has to ignore case on the way in and
  // emit the canonical spelling on the way out. A pass-through of the author's
  // casing would type-check here and be rejected by React Native at runtime.
  expect(styleOf("b1", `.b1 { mix-blend-mode: MULTIPLY; }`)).toStrictEqual({
    mixBlendMode: "multiply",
  });
  expect(styleOf("b2", `.b2 { mix-blend-mode: Multiply; }`)).toStrictEqual({
    mixBlendMode: "multiply",
  });
  // A hyphenated mode, so the canonicalisation is not just `toLowerCase` on a
  // single word.
  expect(styleOf("b13", `.b13 { mix-blend-mode: COLOR-DODGE; }`)).toStrictEqual(
    {
      mixBlendMode: "color-dodge",
    },
  );
});

test("mix-blend-mode: case-insensitivity does not widen the accepted set", () => {
  // The guard on the fix above: relaxing the comparison must not let a value
  // React Native lacks through in a different casing.
  expect(
    styleOf("b14", `.b14 { mix-blend-mode: PLUS-DARKER; }`),
  ).toBeUndefined();
  expect(styleOf("b15", `.b15 { mix-blend-mode: NONE; }`)).toBeUndefined();

  // ...and a value it DOES have is accepted in any casing.
  expect(
    styleOf("b16", `.b16 { mix-blend-mode: PLUS-LIGHTER; }`),
  ).toStrictEqual({ mixBlendMode: "plus-lighter" });
});

test("mix-blend-mode: a var() known at compile time is inlined", () => {
  expect(
    styleOf("b3", `.b3 { --m: multiply; mix-blend-mode: var(--m); }`),
  ).toStrictEqual({ mixBlendMode: "multiply" });
});

test("mix-blend-mode: a var() unresolvable at compile time falls back at runtime", () => {
  // A deferred `var()` is a style function rather than a keyword, so nothing
  // here can check it against the blend-mode list — the runtime resolver does,
  // against the same list, once the fallback has been taken. Checking only at
  // compile time discarded the declaration and lost a fallback that was written
  // as a literal keyword right beside it.
  expect(
    styleOf("b4", `.b4 { mix-blend-mode: var(--missing, screen); }`),
  ).toStrictEqual({ mixBlendMode: "screen" });
});

test("mix-blend-mode: values React Native cannot express produce no style", () => {
  // `plus-darker` is real CSS React Native does not implement; `none` and a
  // comma list are not CSS at all here (a list is `background-blend-mode`'s
  // grammar, not this property's). `plus-lighter` is deliberately absent from
  // this list — React Native does implement it.
  for (const value of [
    "plus-darker",
    "none",
    "frobnicate",
    "multiply, screen",
    "initial",
  ]) {
    expect(
      styleOf(
        `b5${value.replaceAll(/[^a-z]/gu, "")}`,
        `.b5${value.replaceAll(/[^a-z]/gu, "")} { mix-blend-mode: ${value}; }`,
      ),
    ).toBeUndefined();
  }
});

test("mix-blend-mode: a rejected value records a warning naming the property", () => {
  // `mix-blend-mode` and `isolation` are parsed through
  // `parseCustomDeclaration` — the path for everything lightningcss does not
  // model. It names the declaration it is on, like the other two declaration
  // paths, so a rejected value is reported instead of leaving the author with
  // a rule that silently did nothing.
  expect(warningsOf(`.b6 { mix-blend-mode: frobnicate; }`)).toStrictEqual({
    values: { "mix-blend-mode": ["frobnicate"] },
  });
  expect(warningsOf(`.b7 { isolation: frobnicate; }`)).toStrictEqual({
    values: { isolation: ["frobnicate"] },
  });
});

test("mix-blend-mode: a rejected value is not attributed to a neighbouring property", () => {
  // `transform-origin` compiles cleanly in both stylesheets. Attribution that
  // fell back to whichever declaration named itself last blamed it for a value
  // it never saw — first from the same rule, then from a different one.
  expect(
    warningsOf(
      `.b8 { transform-origin: 10px 20px; mix-blend-mode: frobnicate; }`,
    ),
  ).toStrictEqual({ values: { "mix-blend-mode": ["frobnicate"] } });

  expect(
    warningsOf(
      `.b9 { transform-origin: 10px 20px; } .b10 { isolation: nope; }`,
    ),
  ).toStrictEqual({ values: { isolation: ["nope"] } });
});

test("mix-blend-mode: `normal` survives although it is the initial value", () => {
  // Worth pinning next to `isolation: auto`, which lightningcss elides for
  // exactly this reason. `normal` is `mix-blend-mode`'s initial value, so the
  // two properties are treated inconsistently — this one always reaches the
  // element, and an author can use it to cancel an inherited-looking blend.
  expect(styleOf("b11", `.b11 { mix-blend-mode: normal; }`)).toStrictEqual({
    mixBlendMode: "normal",
  });
});

test("mix-blend-mode: coexists with the properties it composites against", () => {
  // A blend mode is meaningless alone; the rule that sets it almost always sets
  // a colour and an opacity too, and none of the three may displace another.
  expect(
    styleOf(
      "b12",
      `.b12 { mix-blend-mode: screen; opacity: 0.5; background-color: red; }`,
    ),
  ).toStrictEqual({
    mixBlendMode: "screen",
    opacity: 0.5,
    backgroundColor: "#f00",
  });
});

/* -------------------------------------------------------------------------- */
/* isolation — css-compositing-1 §4                                            */
/* -------------------------------------------------------------------------- */

test("isolation: keywords are case-insensitive and canonicalised", () => {
  expect(styleOf("c1", `.c1 { isolation: ISOLATE; }`)).toStrictEqual({
    isolation: "isolate",
  });
  expect(styleOf("c2", `.c2 { isolation: Isolate; }`)).toStrictEqual({
    isolation: "isolate",
  });
});

test("isolation: `auto` compiles in any casing", () => {
  // `auto` is React Native's own value (`isolation?: 'auto' | 'isolate'`), and
  // the only way to switch isolation back off — which is the whole reason the
  // keyword exists. `parseUnparsed` rejects `auto` for most properties because
  // it means "compute this yourself" there; `allowAutoProperties` is the census
  // of the properties where it is a value to emit.
  //
  // CSS keywords are ASCII case-insensitive, so all three spellings are one
  // declaration and produce one style.
  expect(styleOf("c10", `.c10 { isolation: auto; }`)).toStrictEqual({
    isolation: "auto",
  });
  expect(styleOf("c11", `.c11 { isolation: AUTO; }`)).toStrictEqual({
    isolation: "auto",
  });
  expect(styleOf("c12", `.c12 { isolation: Auto; }`)).toStrictEqual({
    isolation: "auto",
  });
});

test("isolation: a var() known at compile time is inlined", () => {
  expect(
    styleOf("c3", `.c3 { --i: isolate; isolation: var(--i); }`),
  ).toStrictEqual({ isolation: "isolate" });
});

test("isolation: a two-keyword value is rejected, in either order", () => {
  // `isolation` takes a single keyword, so `isolate auto` is invalid CSS and
  // produces no style. It reaches the parser as the two-element list it was
  // written as, which is what makes the rejection possible: while `auto` was
  // being eaten upstream the parser saw the one string `"isolate"` and could
  // not tell a malformed pair from a correct single keyword — so both orders
  // silently switched isolation ON.
  expect(styleOf("c6", `.c6 { isolation: isolate auto; }`)).toBeUndefined();
  expect(styleOf("c7", `.c7 { isolation: auto isolate; }`)).toBeUndefined();
  expect(warningsOf(`.c8 { isolation: isolate auto; }`)).toStrictEqual({
    values: { isolation: [`["isolate","auto"]`] },
  });

  // `mix-blend-mode` rejects the equivalent shape, and now for the same reason
  // rather than by accident of which keyword survived.
  expect(
    styleOf("c9", `.c9 { mix-blend-mode: multiply screen; }`),
  ).toBeUndefined();
});

test("isolation: values outside the two-keyword grammar produce no style", () => {
  for (const value of ["frobnicate", "initial", "inherit"]) {
    const className = `c4${value.replaceAll(/[^a-z]/gu, "")}`;
    expect(
      styleOf(className, `.${className} { isolation: ${value}; }`),
    ).toBeUndefined();
  }
});

test("isolation: an isolate/blend pair is emitted together", () => {
  // `isolation: isolate` exists to bound the group a `mix-blend-mode` composites
  // into, so the pair on one rule is the normal authoring shape.
  expect(
    styleOf(
      "c5",
      `.c5 { isolation: isolate; mix-blend-mode: overlay; opacity: 0.5; }`,
    ),
  ).toStrictEqual({
    isolation: "isolate",
    mixBlendMode: "overlay",
    opacity: 0.5,
  });
});

/* -------------------------------------------------------------------------- */
/* cascade contexts — the value has to survive to the element                  */
/* -------------------------------------------------------------------------- */

test("all three survive an `!important` declaration", () => {
  expect(
    styleOf("d1", `.d1 { transform-origin: 10px 20px !important; }`),
  ).toStrictEqual({ transformOrigin: [10, 20, 0] });
  expect(
    styleOf("d2", `.d2 { mix-blend-mode: darken !important; }`),
  ).toStrictEqual({ mixBlendMode: "darken" });
  expect(styleOf("d3", `.d3 { isolation: isolate !important; }`)).toStrictEqual(
    { isolation: "isolate" },
  );
});

test("`!important` outranks a higher-specificity normal declaration", () => {
  // Origin order and specificity both favour the `#x.d4` rule; only the
  // important flag can invert that, so this proves the flag is carried into the
  // cascade rather than merely tolerated by the parser.
  expect(
    styleOf(
      "d4",
      `.d4 { transform-origin: 1px 2px !important; } #x.d4 { transform-origin: 3px 4px; }`,
    ),
  ).toStrictEqual({ transformOrigin: [1, 2, 0] });
});

test("a later rule of equal specificity wins", () => {
  expect(
    styleOf(
      "d5",
      `.d5 { transform-origin: 10px 20px; } .d5 { transform-origin: right bottom; }`,
    ),
  ).toStrictEqual({ transformOrigin: ["100%", "100%", 0] });
});

test("all three survive a matching @media block", () => {
  expect(
    styleOf(
      "d6",
      `@media (min-width: 1px) { .d6 { transform-origin: 10px 20px; mix-blend-mode: lighten; isolation: isolate; } }`,
    ),
  ).toStrictEqual({
    transformOrigin: [10, 20, 0],
    mixBlendMode: "lighten",
    isolation: "isolate",
  });
});

test("none of the three leaks out of a non-matching @media block", () => {
  expect(
    styleOf(
      "d7",
      `@media (min-width: 99999px) { .d7 { transform-origin: 1px 2px; mix-blend-mode: screen; isolation: isolate; } }`,
    ),
  ).toBeUndefined();
});

test("all three re-resolve when the colour scheme changes", () => {
  registerCSS(`
    .d8 { transform-origin: 10px 20px; mix-blend-mode: multiply; isolation: isolate; }
    @media (prefers-color-scheme: dark) {
      .d8 { transform-origin: right bottom; mix-blend-mode: screen; }
    }`);

  const component = render(<View testID={testID} className="d8" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({
    transformOrigin: [10, 20, 0],
    mixBlendMode: "multiply",
    isolation: "isolate",
  });

  act(() => {
    colorScheme.set("dark");
  });

  expect(component.props.style).toStrictEqual({
    transformOrigin: ["100%", "100%", 0],
    mixBlendMode: "screen",
    isolation: "isolate",
  });
});

test.each([
  ["d9", "auto"],
  ["d10", "AUTO"],
])(
  "a dark-scheme `isolation: %s` cancels a light-scheme `isolate`",
  (className, spelling) => {
    // Turning isolation back off is the whole job of the `auto` keyword, and
    // this is the shape it is written in: a base rule isolates, a scheme rule
    // undoes it. Both casings are the same declaration to CSS, so both reach
    // the override — one keyword being dropped and the other refused for
    // consistency with it left the override with no spelling at all.
    registerCSS(`
    .${className} { isolation: isolate; }
    @media (prefers-color-scheme: dark) {
      .${className} { isolation: ${spelling}; }
    }`);

    const component = render(
      <View testID={testID} className={className} />,
    ).getByTestId(testID);

    expect(component.props.style).toStrictEqual({ isolation: "isolate" });

    act(() => {
      colorScheme.set("dark");
    });

    expect(component.props.style).toStrictEqual({ isolation: "auto" });
  },
);
