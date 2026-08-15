import { render } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

import { renderRoutes } from "./_routes/harness";

/**
 * `transform-origin`'s grammar, and the exact SHAPE each spelling reaches React
 * Native as.
 *
 * The shape matters more here than for most properties, for two reasons.
 *
 * **React Native validates this array rather than normalising it.** Its string
 * branch pre-fills a three-value result; its array branch is passed through and
 * checked by a `__DEV__`-only invariant requiring exactly three
 * (`contributions/117` §4). So a two-value array throws in development and
 * ships malformed in production, and this compiler produces the three-value
 * shape unconditionally rather than relying on either.
 *
 * **Every side keyword is the percentage css-transforms-1 §5.2 defines it to
 * be**, and so is every zero: `left top` and `0px 0px` both become
 * `["0%", "0%", z]`, as `right bottom` becomes `["100%", "100%", z]`. Only a
 * NON-zero length keeps a number, because a percentage for one would depend on
 * the element's measured size.
 *
 * The percentage spelling also happens to be the one that survives a
 * lightningcss round trip, which matters to any consumer running one in front
 * of this compiler: lightningcss types `transform-origin` as `Position`, which
 * carries no z, and rewrites `left top 30px` to `0 30px`. That is a separate
 * defect with its own repair (`compiler/transform-origin.ts`, first pass), and
 * these tests do not measure it — a jest suite hands CSS straight to the
 * compiler and never crosses the hop where it happens.
 *
 * The tests below pin which spelling produces which type. The consuming repo's
 * `frontends/storybook` renders both under the same rotation and asserts they
 * coincide on a device — and that assertion currently FAILS, for the
 * lightningcss reason above rather than anything these tests can reach. Keep
 * the two facts apart: this file measures what the compiler emits, the device
 * suite measures what survives the whole pipeline, and the gap between them is
 * the hop no jest suite crosses.
 */

