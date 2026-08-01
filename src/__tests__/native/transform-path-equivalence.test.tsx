import { render } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

/**
 * The same declaration reaches React Native by different routes depending on the
 * value it carries:
 *
 * 1. `literal`   — a static value, fully resolved by the compiler.
 * 2. `inlinable` — a custom property with exactly ONE definition, inlined by the
 *    compiler and then treated exactly like route 1.
 * 3. `deferred`  — a custom property with a SECOND definition (here behind a
 *    `prefers-color-scheme` media query), which cannot be inlined and so is
 *    resolved at runtime.
 * 4. runtime units (`em`, `vw`, `vh`, `%`) and `calc()` mixing them, which defer
 *    even when written literally.
 *
 * Routes 1/2 go through `parseTransform` / `parseFilter` in the compiler, which
 * switch exhaustively over lightningcss's parsed value. Route 3 goes through
 * `parseUnparsed`, whose function allow-list is a different, smaller set, and
 * then through the runtime resolvers in `native/styles/`. Every disagreement
 * below traces back to those two lists having drifted apart.
 *
 * These tests assert the CURRENT behaviour. Where the two routes agree, the test
 * locks the agreement in. Where they disagree, both values are pinned and the
 * divergence is called out with `SUSPECTED DEFECT`.
 */

/** React Native's own `filter` processor — the array branch is what runs here. */
const processFilter = jest.requireActual<{
  default: (filter: unknown) => unknown[];
}>("react-native/Libraries/StyleSheet/processFilter").default;

type Style = Record<string, unknown> | undefined;

/**
 * Registers one stylesheet, then renders one `View` per class name and returns
 * their resolved styles in the same order.
 */
function stylesFor(css: string, ...classNames: string[]): Style[] {
  registerCSS(css);

  return classNames.map((className) => {
    const view = render(<View testID={testID} className={className} />);
    return view.getByTestId(testID).props.style as Style;
  });
}

