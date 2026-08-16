/**
 * Layout & box properties: do the COMPILE-TIME and RUNTIME paths agree?
 *
 * The same declaration reaches React Native by one of four routes:
 *
 *   1. LITERAL      `.a { width: 10px }`                    — resolved at compile time
 *   2. INLINABLE    a custom property with exactly ONE definition is folded
 *                   into the declaration at compile time, so it behaves like (1)
 *   3. NON-INLINABLE a custom property with TWO definitions cannot be folded, so
 *                   the declaration is emitted as a runtime descriptor
 *   4. FALLBACK-ONLY `var(--never-declared, 10px)` — also deferred to runtime
 *
 * Routes 1+2 go through the compiler's per-property parsers in
 * `src/compiler/declarations.ts`. Routes 3+4 bypass them and re-resolve the
 * token stream at runtime. Every test below either proves the two agree, or
 * pins exactly where they do not.
 */
import { act, render } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

import { dimensions } from "../../native/reactivity";

/**
 * `toJSON()` rather than `getByTestId` — a `display: none` element is excluded
 * from the query tree, and an all-dropped rule leaves no `style` prop at all.
 */
function styleFor(className: string): unknown {
  const tree = render(
    <View testID={testID} className={className} />,
  ).toJSON() as unknown as { props: { style?: unknown } };
  return tree.props.style;
}

/**
 * Registers one stylesheet that carries all four routes for a single value.
 *
 * `--inl<n>` has one definition (inlined at compile time); `--run<n>` has two
 * (deferred to runtime). Both live in the same stylesheet because the inliner
 * decides per-variable, on that variable's own definition count.
 */
function registerFourRoutes(
  declarations: { property: string; value: string }[],
) {
  const rootInline = declarations
    .map((d, index) => `--inl${index}: ${d.value};`)
    .join(" ");
  const rootRuntime = declarations
    .map((d, index) => `--run${index}: ${d.value};`)
    .join(" ");
  const darkRuntime = declarations
    .map((d, index) => `--run${index}: ${d.value};`)
    .join(" ");

  registerCSS(`
    :root { ${rootInline} ${rootRuntime} }
    @media (prefers-color-scheme: dark) { :root { ${darkRuntime} } }
    ${declarations
      .map(
        (d, index) => `
      .literal${index} { ${d.property}: ${d.value}; }
      .inlinable${index} { ${d.property}: var(--inl${index}); }
      .runtime${index} { ${d.property}: var(--run${index}); }
      .fallback${index} { ${d.property}: var(--undeclared${index}, ${d.value}); }
    `,
      )
      .join("\n")}
  `);
}