/** The style React Native receives for one class. */
function styleOf(css: string, className: string): unknown {
  registerCSS(css);

  return render(<View testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style;
}

/* -------------------------------------------------------------------------
 * The grammar
 * ---------------------------------------------------------------------- */

test("every keyword pair compiles to the percentage the spec defines", () => {
  // css-transforms-1 §5.2: `left` and `top` ARE `0%`, exactly as `right` and
  // `bottom` are `100%`. The near sides were the number `0` — the same point,
  // spelled inconsistently with the other three.
  expect(styleOf(`.a { transform-origin: left top; }`, "a")).toStrictEqual({
    transformOrigin: ["0%", "0%", 0],
  });

  expect(styleOf(`.b { transform-origin: right bottom; }`, "b")).toStrictEqual({
    transformOrigin: ["100%", "100%", 0],
  });
});

test("the z is carried, and every form is three values", () => {
  // React Native's array branch requires exactly three and does not fill in the
  // missing one, so a two-value result is a crash in development and a
  // malformed value in production.
  expect(styleOf(`.a { transform-origin: left top 30px; }`, "a")).toStrictEqual(
    { transformOrigin: ["0%", "0%", 30] },
  );

  expect(
    styleOf(`.b { transform-origin: right bottom 30px; }`, "b"),
  ).toStrictEqual({ transformOrigin: ["100%", "100%", 30] });

  expect(styleOf(`.c { transform-origin: center; }`, "c")).toStrictEqual({
    transformOrigin: ["50%", "50%", 0],
  });
});

test("a keyword claims its own axis wherever it was written", () => {
  // css-transforms-1 joins the keyword pair with `&&`, so `top left` and
  // `left top` are one position — the axis of a keyword decides its slot, not
  // the order it appears in.
  const written = styleOf(`.a { transform-origin: left top; }`, "a");
  const reversed = styleOf(`.b { transform-origin: top left; }`, "b");

  expect(reversed).toStrictEqual(written);
});

test("a lone vertical keyword fills the Y slot, not the X one", () => {
  // `top` can only ever be a y-component, so it must not be read as the first
  // positional value the way a lone length is.
  expect(styleOf(`.a { transform-origin: top; }`, "a")).toStrictEqual({
    transformOrigin: ["50%", "0%", 0],
  });

  expect(styleOf(`.b { transform-origin: 10px; }`, "b")).toStrictEqual({
    transformOrigin: [10, "50%", 0],
  });
});

test("a percentage z on the RUNTIME route is refused, because the z is a length", () => {
  // css-transforms-1: the third component is a `<length>`. A percentage there
  // is invalid CSS, and React Native rejects anything but a plain number — so
  // the two agree and the declaration is dropped rather than half-applied.
  const renders = renderRoutes({
    property: "transform-origin",
    value: "left top 50%",
    alternate: "right bottom 10px",
  });

  expect(renders.deferred.style).toStrictEqual({});
});

test("OPEN: the same declaration is ACCEPTED on the compile-time route", () => {
  // A divergence between the two routes, and between native and a browser.
  //
  // `transform-origin`'s grammar is a two-value `<position>` plus an optional z
  // `<length>`, so `left top 50%` is invalid — the z cannot be a percentage —
  // and a browser drops the whole declaration. lightningcss instead parses it
  // with the plain `<position>` grammar, where `top 50%` is a legal
  // side-with-offset, so the declaration never reaches the runtime resolver
  // that refuses it and the compiler emits an origin the author did not write.
  //
  // Pinned rather than fixed: the repair belongs in how a three-token origin is
  // decided to be a position-with-offset rather than a position plus a z, and
  // that decision is lightningcss's before it is this library's. Same root as
  // the round-trip loss described in the header.
  expect(styleOf(`.a { transform-origin: left top 50%; }`, "a")).toStrictEqual({
    transformOrigin: ["0%", "50%", 0],
  });
});

/* -------------------------------------------------------------------------
 * Every route produces the same shape
 * ---------------------------------------------------------------------- */

test("the keyword spelling is identical on all five routes", () => {
  const renders = renderRoutes({
    property: "transform-origin",
    value: "left top 30px",
    alternate: "right bottom 10px",
  });

  expect({
    inlinable: renders.inlinable.style,
    fallback: renders.fallback.style,
    deferred: renders.deferred.style,
    provider: renders.provider.style,
  }).toStrictEqual({
    inlinable: renders.literal.style,
    fallback: renders.literal.style,
    deferred: renders.literal.style,
    provider: renders.literal.style,
  });

  expect(renders.literal.style).toStrictEqual({
    transformOrigin: ["0%", "0%", 30],
  });
});

test("the percentage spelling is identical on all five routes", () => {
  const renders = renderRoutes({
    property: "transform-origin",
    value: "right bottom 30px",
    alternate: "left top 10px",
  });

  expect({
    inlinable: renders.inlinable.style,
    fallback: renders.fallback.style,
    deferred: renders.deferred.style,
    provider: renders.provider.style,
  }).toStrictEqual({
    inlinable: renders.literal.style,
    fallback: renders.literal.style,
    deferred: renders.literal.style,
    provider: renders.literal.style,
  });

  expect(renders.literal.style).toStrictEqual({
    transformOrigin: ["100%", "100%", 30],
  });
});

/* -------------------------------------------------------------------------
 * React Native's own reading of both shapes
 * ---------------------------------------------------------------------- */

test("React Native returns both array shapes unchanged", () => {
  // Which is what rules the JS side OUT as the cause of the device divergence:
  // whatever separates the two spellings there, it is not this function.
  const processTransformOrigin = jest.requireActual<{
    default: (value: unknown) => unknown;
  }>("react-native/Libraries/StyleSheet/processTransformOrigin").default;

  expect(processTransformOrigin([0, 0, 30])).toStrictEqual([0, 0, 30]);
  expect(processTransformOrigin(["100%", "100%", 30])).toStrictEqual([
    "100%",
    "100%",
    30,
  ]);
});

test("React Native's own string branch maps the near sides to numbers", () => {
  // React Native's own implementation of this grammar maps `left` and `top` to
  // the number `0`, where this compiler now emits `"0%"`. Both name the same
  // point, so the two do not disagree about the ORIGIN — only about how to
  // spell it, and this pins that the divergence is deliberate rather than
  // accidental drift.
  //
  // Pinned so a change on either side is visible: if React Native's string
  // branch starts emitting percentages, the two spellings converge and this
  // fails.
  const processTransformOrigin = jest.requireActual<{
    default: (value: unknown) => unknown;
  }>("react-native/Libraries/StyleSheet/processTransformOrigin").default;

  expect(processTransformOrigin("left top 30px")).toStrictEqual([0, 0, 30]);
  expect(processTransformOrigin("right bottom 30px")).toStrictEqual([
    "100%",
    "100%",
    30,
  ]);
});
