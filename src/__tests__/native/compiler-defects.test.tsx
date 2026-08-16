import { render } from "@testing-library/react-native";
import { compile } from "react-native-css/compiler";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

import { renderRoutes, type RouteRenders } from "./_routes/harness";

/**
 * Ten compiler defects, each one a value that reaches React Native as something
 * React Native cannot read — a CSS-wide keyword shipped as a colour, a style
 * key React Native has never had, a length whose unit was folded away before
 * the consumer could ask what it meant.
 *
 * Each has the same failure signature: the CSS is correct, the compile is
 * clean, and the element renders wrong or renders nothing. That is what makes
 * them expensive — there is no error to search for, so the only way they get
 * found is by reading the style object React Native actually received. Which is
 * what every test below does.
 */

/** The rules a stylesheet compiles to, as the runtime receives them. */
function compiled(css: string) {
  const output = compile(css);

  return {
    stylesheet: output.stylesheet(),
    warnings: output.warnings(),
  };
}

/** The style React Native receives for one class on a `<View>`. */
function viewStyle(css: string, className: string): unknown {
  registerCSS(css);

  return render(<View testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style;
}

/*****************************************************************************
 * 1. A CSS-wide keyword is not a value, so it must not be published as one
 ****************************************************************************/

test("`color: unset` does not shadow the ancestor's published colour", () => {
  registerCSS(`.g { color: red } .m { color: unset }`);

  const element = render(
    <View className="g">
      <View className="m">
        <Text testID={testID} />
      </View>
    </View>,
  ).getByTestId(testID);

  // css-cascade-4 §7.3: `unset` computes to `inherit` on an inherited property,
  // so the `<Text>` takes the grandparent's red. Publishing `unset` as the
  // value of `--__rn-css-inherit-color` shadowed that entry with a non-value,
  // and `resolveValue` maps `unset` to `null` — which is a colour React Native
  // renders as transparent, not an absence.
  expect(element.props.style).toStrictEqual({ color: "#f00" });
});

test("`color: unset` does not republish the variable it reads", () => {
  const { stylesheet } = compiled(`.m { color: unset }`);
  const rule = stylesheet.s?.[0]?.[1]?.[0];

  // Nothing is published, and that absence is the point: a rule that
  // republished the channel it reads would shadow the ancestor's colour with a
  // lookup pointing at itself. Withholding leaves the ancestor's entry
  // standing, which is what `unset` on an inherited property asks for.
  expect(rule?.v).toBeUndefined();
  // The element's own colour is the inherited-scope lookup, so it renders the
  // ancestor's colour rather than the `null` the bare keyword resolved to —
  // which React Native reads as transparent, not as an absence.
  expect(rule?.d).toStrictEqual([
    [[{}, "inheritedVar", "__rn-css-inherit-color"], "color", 1],
  ]);
});

test("`currentcolor` inside an `unset` rule reads the inherited colour", () => {
  registerCSS(`
    .g { color: red }
    .m { color: unset; border-color: currentcolor }
  `);

  const element = render(
    <View className="g">
      <View testID={testID} className="m" />
    </View>,
  ).getByTestId(testID);

  // Both read the grandparent's published red: `unset` computes to `inherit`
  // on an inherited property, and `currentcolor` is the same lookup — so the
  // two spellings agree, which is the identity css-color-4 defines.
  expect(element.props.style).toStrictEqual({
    color: "#f00",
    borderColor: "#f00",
  });
});

/*****************************************************************************
 * 2. `revert` and `revert-layer` are keywords, not colours
 ****************************************************************************/

test("every CSS-wide keyword with no React Native form is dropped with a warning", () => {
  // `inherit` is deliberately absent from this list: on `color` it DOES have a
  // React Native form — an inherited-scope read of the channel every colour
  // declaration publishes — so it resolves rather than being dropped, and the test above
  // pins that. The three below have nothing to resolve through: `initial`
  // wants a UA stylesheet and `revert` / `revert-layer` want a cascade origin,
  // neither of which React Native has.
  for (const keyword of ["initial", "revert", "revert-layer"]) {
    const { stylesheet, warnings } = compiled(`.a { color: ${keyword} }`);

    expect({ keyword, stylesheet, warnings }).toStrictEqual({
      keyword,
      stylesheet: {},
      warnings: { values: { color: [keyword] } },
    });
  }
});

test("`revert` does not reach the element as a colour", () => {
  expect(viewStyle(`.a { color: revert }`, "a")).toBeUndefined();
});

/*****************************************************************************
 * 3. A percentage font-size is a multiple of the parent's, i.e. an `em`
 ****************************************************************************/

test("a percentage font-size compiles to the `em` resolver", () => {
  const { stylesheet } = compiled(`.a { font-size: 150% }`);
  const rule = stylesheet.s?.[0]?.[1]?.[0];

  // css-fonts-4 §3.5: a `<percentage>` font-size is relative to the parent's
  // computed size, which is what `em` measures. React Native's `fontSize` is a
  // number, so `"150%"` reached it as a string it drops.
  expect(rule?.d).toStrictEqual([[[{}, "em", 1.5, 1], "fontSize", 1]]);
});

test("a percentage font-size renders as a multiple of the ancestor's", () => {
  registerCSS(`.parent { font-size: 20px } .child { font-size: 150% }`);

  const element = render(
    <Text className="parent">
      <Text testID={testID} className="child" />
    </Text>,
  ).getByTestId(testID);

  // 1.5 x the ancestor's 20. `publishEmVariable` skips an em-valued font size,
  // so `.child` publishes no `--__rn-css-em` of its own and the `em` resolves
  // against the size it is a multiple OF, which is what the percentage means.
  expect(element.props.style).toStrictEqual({ fontSize: 30 });
});

/*****************************************************************************
 * 4. A dropped shadow says so
 ****************************************************************************/

test("a multi-shadow `text-shadow` warns about the shadows it cannot carry", () => {
  const { warnings } = compiled(
    `.a { text-shadow: 1px 1px 1px red, 2px 2px 2px blue }`,
  );

  // React Native has one `textShadowColor` / `textShadowOffset` /
  // `textShadowRadius` triple per element, so only the first shadow can be
  // rendered. The drop is forced; the silence was not.
  expect(warnings).toStrictEqual({
    // The geometry names the dropped shadow. The colour is not reconstructed:
    // `parseColor` is the only thing that can spell a `CssColor` back and it
    // registers a `light-dark()` dark rule as a side effect, which a shadow
    // nothing draws must not do.
    values: { "text-shadow": ["2px 2px 2px"] },
  });
});

test("a single `text-shadow` still warns about nothing", () => {
  expect(
    compiled(`.a { text-shadow: 1px 1px 1px red }`).warnings,
  ).toStrictEqual({});
});

/*****************************************************************************
 * 5. `flex-basis: auto` is a value React Native renders
 ****************************************************************************/

test("`flex-basis: auto` survives the compile-time route", () => {
  expect(viewStyle(`.a { flex-basis: auto }`, "a")).toStrictEqual({
    flexBasis: "auto",
  });
});

test("`flex: auto` keeps its basis", () => {
  // The shorthand is `1 1 auto` (css-flexbox-1 §7.1.1), so the basis is the
  // whole difference between `flex: auto` and `flex: 1`.
  expect(viewStyle(`.a { flex: auto }`, "a")).toStrictEqual({
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
  });
});

test("`flex-basis: auto` agrees on every route", () => {
  expectRoutesAgree(
    renderRoutes({
      property: "flex-basis",
      value: "auto",
      alternate: "120px",
    }),
  );
});

/*****************************************************************************
 * 6. The inline border edges, under React Native's own name for them
 ****************************************************************************/

test("the inline border edges reach React Native's `borderStart*` / `borderEnd*`", () => {
  // `ReactNativeStyleAttributes.js` — the `style` validAttributes both
  // platforms build their view config from — carries `borderStartColor` /
  // `borderEndColor` and `borderStartWidth` / `borderEndWidth`, and no
  // `borderInline*` key of any kind. The two names are ONE property: React
  // Native's start/end swap with `direction` exactly as CSS's inline start and
  // end do, so nothing is lost in the rename. Spelled `borderInlineStartColor`
  // the declaration compiled, produced a style object, and rendered nothing.
  for (const [css, style] of [
    [
      "border-inline: 2px solid red",
      {
        borderStartColor: "#f00",
        borderEndColor: "#f00",
        borderStartWidth: 2,
        borderEndWidth: 2,
      },
    ],
    [
      "border-inline-color: red blue",
      { borderStartColor: "#f00", borderEndColor: "#00f" },
    ],
    [
      "border-inline-width: 1px 2px",
      { borderStartWidth: 1, borderEndWidth: 2 },
    ],
    [
      // No axis key to collapse onto, so one value still writes both edges.
      "border-inline-color: red",
      { borderStartColor: "#f00", borderEndColor: "#f00" },
    ],
    ["border-inline-start-color: red", { borderStartColor: "#f00" }],
    ["border-inline-end-width: 2px", { borderEndWidth: 2 }],
    [
      "border-inline-start: 2px solid red",
      { borderStartColor: "#f00", borderStartWidth: 2 },
    ],
  ] as const) {
    expect([css, viewStyle(`.a { ${css} }`, "a")]).toStrictEqual([css, style]);
  }
});

test("the block axis keeps the one key React Native has for it", () => {
  // The COLOUR is that key: `borderBlockColor`, `borderBlockStartColor` and
  // `borderBlockEndColor` are in `ReactNativeStyleAttributes`, in both
  // `BaseViewConfig`s and in `ViewStyle`, so the axis collapses onto it rather
  // than writing two edges.
  expect(viewStyle(`.a { border-block-color: red }`, "a")).toStrictEqual({
    borderBlockColor: "#f00",
  });

  // The WIDTH is not. `borderBlockWidth` lives in `BaseViewConfig.ios.js` and
  // nowhere else, so writing it paints on iOS Fabric and vanishes on Android
  // and the old architecture — which is how Tailwind's `border-y-*` drew
  // nothing there. `direction` never flips the block axis, so the physical top
  // and bottom carry it on every platform, exactly rather than approximately.
  expect(viewStyle(`.a { border-block-width: 1px }`, "a")).toStrictEqual({
    borderTopWidth: 1,
    borderBottomWidth: 1,
  });
});

test("a per-edge border style is dropped, on either axis", () => {
  // React Native's only border style is `borderStyle` and it applies to the
  // whole box, so there is nothing for one axis or one edge to map to — and no
  // layer of React Native reads a per-edge style name at all. Emitting the
  // faithful CSS key would put a declaration into the style object that reads
  // exactly like a live one and renders nothing, so the declaration drops and
  // a non-`solid` value is warned about. Mapping onto `borderStyle` is the
  // other thing this is not: it would style edges nobody asked for.
  for (const css of [
    "border-inline-style: solid",
    "border-block-style: solid",
    "border-inline-start-style: solid",
    "border-block-end-style: solid",
  ] as const) {
    expect([css, viewStyle(`.a { ${css} }`, "a")]).toStrictEqual([
      css,
      undefined,
    ]);
  }
});

/*****************************************************************************
 * 7. `light-dark()` on the two-edge border-colour shorthands
 ****************************************************************************/

test("`border-block-color: light-dark()` settles the collapse before it parses", () => {
  // The collapse decides which key `parseColor` is told about, and `parseColor`
  // uses that key to register the `light-dark()` DARK rule — so a collapse
  // taken on the parsed values arrives too late. It put the LIGHT value on
  // `borderBlockColor` while the dark halves were already on `borderTopColor` /
  // `borderBottomColor`, and in dark mode the element carried all three.
  //
  // The sources are also the only comparison that separates
  // `light-dark(#333, #eee)` from `light-dark(#333, #000)`: both halves parse
  // to `#333`, and only one of those pairs may collapse.
  const { stylesheet } = compiled(
    `.b { border-block-color: light-dark(#333, #eee) }`,
  );

  expect(stylesheet.s?.[0]?.[1]).toStrictEqual([
    { s: [1, 1], d: [{ borderBlockColor: "#333" }] },
    {
      s: [1, 1],
      d: [{ borderBlockColor: "#eee" }],
      m: [["=", "prefers-color-scheme", "dark"]],
    },
  ]);
});

test("`border-inline-color: light-dark()` puts both halves on the same two edges", () => {
  // The inline axis never collapses — React Native has no key for the pair —
  // so the fault could not take the same shape here. It is pinned anyway: the
  // light and dark values have to land on the SAME keys, which is the invariant
  // the block-axis collapse broke.
  const { stylesheet } = compiled(
    `.b { border-inline-color: light-dark(#333, #eee) }`,
  );

  expect(stylesheet.s?.[0]?.[1]).toStrictEqual([
    { s: [1, 1], d: [{ borderStartColor: "#333", borderEndColor: "#333" }] },
    {
      s: [1, 1],
      d: [{ borderStartColor: "#eee" }],
      m: [["=", "prefers-color-scheme", "dark"]],
    },
    {
      s: [1, 1],
      d: [{ borderEndColor: "#eee" }],
      m: [["=", "prefers-color-scheme", "dark"]],
    },
  ]);
});

test("the two-edge border-colour shorthands still split two different colours", () => {
  expect(viewStyle(`.a { border-block-color: red blue }`, "a")).toStrictEqual({
    borderTopColor: "#f00",
    borderBottomColor: "#00f",
  });

  expect(viewStyle(`.a { border-inline-color: red blue }`, "a")).toStrictEqual({
    borderStartColor: "#f00",
    borderEndColor: "#00f",
  });
});

/*****************************************************************************
 * 9. A custom property keeps the unit its consumer needs
 ****************************************************************************/

test("a `px` length in a custom property keeps its unit", () => {
  const { stylesheet } = compiled(
    `:root { --a: 24px } @media print { :root { --a: 32px } }`,
  );

  // A custom property's value is an uninterpreted token stream (css-variables-1
  // §2), so the consumer is the only thing that knows what it means. Folded to
  // the bare number `24`, `line-height` reads it as a RATIO and multiplies by
  // the font size.
  expect(stylesheet.vr?.[0]?.[1]?.[0]).toStrictEqual(["24px"]);
});

test("`line-height` through a custom property renders the length", () => {
  const renders = renderRoutes({
    property: "line-height",
    value: "24px",
    alternate: "32px",
    surface: "text",
  });

  // The `var()` fallback route is the one that needs saying twice. `var(--never,
  // 24px)` is parsed under `line-height`, so the consuming property is known and
  // the value is correctly read as a length — but it is then STORED inside the
  // style function and read back by `resolveDimension`, which stands where the
  // custom property's consumer stands. Both halves have to agree that the value
  // is a stored one, or the unit is dropped and 24 renders as 24 x the font size.
  expect({
    inlinable: renders.inlinable,
    deferred: renders.deferred,
    provider: renders.provider,
    fallback: renders.fallback,
  }).toStrictEqual({
    inlinable: renders.literal,
    deferred: renders.literal,
    provider: renders.literal,
    fallback: renders.literal,
  });
});

/*****************************************************************************
 * 10. A `var()` whose arity is unknown must not be pre-wrapped
 ****************************************************************************/

test("`filter` through a var() is flattened, because its arity is a runtime fact", () => {
  // React Native's own processor is the authority on the target shape, so it is
  // asked here rather than inferred from the route comparison.
  const processFilter = jest.requireActual<{
    default: (filter: unknown) => unknown[];
  }>("react-native/Libraries/StyleSheet/processFilter").default;

  const flat = [{ blur: 4 }, { brightness: 0.5 }];

  expect(processFilter(flat)).toStrictEqual(flat);
  // One bad entry discards the whole declaration, so a nested list is a silent
  // TOTAL loss rather than a partial one.
  expect(processFilter([flat])).toStrictEqual([]);
  // And an unwrapped single entry is worse than either.
  expect(() => processFilter({ blur: 4 })).toThrow(TypeError);

  // Those three are why the shape cannot be decided at compile time.
  // `filter: var(--f)` is ONE reference whose arity is known only once it
  // resolves — one entry for `--f: blur(4px)`, two for
  // `--f: blur(4px) brightness(0.5)` — so either compile-time choice is wrong
  // for one of them: wrap, and the multi case is discarded to `[]`; do not
  // wrap, and the single case throws.
  //
  // So the decision belongs where the arity is known, which is the runtime.
  // `"filter"` sits in `unparsedRuntimeParsing` and `filter.ts` is its
  // resolver — `transform`'s shape, and for the same reason. The two halves
  // only work together: the registry entry without the resolver drops every
  // filter, because `resolveValue` finds no resolver of that name.
  const renders = renderRoutes({
    property: "filter",
    value: "blur(4px) brightness(0.5)",
    alternate: "grayscale(1)",
  });

  expectRoutesAgree(renders);
  expect(renders.deferred.style).toStrictEqual({ filter: flat });

  // The single-entry case is the other half of the arity problem, and takes the
  // same route — a lone entry arrives wrapped, never bare.
  const single = renderRoutes({
    property: "filter",
    value: "blur(4px)",
    alternate: "grayscale(1)",
  });

  expectRoutesAgree(single);
  expect(single.deferred.style).toStrictEqual({ filter: [{ blur: 4 }] });
});

/** Every route rendered the same style as the literal one. */
function expectRoutesAgree(renders: RouteRenders): void {
  expect({
    inlinable: renders.inlinable,
    fallback: renders.fallback,
    deferred: renders.deferred,
    provider: renders.provider,
  }).toStrictEqual({
    inlinable: renders.literal,
    fallback: renders.literal,
    deferred: renders.literal,
    provider: renders.literal,
  });
}