/** Asserts all four routes produce `expected` for every declaration given. */
function expectAllRoutesAgree(
  declarations: { property: string; value: string; expected: unknown }[],
) {
  registerFourRoutes(declarations);

  for (const [index, declaration] of declarations.entries()) {
    const routes = {
      literal: styleFor(`literal${index}`),
      inlinable: styleFor(`inlinable${index}`),
      runtime: styleFor(`runtime${index}`),
      fallback: styleFor(`fallback${index}`),
    };

    expect({
      declaration: `${declaration.property}: ${declaration.value}`,
      ...routes,
    }).toStrictEqual({
      declaration: `${declaration.property}: ${declaration.value}`,
      literal: declaration.expected,
      inlinable: declaration.expected,
      runtime: declaration.expected,
      fallback: declaration.expected,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* ROUTES AGREE                                                               */
/* -------------------------------------------------------------------------- */

test("sizing: all four routes agree for every unit", () => {
  expectAllRoutesAgree([
    { property: "width", value: "10px", expected: { width: 10 } },
    { property: "width", value: "50%", expected: { width: "50%" } },
    { property: "width", value: "10vw", expected: { width: 75 } },
    { property: "height", value: "10vh", expected: { height: 133.4 } },
    { property: "width", value: "2rem", expected: { width: 28 } },
    { property: "width", value: "0%", expected: { width: "0%" } },
    { property: "min-width", value: "10px", expected: { minWidth: 10 } },
    { property: "max-width", value: "10px", expected: { maxWidth: 10 } },
    { property: "min-height", value: "10px", expected: { minHeight: 10 } },
    { property: "max-height", value: "10px", expected: { maxHeight: 10 } },
  ]);
});

test("margin/padding longhands: all four routes agree", () => {
  expectAllRoutesAgree([
    { property: "margin-top", value: "10px", expected: { marginTop: 10 } },
    {
      property: "margin-right",
      value: "10px",
      expected: { marginRight: 10 },
    },
    {
      property: "margin-bottom",
      value: "10px",
      expected: { marginBottom: 10 },
    },
    { property: "margin-left", value: "10px", expected: { marginLeft: 10 } },
    { property: "margin-top", value: "-10px", expected: { marginTop: -10 } },
    { property: "margin-top", value: "10vw", expected: { marginTop: 75 } },
    { property: "margin-top", value: "10%", expected: { marginTop: "10%" } },
    { property: "padding-top", value: "10px", expected: { paddingTop: 10 } },
    {
      property: "padding-right",
      value: "10px",
      expected: { paddingRight: 10 },
    },
    {
      property: "padding-bottom",
      value: "10px",
      expected: { paddingBottom: 10 },
    },
    { property: "padding-left", value: "10px", expected: { paddingLeft: 10 } },
  ]);
});

test("logical margin/padding longhands: all four routes agree", () => {
  expectAllRoutesAgree([
    {
      property: "margin-inline-start",
      value: "10px",
      expected: { marginInlineStart: 10 },
    },
    {
      property: "margin-inline-end",
      value: "10px",
      expected: { marginInlineEnd: 10 },
    },
    {
      property: "padding-inline-start",
      value: "10px",
      expected: { paddingInlineStart: 10 },
    },
    {
      property: "padding-inline-end",
      value: "10px",
      expected: { paddingInlineEnd: 10 },
    },
  ]);
});

test("single-value margin/padding/gap/inset shorthands: all four routes agree", () => {
  expectAllRoutesAgree([
    { property: "margin", value: "10px", expected: { margin: 10 } },
    { property: "margin", value: "10vw", expected: { margin: 75 } },
    { property: "margin", value: "10%", expected: { margin: "10%" } },
    { property: "padding", value: "10px", expected: { padding: 10 } },
    {
      property: "margin-inline",
      value: "10px",
      expected: { marginInline: 10 },
    },
    { property: "margin-block", value: "10px", expected: { marginBlock: 10 } },
    {
      property: "padding-inline",
      value: "10px",
      expected: { paddingInline: 10 },
    },
    {
      property: "padding-block",
      value: "10px",
      expected: { paddingBlock: 10 },
    },
    { property: "inset", value: "10px", expected: { inset: 10 } },
    { property: "inset-inline", value: "10px", expected: { insetInline: 10 } },
    { property: "inset-block", value: "10px", expected: { insetBlock: 10 } },
    { property: "gap", value: "10px", expected: { gap: 10 } },
    { property: "gap", value: "1rem", expected: { gap: 14 } },
    { property: "gap", value: "5%", expected: { gap: "5%" } },
    { property: "gap", value: "calc(1px + 2px)", expected: { gap: 3 } },
  ]);
});

test("inset longhands: all four routes agree", () => {
  expectAllRoutesAgree([
    { property: "top", value: "10px", expected: { top: 10 } },
    { property: "right", value: "10px", expected: { right: 10 } },
    { property: "bottom", value: "10px", expected: { bottom: 10 } },
    { property: "left", value: "10px", expected: { left: 10 } },
    { property: "top", value: "-5px", expected: { top: -5 } },
    { property: "top", value: "50%", expected: { top: "50%" } },
    { property: "top", value: "10vw", expected: { top: 75 } },
    {
      property: "inset-inline-start",
      value: "10px",
      expected: { insetInlineStart: 10 },
    },
    {
      property: "inset-inline-end",
      value: "10px",
      expected: { insetInlineEnd: 10 },
    },
    {
      property: "inset-block-start",
      value: "10px",
      expected: { insetBlockStart: 10 },
    },
    {
      property: "inset-block-end",
      value: "10px",
      expected: { insetBlockEnd: 10 },
    },
  ]);
});

test("flex longhands + row-gap/column-gap: all four routes agree", () => {
  expectAllRoutesAgree([
    { property: "flex-grow", value: "2", expected: { flexGrow: 2 } },
    { property: "flex-shrink", value: "2", expected: { flexShrink: 2 } },
    { property: "flex-basis", value: "10px", expected: { flexBasis: 10 } },
    { property: "flex-basis", value: "50%", expected: { flexBasis: "50%" } },
    { property: "flex-basis", value: "10vw", expected: { flexBasis: 75 } },
    { property: "row-gap", value: "10px", expected: { rowGap: 10 } },
    { property: "column-gap", value: "10px", expected: { columnGap: 10 } },
  ]);
});

test("layout keywords: all four routes agree", () => {
  expectAllRoutesAgree([
    {
      property: "flex-direction",
      value: "row",
      expected: { flexDirection: "row" },
    },
    {
      property: "flex-direction",
      value: "column-reverse",
      expected: { flexDirection: "column-reverse" },
    },
    {
      property: "justify-content",
      value: "space-between",
      expected: { justifyContent: "space-between" },
    },
    {
      property: "justify-content",
      value: "space-evenly",
      expected: { justifyContent: "space-evenly" },
    },
    {
      property: "align-items",
      value: "flex-end",
      expected: { alignItems: "flex-end" },
    },
    {
      property: "align-items",
      value: "baseline",
      expected: { alignItems: "baseline" },
    },
    {
      property: "align-self",
      value: "center",
      expected: { alignSelf: "center" },
    },
    {
      property: "position",
      value: "absolute",
      expected: { position: "absolute" },
    },
    {
      property: "position",
      value: "relative",
      expected: { position: "relative" },
    },
    { property: "position", value: "static", expected: { position: "static" } },
    { property: "overflow", value: "hidden", expected: { overflow: "hidden" } },
    {
      property: "overflow",
      value: "visible",
      expected: { overflow: "visible" },
    },
    { property: "display", value: "flex", expected: { display: "flex" } },
    { property: "display", value: "none", expected: { display: "none" } },
    { property: "z-index", value: "5", expected: { zIndex: 5 } },
    { property: "z-index", value: "-1", expected: { zIndex: -1 } },
  ]);
});

test("calc() over compile-time-resolvable units: all four routes agree", () => {
  expectAllRoutesAgree([
    { property: "width", value: "calc(10px + 5px)", expected: { width: 15 } },
    {
      property: "width",
      value: "calc(calc(2px + 3px) * 2)",
      expected: { width: 10 },
    },
    { property: "width", value: "calc(2rem * 2)", expected: { width: 56 } },
    {
      property: "margin-top",
      value: "calc(10px + 5px)",
      expected: { marginTop: 15 },
    },
    { property: "flex-grow", value: "calc(1 + 1)", expected: { flexGrow: 2 } },
    { property: "z-index", value: "calc(2 + 3)", expected: { zIndex: 5 } },
  ]);
});

test("calc(var() + literal) agrees whether the var is inlinable or not", () => {
  registerCSS(`
    :root { --inlinable: 100px; --runtime: 100px; }
    @media (prefers-color-scheme: dark) { :root { --runtime: 200px; } }
    .calc-inlinable { width: calc(var(--inlinable) + 20px); }
    .calc-runtime { width: calc(var(--runtime) + 20px); }
  `);

  expect(styleFor("calc-inlinable")).toStrictEqual({ width: 120 });
  expect(styleFor("calc-runtime")).toStrictEqual({ width: 120 });
});

test("em resolves against the element's own font-size on every route", () => {
  registerCSS(`
    :root { --inlinable-em: 2em; --runtime-em: 2em; }
    @media (prefers-color-scheme: dark) { :root { --runtime-em: 2em; } }
    .em-literal { width: 2em; font-size: 5px; }
    .em-inlinable { width: var(--inlinable-em); font-size: 5px; }
    .em-runtime { width: var(--runtime-em); font-size: 5px; }
    .em-fallback { width: var(--no-such-em, 2em); font-size: 5px; }
  `);

  const expected = { fontSize: 5, width: 10 };
  expect(styleFor("em-literal")).toStrictEqual(expected);
  expect(styleFor("em-inlinable")).toStrictEqual(expected);
  expect(styleFor("em-runtime")).toStrictEqual(expected);
  expect(styleFor("em-fallback")).toStrictEqual(expected);
});

test("!important does not change which route a value takes", () => {
  registerCSS(`
    :root { --important-runtime: 10px; }
    @media (prefers-color-scheme: dark) { :root { --important-runtime: 12px; } }
    .important-literal { width: 5px; }
    .important-literal { width: 10px !important; }
    .important-runtime { width: 5px; }
    .important-runtime { width: var(--important-runtime) !important; }
  `);

  expect(styleFor("important-literal")).toStrictEqual({ width: 10 });
  expect(styleFor("important-runtime")).toStrictEqual({ width: 10 });
});

test("a value supplied inside a matching @media block keeps its route's result", () => {
  registerCSS(`
    :root { --media-runtime: 10px; }
    @media (prefers-color-scheme: dark) { :root { --media-runtime: 12px; } }
    @media (min-width: 100px) {
      .media-literal { width: 10px; }
      .media-runtime { width: var(--media-runtime); }
    }
  `);

  expect(styleFor("media-literal")).toStrictEqual({ width: 10 });
  expect(styleFor("media-runtime")).toStrictEqual({ width: 10 });
});

test("vw stays reactive on both the compile-time and the runtime route", () => {
  registerCSS(`
    :root { --reactive-vw: 10vw; }
    @media (prefers-color-scheme: dark) { :root { --reactive-vw: 20vw; } }
    .vw-literal { width: 10vw; }
    .vw-runtime { width: var(--reactive-vw); }
  `);

  const literal = render(<View testID="vw-literal" className="vw-literal" />);
  const runtime = render(<View testID="vw-runtime" className="vw-runtime" />);
  const styleOf = (tree: ReturnType<typeof render>): unknown =>
    (tree.toJSON() as unknown as { props: { style?: unknown } }).props.style;

  expect(styleOf(literal)).toStrictEqual({ width: 75 });
  expect(styleOf(runtime)).toStrictEqual({ width: 75 });

  act(() => {
    dimensions.set({ ...dimensions.get(), width: 200 });
  });

  expect(styleOf(literal)).toStrictEqual({ width: 20 });
  expect(styleOf(runtime)).toStrictEqual({ width: 20 });
});

/* -------------------------------------------------------------------------- */
/* MULTI-VALUE SHORTHANDS EXPAND ON EVERY ROUTE                                */
/* -------------------------------------------------------------------------- */

test("multi-value `margin` expands to its four sides on every route", () => {
  registerCSS(`
    :root { --margin-inlinable: 1px 2px 3px 4px; --margin-runtime: 1px 2px 3px 4px; }
    @media (prefers-color-scheme: dark) { :root { --margin-runtime: 9px; } }
    .margin-literal { margin: 1px 2px 3px 4px; }
    .margin-inlinable { margin: var(--margin-inlinable); }
    .margin-runtime { margin: var(--margin-runtime); }
    .margin-fallback { margin: var(--no-such-margin, 1px 2px 3px 4px); }
  `);

  // React Native has no array form for `margin`, so the four longhands are the
  // only shape the shorthand has once the sides differ.
  const expanded = {
    marginTop: 1,
    marginRight: 2,
    marginBottom: 3,
    marginLeft: 4,
  };
  expect(styleFor("margin-literal")).toStrictEqual(expanded);
  expect(styleFor("margin-inlinable")).toStrictEqual(expanded);
  expect(styleFor("margin-runtime")).toStrictEqual(expanded);
  expect(styleFor("margin-fallback")).toStrictEqual(expanded);
});

test("every multi-value box shorthand expands to its longhands on the runtime path", () => {
  registerCSS(`
    :root {
      --two-runtime: 10px 20px;
      --four-runtime: 1px 2px 3px 4px;
      --flex-runtime: 1 2 3px;
      --percent-runtime: 10% 20%;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --two-runtime: 1px;
        --four-runtime: 1px;
        --flex-runtime: 1;
        --percent-runtime: 1%;
      }
    }
    .margin-two-literal { margin: 10px 20px; }
    .margin-two-runtime { margin: var(--two-runtime); }
    .padding-four-literal { padding: 1px 2px 3px 4px; }
    .padding-four-runtime { padding: var(--four-runtime); }
    .inset-four-literal { inset: 1px 2px 3px 4px; }
    .inset-four-runtime { inset: var(--four-runtime); }
    .gap-two-literal { gap: 10px 20px; }
    .gap-two-runtime { gap: var(--two-runtime); }
    .flex-three-literal { flex: 1 2 3px; }
    .flex-three-runtime { flex: var(--flex-runtime); }
    .margin-inline-two-literal { margin-inline: 10px 20px; }
    .margin-inline-two-runtime { margin-inline: var(--two-runtime); }
    .inset-inline-two-literal { inset-inline: 10px 20px; }
    .inset-inline-two-runtime { inset-inline: var(--two-runtime); }
    .padding-block-two-literal { padding-block: 10px 20px; }
    .padding-block-two-runtime { padding-block: var(--two-runtime); }
    .margin-percent-literal { margin: 10% 20%; }
    .margin-percent-runtime { margin: var(--percent-runtime); }
  `);

  // Every row: the two routes reach the same longhands. React Native takes no
  // array on any of these keys, so the expansion is the only usable shape.
  const marginTwo = {
    marginTop: 10,
    marginBottom: 10,
    marginLeft: 20,
    marginRight: 20,
  };
  expect(styleFor("margin-two-literal")).toStrictEqual(marginTwo);
  expect(styleFor("margin-two-runtime")).toStrictEqual(marginTwo);

  const paddingFour = {
    paddingTop: 1,
    paddingRight: 2,
    paddingBottom: 3,
    paddingLeft: 4,
  };
  expect(styleFor("padding-four-literal")).toStrictEqual(paddingFour);
  expect(styleFor("padding-four-runtime")).toStrictEqual(paddingFour);

  const insetFour = { top: 1, right: 2, bottom: 3, left: 4 };
  expect(styleFor("inset-four-literal")).toStrictEqual(insetFour);
  expect(styleFor("inset-four-runtime")).toStrictEqual(insetFour);

  const gapTwo = { rowGap: 10, columnGap: 20 };
  expect(styleFor("gap-two-literal")).toStrictEqual(gapTwo);
  expect(styleFor("gap-two-runtime")).toStrictEqual(gapTwo);

  const flexThree = { flexGrow: 1, flexShrink: 2, flexBasis: 3 };
  expect(styleFor("flex-three-literal")).toStrictEqual(flexThree);
  expect(styleFor("flex-three-runtime")).toStrictEqual(flexThree);

  const marginInlineTwo = { marginInlineStart: 10, marginInlineEnd: 20 };
  expect(styleFor("margin-inline-two-literal")).toStrictEqual(marginInlineTwo);
  expect(styleFor("margin-inline-two-runtime")).toStrictEqual(marginInlineTwo);

  const insetInlineTwo = { insetInlineStart: 10, insetInlineEnd: 20 };
  expect(styleFor("inset-inline-two-literal")).toStrictEqual(insetInlineTwo);
  expect(styleFor("inset-inline-two-runtime")).toStrictEqual(insetInlineTwo);

  const paddingBlockTwo = { paddingBlockStart: 10, paddingBlockEnd: 20 };
  expect(styleFor("padding-block-two-literal")).toStrictEqual(paddingBlockTwo);
  expect(styleFor("padding-block-two-runtime")).toStrictEqual(paddingBlockTwo);

  const marginPercent = {
    marginTop: "10%",
    marginBottom: "10%",
    marginLeft: "20%",
    marginRight: "20%",
  };
  expect(styleFor("margin-percent-literal")).toStrictEqual(marginPercent);
  expect(styleFor("margin-percent-runtime")).toStrictEqual(marginPercent);
});

test("`flex: 1` becomes its three longhands on every route", () => {
  registerCSS(`
    :root { --flex-one: 1; }
    @media (prefers-color-scheme: dark) { :root { --flex-one: 2; } }
    .flex-one-literal { flex: 1; }
    .flex-one-runtime { flex: var(--flex-one); }
  `);

  // css-flexbox-1 §7.1.1: `flex: <number>` is `<number> 1 0%`. React Native's
  // `flex` is a number rather than a CSS shorthand, so the three longhands are
  // what carries the meaning on both routes.
  const expanded = { flexGrow: 1, flexShrink: 1, flexBasis: "0%" };
  expect(styleFor("flex-one-literal")).toStrictEqual(expanded);
  expect(styleFor("flex-one-runtime")).toStrictEqual(expanded);
});

test("a var anywhere inside a shorthand decides the route for the WHOLE shorthand", () => {
  registerCSS(`
    :root { --part-inlinable: 2px; --part-runtime: 2px; }
    @media (prefers-color-scheme: dark) { :root { --part-runtime: 3px; } }
    .part-inlinable { padding: 1px var(--part-inlinable) 3px 4px; }
    .part-runtime { padding: 1px var(--part-runtime) 3px 4px; }
  `);

  // One deferred component drags the three static components onto the runtime
  // path with it, and the shorthand expands there just as it does at compile
  // time.
  const expanded = {
    paddingTop: 1,
    paddingRight: 2,
    paddingBottom: 3,
    paddingLeft: 4,
  };
  expect(styleFor("part-inlinable")).toStrictEqual(expanded);
  expect(styleFor("part-runtime")).toStrictEqual(expanded);
});

/* -------------------------------------------------------------------------- */
/* THE `auto` KEYWORD SURVIVES EVERY ROUTE                                     */
/* -------------------------------------------------------------------------- */

test("the `auto` keyword survives the runtime path", () => {
  registerCSS(`
    :root { --auto-runtime: auto; }
    @media (prefers-color-scheme: dark) { :root { --auto-runtime: 10px; } }
    :root { --align-auto-runtime: auto; }
    @media (prefers-color-scheme: dark) { :root { --align-auto-runtime: center; } }
    .width-auto-literal { width: auto; }
    .width-auto-runtime { width: var(--auto-runtime); }
    .height-auto-literal { height: auto; }
    .height-auto-runtime { height: var(--auto-runtime); }
    .margin-auto-literal { margin: auto; }
    .margin-auto-runtime { margin: var(--auto-runtime); }
    .align-self-auto-literal { align-self: auto; }
    .align-self-auto-runtime { align-self: var(--align-auto-runtime); }
    .flex-basis-auto-literal { flex-basis: auto; }
    .flex-basis-auto-runtime { flex-basis: var(--auto-runtime); }
    .aspect-auto-literal { aspect-ratio: auto; }
    .aspect-auto-runtime { aspect-ratio: var(--auto-runtime); }
  `);

  // React Native accepts `auto` for width/height/margin/flexBasis — each is a
  // `DimensionValue` (`StyleSheetTypes.d.ts`), and that union includes the
  // keyword — and for alignSelf, so every route keeps it. `margin: auto`
  // collapses back onto the shorthand key because all four sides agree, which
  // is the shape the literal route emits.
  expect(styleFor("width-auto-literal")).toStrictEqual({ width: "auto" });
  expect(styleFor("width-auto-runtime")).toStrictEqual({ width: "auto" });

  expect(styleFor("height-auto-literal")).toStrictEqual({ height: "auto" });
  expect(styleFor("height-auto-runtime")).toStrictEqual({ height: "auto" });

  expect(styleFor("margin-auto-literal")).toStrictEqual({ margin: "auto" });
  expect(styleFor("margin-auto-runtime")).toStrictEqual({ margin: "auto" });

  expect(styleFor("align-self-auto-literal")).toStrictEqual({
    alignSelf: "auto",
  });
  expect(styleFor("align-self-auto-runtime")).toStrictEqual({
    alignSelf: "auto",
  });

  expect(styleFor("flex-basis-auto-literal")).toStrictEqual({
    flexBasis: "auto",
  });
  expect(styleFor("flex-basis-auto-runtime")).toStrictEqual({
    flexBasis: "auto",
  });

  // `aspect-ratio: auto` is carried rather than dropped, because carrying it is
  // the only way the declaration can do its one job: CANCEL a ratio an earlier
  // rule set. `processAspectRatio` returns `undefined` for any value containing
  // `auto` (`StyleSheet/processAspectRatio.js`), which is what CSS means by it.
  expect(styleFor("aspect-auto-literal")).toStrictEqual({
    aspectRatio: "auto",
  });
  expect(styleFor("aspect-auto-runtime")).toStrictEqual({
    aspectRatio: "auto",
  });
});

test("`margin: auto 10px` keeps `auto` on the block axis on every route", () => {
  registerCSS(`
    :root { --mixed-auto: auto 10px; }
    @media (prefers-color-scheme: dark) { :root { --mixed-auto: 1px; } }
    .mixed-auto-literal { margin: auto 10px; }
    .mixed-auto-runtime { margin: var(--mixed-auto); }
  `);

  // The sides disagree, so there is no shorthand key to collapse onto and each
  // side carries its own value.
  const expanded = {
    marginTop: "auto",
    marginBottom: "auto",
    marginLeft: 10,
    marginRight: 10,
  };
  expect(styleFor("mixed-auto-literal")).toStrictEqual(expanded);
  expect(styleFor("mixed-auto-runtime")).toStrictEqual(expanded);
});

test("`flex: auto` / `flex: none` expand to their grow/shrink/basis triple on every route", () => {
  registerCSS(`
    :root { --flex-auto: auto; --flex-none: none; }
    @media (prefers-color-scheme: dark) { :root { --flex-auto: 1; --flex-none: 0; } }
    .flex-auto-literal { flex: auto; }
    .flex-auto-runtime { flex: var(--flex-auto); }
    .flex-none-literal { flex: none; }
    .flex-none-runtime { flex: var(--flex-none); }
  `);

  // css-flexbox-1 §7.1.1: `auto` is `1 1 auto` and `none` is `0 0 auto`. React
  // Native's `flex` takes a number only, so the keyword itself is never a usable
  // style, and the basis is what separates `flex: auto` from `flex: 1`.
  // `flexBasis` is a `DimensionValue`, which includes `"auto"`
  // (`StyleSheetTypes.d.ts`), so the keyword is a value React Native reads —
  // and writing it is what resets a basis an earlier rule set.
  //
  // SUSPECTED DEFECT: the runtime route omits `flexBasis` on both keywords.
  // `native/styles/shorthands/flex.ts` withholds the key whenever the basis is
  // `auto`, on the stated premise that the compile-time route cannot express
  // the keyword — a premise `parseFlex` does not hold to, since it passes
  // `allowAuto`. So `.a { flex-basis: 0 } .b { flex: auto }` resets the basis
  // written out and leaves the stale `0` when the value arrives via `var()`.
  const auto = { flexBasis: "auto", flexGrow: 1, flexShrink: 1 };
  expect(styleFor("flex-auto-literal")).toStrictEqual(auto);
  expect(styleFor("flex-auto-runtime")).toStrictEqual(auto);

  const none = { flexBasis: "auto", flexGrow: 0, flexShrink: 0 };
  expect(styleFor("flex-none-literal")).toStrictEqual(none);
  expect(styleFor("flex-none-runtime")).toStrictEqual(none);
});

/* -------------------------------------------------------------------------- */
/* DIVERGENCE 3 — numeric zero is dropped on the runtime path                  */
/* -------------------------------------------------------------------------- */

test("a numeric zero survives the runtime path, as it does the literal one", () => {
  registerCSS(`
    :root {
      --zero-length: 0px;
      --zero-unitless: 0;
      --zero-number: 0;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --zero-length: 1px;
        --zero-unitless: 1;
        --zero-number: 1;
      }
    }
    .zero-width-literal { width: 0px; }
    .zero-width-runtime { width: var(--zero-length); }
    .zero-top-literal { top: 0; }
    .zero-top-runtime { top: var(--zero-unitless); }
    .zero-margin-literal { margin: 0; }
    .zero-margin-runtime { margin: var(--zero-unitless); }
    .zero-gap-literal { gap: 0; }
    .zero-gap-runtime { gap: var(--zero-unitless); }
    .zero-min-width-literal { min-width: 0; }
    .zero-min-width-runtime { min-width: var(--zero-unitless); }
    .zero-flex-grow-literal { flex-grow: 0; }
    .zero-flex-grow-runtime { flex-grow: var(--zero-number); }
    .zero-flex-shrink-literal { flex-shrink: 0; }
    .zero-flex-shrink-runtime { flex-shrink: var(--zero-number); }
    .zero-z-index-literal { z-index: 0; }
    .zero-z-index-runtime { z-index: var(--zero-number); }
  `);

  // All three routes agree. `0` is a legal value for every one of these
  // properties, and `min-width: 0`, `flex-shrink: 0`, `margin: 0` and
  // `z-index: 0` all change layout when present.
  //
  // A truthiness guard on the runtime path used to discard every one of them.
  // `0%` survived because a string is truthy, which is what made the fault
  // look property-specific rather than type-specific.
  expect(styleFor("zero-width-literal")).toStrictEqual({ width: 0 });
  expect(styleFor("zero-width-runtime")).toStrictEqual({ width: 0 });

  expect(styleFor("zero-top-literal")).toStrictEqual({ top: 0 });
  expect(styleFor("zero-top-runtime")).toStrictEqual({ top: 0 });

  expect(styleFor("zero-margin-literal")).toStrictEqual({ margin: 0 });
  expect(styleFor("zero-margin-runtime")).toStrictEqual({ margin: 0 });

  expect(styleFor("zero-gap-literal")).toStrictEqual({ gap: 0 });
  expect(styleFor("zero-gap-runtime")).toStrictEqual({ gap: 0 });

  expect(styleFor("zero-min-width-literal")).toStrictEqual({ minWidth: 0 });
  expect(styleFor("zero-min-width-runtime")).toStrictEqual({ minWidth: 0 });

  expect(styleFor("zero-flex-grow-literal")).toStrictEqual({ flexGrow: 0 });
  expect(styleFor("zero-flex-grow-runtime")).toStrictEqual({ flexGrow: 0 });

  expect(styleFor("zero-flex-shrink-literal")).toStrictEqual({ flexShrink: 0 });
  expect(styleFor("zero-flex-shrink-runtime")).toStrictEqual({ flexShrink: 0 });

  expect(styleFor("zero-z-index-literal")).toStrictEqual({ zIndex: 0 });
  expect(styleFor("zero-z-index-runtime")).toStrictEqual({ zIndex: 0 });
});

test("a zero PERCENTAGE survives the runtime path too", () => {
  registerCSS(`
    :root { --zero-percent: 0%; }
    @media (prefers-color-scheme: dark) { :root { --zero-percent: 1%; } }
    .zero-percent-literal { width: 0%; }
    .zero-percent-runtime { width: var(--zero-percent); }
  `);

  // `0%` reaches React Native as the string "0%". It was the one zero that
  // always survived, because a string is truthy.
  expect(styleFor("zero-percent-literal")).toStrictEqual({ width: "0%" });
  expect(styleFor("zero-percent-runtime")).toStrictEqual({ width: "0%" });
});

/* -------------------------------------------------------------------------- */
/* DIVERGENCE 4 — calc() mixing a runtime unit with a literal                  */
/* -------------------------------------------------------------------------- */

test("SUSPECTED DEFECT: calc() mixing a viewport/em unit with px is dropped at COMPILE time", () => {
  registerCSS(`
    :root {
      --calc-vw: calc(10vw + 5px);
      --calc-vh: calc(10vh - 4px);
      --calc-em: calc(1em + 2px);
      --calc-nested: calc(calc(10vw + 5px) * 2);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --calc-vw: 1px;
        --calc-vh: 1px;
        --calc-em: 1px;
        --calc-nested: 1px;
      }
    }
    .calc-vw-literal { width: calc(10vw + 5px); }
    .calc-vw-runtime { width: var(--calc-vw); }
    .calc-vh-literal { top: calc(10vh - 4px); }
    .calc-vh-runtime { top: var(--calc-vh); }
    .calc-em-literal { margin-top: calc(1em + 2px); }
    .calc-em-runtime { margin-top: var(--calc-em); }
    .calc-gap-literal { gap: calc(10vw + 5px); }
    .calc-gap-runtime { gap: var(--calc-vw); }
    .calc-nested-literal { width: calc(calc(10vw + 5px) * 2); }
    .calc-nested-runtime { width: var(--calc-nested); }
  `);

  // SUSPECTED DEFECT — this one runs the OTHER way: the runtime path is right
  // and the compile-time path throws the declaration away.
  //   literal / inlinable var : undefined — no `style` prop is emitted at all
  //   NON-inlinable var       : the correct arithmetic
  //   correct per CSS         : the RUNTIME result. The viewport is 750x1334,
  //     so 10vw = 75 and 10vw + 5px = 80; 10vh = 133.4 and 10vh - 4px = 129.4;
  //     the default em is 14 so 1em + 2px = 16.
  expect(styleFor("calc-vw-literal")).toBeUndefined();
  expect(styleFor("calc-vw-runtime")).toStrictEqual({ width: 80 });

  expect(styleFor("calc-vh-literal")).toBeUndefined();
  expect(styleFor("calc-vh-runtime")).toStrictEqual({ top: 129.4 });

  expect(styleFor("calc-em-literal")).toBeUndefined();
  expect(styleFor("calc-em-runtime")).toStrictEqual({ marginTop: 16 });

  expect(styleFor("calc-gap-literal")).toBeUndefined();
  expect(styleFor("calc-gap-runtime")).toStrictEqual({ gap: 80 });

  expect(styleFor("calc-nested-literal")).toBeUndefined();
  expect(styleFor("calc-nested-runtime")).toStrictEqual({ width: 160 });
});

test("calc() mixing a percentage with px is dropped on BOTH routes", () => {
  registerCSS(`
    :root { --calc-percent: calc(100% - 10px); }
    @media (prefers-color-scheme: dark) { :root { --calc-percent: 1px; } }
    .calc-percent-literal { height: calc(100% - 10px); }
    .calc-percent-runtime { height: var(--calc-percent); }
  `);

  // React Native cannot represent a percentage combined with a length, so both
  // routes correctly refuse it. They differ only in whether an empty style
  // object is produced.
  expect(styleFor("calc-percent-literal")).toBeUndefined();
  expect(styleFor("calc-percent-runtime")).toStrictEqual({});
});

/* -------------------------------------------------------------------------- */
/* DIVERGENCE 5 — the runtime path performs no per-property validation         */
/* -------------------------------------------------------------------------- */

test("`overflow: scroll` agrees on every route", () => {
  registerCSS(`
    :root { --overflow-scroll: scroll; }
    @media (prefers-color-scheme: dark) { :root { --overflow-scroll: hidden; } }
    .overflow-scroll-literal { overflow: scroll; }
    .overflow-scroll-runtime { overflow: var(--overflow-scroll); }
  `);

  // React Native's ViewStyle declares overflow as
  // "visible" | "hidden" | "scroll". `parseOverflow` used to allow only the
  // first two, so the literal route dropped `scroll` while the runtime route
  // kept it.
  expect(styleFor("overflow-scroll-literal")).toStrictEqual({
    overflow: "scroll",
  });
  expect(styleFor("overflow-scroll-runtime")).toStrictEqual({
    overflow: "scroll",
  });
});

test("SUSPECTED DEFECT: values React Native cannot use are filtered at compile time but leak at runtime", () => {
  registerCSS(`
    :root {
      --position-fixed: fixed;
      --width-min-content: min-content;
      --overflow-clip: clip;
      --gap-normal: normal;
      --z-index-auto: auto;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --position-fixed: absolute;
        --width-min-content: 1px;
        --overflow-clip: hidden;
        --gap-normal: 1px;
        --z-index-auto: 1;
      }
    }
    .position-fixed-literal { position: fixed; }
    .position-fixed-runtime { position: var(--position-fixed); }
    .min-content-literal { width: min-content; }
    .min-content-runtime { width: var(--width-min-content); }
    .overflow-clip-literal { overflow: clip; }
    .overflow-clip-runtime { overflow: var(--overflow-clip); }
    .gap-normal-literal { gap: normal; }
    .gap-normal-runtime { gap: var(--gap-normal); }
    .z-index-auto-literal { z-index: auto; }
    .z-index-auto-runtime { z-index: var(--z-index-auto); }
  `);

  // SUSPECTED DEFECT — the compile-time path rejects a value React Native has
  // no representation for; the runtime path forwards the raw token.
  //   correct per CSS/RN: the LITERAL result in every row here. React Native
  //     supports neither `position: fixed`, `width: min-content`,
  //     `overflow: clip`, nor `gap: normal`.
  expect(styleFor("position-fixed-literal")).toBeUndefined();
  expect(styleFor("position-fixed-runtime")).toStrictEqual({
    position: "fixed",
  });

  expect(styleFor("min-content-literal")).toBeUndefined();
  expect(styleFor("min-content-runtime")).toStrictEqual({
    width: "min-content",
  });

  expect(styleFor("overflow-clip-literal")).toBeUndefined();
  expect(styleFor("overflow-clip-runtime")).toStrictEqual({ overflow: "clip" });

  expect(styleFor("gap-normal-literal")).toBeUndefined();
  expect(styleFor("gap-normal-runtime")).toStrictEqual({ gap: "normal" });

  // `zIndex` is typed `number | undefined` (`StyleSheetTypes.d.ts`), so the
  // keyword the runtime route forwards is a value React Native cannot use.
  expect(styleFor("z-index-auto-literal")).toBeUndefined();
  expect(styleFor("z-index-auto-runtime")).toStrictEqual({ zIndex: "auto" });
});

test("SUSPECTED DEFECT: an unparseable value reaches React Native verbatim on every route", () => {
  registerCSS(`
    :root {
      --garbage-overflow: garbage;
      --garbage-position: garbage;
      --garbage-direction: garbage;
      --garbage-width: garbage;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --garbage-overflow: hidden;
        --garbage-position: absolute;
        --garbage-direction: row;
        --garbage-width: 10px;
      }
    }
    .garbage-overflow-literal { overflow: garbage; }
    .garbage-overflow-runtime { overflow: var(--garbage-overflow); }
    .garbage-position-literal { position: garbage; }
    .garbage-position-runtime { position: var(--garbage-position); }
    .garbage-direction-literal { flex-direction: garbage; }
    .garbage-direction-runtime { flex-direction: var(--garbage-direction); }
    .garbage-width-literal { width: garbage; }
    .garbage-width-runtime { width: var(--garbage-width); }
    .garbage-z-index-literal { z-index: garbage; }
    .garbage-margin-literal { margin: garbage; }
  `);

  // SUSPECTED DEFECT — an invalid keyword is not a compile-time route at all.
  // lightningcss cannot parse it into a typed declaration, so it stays
  // `unparsed` and is emitted as a runtime descriptor exactly like a
  // non-inlinable var. The per-property validators in
  // src/compiler/declarations.ts therefore never see it, and neither route
  // validates: the raw token lands in the React Native style object.
  //   literal / inlinable var / NON-inlinable var : { overflow: "garbage" }
  //   correct per CSS : the declaration is invalid and must be dropped.
  expect(styleFor("garbage-overflow-literal")).toStrictEqual({
    overflow: "garbage",
  });
  expect(styleFor("garbage-overflow-runtime")).toStrictEqual({
    overflow: "garbage",
  });

  expect(styleFor("garbage-position-literal")).toStrictEqual({
    position: "garbage",
  });
  expect(styleFor("garbage-position-runtime")).toStrictEqual({
    position: "garbage",
  });

  expect(styleFor("garbage-direction-literal")).toStrictEqual({
    flexDirection: "garbage",
  });
  expect(styleFor("garbage-direction-runtime")).toStrictEqual({
    flexDirection: "garbage",
  });

  expect(styleFor("garbage-width-literal")).toStrictEqual({ width: "garbage" });
  expect(styleFor("garbage-width-runtime")).toStrictEqual({ width: "garbage" });

  // A numeric property fares no better: `zIndex` is typed `number` in React
  // Native, and `margin: garbage` is not expanded either.
  expect(styleFor("garbage-z-index-literal")).toStrictEqual({
    zIndex: "garbage",
  });
  expect(styleFor("garbage-margin-literal")).toStrictEqual({
    margin: "garbage",
  });
});

test("SUSPECTED DEFECT: `gap` with a runtime unit splits into rowGap/columnGap only on the compile-time path", () => {
  registerCSS(`
    :root { --gap-vw: 10vw; --gap-em: 1em; }
    @media (prefers-color-scheme: dark) { :root { --gap-vw: 1px; --gap-em: 1px; } }
    .gap-vw-literal { gap: 10vw; }
    .gap-vw-runtime { gap: var(--gap-vw); }
    .gap-em-literal { gap: 1em; }
    .gap-em-runtime { gap: var(--gap-em); }
    .gap-px-literal { gap: 10px; }
  `);

  // SUSPECTED DEFECT (equivalent in effect, different in shape). A gap whose
  // value needs runtime resolution is emitted as the two longhands at compile
  // time, but stays on the `gap` key at runtime. A px/rem/calc gap keeps the
  // `gap` key on both routes, so the split is triggered by the UNIT, not the
  // property.
  //   literal / inlinable var : { rowGap: 75, columnGap: 75 }
  //   NON-inlinable var       : { gap: 75 }
  //   correct per CSS         : both — React Native treats `gap` as shorthand
  //     for rowGap + columnGap.
  expect(styleFor("gap-vw-literal")).toStrictEqual({
    rowGap: 75,
    columnGap: 75,
  });
  expect(styleFor("gap-vw-runtime")).toStrictEqual({ gap: 75 });

  expect(styleFor("gap-em-literal")).toStrictEqual({
    rowGap: 14,
    columnGap: 14,
  });
  expect(styleFor("gap-em-runtime")).toStrictEqual({ gap: 14 });

  expect(styleFor("gap-px-literal")).toStrictEqual({ gap: 10 });
});

/* -------------------------------------------------------------------------- */
/* DIVERGENCE 6 — aspect-ratio: a whole ratio agrees, a bare number does not   */
/* -------------------------------------------------------------------------- */

test("aspect-ratio: a ratio takes one shape on both routes, a bare number two", () => {
  registerCSS(`
    :root { --ratio-fraction: 16 / 9; --ratio-number: 2; --ratio-one: 1; }
    @media (prefers-color-scheme: dark) {
      :root { --ratio-fraction: 1 / 1; --ratio-number: 1; --ratio-one: 2; }
    }
    .ratio-fraction-literal { aspect-ratio: 16 / 9; }
    .ratio-fraction-runtime { aspect-ratio: var(--ratio-fraction); }
    .ratio-number-literal { aspect-ratio: 2; }
    .ratio-number-runtime { aspect-ratio: var(--ratio-number); }
    .ratio-one-literal { aspect-ratio: 1; }
    .ratio-one-runtime { aspect-ratio: var(--ratio-one); }
  `);

  // A `<ratio>` takes ONE shape whichever route it arrives by — the runtime
  // tokeniser serialises it the way the property parser does, so whether the
  // compiler could fold the variable is not visible in the value.
  //
  //   16 / 9 -> literal "16/9"   runtime "16/9"
  //   2      -> literal "2/1"    runtime 2       <- still two shapes
  //
  // The bare number is the one that still differs, and both are correct per
  // CSS: React Native's processAspectRatio splits on "/" and trims each side,
  // so every spelling here resolves to the same ratio.
  expect(styleFor("ratio-fraction-literal")).toStrictEqual({
    aspectRatio: "16/9",
  });
  expect(styleFor("ratio-fraction-runtime")).toStrictEqual({
    aspectRatio: "16/9",
  });

  expect(styleFor("ratio-number-literal")).toStrictEqual({
    aspectRatio: "2/1",
  });
  expect(styleFor("ratio-number-runtime")).toStrictEqual({ aspectRatio: 2 });

  // `1` is the one value the compile-time path emits as a bare number, so here
  // the two routes happen to agree exactly.
  expect(styleFor("ratio-one-literal")).toStrictEqual({ aspectRatio: 1 });
  expect(styleFor("ratio-one-runtime")).toStrictEqual({ aspectRatio: 1 });
});