/**
 * Builds a stylesheet exercising routes 1, 2 and 3 for a single declaration.
 * `alternate` only exists to give `--deferred` a second definition; the media
 * query never matches under the default (unset) colour scheme.
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

describe("transform functions — routes that AGREE", () => {
  // A transform function is only safe across routes when the compiler's
  // `parseTransform` switch AND `parseUnparsed`'s function allow-list both name
  // it, and both produce the same single-key object.
  test.each([
    ["translateX(10px)", [{ translateX: 10 }]],
    ["translateY(10px)", [{ translateY: 10 }]],
    ["translateX(10%)", [{ translateX: "10%" }]],
    ["scaleX(2)", [{ scaleX: 2 }]],
    ["scaleY(2)", [{ scaleY: 2 }]],
    ["rotate(45deg)", [{ rotate: "45deg" }]],
    ["rotateX(45deg)", [{ rotateX: "45deg" }]],
    ["rotateY(45deg)", [{ rotateY: "45deg" }]],
    ["skewX(10deg)", [{ skewX: "10deg" }]],
    ["skewY(10deg)", [{ skewY: "10deg" }]],
  ])("%s is identical on all three routes", (value, expected) => {
    const [literal, inlinable, deferred] = transformRoutes(value);

    expect(literal).toStrictEqual({ transform: expected });
    expect(inlinable).toStrictEqual({ transform: expected });
    expect(deferred).toStrictEqual({ transform: expected });
  });
});

describe("transform functions — routes that used to DIVERGE", () => {
  test("rotateZ() survives the runtime route", () => {
    const [literal, inlinable, deferred] = transformRoutes("rotateZ(45deg)");

    // `parseTransform` always handled `rotateZ`; `parseUnparsed`'s function
    // allow-list did not, so the deferred route warned and dropped the rotation
    // entirely. `rotate()` (the 2D alias) was on both lists, which is what made
    // this easy to miss.
    expect(literal).toStrictEqual({ transform: [{ rotateZ: "45deg" }] });
    expect(inlinable).toStrictEqual({ transform: [{ rotateZ: "45deg" }] });
    expect(deferred).toStrictEqual({ transform: [{ rotateZ: "45deg" }] });
  });

  test("perspective() survives the runtime route", () => {
    const [literal, inlinable, deferred] =
      transformRoutes("perspective(100px)");

    expect(literal).toStrictEqual({ transform: [{ perspective: 100 }] });
    expect(inlinable).toStrictEqual({ transform: [{ perspective: 100 }] });
    expect(deferred).toStrictEqual({ transform: [{ perspective: 100 }] });
  });

  test("the two-argument skew() survives the runtime route", () => {
    const [literal, inlinable, deferred] =
      transformRoutes("skew(10deg, 20deg)");

    // `skewX`/`skewY` were on the allow-list but the `skew` shorthand was not,
    // and there was no runtime resolver to expand it into the pair.
    const expected = { transform: [{ skewX: "10deg" }, { skewY: "20deg" }] };
    expect(literal).toStrictEqual(expected);
    expect(inlinable).toStrictEqual(expected);
    expect(deferred).toStrictEqual(expected);
  });

  test("the two-argument translate() is FLAT on every route", () => {
    const [literal, inlinable, deferred] = transformRoutes(
      "translate(10px, 20px)",
    );

    // React Native's `transform` is a flat array of single-key objects, and
    // `processTransform` asserts "exactly one property per transform object" —
    // a nested entry has zero keys and fails it, taking every sibling transform
    // down with it. Both routes used to nest, in different places: the compiler
    // wrapped `translateY` in an extra array, and the runtime resolver returned
    // a pair the `transform` shorthand pushed as ONE entry.
    const expected = { transform: [{ translateX: 10 }, { translateY: 20 }] };
    expect(literal).toStrictEqual(expected);
    expect(inlinable).toStrictEqual(expected);
    expect(deferred).toStrictEqual(expected);
  });

  test("the one-argument translate() defaults y to 0 on every route", () => {
    const [literal, inlinable, deferred] = transformRoutes("translate(10px)");

    // With the y component omitted CSS defaults it to 0. The runtime resolver
    // read `args[1]` off a non-array descriptor, failed its validity check for
    // BOTH components, and returned nothing at all.
    const expected = { transform: [{ translateX: 10 }, { translateY: 0 }] };
    expect(literal).toStrictEqual(expected);
    expect(inlinable).toStrictEqual(expected);
    expect(deferred).toStrictEqual(expected);
  });

  test("the one-argument scale() splits on one route and collapses on the other", () => {
    const [literal, inlinable, deferred] = transformRoutes("scale(2)");

    // Divergent shape, same meaning: React Native understands both `scale` and
    // the `scaleX`/`scaleY` pair, so this one is benign — but a consumer that
    // reads back `style.transform` to find `scaleX` sees it on one route only.
    //   literal  -> [{ scaleX: 2 }, { scaleY: 2 }]
    //   deferred -> [{ scale: 2 }]
    expect(literal).toStrictEqual({
      transform: [{ scaleX: 2 }, { scaleY: 2 }],
    });
    expect(inlinable).toStrictEqual({
      transform: [{ scaleX: 2 }, { scaleY: 2 }],
    });
    expect(deferred).toStrictEqual({ transform: [{ scale: 2 }] });
  });

  test("the two-argument scale() is FLAT on every route", () => {
    const [literal, inlinable, deferred] = transformRoutes("scale(2, 3)");

    const expected = { transform: [{ scaleX: 2 }, { scaleY: 3 }] };
    expect(literal).toStrictEqual(expected);
    expect(inlinable).toStrictEqual(expected);
    expect(deferred).toStrictEqual(expected);
  });
});

describe("transform functions — the 3D and matrix family", () => {
  test("matrix() becomes React Native's column-major 3x3", () => {
    const [literal] = transformRoutes("matrix(1, 2, 3, 4, 5, 6)");

    // React Native takes a 9-element (2D) or 16-element (3D) matrix, which is
    // the same column-major layout CSS names: columns (a b 0), (c d 0), (e f 1).
    // This used to compile to `[[]]` — an empty entry that fails React Native's
    // "exactly one property per transform object" and discards the whole
    // declaration.
    expect(literal).toStrictEqual({
      transform: [{ matrix: [1, 2, 0, 3, 4, 0, 5, 6, 1] }],
    });
  });

  test("matrix3d() passes its 16 values through", () => {
    const [literal] = transformRoutes(
      "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1)",
    );

    // CSS's `m11..m44` argument order IS column-major, and React Native expects
    // the same, so this is a straight copy.
    expect(literal).toStrictEqual({
      transform: [
        { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1] },
      ],
    });
  });

  test("translate3d() keeps its x/y and warns about the z", () => {
    const [literal] = transformRoutes("translate3d(1px, 2px, 3px)");

    // React Native has no `translateZ`, so the x/y half is the closest exact
    // rendering. The z is named in a warning rather than dropped in silence.
    expect(literal).toStrictEqual({
      transform: [{ translateX: 1 }, { translateY: 2 }],
    });
    expect(
      registerCSS(`.z { transform: translate3d(1px, 2px, 3px); }`).warnings(),
    ).toStrictEqual({ values: { transform: ["translate3d(<z>)"] } });
  });

  test("a zero z in translate3d is the identity and warns about nothing", () => {
    const compiled = registerCSS(
      `.z0 { transform: translate3d(1px, 2px, 0); }`,
    );
    const style = render(<View testID={testID} className="z0" />).getByTestId(
      testID,
    ).props.style as Style;

    expect(style).toStrictEqual({
      transform: [{ translateX: 1 }, { translateY: 2 }],
    });
    expect(compiled.warnings()).toStrictEqual({});
  });

  test("scale3d() keeps its x/y and warns about the z", () => {
    const [literal] = transformRoutes("scale3d(1, 2, 3)");

    expect(literal).toStrictEqual({
      transform: [{ scaleX: 1 }, { scaleY: 2 }],
    });
    expect(
      registerCSS(`.s { transform: scale3d(1, 2, 3); }`).warnings(),
    ).toStrictEqual({ values: { transform: ["scale3d(<z>)"] } });
  });

  test("an axis-aligned rotate3d() maps onto the matching Euler rotation", () => {
    // `rotate3d` is an axis-angle rotation, and React Native has only the three
    // Euler rotations — exact for a unit axis, and with no decomposition for
    // anything else.
    const [x] = transformRoutes("rotate3d(1, 0, 0, 45deg)");
    const [y] = transformRoutes("rotate3d(0, 1, 0, 45deg)");
    const [z] = transformRoutes("rotate3d(0, 0, 1, 45deg)");

    expect(x).toStrictEqual({ transform: [{ rotateX: "45deg" }] });
    expect(y).toStrictEqual({ transform: [{ rotateY: "45deg" }] });
    expect(z).toStrictEqual({ transform: [{ rotateZ: "45deg" }] });
  });

  test.each([
    ["rotate3d(1, 1, 1, 45deg)", "rotate3d(<axis>)"],
    ["translateZ(10px)", "translateZ()"],
    ["scaleZ(2)", "scaleZ()"],
  ])("%s contributes nothing and says so", (value, warning) => {
    const [literal, inlinable, deferred] = transformRoutes(value);

    // Returning `[[]]` — as every one of these did — ships an EMPTY object into
    // the transform array. React Native's `processTransform` asserts exactly one
    // property per entry, so one unsupported function discarded every transform
    // beside it.
    expect(literal).toStrictEqual({ transform: [] });
    expect(inlinable).toStrictEqual({ transform: [] });
    expect(deferred).toStrictEqual({ transform: [] });
    expect(
      registerCSS(`.unsupported { transform: ${value}; }`).warnings(),
    ).toStrictEqual({ values: { transform: [warning] } });
  });
});

describe("transform — runtime units", () => {
  test.each([
    ["translateX(2em)", [{ translateX: 28 }]],
    ["translateX(10vw)", [{ translateX: 75 }]],
    ["translateY(10vh)", [{ translateY: 133.4 }]],
    ["translateX(50%)", [{ translateX: "50%" }]],
    ["perspective(2em)", [{ perspective: 28 }]],
    ["scaleX(calc(1 + 1))", [{ scaleX: 2 }]],
    ["rotate(calc(45deg * 2))", [{ rotate: "90deg" }]],
    ["translateX(calc(10px + 5px))", [{ translateX: 15 }]],
  ])("%s resolves at runtime and keeps its slot", (value, expected) => {
    const [style] = stylesFor(`.literal { transform: ${value}; }`, "literal");

    expect(style).toStrictEqual({ transform: expected });
  });

  test.each([
    ["translateX(2em)", [{ translateX: 28 }]],
    ["translateX(50%)", [{ translateX: "50%" }]],
    ["translateX(calc(10px + 5px))", [{ translateX: 15 }]],
  ])(
    "%s resolves the same when it arrives through a runtime variable",
    (value, expected) => {
      const [literal, , deferred] = transformRoutes(value);

      expect(literal).toStrictEqual({ transform: expected });
      expect(deferred).toStrictEqual({ transform: expected });
    },
  );

  test("calc() mixing a runtime unit with a literal length produces undefined", () => {
    const [style] = stylesFor(
      `.literal { transform: translateX(calc(2em + 1px)); }`,
      "literal",
    );

    // SUSPECTED DEFECT: `calc(2em + 1px)` should be 29 (2em = 28 at the default
    // 14 rem, plus 1). Instead the transform slot survives with an `undefined`
    // value. `calc(10px + 5px)` (no runtime unit) and a bare `2em` both work,
    // so it is specifically MIXING a runtime unit with a literal length inside
    // `calc()` that fails.
    //   literal -> [{ translateX: undefined }]
    //   correct -> [{ translateX: 29 }]
    expect(style).toStrictEqual({ transform: [{ translateX: undefined }] });
  });
});

describe("standalone translate / rotate / scale properties", () => {
  test("translate resolves identically on all three routes", () => {
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("translate", "10px 20px", "1px 2px"),
      "literal",
      "inlinable",
      "deferred",
    );

    // `translate` is a transform KEY, so `applyDeclarations` writes the
    // sentinel `{ translate: true }` into `transform` and defers the real
    // resolution. The runtime resolver RESOLVES its argument before inspecting
    // it, so a whole-value `var()` — one descriptor that resolves to the
    // component list — is the same declaration as the two components written
    // out, and the sentinel is replaced rather than left in the style.
    expect(literal).toStrictEqual({
      transform: [{ translateX: 10 }, { translateY: 20 }],
    });
    expect(inlinable).toStrictEqual({
      transform: [{ translateX: 10 }, { translateY: 20 }],
    });
    expect(deferred).toStrictEqual({
      transform: [{ translateX: 10 }, { translateY: 20 }],
    });
  });

  test("translate percentages resolve identically too", () => {
    const [literal, , deferred] = stylesFor(
      threeRoutes("translate", "10% 20%", "1% 2%"),
      "literal",
      "inlinable",
      "deferred",
    );

    // A percentage stays a string all the way to React Native, which resolves
    // it against the element's own size — so the two routes agree on the
    // string, not merely on a number.
    expect(literal).toStrictEqual({
      transform: [{ translateX: "10%" }, { translateY: "20%" }],
    });
    expect(deferred).toStrictEqual({
      transform: [{ translateX: "10%" }, { translateY: "20%" }],
    });
  });

  test("translate with runtime units stays on the static route and resolves", () => {
    const [em, viewport] = stylesFor(
      `.em { translate: 2em 3em; } .viewport { translate: 10vw 10vh; }`,
      "em",
      "viewport",
    );

    expect(em).toStrictEqual({
      transform: [{ translateX: 28 }, { translateY: 42 }],
    });
    expect(viewport).toStrictEqual({
      transform: [{ translateX: 75 }, { translateY: 133.4 }],
    });
  });

  test("scale with two components splits into scaleX / scaleY on every route", () => {
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("scale", "2 3", "4 5"),
      "literal",
      "inlinable",
      "deferred",
    );

    // Two components are two axes. React Native's `scale` takes a single
    // number, so the pair has to become `scaleX` + `scaleY` — which is what
    // resolving the argument before inspecting it makes possible on the
    // deferred route, where the pair arrives as one `var()` rather than as two
    // sibling descriptors.
    expect(literal).toStrictEqual({
      transform: [{ scaleX: 2 }, { scaleY: 3 }],
    });
    expect(inlinable).toStrictEqual({
      transform: [{ scaleX: 2 }, { scaleY: 3 }],
    });
    expect(deferred).toStrictEqual({
      transform: [{ scaleX: 2 }, { scaleY: 3 }],
    });
  });

  test("scale with one component splits statically and collapses at runtime", () => {
    const [literal, , deferred] = stylesFor(
      threeRoutes("scale", "2", "3"),
      "literal",
      "inlinable",
      "deferred",
    );

    // Divergent shape, same meaning — React Native understands both.
    expect(literal).toStrictEqual({
      transform: [{ scaleX: 2 }, { scaleY: 2 }],
    });
    expect(deferred).toStrictEqual({ transform: [{ scale: 2 }] });
  });

  test("rotate picks a different axis key on each route", () => {
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("rotate", "45deg", "90deg"),
      "literal",
      "inlinable",
      "deferred",
    );

    // Divergent shape, same meaning: `rotate` and `rotateZ` are the same
    // rotation in React Native. Still a divergence a consumer reading back the
    // array will trip over.
    //   literal  -> [{ rotateZ: "45deg" }]
    //   deferred -> [{ rotate: "45deg" }]
    expect(literal).toStrictEqual({ transform: [{ rotateZ: "45deg" }] });
    expect(inlinable).toStrictEqual({ transform: [{ rotateZ: "45deg" }] });
    expect(deferred).toStrictEqual({ transform: [{ rotate: "45deg" }] });
  });

  test("rotate with an explicit axis keeps the axis on both routes", () => {
    const [literal, , deferred] = stylesFor(
      threeRoutes("rotate", "x 45deg", "y 45deg"),
      "literal",
      "inlinable",
      "deferred",
    );

    // css-transforms-2 §3.3: the standalone `rotate` PROPERTY names its axis
    // beside the angle — `rotate: x 45deg` is ONE rotation about x, not two
    // rotations. The components are `&&`-combined, so either order is valid,
    // and both routes read the keyword as an axis rather than as a component.
    expect(literal).toStrictEqual({ transform: [{ rotateX: "45deg" }] });
    expect(deferred).toStrictEqual({ transform: [{ rotateX: "45deg" }] });
  });

  test("the `none` keyword is the identity on the static route", () => {
    const [translate, scale, rotate] = stylesFor(
      `
        .translate { translate: none; }
        .scale { scale: none; }
        .rotate { rotate: none; }
      `,
      "translate",
      "scale",
      "rotate",
    );

    // Every one of these is an IDENTITY transform.
    expect(translate).toStrictEqual({
      transform: [{ translateX: 0 }, { translateY: 0 }],
    });
    expect(rotate).toStrictEqual({ transform: [{ rotateZ: "0deg" }] });

    // The identity scale is 1, not 0 — `scale: none` means "do not scale", so
    // a 0 there would scale the element to nothing and make it invisible.
    expect(scale).toStrictEqual({ transform: [{ scaleX: 1 }, { scaleY: 1 }] });
  });

  test("the `none` keyword through a runtime variable is the identity too", () => {
    const [translate, scale, rotate] = stylesFor(
      `
        :root { --translate: none; }
        @media (prefers-color-scheme: dark) { :root { --translate: 1px 2px; } }
        .translate { translate: var(--translate); }

        :root { --scale: none; }
        @media (prefers-color-scheme: dark) { :root { --scale: 2; } }
        .scale { scale: var(--scale); }

        :root { --rotate: none; }
        @media (prefers-color-scheme: dark) { :root { --rotate: 45deg; } }
        .rotate { rotate: var(--rotate); }
      `,
      "translate",
      "scale",
      "rotate",
    );

    // None of these was renderable: the delayed-resolution sentinel leaked for
    // `translate`, and the literal keyword `"none"` reached the style for the
    // other two — where the static route (previous test) turned each into an
    // identity transform. The two routes now agree.
    expect(translate).toStrictEqual({
      transform: [{ translateX: 0 }, { translateY: 0 }],
    });
    expect(scale).toStrictEqual({ transform: [{ scale: 1 }] });
    expect(rotate).toStrictEqual({ transform: [{ rotate: "0deg" }] });
  });
});

describe("transform-origin", () => {
  test.each([
    ["10px 20px", [10, 20]],
    ["50% 50%", ["50%", "50%"]],
    ["2em 3em", [28, 42]],
    ["10vw 10vh", [75, 133.4]],
  ])(
    "%s resolves the same components on all three routes",
    (value, expected) => {
      const [literal, inlinable, deferred] = stylesFor(
        threeRoutes("transform-origin", value, "center"),
        "literal",
        "inlinable",
        "deferred",
      );

      // All three routes carry an explicit z, because React Native's
      // `processTransformOrigin` asserts `length === 3` and throws an Invariant
      // Violation otherwise — a hard render crash, which is what a two-element
      // array used to cause on a device. The deferred route reaches that arity
      // through `native/styles/transform-origin.ts` rather than through the
      // compiler, so this is the assertion that keeps the two implementations
      // honest.
      expect(literal).toStrictEqual({ transformOrigin: [...expected, 0] });
      expect(inlinable).toStrictEqual({ transformOrigin: [...expected, 0] });
      expect(deferred).toStrictEqual({ transformOrigin: [...expected, 0] });
    },
  );

  test("side keywords resolve to percentages on the runtime route too", () => {
    const [nearSides, farSides] = stylesFor(
      `
        :root { --near: left top; }
        @media (prefers-color-scheme: dark) { :root { --near: center; } }
        .near { transform-origin: var(--near); }

        :root { --far: right bottom; }
        @media (prefers-color-scheme: dark) { :root { --far: center; } }
        .far { transform-origin: var(--far); }
      `,
      "near",
      "far",
    );

    // React Native's ARRAY form of `transformOrigin` takes numbers and
    // percentage strings, never keywords — a leaked `"left"` fails its
    // "x-position must be a number" invariant just as loudly as a wrong arity.
    expect(nearSides).toStrictEqual({ transformOrigin: ["0%", "0%", 0] });
    expect(farSides).toStrictEqual({ transformOrigin: ["100%", "100%", 0] });
  });

  test("a keyword pair written in either axis order resolves the same", () => {
    // The `&&` production: `top left` is the same origin as `left top`. The
    // runtime route sees the two keywords as bare strings with no grammar
    // around them, so the axis a keyword belongs to has to decide its slot.
    const [forwards, backwards] = stylesFor(
      `
        :root { --forwards: left bottom; }
        @media (prefers-color-scheme: dark) { :root { --forwards: center; } }
        .forwards { transform-origin: var(--forwards); }

        :root { --backwards: bottom left; }
        @media (prefers-color-scheme: dark) { :root { --backwards: center; } }
        .backwards { transform-origin: var(--backwards); }
      `,
      "forwards",
      "backwards",
    );

    expect(forwards).toStrictEqual({ transformOrigin: ["0%", "100%", 0] });
    expect(backwards).toStrictEqual({ transformOrigin: ["0%", "100%", 0] });
  });

  test("side keywords resolve to percentages on the static routes", () => {
    const [nearSides, farSides, centre] = stylesFor(
      `
        .near { transform-origin: left top; }
        .far { transform-origin: right bottom; }
        .centre { transform-origin: center; }
      `,
      "near",
      "far",
      "centre",
    );

    expect(nearSides).toStrictEqual({ transformOrigin: ["0%", "0%", 0] });
    expect(farSides).toStrictEqual({ transformOrigin: ["100%", "100%", 0] });
    expect(centre).toStrictEqual({ transformOrigin: ["50%", "50%", 0] });
  });

  test("a single `center` keyword is completed to a pair on every route", () => {
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("transform-origin", "center", "left top"),
      "literal",
      "inlinable",
      "deferred",
    );

    expect(literal).toStrictEqual({ transformOrigin: ["50%", "50%", 0] });
    expect(inlinable).toStrictEqual({ transformOrigin: ["50%", "50%", 0] });
    expect(deferred).toStrictEqual({ transformOrigin: ["50%", "50%", 0] });
  });

  test("a single length is completed to a pair on every route", () => {
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("transform-origin", "10px", "20px"),
      "literal",
      "inlinable",
      "deferred",
    );

    // With the y component omitted CSS defaults it to `center`. A bare number
    // is not even an array, so the deferred route used to fail React Native's
    // arity check before it could fail the value check.
    expect(literal).toStrictEqual({ transformOrigin: [10, "50%", 0] });
    expect(inlinable).toStrictEqual({ transformOrigin: [10, "50%", 0] });
    expect(deferred).toStrictEqual({ transformOrigin: [10, "50%", 0] });
  });

  test("a lone vertical keyword claims the y slot on every route", () => {
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("transform-origin", "bottom", "10px"),
      "literal",
      "inlinable",
      "deferred",
    );

    expect(literal).toStrictEqual({ transformOrigin: ["50%", "100%", 0] });
    expect(inlinable).toStrictEqual({ transformOrigin: ["50%", "100%", 0] });
    expect(deferred).toStrictEqual({ transformOrigin: ["50%", "100%", 0] });
  });

  test("three components pass through on every route", () => {
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("transform-origin", "10px 20px 30px", "center"),
      "literal",
      "inlinable",
      "deferred",
    );

    // The three-value form NEVER reaches the compiler's declaration parser:
    // lightningcss reads this property with the `<position>` grammar, which has
    // no z, so it fails to parse and arrives unparsed. Every route here is
    // therefore the runtime one, which is exactly why it had to be built.
    expect(literal).toStrictEqual({ transformOrigin: [10, 20, 30] });
    expect(inlinable).toStrictEqual({ transformOrigin: [10, 20, 30] });
    expect(deferred).toStrictEqual({ transformOrigin: [10, 20, 30] });
  });

  test("an invalid z-component drops the declaration on every route", () => {
    // The z is a `<length>`; a percentage there is invalid CSS, and React
    // Native separately requires a plain number. Both agree, so the declaration
    // is dropped rather than shipped in a shape that throws.
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("transform-origin", "10px 20px 30%", "center"),
      "literal",
      "inlinable",
      "deferred",
    );

    expect(literal).toStrictEqual({});
    expect(inlinable).toStrictEqual({});
    expect(deferred).toStrictEqual({});
  });

  test("a deferred transform-origin never lands in the transform array", () => {
    // Regression guard: `transformOrigin` is deliberately NOT a member of
    // `transformKeys`. When it was, a deferred origin was APPENDED to the
    // transform array — `transform: scale(2); transform-origin: 1em 2em` gave
    // `transform: [{scaleX:2},{scaleY:2},14,28]`.
    const [literal, runtimeUnit, deferred] = stylesFor(
      `
        .literal { transform: scale(2); transform-origin: 10px 20px; }
        .runtime-unit { transform: scale(2); transform-origin: 1em 2em; }

        :root { --origin: 10px 20px; }
        @media (prefers-color-scheme: dark) { :root { --origin: center; } }
        .deferred { transform: scale(2); transform-origin: var(--origin); }
      `,
      "literal",
      "runtime-unit",
      "deferred",
    );

    expect(literal).toStrictEqual({
      transform: [{ scaleX: 2 }, { scaleY: 2 }],
      transformOrigin: [10, 20, 0],
    });
    expect(runtimeUnit).toStrictEqual({
      transform: [{ scaleX: 2 }, { scaleY: 2 }],
      // `em` resolves at COMPILE time, so this reaches `parseTransformOrigin`
      // and carries the explicit z — unlike a `var()`, which does not.
      transformOrigin: [14, 28, 0],
    });
    expect(deferred).toStrictEqual({
      transform: [{ scaleX: 2 }, { scaleY: 2 }],
      transformOrigin: [10, 20, 0],
    });
  });
});

describe("transform — declaration order is preserved", () => {
  test("statically declared functions keep their declared order", () => {
    const [forwards, backwards, three] = stylesFor(
      `
        .forwards { transform: translateX(10px) scaleX(2); }
        .backwards { transform: scaleX(2) translateX(10px); }
        .three { transform: rotate(45deg) translateX(10px) scaleX(2); }
      `,
      "forwards",
      "backwards",
      "three",
    );

    expect(forwards).toStrictEqual({
      transform: [{ translateX: 10 }, { scaleX: 2 }],
    });
    expect(backwards).toStrictEqual({
      transform: [{ scaleX: 2 }, { translateX: 10 }],
    });
    expect(three).toStrictEqual({
      transform: [{ rotate: "45deg" }, { translateX: 10 }, { scaleX: 2 }],
    });
  });

  test("a deferred function composes into its declared slot", () => {
    const [trailing, leading, middle] = stylesFor(
      `
        :root { --deferred: scaleX(2); }
        @media (prefers-color-scheme: dark) { :root { --deferred: scaleX(3); } }

        .trailing { transform: translateX(10px) var(--deferred); }
        .leading { transform: var(--deferred) translateX(10px); }
        .middle { transform: rotate(45deg) var(--deferred) translateX(10px); }
      `,
      "trailing",
      "leading",
      "middle",
    );

    expect(trailing).toStrictEqual({
      transform: [{ translateX: 10 }, { scaleX: 2 }],
    });
    expect(leading).toStrictEqual({
      transform: [{ scaleX: 2 }, { translateX: 10 }],
    });
    expect(middle).toStrictEqual({
      transform: [{ rotate: "45deg" }, { scaleX: 2 }, { translateX: 10 }],
    });
  });

  test("a runtime unit composes into its declared slot", () => {
    const [style] = stylesFor(
      `.middle { transform: scaleX(2) translateX(2em) rotate(45deg); }`,
      "middle",
    );

    expect(style).toStrictEqual({
      transform: [{ scaleX: 2 }, { translateX: 28 }, { rotate: "45deg" }],
    });
  });

  test("two deferred variables each contribute one flat entry", () => {
    const [style] = stylesFor(
      `
        :root { --first: scaleX(2); }
        @media (prefers-color-scheme: dark) { :root { --first: scaleX(3); } }
        :root { --second: rotate(45deg); }
        @media (prefers-color-scheme: dark) { :root { --second: rotate(90deg); } }

        .pair { transform: var(--first) var(--second); }
      `,
      "pair",
    );

    expect(style).toStrictEqual({
      transform: [{ scaleX: 2 }, { rotate: "45deg" }],
    });
  });

  test("ONE deferred variable holding TWO functions nests instead of flattening", () => {
    const [style] = stylesFor(
      `
        :root { --pair: scaleX(2) rotate(45deg); }
        @media (prefers-color-scheme: dark) { :root { --pair: none; } }

        .nested { transform: translateX(10px) var(--pair) skewX(5deg); }
      `,
      "nested",
    );

    // A variable carrying a MULTI-function transform list is spread in place,
    // not pushed as one nested entry. The surrounding order always survived;
    // the middle slot was the part React Native could not accept, and it took
    // the whole declaration down with it.
    expect(style).toStrictEqual({
      transform: [
        { translateX: 10 },
        { scaleX: 2 },
        { rotate: "45deg" },
        { skewX: "5deg" },
      ],
    });
  });

  test("the same function declared twice keeps both entries on both routes", () => {
    const [literal, deferred] = stylesFor(
      `
        :root { --second: translateX(20px); }
        @media (prefers-color-scheme: dark) { :root { --second: translateX(30px); } }

        .literal { transform: translateX(10px) translateX(20px); }
        .deferred { transform: translateX(10px) var(--second); }
      `,
      "literal",
      "deferred",
    );

    expect(literal).toStrictEqual({
      transform: [{ translateX: 10 }, { translateX: 20 }],
    });
    expect(deferred).toStrictEqual({
      transform: [{ translateX: 10 }, { translateX: 20 }],
    });
  });
});

describe("transform — a second declaration REPLACES rather than appends", () => {
  test("within one rule", () => {
    const [style] = stylesFor(
      `.replaced { transform: scaleX(2); transform: translateX(10px); }`,
      "replaced",
    );

    expect(style).toStrictEqual({ transform: [{ translateX: 10 }] });
  });

  test("across two classes, both static", () => {
    registerCSS(
      `.first { transform: scaleX(2); } .second { transform: translateX(10px); }`,
    );
    const view = render(<View testID={testID} className="first second" />);

    expect(view.getByTestId(testID).props.style).toStrictEqual({
      transform: [{ translateX: 10 }],
    });
  });

  test("across two classes, a deferred value replacing a static one", () => {
    registerCSS(`
      :root { --deferred: translateX(10px); }
      @media (prefers-color-scheme: dark) { :root { --deferred: translateX(20px); } }

      .first { transform: scaleX(2); }
      .second { transform: var(--deferred); }
    `);
    const view = render(<View testID={testID} className="first second" />);

    expect(view.getByTestId(testID).props.style).toStrictEqual({
      transform: [{ translateX: 10 }],
    });
  });

  test("across two classes, a static value replacing a deferred one", () => {
    registerCSS(`
      :root { --deferred: translateX(10px); }
      @media (prefers-color-scheme: dark) { :root { --deferred: translateX(20px); } }

      .first { transform: var(--deferred); }
      .second { transform: scaleX(2); }
    `);
    const view = render(<View testID={testID} className="first second" />);

    expect(view.getByTestId(testID).props.style).toStrictEqual({
      transform: [{ scaleX: 2 }],
    });
  });

  test("!important wins over a later static declaration", () => {
    registerCSS(
      `.first { transform: scaleX(2) !important; } .second { transform: translateX(10px); }`,
    );
    const view = render(<View testID={testID} className="first second" />);

    expect(view.getByTestId(testID).props.style).toStrictEqual({
      transform: [{ scaleX: 2 }],
    });
  });

  test("!important on a deferred value wins too", () => {
    registerCSS(`
      :root { --deferred: scaleX(2); }
      @media (prefers-color-scheme: dark) { :root { --deferred: scaleX(3); } }

      .first { transform: var(--deferred) !important; }
      .second { transform: translateX(10px); }
    `);
    const view = render(<View testID={testID} className="first second" />);

    expect(view.getByTestId(testID).props.style).toStrictEqual({
      transform: [{ scaleX: 2 }],
    });
  });

  test("a matching @media block replaces, on both routes", () => {
    const [literal, deferred] = stylesFor(
      `
        :root { --deferred: scaleX(2); }
        @media (prefers-color-scheme: dark) { :root { --deferred: scaleX(3); } }

        .literal { transform: scaleX(2); }
        @media (min-width: 1px) { .literal { transform: translateX(10px); } }

        .deferred { transform: translateX(10px); }
        @media (min-width: 1px) { .deferred { transform: var(--deferred); } }
      `,
      "literal",
      "deferred",
    );

    expect(literal).toStrictEqual({ transform: [{ translateX: 10 }] });
    expect(deferred).toStrictEqual({ transform: [{ scaleX: 2 }] });
  });

  test("transform: none empties the array on the static route", () => {
    const [style] = stylesFor(`.literal { transform: none; }`, "literal");

    expect(style).toStrictEqual({ transform: [] });
  });

  test("transform: none through a runtime variable empties the array too", () => {
    const [style] = stylesFor(
      `
        :root { --deferred: none; }
        @media (prefers-color-scheme: dark) { :root { --deferred: scaleX(2); } }
        .deferred { transform: var(--deferred); }
      `,
      "deferred",
    );

    // The runtime `transform` shorthand keeps only entries that are the shape
    // React Native's transform array holds — a single-keyed object — so
    // `none`, `initial` and anything else that resolves to a bare string is
    // dropped rather than forwarded. `none` IS the empty transform, so the
    // empty array is the right thing to be left with.
    expect(style).toStrictEqual({ transform: [] });
  });
});

describe("transform composed with the standalone translate/rotate/scale properties", () => {
  test("in the SAME rule, the standalone property composes into the array", () => {
    const [withTranslate, withRotate, withScale] = stylesFor(
      `
        .with-translate { transform: scaleX(2); translate: 10px 20px; }
        .with-rotate { transform: scaleX(2); rotate: 45deg; }
        .with-scale { transform: translateX(10px); scale: 2; }
      `,
      "with-translate",
      "with-rotate",
      "with-scale",
    );

    // lightningcss folds the standalone property into the `transform`
    // shorthand, and it used to arrive as a value class `parseTransform` mapped
    // to `[[]]` — so the composed transform gained a BARE EMPTY ARRAY and lost
    // the translate/rotate/scale entirely.
    expect(withTranslate).toStrictEqual({
      transform: [{ scaleX: 2 }, { translateX: 10 }, { translateY: 20 }],
    });
    expect(withRotate).toStrictEqual({
      transform: [{ scaleX: 2 }, { rotateZ: "45deg" }],
    });
    expect(withScale).toStrictEqual({
      transform: [{ translateX: 10 }, { scaleX: 2 }, { scaleY: 2 }],
    });

    // SUSPECTED DEFECT — ORDER, not content. CSS applies `translate`, then
    // `rotate`, then `scale`, and only then the `transform` list, so the
    // standalone property belongs BEFORE the list rather than appended to it.
    // Transform composition does not commute, so for a rule using both the
    // rendered result differs. lightningcss appends when it folds, and nothing
    // downstream re-sorts.
  });

  test("in the SAME rule with the standalone property FIRST, it is dropped silently", () => {
    const [style] = stylesFor(
      `.combined { translate: 10px 20px; transform: scaleX(2); }`,
      "combined",
    );

    // SUSPECTED DEFECT: source order changes the outcome — declared first, the
    // standalone property leaves no trace at all (not even the junk entry).
    //   literal -> [{ scaleX: 2 }]
    //   correct -> [{ translateX: 10 }, { translateY: 20 }, { scaleX: 2 }]
    expect(style).toStrictEqual({ transform: [{ scaleX: 2 }] });
  });

  test("across two classes, both static, the entries compose", () => {
    registerCSS(
      `.first { transform: scaleX(2); } .second { translate: 10px 20px; }`,
    );
    const view = render(<View testID={testID} className="first second" />);

    // Split across rules there is no shorthand folding, so both survive. Note
    // the ORDER: the `transform` list lands first and the standalone property
    // is appended, whereas CSS applies `translate` BEFORE `transform`.
    expect(view.getByTestId(testID).props.style).toStrictEqual({
      transform: [{ scaleX: 2 }, { translateX: 10 }, { translateY: 20 }],
    });
  });

  test("a DEFERRED transform beside a static standalone property composes", () => {
    const [sameRule] = stylesFor(
      `
        :root { --deferred: scaleX(2); }
        @media (prefers-color-scheme: dark) { :root { --deferred: scaleX(3); } }
        .same-rule { transform: var(--deferred); translate: 10px 20px; }
      `,
      "same-rule",
    );

    // Both entries survive, in the same arrangement the all-static case
    // produces: the `transform` list first, the standalone property appended.
    //
    // SUSPECTED DEFECT — ORDER, not content, and the same one the all-static
    // case carries. css-transforms-2 §3 applies `translate`, then `rotate`,
    // then `scale`, and only then the `transform` list, so the correct array is
    // [{ translateX: 10 }, { translateY: 20 }, { scaleX: 2 }]. Transform
    // composition does not commute, so a rule using both renders differently.
    expect(sameRule).toStrictEqual({
      transform: [{ scaleX: 2 }, { translateX: 10 }, { translateY: 20 }],
    });
  });

  test("a DEFERRED transform in ANOTHER class than the standalone property is dropped", () => {
    registerCSS(`
      :root { --deferred: scaleX(2); }
      @media (prefers-color-scheme: dark) { :root { --deferred: scaleX(3); } }

      .first { transform: var(--deferred); }
      .second { translate: 10px 20px; }
    `);
    const view = render(<View testID={testID} className="first second" />);

    // SUSPECTED DEFECT: the deferred `transform` writes the sentinel
    // `{ transform: true }` into `style.transform`; the standalone property is
    // a transform KEY, so `applyValue` sees a non-array there and REPLACES it
    // with a fresh array. The deferred pass then finds its sentinel gone and
    // skips — the whole `transform` declaration vanishes with no warning.
    //
    // Split across two rules there is no shorthand folding to reunite them,
    // which is what makes this the case the same-rule test above does NOT hit:
    //   deferred -> [{ translateX: 10 }, { translateY: 20 }]
    //   correct  -> [{ translateX: 10 }, { translateY: 20 }, { scaleX: 2 }]
    expect(view.getByTestId(testID).props.style).toStrictEqual({
      transform: [{ translateX: 10 }, { translateY: 20 }],
    });
  });

  test("a static transform beside a DEFERRED translate composes", () => {
    const [style] = stylesFor(
      `
        :root { --deferred: 10px 20px; }
        @media (prefers-color-scheme: dark) { :root { --deferred: 1px 2px; } }
        .combined { transform: scaleX(2); translate: var(--deferred); }
      `,
      "combined",
    );

    // The deferred `translate` resolves into its two components and takes the
    // sentinel's place beside the static entry.
    //
    // SUSPECTED DEFECT — ORDER only, as above: css-transforms-2 §3 puts
    // `translate` before the `transform` list, so the correct array is
    // [{ translateX: 10 }, { translateY: 20 }, { scaleX: 2 }].
    expect(style).toStrictEqual({
      transform: [{ scaleX: 2 }, { translateX: 10 }, { translateY: 20 }],
    });
  });

  test("BOTH deferred compose", () => {
    const [style] = stylesFor(
      `
        :root { --transform: scaleX(2); }
        @media (prefers-color-scheme: dark) { :root { --transform: scaleX(3); } }
        :root { --translate: 10px 20px; }
        @media (prefers-color-scheme: dark) { :root { --translate: 1px 2px; } }

        .combined { transform: var(--transform); translate: var(--translate); }
      `,
      "combined",
    );

    // Neither declaration is resolvable at build time, and both still land —
    // the same content the all-static and half-static spellings produce.
    //
    // SUSPECTED DEFECT — ORDER only, as above:
    // [{ translateX: 10 }, { translateY: 20 }, { scaleX: 2 }] is what CSS
    // specifies.
    expect(style).toStrictEqual({
      transform: [{ scaleX: 2 }, { translateX: 10 }, { translateY: 20 }],
    });
  });

  test("deferred rotate and scale beside a static transform DO compose", () => {
    const [withRotate, withScale] = stylesFor(
      `
        :root { --rotate: 45deg; }
        @media (prefers-color-scheme: dark) { :root { --rotate: 90deg; } }
        :root { --scale: 2; }
        @media (prefers-color-scheme: dark) { :root { --scale: 3; } }

        .with-rotate { transform: scaleX(2); rotate: var(--rotate); }
        .with-scale { transform: translateX(10px); scale: var(--scale); }
      `,
      "with-rotate",
      "with-scale",
    );

    // `rotate` and `scale` take a single value, so the runtime resolvers hit
    // their scalar branch and emit the single-component key React Native
    // understands — `rotate` and `scale` rather than the `rotateZ` / `scaleX` +
    // `scaleY` pair the compile-time route names for the same declaration.
    expect(withRotate).toStrictEqual({
      transform: [{ scaleX: 2 }, { rotate: "45deg" }],
    });
    expect(withScale).toStrictEqual({
      transform: [{ translateX: 10 }, { scale: 2 }],
    });
  });
});

describe("filter", () => {
  test("a single filter function is identical on all three routes", () => {
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("filter", "blur(4px)", "blur(8px)"),
      "literal",
      "inlinable",
      "deferred",
    );

    expect(literal).toStrictEqual({ filter: [{ blur: 4 }] });
    expect(inlinable).toStrictEqual({ filter: [{ blur: 4 }] });
    expect(deferred).toStrictEqual({ filter: [{ blur: 4 }] });
  });

  test("statically declared functions keep their declared order", () => {
    const [style] = stylesFor(
      `.literal { filter: blur(4px) brightness(0.5) saturate(2); }`,
      "literal",
    );

    expect(style).toStrictEqual({
      filter: [{ blur: 4 }, { brightness: 0.5 }, { saturate: 2 }],
    });
  });

  test("a deferred function composes into its declared slot", () => {
    const [style] = stylesFor(
      `
        :root { --deferred: brightness(0.5); }
        @media (prefers-color-scheme: dark) { :root { --deferred: none; } }
        .middle { filter: blur(4px) var(--deferred) saturate(2); }
      `,
      "middle",
    );

    expect(style).toStrictEqual({
      filter: [{ blur: 4 }, { brightness: 0.5 }, { saturate: 2 }],
    });
  });

  test("two deferred variables each contribute one flat entry", () => {
    const [style] = stylesFor(
      `
        :root { --first: blur(4px); }
        @media (prefers-color-scheme: dark) { :root { --first: blur(8px); } }
        :root { --second: saturate(2); }
        @media (prefers-color-scheme: dark) { :root { --second: saturate(3); } }

        .pair { filter: var(--first) var(--second); }
      `,
      "pair",
    );

    expect(style).toStrictEqual({ filter: [{ blur: 4 }, { saturate: 2 }] });
  });

  test("ONE deferred variable holding TWO functions flattens, as two variables do", () => {
    const [literal, , deferred] = stylesFor(
      threeRoutes("filter", "blur(4px) brightness(0.5)", "blur(8px)"),
      "literal",
      "inlinable",
      "deferred",
    );

    // React Native's `filter` is a FLAT array of single-key objects: its
    // processor reads `Object.entries(entry)[0]` for every element
    // (`StyleSheet/processFilter.js`), so a nested list names the first filter
    // `"0"`, finds no amount for it, and discards the WHOLE declaration —
    // "if any primitive is invalid then apply none of the filters".
    const flat = [{ blur: 4 }, { brightness: 0.5 }];

    expect(literal).toStrictEqual({ filter: flat });
    expect(deferred).toStrictEqual({ filter: flat });
    expect(processFilter(flat)).toStrictEqual(flat);
    expect(processFilter([flat])).toStrictEqual([]);
  });

  test("hue-rotate emits the same React Native key on all three routes", () => {
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("filter", "hue-rotate(90deg)", "none"),
      "literal",
      "inlinable",
      "deferred",
    );

    // `parseFilter` used to key the entry off lightningcss's value TYPE without
    // running it through `toRNProperty`, so the static route emitted the
    // hyphenated CSS name while the deferred route emitted `hueRotate`. The
    // DEFERRED route was the correct one — the reverse of every other
    // divergence in this file — and React Native discarded the whole filter
    // list when it met the static route's key.
    expect(literal).toStrictEqual({ filter: [{ hueRotate: "90deg" }] });
    expect(inlinable).toStrictEqual({ filter: [{ hueRotate: "90deg" }] });
    expect(deferred).toStrictEqual({ filter: [{ hueRotate: "90deg" }] });
  });

  test("percentage arguments are preserved as strings on both routes", () => {
    const [literal, , deferred] = stylesFor(
      threeRoutes("filter", "brightness(50%) saturate(150%)", "none"),
      "literal",
      "inlinable",
      "deferred",
    );

    // `_getFilterAmount` reads a percentage argument and divides it by 100
    // (`StyleSheet/processFilter.js`), so the string is a value React Native
    // consumes rather than one it has to be handed as a number.
    const percentages = [{ brightness: "50%" }, { saturate: "150%" }];

    expect(literal).toStrictEqual({ filter: percentages });
    expect(deferred).toStrictEqual({ filter: percentages });
    expect(processFilter(percentages)).toStrictEqual([
      { brightness: 0.5 },
      { saturate: 1.5 },
    ]);
  });

  test("blur() with a runtime unit leaks an unresolved style function", () => {
    const [em, viewport] = stylesFor(
      `.em { filter: blur(1em); } .viewport { filter: blur(1vw); }`,
      "em",
      "viewport",
    );

    // SUSPECTED DEFECT: `parseFilter` calls `parseLength`, which emits a
    // deferred `em`/`vw` STYLE FUNCTION, but the filter entry is built as a
    // plain object at compile time and nothing resolves it afterwards — the raw
    // descriptor reaches the style.
    //   literal -> [{ blur: [{}, "em", 1, 1] }]
    //   correct -> [{ blur: 14 }]  (1em at the default 14 rem)
    // `drop-shadow()` with the same units resolves correctly (next test), so the
    // gap is specific to the single-argument filter functions.
    expect(em).toStrictEqual({ filter: [{ blur: [{}, "em", 1, 1] }] });
    expect(viewport).toStrictEqual({ filter: [{ blur: [{}, "vw", 1, 1] }] });
  });

  test("drop-shadow() resolves runtime units correctly", () => {
    const [style] = stylesFor(
      `.literal { filter: drop-shadow(1em 2em 3em #000); }`,
      "literal",
    );

    expect(style).toStrictEqual({
      filter: [
        {
          dropShadow: {
            offsetX: 14,
            offsetY: 28,
            standardDeviation: 42,
            color: "#000",
          },
        },
      ],
    });
  });

  test("drop-shadow() through a runtime variable matches the static route", () => {
    const [literal, , deferred] = stylesFor(
      threeRoutes("filter", "drop-shadow(0 4px 6px #000)", "none"),
      "literal",
      "inlinable",
      "deferred",
    );

    const expected = {
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
    };

    expect(literal).toStrictEqual(expected);
    expect(deferred).toStrictEqual(expected);
  });

  test("filter: none clears on every route, spelled two ways", () => {
    const [literal, , deferred] = stylesFor(
      threeRoutes("filter", "none", "blur(1px)"),
      "literal",
      "inlinable",
      "deferred",
    );

    // Both mean "no filter functions": the static route clears the key, the
    // runtime route writes the empty list React Native's processor produces for
    // the same declaration. Leaking the keyword instead put `["none"]` into the
    // array branch, where `Object.entries("none")[0]` reads the first CHARACTER
    // as a filter name.
    expect(literal).toStrictEqual({ filter: undefined });
    expect(deferred).toStrictEqual({ filter: [] });
    expect(processFilter(undefined)).toStrictEqual([]);
    expect(processFilter([])).toStrictEqual([]);
  });

  test("a second declaration replaces, and !important wins", () => {
    const [replaced] = stylesFor(
      `.replaced { filter: blur(4px); filter: saturate(2); }`,
      "replaced",
    );
    expect(replaced).toStrictEqual({ filter: [{ saturate: 2 }] });

    registerCSS(
      `.first { filter: blur(4px) !important; } .second { filter: saturate(2); }`,
    );
    const view = render(<View testID={testID} className="first second" />);
    expect(view.getByTestId(testID).props.style).toStrictEqual({
      filter: [{ blur: 4 }],
    });
  });
});

describe("box-shadow", () => {
  test("a single shadow agrees on all three routes", () => {
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("box-shadow", "0 4px 6px -1px #000", "0 1px 1px 0 #fff"),
      "literal",
      "inlinable",
      "deferred",
    );

    const expected = {
      boxShadow: [
        {
          offsetX: 0,
          offsetY: 4,
          blurRadius: 6,
          spreadDistance: -1,
          color: "#000",
        },
      ],
    };

    expect(literal).toStrictEqual(expected);
    expect(inlinable).toStrictEqual(expected);
    expect(deferred).toStrictEqual(expected);
  });

  test("runtime units resolve on both routes", () => {
    const [em, viewport, deferredEm] = stylesFor(
      `
        .em { box-shadow: 1em 2em 3em #000; }
        .viewport { box-shadow: 1vw 2vw 3vw #000; }

        :root { --deferred: 1em 2em 3em #000; }
        @media (prefers-color-scheme: dark) { :root { --deferred: none; } }
        .deferred-em { box-shadow: var(--deferred); }
      `,
      "em",
      "viewport",
      "deferred-em",
    );

    expect(em).toStrictEqual({
      boxShadow: [
        {
          offsetX: 14,
          offsetY: 28,
          blurRadius: 42,
          spreadDistance: 0,
          color: "#000",
        },
      ],
    });
    expect(viewport).toStrictEqual({
      boxShadow: [
        {
          offsetX: 7.5,
          offsetY: 15,
          blurRadius: 22.5,
          spreadDistance: 0,
          color: "#000",
        },
      ],
    });

    // SUSPECTED DEFECT: the offsets agree, but the runtime route omits
    // `spreadDistance` entirely where the static route normalises it to 0.
    //   literal  -> { …, spreadDistance: 0, color: "#000" }
    //   deferred -> { …, color: "#000" }
    // The static route matches CSS, which defaults the omitted spread to 0.
    expect(deferredEm).toStrictEqual({
      boxShadow: [{ offsetX: 14, offsetY: 28, blurRadius: 42, color: "#000" }],
    });
  });

  test("two shadows keep their order, and the runtime route omits the default spread", () => {
    const [literal, deferred] = stylesFor(
      `
        .literal { box-shadow: 0 1px 2px #000, 0 3px 4px #fff; }

        :root { --deferred: 0 1px 2px #000, 0 3px 4px #fff; }
        @media (prefers-color-scheme: dark) { :root { --deferred: none; } }
        .deferred { box-shadow: var(--deferred); }
      `,
      "literal",
      "deferred",
    );

    expect(literal).toStrictEqual({
      boxShadow: [
        {
          offsetX: 0,
          offsetY: 1,
          blurRadius: 2,
          spreadDistance: 0,
          color: "#000",
        },
        {
          offsetX: 0,
          offsetY: 3,
          blurRadius: 4,
          spreadDistance: 0,
          color: "#fff",
        },
      ],
    });

    // SUSPECTED DEFECT: same missing `spreadDistance` as above; the ORDER of
    // the two shadows is preserved on both routes.
    expect(deferred).toStrictEqual({
      boxShadow: [
        { offsetX: 0, offsetY: 1, blurRadius: 2, color: "#000" },
        { offsetX: 0, offsetY: 3, blurRadius: 4, color: "#fff" },
      ],
    });
  });

  test("!important wins over a later declaration", () => {
    registerCSS(`
      .first { box-shadow: 0 1px 2px #000 !important; }
      .second { box-shadow: 0 3px 4px #fff; }
    `);
    const view = render(<View testID={testID} className="first second" />);

    expect(view.getByTestId(testID).props.style).toStrictEqual({
      boxShadow: [
        {
          offsetX: 0,
          offsetY: 1,
          blurRadius: 2,
          spreadDistance: 0,
          color: "#000",
        },
      ],
    });
  });
});

describe("opacity and the remaining effect properties", () => {
  test("opacity is identical on all three routes", () => {
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("opacity", "0.5", "0.25"),
      "literal",
      "inlinable",
      "deferred",
    );

    expect(literal).toStrictEqual({ opacity: 0.5 });
    expect(inlinable).toStrictEqual({ opacity: 0.5 });
    expect(deferred).toStrictEqual({ opacity: 0.5 });
  });

  test("opacity accepts a percentage and calc(), including one with a runtime unit", () => {
    const [percentage, ratio, withEm] = stylesFor(
      `
        .percentage { opacity: 50%; }
        .ratio { opacity: calc(1 / 2); }
        .with-em { opacity: calc(1em / 28px); }
      `,
      "percentage",
      "ratio",
      "with-em",
    );

    expect(percentage).toStrictEqual({ opacity: 0.5 });
    expect(ratio).toStrictEqual({ opacity: 0.5 });
    expect(withEm).toStrictEqual({ opacity: 0.5 });
  });

  test("opacity honours a fallback-only var() reference", () => {
    const [style] = stylesFor(
      `.fallback { opacity: var(--never-declared, 0.5); }`,
      "fallback",
    );

    expect(style).toStrictEqual({ opacity: 0.5 });
  });

  test("backface-visibility is identical on all three routes", () => {
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("backface-visibility", "hidden", "visible"),
      "literal",
      "inlinable",
      "deferred",
    );

    expect(literal).toStrictEqual({ backfaceVisibility: "hidden" });
    expect(inlinable).toStrictEqual({ backfaceVisibility: "hidden" });
    expect(deferred).toStrictEqual({ backfaceVisibility: "hidden" });
  });

  test("mix-blend-mode agrees on all three routes", () => {
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("mix-blend-mode", "multiply", "screen"),
      "literal",
      "inlinable",
      "deferred",
    );

    // A keyword property cannot be validated where its value is not yet known,
    // so the deferred route hands the value to the runtime resolver of the same
    // name (`native/styles/functions/keyword-functions.ts`), which decides it
    // from the same keyword table. Validating only at compile time dropped the
    // declaration instead — silently, and only for the spelling a theme uses.
    expect(literal).toStrictEqual({ mixBlendMode: "multiply" });
    expect(inlinable).toStrictEqual({ mixBlendMode: "multiply" });
    expect(deferred).toStrictEqual({ mixBlendMode: "multiply" });
  });

  test("isolation agrees on all three routes", () => {
    const [literal, inlinable, deferred] = stylesFor(
      threeRoutes("isolation", "isolate", "auto"),
      "literal",
      "inlinable",
      "deferred",
    );

    // The same mechanism as mix-blend-mode above. `auto` is the deferred
    // route's other value here, and it is the one that made this worth closing:
    // it is React Native's own `isolation: 'auto'`, and the only way a
    // dark-scheme rule can switch isolation back off.
    expect(literal).toStrictEqual({ isolation: "isolate" });
    expect(inlinable).toStrictEqual({ isolation: "isolate" });
    expect(deferred).toStrictEqual({ isolation: "isolate" });
  });

  test.each([
    ["will-change", "transform", "opacity"],
    ["perspective", "100px", "200px"],
    ["perspective-origin", "10px 20px", "center"],
    ["backdrop-filter", "blur(4px)", "blur(8px)"],
  ])(
    "%s is unsupported and produces no style on any route",
    (property, value, alternate) => {
      const [literal, inlinable, deferred] = stylesFor(
        threeRoutes(property, value, alternate),
        "literal",
        "inlinable",
        "deferred",
      );

      // These four have no React Native equivalent. The routes AGREE — every
      // one drops the declaration — which is the desired state for an
      // unsupported property.
      expect(literal).toBeUndefined();
      expect(inlinable).toBeUndefined();
      expect(deferred).toBeUndefined();
    },
  );
});

describe("fallback-only var() references defer without changing the result", () => {
  test("transform uses its fallback", () => {
    const [fallback, literal] = stylesFor(
      `
        .fallback { transform: var(--never-declared, scaleX(2)); }
        .literal { transform: scaleX(2); }
      `,
      "fallback",
      "literal",
    );

    // CSS Variables Level 1 §3: a `var()` with no declaration and a valid
    // fallback resolves to the fallback, so the two routes land on the same
    // single-function list. An empty `transform` is the shape React Native reads
    // as "no transform", which is why the difference is invisible in the value
    // and total on screen.
    expect(literal).toStrictEqual({ transform: [{ scaleX: 2 }] });
    expect(fallback).toStrictEqual(literal);
  });

  test("transform-origin and box-shadow use their fallbacks", () => {
    const [origin, shadow] = stylesFor(
      `
        .origin { transform-origin: var(--never-declared, 10px 20px); }
        .shadow { box-shadow: var(--never-declared, 0 4px 6px #000); }
      `,
      "origin",
      "shadow",
    );

    expect(origin).toStrictEqual({ transformOrigin: [10, 20, 0] });
    expect(shadow).toStrictEqual({
      boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 6, color: "#000" }],
    });
  });
});
