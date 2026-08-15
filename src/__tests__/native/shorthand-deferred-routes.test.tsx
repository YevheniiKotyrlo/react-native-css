/**
 * Shorthands whose value is only known once a `var()` has been read.
 *
 * A shorthand written literally is expanded by the per-property parsers in
 * `src/compiler/declarations.ts`. The same shorthand written as `var(--x)`,
 * where `--x` has two definitions and so cannot be folded in at compile time,
 * is expanded by a resolver of the same name in
 * `src/native/styles/shorthands/`. The two must produce the same style: React
 * Native has no array form for `margin` and no keyword form for `flex`, so a
 * value left on the shorthand key is a rule that renders as nothing.
 *
 * Every test below states the literal result and the deferred result for one
 * value and asserts they are the same, or pins the one place they are not.
 */
import { render } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

/**
 * `toJSON()` rather than `getByTestId` — an all-dropped rule leaves no `style`
 * prop at all, and a `display: none` element is excluded from the query tree.
 */
function styleFor(className: string): unknown {
  const tree = render(
    <View testID={testID} className={className} />,
  ).toJSON() as unknown as { props: { style?: unknown } };
  return tree.props.style;
}

interface RouteCase {
  readonly property: string;
  readonly value: string;
  readonly expected: unknown;
}

/**
 * Registers one stylesheet carrying both routes for every case, then asserts
 * each produces `expected`.
 *
 * `--deferred<n>` is declared twice so the inliner cannot fold it into the
 * declaration; the second definition is what forces the value to be resolved on
 * the device rather than in the compiler.
 */
function expectBothRoutesAgree(cases: readonly RouteCase[]): void {
  registerCSS(`
    :root { ${cases.map((c, index) => `--deferred${index}: ${c.value};`).join(" ")} }
    @media (prefers-color-scheme: dark) {
      :root { ${cases.map((_, index) => `--deferred${index}: inherit;`).join(" ")} }
    }
    ${cases
      .map(
        (c, index) => `
      .literal${index} { ${c.property}: ${c.value}; }
      .deferred${index} { ${c.property}: var(--deferred${index}); }
    `,
      )
      .join("\n")}
  `);

  for (const [index, routeCase] of cases.entries()) {
    const declaration = `${routeCase.property}: ${routeCase.value}`;

    expect({
      declaration,
      literal: styleFor(`literal${index}`),
      deferred: styleFor(`deferred${index}`),
    }).toStrictEqual({
      declaration,
      literal: routeCase.expected,
      deferred: routeCase.expected,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* THE FOUR-SIDED BOX SHORTHANDS                                              */
/* -------------------------------------------------------------------------- */

test("margin expands to its four sides on both routes, at every value count", () => {
  expectBothRoutesAgree([
    { property: "margin", value: "10px", expected: { margin: 10 } },
    {
      property: "margin",
      value: "10px 20px",
      expected: {
        marginTop: 10,
        marginRight: 20,
        marginBottom: 10,
        marginLeft: 20,
      },
    },
    {
      property: "margin",
      value: "1px 2px 3px",
      expected: {
        marginTop: 1,
        marginRight: 2,
        marginBottom: 3,
        marginLeft: 2,
      },
    },
    {
      property: "margin",
      value: "1px 2px 3px 4px",
      expected: {
        marginTop: 1,
        marginRight: 2,
        marginBottom: 3,
        marginLeft: 4,
      },
    },
    {
      property: "margin",
      value: "10% 20%",
      expected: {
        marginTop: "10%",
        marginRight: "20%",
        marginBottom: "10%",
        marginLeft: "20%",
      },
    },
  ]);
});

test("padding, inset and border-width expand to their four sides on both routes", () => {
  expectBothRoutesAgree([
    {
      property: "padding",
      value: "1px 2px 3px 4px",
      expected: {
        paddingTop: 1,
        paddingRight: 2,
        paddingBottom: 3,
        paddingLeft: 4,
      },
    },
    {
      property: "padding",
      value: "10px 20px",
      expected: {
        paddingTop: 10,
        paddingRight: 20,
        paddingBottom: 10,
        paddingLeft: 20,
      },
    },
    {
      property: "inset",
      value: "1px 2px 3px 4px",
      expected: { top: 1, right: 2, bottom: 3, left: 4 },
    },
    {
      property: "inset",
      value: "10px 20px",
      expected: { top: 10, right: 20, bottom: 10, left: 20 },
    },
    {
      property: "border-width",
      value: "1px 2px 3px 4px",
      expected: {
        borderTopWidth: 1,
        borderRightWidth: 2,
        borderBottomWidth: 3,
        borderLeftWidth: 4,
      },
    },
    {
      property: "border-width",
      value: "1px 2px",
      expected: {
        borderTopWidth: 1,
        borderRightWidth: 2,
        borderBottomWidth: 1,
        borderLeftWidth: 2,
      },
    },
    { property: "border-width", value: "2px", expected: { borderWidth: 2 } },
  ]);
});

test("border-radius expands to its four corners on both routes", () => {
  expectBothRoutesAgree([
    { property: "border-radius", value: "5px", expected: { borderRadius: 5 } },
    {
      property: "border-radius",
      value: "1px 2px",
      expected: {
        borderTopLeftRadius: 1,
        borderTopRightRadius: 2,
        borderBottomRightRadius: 1,
        borderBottomLeftRadius: 2,
      },
    },
    {
      property: "border-radius",
      value: "1px 2px 3px",
      expected: {
        borderTopLeftRadius: 1,
        borderTopRightRadius: 2,
        borderBottomRightRadius: 3,
        borderBottomLeftRadius: 2,
      },
    },
    {
      property: "border-radius",
      value: "1px 2px 3px 4px",
      expected: {
        borderTopLeftRadius: 1,
        borderTopRightRadius: 2,
        borderBottomRightRadius: 3,
        borderBottomLeftRadius: 4,
      },
    },
  ]);
});

test("the vertical half of an elliptical border-radius is discarded on both routes", () => {
  // React Native has one radius per corner, so the values after the `/` name an
  // ellipse it cannot draw.
  expectBothRoutesAgree([
    {
      property: "border-radius",
      value: "1px / 20%",
      expected: { borderRadius: 1 },
    },
  ]);
});

/* -------------------------------------------------------------------------- */
/* THE TWO-VALUE AXIS SHORTHANDS                                              */
/* -------------------------------------------------------------------------- */

test("the block and inline box shorthands expand to their two edges on both routes", () => {
  expectBothRoutesAgree([
    {
      property: "margin-block",
      value: "10px 20px",
      expected: { marginBlockStart: 10, marginBlockEnd: 20 },
    },
    {
      property: "margin-inline",
      value: "10px 20px",
      expected: { marginInlineStart: 10, marginInlineEnd: 20 },
    },
    {
      property: "padding-block",
      value: "10px 20px",
      expected: { paddingBlockStart: 10, paddingBlockEnd: 20 },
    },
    {
      property: "padding-inline",
      value: "10px 20px",
      expected: { paddingInlineStart: 10, paddingInlineEnd: 20 },
    },
    {
      property: "inset-block",
      value: "10px 20px",
      expected: { insetBlockStart: 10, insetBlockEnd: 20 },
    },
    {
      property: "inset-inline",
      value: "10px 20px",
      expected: { insetInlineStart: 10, insetInlineEnd: 20 },
    },
    {
      property: "margin-inline",
      value: "10px",
      expected: { marginInline: 10 },
    },
  ]);
});

test("the block-axis border shorthands expand to their two edges on both routes", () => {
  expectBothRoutesAgree([
    // The block WIDTHS reach the physical edges. `borderBlockWidth` and its two
    // per-edge twins are in `BaseViewConfig.ios.js` and nowhere else, so a
    // width written to them paints on iOS Fabric and vanishes on Android and
    // the old architecture; `direction` never flips this axis, so top and
    // bottom carry it exactly rather than approximately.
    {
      property: "border-block-width",
      value: "2px",
      expected: { borderTopWidth: 2, borderBottomWidth: 2 },
    },
    // Every per-edge STYLE drops on both axes. React Native has one
    // `borderStyle` for the whole box at every layer, so there is no key for an
    // edge to reach — and an inert CSS-spelled key in the style object reads
    // exactly like a live declaration to everything downstream.
    {
      property: "border-block-style",
      value: "solid dashed",
      expected: undefined,
    },
    {
      property: "border-inline-style",
      value: "solid dashed",
      expected: undefined,
    },
    {
      property: "border-inline-style",
      value: "solid",
      expected: undefined,
    },
  ]);
});

test("border colours expand to their sides on both routes", () => {
  // React Native names the block axis by physical edge (top/bottom) and the
  // inline axis the way CSS does — `borderStartColor` / `borderEndColor` are
  // direction-aware exactly as `border-inline-start` / `-end` are, so the two
  // names are one property. Hexadecimal values, because the two routes spell a
  // NAMED colour differently — the literal route normalises it and the deferred
  // route forwards the name — which is a question about colours rather than
  // about the expansion under test.
  expectBothRoutesAgree([
    {
      property: "border-color",
      value: "#123456 #654321",
      expected: {
        borderTopColor: "#123456",
        borderRightColor: "#654321",
        borderBottomColor: "#123456",
        borderLeftColor: "#654321",
      },
    },
    {
      property: "border-color",
      value: "#123456",
      expected: { borderColor: "#123456" },
    },
  ]);
});

test("gap expands to rowGap/columnGap when the axes differ, and collapses when they agree", () => {
  expectBothRoutesAgree([
    { property: "gap", value: "10px", expected: { gap: 10 } },
    {
      property: "gap",
      value: "10px 20px",
      expected: { rowGap: 10, columnGap: 20 },
    },
    {
      property: "gap",
      value: "10px 20%",
      expected: { rowGap: 10, columnGap: "20%" },
    },
  ]);
});

test("place-content expands to both axes; place-items and place-self keep the block axis", () => {
  // React Native has no `justifyItems` and no `justifySelf`, so the inline
  // value is read and discarded — which is what the literal route does with it.
  expectBothRoutesAgree([
    {
      property: "place-content",
      value: "center",
      expected: { alignContent: "center", justifyContent: "center" },
    },
    {
      property: "place-content",
      value: "center space-between",
      expected: { alignContent: "center", justifyContent: "space-between" },
    },
    {
      property: "place-items",
      value: "center",
      expected: { alignItems: "center" },
    },
    {
      property: "place-items",
      value: "center flex-start",
      expected: { alignItems: "center" },
    },
    {
      property: "place-self",
      value: "center",
      expected: { alignSelf: "center" },
    },
    {
      property: "place-self",
      value: "center flex-start",
      expected: { alignSelf: "center" },
    },
  ]);
});

test("overflow keeps its block axis on both routes", () => {
  expectBothRoutesAgree([
    { property: "overflow", value: "hidden", expected: { overflow: "hidden" } },
    {
      property: "overflow",
      value: "hidden scroll",
      expected: { overflow: "hidden" },
    },
  ]);
});

/**
 * The one two-edge case the routes do NOT agree on, on either axis.
 *
 * A logical axis shorthand is expanded at COMPILE time, by counting the
 * component values the declaration is written with. `var(--pair)` is one
 * component value however many values it later resolves to, so the whole list
 * is assigned to the target the one-value arity picks — both edges, or the axis
 * property where React Native has one. The literal route counts two and splits.
 *
 * It is pinned rather than fixed because the count cannot be taken here: the
 * expansion runs before the variable resolves. Deferring the whole axis to a
 * runtime resolver, which is how `border-width` above splits the same value
 * correctly, trades this for a worse defect — the resolver writes its keys after
 * the flat ones, so a later `border-block-color: green` on the same element
 * loses to a var() written before it. `native/logical-borders.test.tsx`'s
 * cascade test is what holds that, and it is why the axes are expanded here.
 */
test("a two-value var() is one component, so an axis shorthand assigns it whole", () => {
  const pairs = [
    ["border-block-color", "#123456 #654321", ["borderBlockColor"]],
    [
      "border-inline-color",
      "#123456 #654321",
      ["borderStartColor", "borderEndColor"],
    ],
    ["border-block-width", "1px 2px", ["borderTopWidth", "borderBottomWidth"]],
    ["border-inline-width", "1px 2px", ["borderStartWidth", "borderEndWidth"]],
  ] as const;

  registerCSS(`
    :root { ${pairs.map((pair, index) => `--pair${index}: ${pair[1]};`).join(" ")} }
    @media (prefers-color-scheme: dark) {
      :root { ${pairs.map((_, index) => `--pair${index}: inherit;`).join(" ")} }
    }
    ${pairs
      .map(
        (pair, index) => `.pair${index} { ${pair[0]}: var(--pair${index}); }`,
      )
      .join(" ")}
  `);

  for (const [index, [property, value, targets]] of pairs.entries()) {
    const whole = value
      .split(" ")
      .map((part) => (part.endsWith("px") ? Number.parseInt(part, 10) : part));

    expect({ property, style: styleFor(`pair${index}`) }).toStrictEqual({
      property,
      style: Object.fromEntries(targets.map((target) => [target, whole])),
    });
  }
});

/* -------------------------------------------------------------------------- */
/* auto — legal for margin, and for nothing else in the box model             */
/* -------------------------------------------------------------------------- */

test("margin keeps `auto` per side on both routes", () => {
  expectBothRoutesAgree([
    { property: "margin", value: "auto", expected: { margin: "auto" } },
    {
      property: "margin",
      value: "auto 10px",
      expected: {
        marginTop: "auto",
        marginRight: 10,
        marginBottom: "auto",
        marginLeft: 10,
      },
    },
  ]);
});

test("padding and inset drop the sides given `auto`, on both routes", () => {
  // `auto` is not in either grammar, and the side that received it has no value
  // to write — the sides that got a length still do.
  expectBothRoutesAgree([
    {
      property: "padding",
      value: "auto 10px",
      expected: { paddingRight: 10, paddingLeft: 10 },
    },
    {
      property: "inset",
      value: "auto 10px",
      expected: { right: 10, left: 10 },
    },
  ]);
});

/* -------------------------------------------------------------------------- */
/* flex                                                                       */
/* -------------------------------------------------------------------------- */

test("flex expands to its three longhands on both routes", () => {
  expectBothRoutesAgree([
    {
      property: "flex",
      value: "1",
      expected: { flexGrow: 1, flexShrink: 1, flexBasis: "0%" },
    },
    {
      property: "flex",
      value: "2",
      expected: { flexGrow: 2, flexShrink: 1, flexBasis: "0%" },
    },
    {
      property: "flex",
      value: "1 2",
      expected: { flexGrow: 1, flexShrink: 2, flexBasis: "0%" },
    },
    {
      property: "flex",
      value: "1 2 3px",
      expected: { flexGrow: 1, flexShrink: 2, flexBasis: 3 },
    },
    {
      property: "flex",
      value: "1 1 0%",
      expected: { flexGrow: 1, flexShrink: 1, flexBasis: "0%" },
    },
    {
      property: "flex",
      value: "50%",
      expected: { flexGrow: 1, flexShrink: 1, flexBasis: "50%" },
    },
    {
      property: "flex",
      value: "1 50%",
      expected: { flexGrow: 1, flexShrink: 1, flexBasis: "50%" },
    },
  ]);
});

test("flex keyword forms expand to their grow/shrink/basis triple on both routes", () => {
  // css-flexbox-1 §7.1.1: `auto` is `1 1 auto` and `none` is `0 0 auto`. The
  // basis is the whole difference between `flex: auto` and `flex: 1`, and
  // `flexBasis` is a `DimensionValue` — a union that includes `"auto"`
  // (`StyleSheetTypes.d.ts`) — so the keyword is a value React Native reads,
  // and writing it is what resets a basis an earlier rule set.
  //
  // SUSPECTED DEFECT: the deferred route omits `flexBasis` for every keyword
  // basis. `native/styles/shorthands/flex.ts` withholds the key whenever the
  // basis is `auto`, on the stated premise that the compile-time route cannot
  // express the keyword — a premise `parseFlex` does not hold to, since it
  // parses the basis with `allowAuto`. So `.a { flex-basis: 0 } .b { flex:
  // auto }` resets the basis written out and leaves the stale `0` through a
  // `var()`.
  expectBothRoutesAgree([
    {
      property: "flex",
      value: "auto",
      expected: { flexGrow: 1, flexShrink: 1, flexBasis: "auto" },
    },
    {
      property: "flex",
      value: "none",
      expected: { flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
    },
    {
      property: "flex",
      value: "1 auto",
      expected: { flexGrow: 1, flexShrink: 1, flexBasis: "auto" },
    },
    {
      property: "flex",
      value: "0 0 auto",
      expected: { flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
    },
  ]);
});

test("flex-flow expands to direction and wrap on both routes, in either token order", () => {
  expectBothRoutesAgree([
    {
      property: "flex-flow",
      value: "row wrap",
      expected: { flexDirection: "row", flexWrap: "wrap" },
    },
    {
      property: "flex-flow",
      value: "wrap-reverse column",
      expected: { flexDirection: "column", flexWrap: "wrap-reverse" },
    },
    {
      property: "flex-flow",
      value: "column",
      expected: { flexDirection: "column", flexWrap: "nowrap" },
    },
    {
      property: "flex-flow",
      value: "wrap",
      expected: { flexDirection: "row", flexWrap: "wrap" },
    },
  ]);
});

/* -------------------------------------------------------------------------- */
/* A DEFERRED PART DRAGS ITS STATIC SIBLINGS ONTO THE DEFERRED ROUTE          */
/* -------------------------------------------------------------------------- */

test("a var in one slot of a shorthand still expands the whole shorthand", () => {
  registerCSS(`
    :root { --one-slot: 2px; }
    @media (prefers-color-scheme: dark) { :root { --one-slot: 3px; } }
    .one-slot { padding: 1px var(--one-slot) 3px 4px; }
    .one-slot-flex { flex: 1 var(--one-slot) 3px; }
  `);

  expect(styleFor("one-slot")).toStrictEqual({
    paddingTop: 1,
    paddingRight: 2,
    paddingBottom: 3,
    paddingLeft: 4,
  });

  expect(styleFor("one-slot-flex")).toStrictEqual({
    flexGrow: 1,
    flexShrink: 2,
    flexBasis: 3,
  });
});

/* -------------------------------------------------------------------------- */
/* SHORTHANDS WITH NO RUNTIME FORM — DROPPED, NOT SHIPPED                     */
/* -------------------------------------------------------------------------- */

test("a deferred `font` expands to all six longhands, leading included", () => {
  registerCSS(`
    :root { --font: 24px/1.5 Arial; }
    @media (prefers-color-scheme: dark) { :root { --font: 12px Arial; } }
    .font-literal { font: 24px/1.5 Arial; }
    .font-deferred { font: var(--font); }
  `);

  // lightningcss fills the shorthand's unwritten longhands with their initial
  // values, which is what the shorthand means: `font` resets `font-variant`,
  // and `normal` asks for NO variants — the empty list React Native spells it
  // with (`fontVariant?: FontVariant[]`).
  expect(styleFor("font-literal")).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 24,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
    lineHeight: 36,
  });
  // `lineHeight` is the one that could not cross on its own: resolving a
  // `var()` folds a length's unit away, so `24px/1.5` arrives as the two bare
  // numbers `24` and `1.5` and the leading is indistinguishable from a
  // thirty-six-fold multiple of the size. Guessing would render a 36px line box
  // as 864 — the class of error `line-height.ts` exists to refuse.
  //
  // It is read from the DECLARED token instead. `lookupVariable` returns the
  // variable's declaration beside its resolved value, so the ratio `1.5` is
  // still a ratio at exactly the position the resolved list holds the number.
  expect(styleFor("font-deferred")).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 24,
    fontStyle: "normal",
    fontVariant: [],
    fontWeight: "normal",
    lineHeight: 36,
  });
});

test("the container shorthand and its longhands are dropped, as the literal route emits no style for them", () => {
  registerCSS(`
    :root {
      --container: sidebar / inline-size;
      --container-name: sidebar;
      --container-type: inline-size;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --container: main / size;
        --container-name: main;
        --container-type: size;
      }
    }
    .container-literal { container: sidebar / inline-size; }
    .container-deferred { container: var(--container); }
    .container-name-literal { container-name: sidebar; }
    .container-name-deferred { container-name: var(--container-name); }
    .container-type-literal { container-type: inline-size; }
    .container-type-deferred { container-type: var(--container-type); }
  `);

  // All three register the element as a query container on its RULE, which is
  // decided while the stylesheet is read. A deferred value arrives long after,
  // so it can only produce the camelCased CSS name — a key React Native has
  // never had — and is dropped in the compiler instead.
  expect(styleFor("container-literal")).toBeUndefined();
  expect(styleFor("container-deferred")).toBeUndefined();
  expect(styleFor("container-name-literal")).toBeUndefined();
  expect(styleFor("container-name-deferred")).toBeUndefined();
  expect(styleFor("container-type-literal")).toBeUndefined();
  expect(styleFor("container-type-deferred")).toBeUndefined();
});

test("a deferred `transition` produces no transition rather than a corrupt one", () => {
  registerCSS(`
    :root { --transition: width 1s ease-in 200ms; }
    @media (prefers-color-scheme: dark) { :root { --transition: opacity 2s; } }
    .transition-literal { transition: width 1s ease-in 200ms; }
    .transition-deferred { transition: var(--transition); }
  `);

  // `transition` is one of reanimated's own props, so an argument list left on
  // it is READ as a transition rather than ignored. Both routes leave the style
  // object empty because a transition writes no style key.
  expect(styleFor("transition-literal")).toStrictEqual({});
  expect(styleFor("transition-deferred")).toStrictEqual({});
});

test("visibility and direction reach the keys React Native has, on both routes", () => {
  // Neither is a shorthand: each is a property React Native has no key of its
  // own for, expressed through the keys it does have. `visibility` rides along
  // beside its approximation and is inert — it is in neither `StyleSheetTypes`
  // nor `ReactNativeStyleAttributes` — and `direction` alone would leave every
  // Text inside an RTL View laid out left to right, which is why
  // `writingDirection` goes out with it.
  expectBothRoutesAgree([
    {
      property: "visibility",
      value: "hidden",
      expected: { visibility: "hidden", opacity: 0, pointerEvents: "none" },
    },
    {
      property: "visibility",
      value: "visible",
      expected: { visibility: "visible", opacity: 1, pointerEvents: "auto" },
    },
    {
      property: "direction",
      value: "rtl",
      expected: { direction: "rtl", writingDirection: "rtl" },
    },
  ]);
});

test("the border edge shorthands expand to their own edge's keys on both routes", () => {
  // React Native has one `borderStyle` for the whole box, so an edge's style is
  // read and discarded — `border-top: 2px solid red` sets a width and a colour
  // and nothing else. The two logical AXIS shorthands drop theirs for the same
  // reason and not a different one: renaming an axis onto `borderStyle` would
  // style the other two edges, and emitting the faithful CSS key would put a
  // name no layer of React Native reads into the style object.
  //
  // Neither axis has an axis-level key to collapse the WIDTH onto, so each is
  // written to both of its edges. The inline axis reaches `borderStartWidth` /
  // `borderEndWidth` and `borderStartColor` / `borderEndColor`, React Native's
  // own direction-aware spelling of `border-inline-start` / `-end`. The block
  // axis reaches the physical top and bottom, which is exact because
  // `direction` never flips it — and its COLOUR is the one part of the axis
  // React Native does name, so that keeps `borderBlockColor`.
  expectBothRoutesAgree([
    {
      property: "border-top",
      value: "2px solid #123456",
      expected: { borderTopWidth: 2, borderTopColor: "#123456" },
    },
    {
      property: "border-right",
      value: "2px solid #123456",
      expected: { borderRightWidth: 2, borderRightColor: "#123456" },
    },
    {
      property: "border-bottom",
      value: "2px solid #123456",
      expected: { borderBottomWidth: 2, borderBottomColor: "#123456" },
    },
    {
      property: "border-left",
      value: "2px solid #123456",
      expected: { borderLeftWidth: 2, borderLeftColor: "#123456" },
    },
    {
      property: "border-block",
      value: "2px solid #123456",
      expected: {
        borderTopWidth: 2,
        borderBottomWidth: 2,
        borderBlockColor: "#123456",
      },
    },
    {
      property: "border-inline",
      value: "2px solid #123456",
      expected: {
        borderStartWidth: 2,
        borderEndWidth: 2,
        borderStartColor: "#123456",
        borderEndColor: "#123456",
      },
    },
    {
      property: "outline",
      value: "2px solid #123456",
      expected: {
        outlineWidth: 2,
        outlineStyle: "solid",
        outlineColor: "#123456",
      },
    },
  ]);
});

test("border-style writes its one key only when every side agrees", () => {
  expectBothRoutesAgree([
    {
      property: "border-style",
      value: "solid",
      expected: { borderStyle: "solid" },
    },
  ]);

  registerCSS(`
    :root { --sides-differ: solid dashed; }
    @media (prefers-color-scheme: dark) { :root { --sides-differ: solid; } }
    .sides-differ-literal { border-style: solid dashed; }
    .sides-differ-deferred { border-style: var(--sides-differ); }
  `);

  // React Native styles all four sides with one `borderStyle`
  // (`StyleSheetTypes.d.ts`: `'solid' | 'dotted' | 'dashed'`), so two values
  // cannot both be written to it. The literal route emits the four per-edge
  // keys under the names React Native would give them — inert today, and the
  // day it grows them they start working, where collapsing onto one edge's
  // style would be silently wrong on the other three.
  //
  // The deferred route reaches the same four keys. It is the route that most
  // easily loses them: the runtime expander maps four CSS positions onto React
  // Native keys, and mapping all four onto the single `borderStyle` would make
  // the four values disagree over one key and drop the declaration whole.
  const perEdge = {
    borderTopStyle: "solid",
    borderRightStyle: "dashed",
    borderBottomStyle: "solid",
    borderLeftStyle: "dashed",
  };

  expect(styleFor("sides-differ-literal")).toStrictEqual(perEdge);
  expect(styleFor("sides-differ-deferred")).toStrictEqual(perEdge);
});

test("text-decoration expands to its line and colour on both routes", () => {
  expectBothRoutesAgree([
    {
      property: "text-decoration",
      value: "underline #123456",
      expected: {
        textDecorationLine: "underline",
        textDecorationColor: "#123456",
      },
    },
    {
      property: "text-decoration",
      value: "line-through #123456",
      expected: {
        textDecorationLine: "line-through",
        textDecorationColor: "#123456",
      },
    },
  ]);
});

/* -------------------------------------------------------------------------- */
/* THE ONE SLOT THE DEFERRED ROUTE CANNOT TELL APART                          */
/* -------------------------------------------------------------------------- */

test("a bare number in flex is read as a count, because a px length resolves to the same value", () => {
  registerCSS(`
    :root { --flex-px: 1 30px; --flex-basis-px: 30px; }
    @media (prefers-color-scheme: dark) {
      :root { --flex-px: 1 1; --flex-basis-px: 1px; }
    }
    .flex-px-literal { flex: 1 30px; }
    .flex-px-deferred { flex: var(--flex-px); }
    .flex-basis-px-literal { flex: 30px; }
    .flex-basis-px-deferred { flex: var(--flex-basis-px); }
  `);

  // `30px` and `30` are the same JavaScript number once the variable has been
  // read, so the slot is decided by position: css-flexbox-1 §7.1.1 reads a
  // second `<number>` as `flex-shrink` and a first one as `flex-grow`. A
  // percentage keeps its `%` and so is still read as the basis.
  expect(styleFor("flex-px-literal")).toStrictEqual({
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 30,
  });
  expect(styleFor("flex-px-deferred")).toStrictEqual({
    flexGrow: 1,
    flexShrink: 30,
    flexBasis: "0%",
  });

  expect(styleFor("flex-basis-px-literal")).toStrictEqual({
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 30,
  });
  expect(styleFor("flex-basis-px-deferred")).toStrictEqual({
    flexGrow: 30,
    flexShrink: 1,
    flexBasis: "0%",
  });
});

/* -------------------------------------------------------------------------- */
/* VALUES THE SHORTHAND'S GRAMMAR DOES NOT ADMIT                              */
/* -------------------------------------------------------------------------- */

test("a value count the shorthand has no position for is dropped", () => {
  registerCSS(`
    :root { --too-many: 1px 2px 3px; --way-too-many: 1px 2px 3px 4px 5px; }
    @media (prefers-color-scheme: dark) {
      :root { --too-many: 1px; --way-too-many: 1px; }
    }
    .axis-too-many { margin-inline: var(--too-many); }
    .sides-too-many { margin: var(--way-too-many); }
  `);

  expect(styleFor("axis-too-many")).toStrictEqual({});
  expect(styleFor("sides-too-many")).toStrictEqual({});
});

test("a whole flex shorthand arriving as one unsplit string is dropped", () => {
  registerCSS(`
    :root { --unsplit: 1 1 0%; }
    @media (prefers-color-scheme: dark) { :root { --unsplit: 1; } }
    .unsplit-tokenised { flex: var(--unsplit); }
  `);

  // A custom property declared in CSS is tokenised by the compiler, so this one
  // reaches the resolver as three values and expands.
  expect(styleFor("unsplit-tokenised")).toStrictEqual({
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
  });
});

test("a token belonging to neither flex-flow component drops the declaration", () => {
  registerCSS(`
    :root { --bad-flow: row garbage; --two-wraps: wrap nowrap; }
    @media (prefers-color-scheme: dark) {
      :root { --bad-flow: row; --two-wraps: wrap; }
    }
    .bad-flow { flex-flow: var(--bad-flow); }
    .two-wraps { flex-flow: var(--two-wraps); }
  `);

  expect(styleFor("bad-flow")).toStrictEqual({});
  expect(styleFor("two-wraps")).toStrictEqual({});
});

test("a single unparseable token still reaches the shorthand key, as it does literally", () => {
  registerCSS(`
    :root { --garbage: garbage; }
    @media (prefers-color-scheme: dark) { :root { --garbage: hidden; } }
    .garbage-margin-literal { margin: garbage; }
    .garbage-margin-deferred { margin: var(--garbage); }
    .garbage-overflow-literal { overflow: garbage; }
    .garbage-overflow-deferred { overflow: var(--garbage); }
  `);

  // Neither route validates a keyword against the property, so a single
  // unrecognised token is distributed over the sides and collapses back onto
  // the shorthand key exactly as one length would.
  expect(styleFor("garbage-margin-literal")).toStrictEqual({
    margin: "garbage",
  });
  expect(styleFor("garbage-margin-deferred")).toStrictEqual({
    margin: "garbage",
  });
  expect(styleFor("garbage-overflow-literal")).toStrictEqual({
    overflow: "garbage",
  });
  expect(styleFor("garbage-overflow-deferred")).toStrictEqual({
    overflow: "garbage",
  });
});

/* -------------------------------------------------------------------------- */
/* THE EXPANSION HAPPENS AFTER UNIT RESOLUTION, NOT BEFORE                    */
/* -------------------------------------------------------------------------- */

test("a shorthand expands the values it resolves to, not the ones it was written with", () => {
  registerCSS(`
    :root { --viewport-sides: 10vw 2rem; }
    @media (prefers-color-scheme: dark) { :root { --viewport-sides: 1px; } }
    .viewport-sides-literal { margin: 10vw 2rem; }
    .viewport-sides-deferred { margin: var(--viewport-sides); }
  `);

  // The viewport is 750x1334 and the root font size is 14, so 10vw is 75 and
  // 2rem is 28.
  const expanded = {
    marginTop: 75,
    marginRight: 28,
    marginBottom: 75,
    marginLeft: 28,
  };

  expect(styleFor("viewport-sides-literal")).toStrictEqual(expanded);
  expect(styleFor("viewport-sides-deferred")).toStrictEqual(expanded);
});
