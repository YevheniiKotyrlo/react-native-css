import { processColor } from "react-native";

import { act, render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";
import { colorScheme } from "react-native-css/runtime";

/**
 * A CSS declaration reaches React Native by one of two routes:
 *
 *   COMPILE TIME - the value is a literal, or it is `var(--x)` where `--x` has
 *                  exactly ONE definition and is therefore inlined. lightningcss
 *                  has already parsed the value into a typed AST, so the
 *                  compiler expands shorthands and normalises colours.
 *
 *   RUNTIME      - the value cannot be resolved at build time: the custom
 *                  property has a second definition (here, one under
 *                  `@media (prefers-color-scheme: dark)`), or the reference is a
 *                  fallback-only `var(--never-declared, x)`. lightningcss hands
 *                  the compiler an UNPARSED token stream, and the value is
 *                  resolved by `resolveValue` during render.
 *
 * The two routes must produce the same React Native style. This file locks in
 * the cases where they do, and pins the cases where they do not.
 */

let uniqueId = 0;

function styleOf(css: string, className: string): unknown {
  const id = `path-equivalence-${uniqueId++}`;
  registerCSS(css);
  const { getByTestId } = render(<View testID={id} className={className} />);
  return getByTestId(id).props.style;
}

interface RouteStyles {
  /** `color: red` - resolved by the compiler */
  readonly literal: unknown;
  /** `color: var(--x)` with a single `--x` definition - inlined by the compiler */
  readonly inlinable: unknown;
  /** `color: var(--x)` with two `--x` definitions - resolved during render */
  readonly nonInlinable: unknown;
  /** `color: var(--never-declared, red)` - also resolved during render */
  readonly fallback: unknown;
}

/**
 * Compile the same declaration four times, once per route. `key` namespaces the
 * class names and custom properties so a single `test()` never re-registers a
 * name.
 */
function routeStyles(
  key: string,
  declaration: (value: string) => string,
  value: string,
  alternate: string,
): RouteStyles {
  return {
    literal: styleOf(`.${key}-lit { ${declaration(value)} }`, `${key}-lit`),
    inlinable: styleOf(
      `:root { --${key}-i: ${value}; }
       .${key}-inl { ${declaration(`var(--${key}-i)`)} }`,
      `${key}-inl`,
    ),
    nonInlinable: styleOf(
      `:root { --${key}-n: ${value}; }
       @media (prefers-color-scheme: dark) { :root { --${key}-n: ${alternate}; } }
       .${key}-non { ${declaration(`var(--${key}-n)`)} }`,
      `${key}-non`,
    ),
    fallback: styleOf(
      `.${key}-fb { ${declaration(`var(--${key}-undeclared, ${value})`)} }`,
      `${key}-fb`,
    ),
  };
}

function expectRoutesAgree(routes: RouteStyles, expected: unknown) {
  expect(routes.literal).toStrictEqual(expected);
  expect(routes.inlinable).toStrictEqual(expected);
  expect(routes.nonInlinable).toStrictEqual(expected);
  expect(routes.fallback).toStrictEqual(expected);
}

/**
 * Every route produced the same longhands, differing only in how `#f00` is
 * spelled: hex from the two compile-time routes, the `red` keyword from the two
 * deferred ones. That one divergence is pinned on its own in "colour keyword
 * serialisation" above, so a `border-*` shorthand test states the keys it
 * expands to and names the colour keys rather than repeating the split. An AXIS
 * shorthand names two, because React Native has no axis-level colour key for
 * the inline edges to collapse onto.
 */
function expectSidesAgree(
  routes: RouteStyles,
  expected: Record<string, unknown>,
  colorKeys: readonly string[],
) {
  const withColor = (color: string) => ({
    ...expected,
    ...Object.fromEntries(colorKeys.map((key) => [key, color])),
  });

  expect(routes.literal).toStrictEqual(withColor("#f00"));
  expect(routes.inlinable).toStrictEqual(withColor("#f00"));
  expect(routes.nonInlinable).toStrictEqual(withColor("red"));
  expect(routes.fallback).toStrictEqual(withColor("red"));
}

/**
 * The compile-time path re-serialises a colour through `colorjs.io` (`#f00`),
 * while the runtime path forwards lightningcss's minified token text (`red`).
 * Both are accepted by React Native's colour parser, but they are not the same
 * string - so every colour used in an EQUIVALENCE test carries an alpha
 * channel, which forces both routes onto the same 8-digit hex.
 */
const RED_50 = "rgba(255, 0, 0, 0.5)";
const RED_50_HEX = "#ff000080";
const BLUE_50 = "rgba(0, 0, 255, 0.5)";
const BLACK_50 = "rgba(0, 0, 0, 0.5)";
const BLACK_50_HEX = "#00000080";

describe("colour longhands - routes agree", () => {
  test("color", () => {
    expectRoutesAgree(
      routeStyles("color", (value) => `color: ${value}`, RED_50, BLUE_50),
      { color: RED_50_HEX },
    );
  });

  test("background-color", () => {
    expectRoutesAgree(
      routeStyles(
        "background-color",
        (value) => `background-color: ${value}`,
        RED_50,
        BLUE_50,
      ),
      { backgroundColor: RED_50_HEX },
    );
  });

  test("border-color", () => {
    expectRoutesAgree(
      routeStyles(
        "border-color",
        (value) => `border-color: ${value}`,
        RED_50,
        BLUE_50,
      ),
      { borderColor: RED_50_HEX },
    );
  });

  test("border-color physical sides", () => {
    expectRoutesAgree(
      routeStyles(
        "border-top-color",
        (value) => `border-top-color: ${value}`,
        RED_50,
        BLUE_50,
      ),
      { borderTopColor: RED_50_HEX },
    );
    expectRoutesAgree(
      routeStyles(
        "border-right-color",
        (value) => `border-right-color: ${value}`,
        RED_50,
        BLUE_50,
      ),
      { borderRightColor: RED_50_HEX },
    );
    expectRoutesAgree(
      routeStyles(
        "border-bottom-color",
        (value) => `border-bottom-color: ${value}`,
        RED_50,
        BLUE_50,
      ),
      { borderBottomColor: RED_50_HEX },
    );
    expectRoutesAgree(
      routeStyles(
        "border-left-color",
        (value) => `border-left-color: ${value}`,
        RED_50,
        BLUE_50,
      ),
      { borderLeftColor: RED_50_HEX },
    );
  });

  test("border-color logical sides", () => {
    expectRoutesAgree(
      routeStyles(
        "border-inline-start-color",
        (value) => `border-inline-start-color: ${value}`,
        RED_50,
        BLUE_50,
      ),
      { borderStartColor: RED_50_HEX },
    );
    expectRoutesAgree(
      routeStyles(
        "border-inline-end-color",
        (value) => `border-inline-end-color: ${value}`,
        RED_50,
        BLUE_50,
      ),
      { borderEndColor: RED_50_HEX },
    );
    expectRoutesAgree(
      routeStyles(
        "border-block-start-color",
        (value) => `border-block-start-color: ${value}`,
        RED_50,
        BLUE_50,
      ),
      { borderBlockStartColor: RED_50_HEX },
    );
    expectRoutesAgree(
      routeStyles(
        "border-block-end-color",
        (value) => `border-block-end-color: ${value}`,
        RED_50,
        BLUE_50,
      ),
      { borderBlockEndColor: RED_50_HEX },
    );
  });

  test("outline-color", () => {
    expectRoutesAgree(
      routeStyles(
        "outline-color",
        (value) => `outline-color: ${value}`,
        RED_50,
        BLUE_50,
      ),
      { outlineColor: RED_50_HEX },
    );
  });
});

describe("width / radius / style / opacity longhands - routes agree", () => {
  test("border-width", () => {
    expectRoutesAgree(
      routeStyles(
        "border-width",
        (value) => `border-width: ${value}`,
        "2px",
        "4px",
      ),
      { borderWidth: 2 },
    );
  });

  test("border-width physical sides", () => {
    expectRoutesAgree(
      routeStyles(
        "border-top-width",
        (value) => `border-top-width: ${value}`,
        "2px",
        "4px",
      ),
      { borderTopWidth: 2 },
    );
    expectRoutesAgree(
      routeStyles(
        "border-bottom-width",
        (value) => `border-bottom-width: ${value}`,
        "2px",
        "4px",
      ),
      { borderBottomWidth: 2 },
    );
  });

  test("border-width logical sides", () => {
    expectRoutesAgree(
      routeStyles(
        "border-inline-start-width",
        (value) => `border-inline-start-width: ${value}`,
        "2px",
        "4px",
      ),
      { borderStartWidth: 2 },
    );
    expectRoutesAgree(
      routeStyles(
        "border-block-start-width",
        (value) => `border-block-start-width: ${value}`,
        "2px",
        "4px",
      ),
      // The block axis carries its width on the physical edge. `direction`
      // never flips it, so block-start is the top edge on every platform,
      // while `borderBlockStartWidth` is a key only iOS Fabric reads.
      { borderTopWidth: 2 },
    );
  });

  test("border-style", () => {
    expectRoutesAgree(
      routeStyles(
        "border-style",
        (value) => `border-style: ${value}`,
        "dashed",
        "dotted",
      ),
      { borderStyle: "dashed" },
    );
  });

  test("border-radius", () => {
    expectRoutesAgree(
      routeStyles(
        "border-radius",
        (value) => `border-radius: ${value}`,
        "8px",
        "16px",
      ),
      { borderRadius: 8 },
    );
  });

  test("border-radius physical corners", () => {
    expectRoutesAgree(
      routeStyles(
        "border-top-left-radius",
        (value) => `border-top-left-radius: ${value}`,
        "8px",
        "16px",
      ),
      { borderTopLeftRadius: 8 },
    );
    expectRoutesAgree(
      routeStyles(
        "border-bottom-right-radius",
        (value) => `border-bottom-right-radius: ${value}`,
        "8px",
        "16px",
      ),
      { borderBottomRightRadius: 8 },
    );
  });

  test("border-radius logical corners", () => {
    expectRoutesAgree(
      routeStyles(
        "border-start-start-radius",
        (value) => `border-start-start-radius: ${value}`,
        "8px",
        "16px",
      ),
      { borderStartStartRadius: 8 },
    );
    expectRoutesAgree(
      routeStyles(
        "border-end-end-radius",
        (value) => `border-end-end-radius: ${value}`,
        "8px",
        "16px",
      ),
      { borderEndEndRadius: 8 },
    );
  });

  test("outline-width", () => {
    expectRoutesAgree(
      routeStyles(
        "outline-width",
        (value) => `outline-width: ${value}`,
        "2px",
        "4px",
      ),
      { outlineWidth: 2 },
    );
  });

  test("outline-style", () => {
    expectRoutesAgree(
      routeStyles(
        "outline-style",
        (value) => `outline-style: ${value}`,
        "dashed",
        "dotted",
      ),
      { outlineStyle: "dashed" },
    );
  });

  test("outline-offset", () => {
    expectRoutesAgree(
      routeStyles(
        "outline-offset",
        (value) => `outline-offset: ${value}`,
        "2px",
        "4px",
      ),
      { outlineOffset: 2 },
    );
  });

  test("opacity", () => {
    expectRoutesAgree(
      routeStyles("opacity", (value) => `opacity: ${value}`, "0.5", "0.25"),
      { opacity: 0.5 },
    );
  });

  test("opacity 1", () => {
    expectRoutesAgree(
      routeStyles("opacity-one", (value) => `opacity: ${value}`, "1", "0"),
      { opacity: 1 },
    );
  });
});

describe("shorthands - routes agree", () => {
  test("`border` expands on both routes", () => {
    expectRoutesAgree(
      routeStyles(
        "border-shorthand",
        (value) => `border: ${value} solid ${RED_50}`,
        "2px",
        "4px",
      ),
      { borderWidth: 2, borderStyle: "solid", borderColor: RED_50_HEX },
    );
  });

  test("`border` expands when the whole value defers", () => {
    expectRoutesAgree(
      routeStyles(
        "border-whole",
        (value) => `border: ${value}`,
        `2px solid ${RED_50}`,
        `4px solid ${BLUE_50}`,
      ),
      { borderWidth: 2, borderStyle: "solid", borderColor: RED_50_HEX },
    );
  });

  test("`box-shadow` with a non-zero spread", () => {
    expectRoutesAgree(
      routeStyles(
        "box-shadow",
        (value) => `box-shadow: ${value}`,
        `0 4px 6px -1px ${BLACK_50}`,
        `0 8px 6px -1px ${RED_50}`,
      ),
      {
        boxShadow: [
          {
            offsetX: 0,
            offsetY: 4,
            blurRadius: 6,
            spreadDistance: -1,
            color: BLACK_50_HEX,
          },
        ],
      },
    );
  });

  test("`box-shadow` colour alone deferring", () => {
    expectRoutesAgree(
      routeStyles(
        "box-shadow-color",
        (value) => `box-shadow: 0 4px 6px -1px ${value}`,
        BLACK_50,
        RED_50,
      ),
      {
        boxShadow: [
          {
            offsetX: 0,
            offsetY: 4,
            blurRadius: 6,
            spreadDistance: -1,
            color: BLACK_50_HEX,
          },
        ],
      },
    );
  });

  test("`text-shadow` expands on both routes", () => {
    expectRoutesAgree(
      routeStyles(
        "text-shadow",
        (value) => `text-shadow: ${value}`,
        `1px 2px 3px ${RED_50}`,
        `2px 4px 6px ${BLUE_50}`,
      ),
      {
        textShadowOffset: { width: 1, height: 2 },
        textShadowRadius: 3,
        textShadowColor: RED_50_HEX,
      },
    );
  });

  test("`text-shadow` colour alone deferring", () => {
    expectRoutesAgree(
      routeStyles(
        "text-shadow-color",
        (value) => `text-shadow: 1px 2px 3px ${value}`,
        RED_50,
        BLUE_50,
      ),
      {
        textShadowOffset: { width: 1, height: 2 },
        textShadowRadius: 3,
        textShadowColor: RED_50_HEX,
      },
    );
  });
});

describe("currentcolor - routes agree", () => {
  test("border-color: currentcolor tracks a literal color", () => {
    expect(
      styleOf(
        `.cc-literal { color: ${RED_50}; border-color: currentcolor; }`,
        "cc-literal",
      ),
    ).toStrictEqual({ color: RED_50_HEX, borderColor: RED_50_HEX });
  });

  test("border-color: currentcolor tracks a runtime-resolved color", () => {
    expect(
      styleOf(
        `:root { --cc-runtime: ${RED_50}; }
         @media (prefers-color-scheme: dark) { :root { --cc-runtime: ${BLUE_50}; } }
         .cc-runtime { color: var(--cc-runtime); border-color: currentcolor; }`,
        "cc-runtime",
      ),
    ).toStrictEqual({ color: RED_50_HEX, borderColor: RED_50_HEX });
  });

  test("outline-color / background-color / logical border side", () => {
    expect(
      styleOf(
        `.cc-outline { color: ${RED_50}; outline-color: currentcolor; }`,
        "cc-outline",
      ),
    ).toStrictEqual({ color: RED_50_HEX, outlineColor: RED_50_HEX });

    expect(
      styleOf(
        `.cc-background { color: ${RED_50}; background-color: currentcolor; }`,
        "cc-background",
      ),
    ).toStrictEqual({ color: RED_50_HEX, backgroundColor: RED_50_HEX });

    expect(
      styleOf(
        `.cc-logical { color: ${RED_50}; border-inline-start-color: currentcolor; }`,
        "cc-logical",
      ),
    ).toStrictEqual({
      color: RED_50_HEX,
      borderStartColor: RED_50_HEX,
    });
  });

  test("currentcolor with no `color` declared falls back to the platform label colour", () => {
    const semantic = { semantic: ["label", "labelColor"] };

    expect(
      styleOf(
        `.cc-bare-border { border-color: currentcolor; }`,
        "cc-bare-border",
      ),
    ).toStrictEqual({ borderColor: semantic });

    expect(
      styleOf(`.cc-bare-color { color: currentcolor; }`, "cc-bare-color"),
    ).toStrictEqual({ color: semantic });
  });

  test("box-shadow colour resolves currentcolor when `color` is a literal", () => {
    expect(
      styleOf(
        `.cc-box-shadow { color: ${RED_50}; box-shadow: 0 1px 2px currentcolor; }`,
        "cc-box-shadow",
      ),
    ).toStrictEqual({
      color: RED_50_HEX,
      boxShadow: [
        {
          offsetX: 0,
          offsetY: 1,
          blurRadius: 2,
          spreadDistance: 0,
          color: RED_50_HEX,
        },
      ],
    });
  });
});

describe("inherited-property publish - routes agree", () => {
  /** This branch republishes inherited properties down through VariableContext. */
  function childStyleOf(css: string, className: string): unknown {
    const id = `publish-${uniqueId++}`;
    registerCSS(css);
    const { getByTestId } = render(
      <View className={className}>
        <Text testID={id}>text</Text>
      </View>,
    );
    return getByTestId(id).props.style;
  }

  test("`color` publishes the same value on every route", () => {
    expect(
      childStyleOf(`.pub-lit { color: ${RED_50}; }`, "pub-lit"),
    ).toStrictEqual({ color: RED_50_HEX });

    expect(
      childStyleOf(
        `:root { --pub-i: ${RED_50}; } .pub-inl { color: var(--pub-i); }`,
        "pub-inl",
      ),
    ).toStrictEqual({ color: RED_50_HEX });

    expect(
      childStyleOf(
        `:root { --pub-n: ${RED_50}; }
         @media (prefers-color-scheme: dark) { :root { --pub-n: ${BLUE_50}; } }
         .pub-non { color: var(--pub-n); }`,
        "pub-non",
      ),
    ).toStrictEqual({ color: RED_50_HEX });

    expect(
      childStyleOf(
        `.pub-fb { color: var(--pub-undeclared, ${RED_50}); }`,
        "pub-fb",
      ),
    ).toStrictEqual({ color: RED_50_HEX });
  });
});

describe("colour keyword serialisation - routes DIVERGE textually", () => {
  test("a keyword-or-hex colour is re-serialised at compile time but forwarded verbatim at runtime", () => {
    const routes = routeStyles(
      "keyword",
      (value) => `color: ${value}`,
      "#f00",
      "#00f",
    );

    // Not a defect: React Native's colour parser accepts both spellings, and
    // `#f00` and `red` are the same colour. It IS a divergence to be aware of -
    // a `toStrictEqual` in any other test comparing the two routes will fail on
    // any colour whose shortest CSS serialisation is a keyword.
    //   compile time -> colorjs.io re-serialises to the hex form
    //   runtime      -> lightningcss's minified token text is forwarded as-is
    expect(routes.literal).toStrictEqual({ color: "#f00" });
    expect(routes.inlinable).toStrictEqual({ color: "#f00" });
    expect(routes.nonInlinable).toStrictEqual({ color: "red" });
    expect(routes.fallback).toStrictEqual({ color: "red" });
  });

  test("`transparent` is likewise re-serialised only at compile time", () => {
    const routes = routeStyles(
      "transparent",
      (value) => `background-color: ${value}`,
      "transparent",
      "#000",
    );

    expect(routes.literal).toStrictEqual({ backgroundColor: "#0000" });
    expect(routes.inlinable).toStrictEqual({ backgroundColor: "#0000" });
    expect(routes.nonInlinable).toStrictEqual({
      backgroundColor: "transparent",
    });
    expect(routes.fallback).toStrictEqual({ backgroundColor: "transparent" });
  });
});

describe("multi-value shorthands", () => {
  test("border-radius: four corners", () => {
    const routes = routeStyles(
      "radius-four",
      (value) => `border-radius: ${value}`,
      "1px 2px 3px 4px",
      "5px 6px 7px 8px",
    );

    // Every route expands to the four corner longhands, read clockwise from the
    // top-left. React Native's `borderRadius` is an `AnimatableNumericValue |
    // string` (`StyleSheetTypes.d.ts`), so a positional list under that key
    // would lose all four corners.
    expectRoutesAgree(routes, {
      borderTopLeftRadius: 1,
      borderTopRightRadius: 2,
      borderBottomRightRadius: 3,
      borderBottomLeftRadius: 4,
    });
  });

  test("border-radius: two and three values", () => {
    const two = routeStyles(
      "radius-two",
      (value) => `border-radius: ${value}`,
      "1px 2px",
      "3px 4px",
    );
    const three = routeStyles(
      "radius-three",
      (value) => `border-radius: ${value}`,
      "1px 2px 3px",
      "4px 5px 6px",
    );

    // The shorter forms fill the missing corners by the css-backgrounds-3 §5.1
    // rule the four-value case makes trivial: two values are the TL/BR pair then
    // the TR/BL pair, three name TL, the TR/BL pair, then BR. Both routes read
    // them the same way.
    expectRoutesAgree(two, {
      borderTopLeftRadius: 1,
      borderTopRightRadius: 2,
      borderBottomRightRadius: 1,
      borderBottomLeftRadius: 2,
    });

    expectRoutesAgree(three, {
      borderTopLeftRadius: 1,
      borderTopRightRadius: 2,
      borderBottomRightRadius: 3,
      borderBottomLeftRadius: 2,
    });
  });

  test("border-radius: elliptical (slash) syntax", () => {
    const routes = routeStyles(
      "radius-slash",
      (value) => `border-radius: ${value}`,
      "10px / 20px",
      "30px / 40px",
    );

    // React Native has no elliptical corner radius — `borderRadius` is one
    // `AnimatableNumericValue | string` per corner (`StyleSheetTypes.d.ts`) — so
    // the horizontal radius is kept and the vertical one narrowed away.
    expect(routes.literal).toStrictEqual({ borderRadius: 10 });
    expect(routes.inlinable).toStrictEqual({ borderRadius: 10 });
    expect(routes.nonInlinable).toStrictEqual({ borderRadius: 10 });

    // The fallback route narrows identically. Its tokens are parsed under
    // `border-radius` and then stored inside the style function, so they keep
    // their units — `["10px", "/", "20px"]`, byte-identical to what the custom
    // property route stores — rather than folding to the joined string `"10 / 20"`
    // that React Native's radius parser cannot read.
    expect(routes.fallback).toStrictEqual({ borderRadius: 10 });

    // The narrowing is reported, because the corner that renders is not the one
    // the author described. ONCE: all four corners carry the same pair, so this
    // is one narrowing of one declaration rather than four separate facts.
    expect(
      registerCSS(`.radius-warn { border-radius: 10px / 20px; }`).warnings(),
    ).toStrictEqual({
      values: { "border-radius": ["10 / 20"] },
    });
  });

  test("border-width: four sides", () => {
    const routes = routeStyles(
      "width-four",
      (value) => `border-width: ${value}`,
      "1px 2px 3px 4px",
      "5px 6px 7px 8px",
    );

    // Every route expands to the four side longhands, clockwise from the top.
    // React Native's `borderWidth` is a single `number`
    // (`StyleSheetTypes.d.ts`), so a positional list under that key would lose
    // all four widths.
    expectRoutesAgree(routes, {
      borderTopWidth: 1,
      borderRightWidth: 2,
      borderBottomWidth: 3,
      borderLeftWidth: 4,
    });
  });

  test("border-color: four sides", () => {
    const routes = routeStyles(
      "color-four",
      (value) => `border-color: ${value}`,
      "#f00 #0f0 #00f #ff0",
      "#000 #111 #222 #333",
    );

    // Every route expands to the four side longhands. `#f00` is the one value
    // whose shortest CSS serialisation is a keyword, so it is the one that shows
    // the textual divergence the "colour keyword serialisation" tests above pin:
    // the compile-time routes re-serialise it to hex, the deferred routes
    // forward lightningcss's `red`. React Native's colour parser reads both.
    expect(routes.literal).toStrictEqual({
      borderTopColor: "#f00",
      borderRightColor: "#0f0",
      borderBottomColor: "#00f",
      borderLeftColor: "#ff0",
    });
    expect(routes.inlinable).toStrictEqual(routes.literal);
    expect(routes.nonInlinable).toStrictEqual({
      borderTopColor: "red",
      borderRightColor: "#0f0",
      borderBottomColor: "#00f",
      borderLeftColor: "#ff0",
    });
    expect(routes.fallback).toStrictEqual(routes.nonInlinable);
    expect(processColor("red")).toStrictEqual(processColor("#f00"));
  });

  test("border-style: four sides", () => {
    const routes = routeStyles(
      "style-four",
      (value) => `border-style: ${value}`,
      "solid dashed dotted solid",
      "dotted solid dashed dotted",
    );

    // React Native has ONE `borderStyle` for all four sides, and its type is the
    // three-keyword union `'solid' | 'dotted' | 'dashed'`
    // (`StyleSheetTypes.d.ts`) — so four DIFFERING sides have nothing here to be
    // written to. The compile-time routes emit the four per-edge keys under the
    // names React Native would give them: inert today, working the day it grows
    // them, and never the silent wrongness that collapsing onto one edge's style
    // would be on the other three.
    //
    // All four routes reach those keys. The runtime ones are where they are
    // most easily lost: the expander maps CSS positions onto React Native keys,
    // and mapping all four onto the single `borderStyle` leaves four values
    // disagreeing over one key, which drops the declaration whole.
    const perEdge = {
      borderTopStyle: "solid",
      borderRightStyle: "dashed",
      borderBottomStyle: "dotted",
      borderLeftStyle: "solid",
    };

    expect(routes.literal).toStrictEqual(perEdge);
    expect(routes.inlinable).toStrictEqual(perEdge);
    expect(routes.nonInlinable).toStrictEqual(perEdge);
    expect(routes.fallback).toStrictEqual(perEdge);
  });

  test("border-radius: a single deferred corner takes the whole shorthand to the runtime route", () => {
    // ONE deferred value out of four is enough to send the entire shorthand
    // down the runtime route, so this is the case that proves the runtime
    // expander reads a MIXED list — three literals and a resolved var — by the
    // same positional rules.
    expect(
      styleOf(
        `:root { --radius-one: 2px; }
         @media (prefers-color-scheme: dark) { :root { --radius-one: 9px; } }
         .radius-one { border-radius: 1px var(--radius-one) 3px 4px; }`,
        "radius-one",
      ),
    ).toStrictEqual({
      borderTopLeftRadius: 1,
      borderTopRightRadius: 2,
      borderBottomRightRadius: 3,
      borderBottomLeftRadius: 4,
    });
  });
});

describe("per-side and logical `border-*` shorthands", () => {
  // Every `border-<side>` shorthand expands on both routes into the longhands
  // React Native declares. The shorthand names themselves — `borderTop`,
  // `borderBlock`, `borderInlineStart`, … — are not React Native style keys, so
  // the expansion is the only shape that carries the width, style and colour.
  //
  // The one value that differs between the routes is the colour, and only its
  // TEXT: `#f00` from the compile-time routes, `red` from the deferred ones.
  // That divergence is pinned on its own above.

  test("border-top", () => {
    const routes = routeStyles(
      "border-top",
      (value) => `border-top: ${value} solid #f00`,
      "2px",
      "4px",
    );

    // The style component is dropped on every route: React Native has one
    // `borderStyle` for the whole box and no per-side spelling of it, so `solid`
    // has nowhere to land. `borderTopWidth` and `borderTopColor` are both real
    // React Native style keys.
    expectSidesAgree(routes, { borderTopWidth: 2 }, ["borderTopColor"]);
  });

  test("border-bottom", () => {
    const routes = routeStyles(
      "border-bottom",
      (value) => `border-bottom: ${value} solid #f00`,
      "2px",
      "4px",
    );

    expectSidesAgree(routes, { borderBottomWidth: 2 }, ["borderBottomColor"]);
  });

  test("border-inline-start", () => {
    const routes = routeStyles(
      "border-inline-start",
      (value) => `border-inline-start: ${value} solid #f00`,
      "2px",
      "4px",
    );

    // `ReactNativeStyleAttributes.js` — the `style` validAttributes of
    // `BaseViewConfig` on both platforms — names this side `borderStartWidth` /
    // `borderStartColor`, which is the same direction-aware edge CSS spells
    // `border-inline-start`, so the width and the colour reach React Native's
    // own keys on every route.
    //
    // The STYLE is dropped. React Native has no per-side border style at all —
    // only one `borderStyle` for the whole box — so there is no key to write.
    // Renaming it onto `borderStyle` would style the other three sides too, and
    // emitting the faithful CSS key would leave an entry in the style object
    // that reads like a live declaration and paints nothing.
    //
    // The shorthand inherits that naming from the longhands rather than
    // introducing it: `rn-style-coverage.test.tsx`'s "border-inline-* compiles
    // to the start/end keys React Native reads" pins the same key set from
    // `border-inline-start-color` written on its own.
    expectSidesAgree(routes, { borderStartWidth: 2 }, ["borderStartColor"]);
  });

  test("border-inline-end", () => {
    const routes = routeStyles(
      "border-inline-end",
      (value) => `border-inline-end: ${value} solid #f00`,
      "2px",
      "4px",
    );

    // As `border-inline-start`: React Native's name for this side is
    // `borderEndWidth` / `borderEndColor`, and the style has no target.
    expectSidesAgree(routes, { borderEndWidth: 2 }, ["borderEndColor"]);
  });

  test("border-inline", () => {
    const routes = routeStyles(
      "border-inline",
      (value) => `border-inline: ${value} solid #f00`,
      "2px",
      "4px",
    );

    // As `border-inline-start`, and with no React Native key for the axis as a
    // pair — `borderInlineWidth` and `borderInlineColor` do not exist — so each
    // component is written to both edges.
    expectSidesAgree(routes, { borderStartWidth: 2, borderEndWidth: 2 }, [
      "borderStartColor",
      "borderEndColor",
    ]);
  });

  test("border-block", () => {
    const routes = routeStyles(
      "border-block",
      (value) => `border-block: ${value} solid #f00`,
      "2px",
      "4px",
    );

    // Every part of the block axis reaches the PHYSICAL edges. The width and
    // style have no axis key at all — `borderBlockWidth` and
    // `borderBlockStyle` are not React Native style keys — and the colour has
    // one but must not use it: the platforms rank `borderBlockColor` against
    // `borderTopColor` in opposite orders, so an element carrying both paints
    // differently on each.
    expectSidesAgree(routes, { borderTopWidth: 2, borderBottomWidth: 2 }, [
      "borderTopColor",
      "borderBottomColor",
    ]);
  });

  test("border-block-start", () => {
    const routes = routeStyles(
      "border-block-start",
      (value) => `border-block-start: ${value} solid #f00`,
      "2px",
      "4px",
    );

    // The style component is dropped here as it is for `border-top`.
    // `borderBlockStartColor` IS a React Native style key, so the colour keeps
    // it; `borderBlockStartWidth` is not, so the width goes to the top edge.
    expectSidesAgree(routes, { borderTopWidth: 2 }, ["borderBlockStartColor"]);
  });
});

describe("the `outline` shorthand", () => {
  test("`outline` produces the three longhands on every route", () => {
    const routes = routeStyles(
      "outline",
      (value) => `outline: ${value} solid #f00`,
      "2px",
      "4px",
    );

    // React Native declares all three longhands — `outlineWidth`,
    // `outlineStyle` (`'solid' | 'dotted' | 'dashed'`) and `outlineColor`
    // (`StyleSheetTypes.d.ts`) — and no `outline` of its own, so the expansion
    // is the only shape that reaches the host view.
    expectSidesAgree(routes, { outlineWidth: 2, outlineStyle: "solid" }, [
      "outlineColor",
    ]);
  });

  test("the three `outline` longhands together no longer collapse into nothing", () => {
    // An inversion of the usual direction, now closed: writing `outline-width`
    // + `outline-style` + `outline-color` as three separate longhands makes
    // lightningcss RECOMBINE them into `outline`, which used to be dropped —
    // while deferring any ONE of them prevented the recombination, so the
    // runtime path SUCCEEDED where the compile-time path lost all three.
    expect(
      styleOf(
        `.outline-longhands { outline-width: 2px; outline-style: solid; outline-color: #f00; }`,
        "outline-longhands",
      ),
    ).toStrictEqual({
      outlineColor: "#f00",
      outlineStyle: "solid",
      outlineWidth: 2,
    });

    expect(
      styleOf(
        `:root { --outline-deferred: #f00; }
         @media (prefers-color-scheme: dark) { :root { --outline-deferred: #00f; } }
         .outline-deferred {
           outline-width: 2px;
           outline-style: solid;
           outline-color: var(--outline-deferred);
         }`,
        "outline-deferred",
      ),
    ).toStrictEqual({
      outlineWidth: 2,
      outlineStyle: "solid",
      outlineColor: "red",
    });

    // Any two of the three survive, because there is no shorthand to collapse to.
    expect(
      styleOf(
        `.outline-two { outline-width: 2px; outline-color: #f00; }`,
        "outline-two",
      ),
    ).toStrictEqual({ outlineWidth: 2, outlineColor: "#f00" });
  });
});

describe("value keywords and units - routes DIVERGE", () => {
  test("border-width keyword (`thick`)", () => {
    const routes = routeStyles(
      "width-keyword",
      (value) => `border-width: ${value}`,
      "thick",
      "thin",
    );

    // SUSPECTED DEFECT: `border-width: thick`
    //   compile time -> dropped, with a `values` warning (React Native has no
    //                   `thin`/`medium`/`thick` keyword)
    //   runtime      -> `{ borderWidth: "thick" }` - a string where React Native
    //                   needs a number
    // The compile-time behaviour is the correct one.
    expect(routes.literal).toBeUndefined();
    expect(routes.inlinable).toBeUndefined();
    expect(routes.nonInlinable).toStrictEqual({ borderWidth: "thick" });
    expect(routes.fallback).toStrictEqual({ borderWidth: "thick" });
  });

  test("opacity as a percentage", () => {
    const routes = routeStyles(
      "opacity-percent",
      (value) => `opacity: ${value}`,
      "50%",
      "25%",
    );

    // SUSPECTED DEFECT: `opacity: 50%`
    //   compile time -> `0.5` (correct - CSS defines `50%` as the number 0.5)
    //   runtime      -> `"50%"` - a string React Native's opacity cannot use
    expect(routes.literal).toStrictEqual({ opacity: 0.5 });
    expect(routes.inlinable).toStrictEqual({ opacity: 0.5 });
    expect(routes.nonInlinable).toStrictEqual({ opacity: "50%" });
    expect(routes.fallback).toStrictEqual({ opacity: "50%" });
  });
});

describe("box-shadow spread - routes DIVERGE", () => {
  test("a zero spread is emitted at compile time and omitted at runtime", () => {
    const routes = routeStyles(
      "shadow-spread",
      (value) => `box-shadow: 0 1px 2px ${value}`,
      BLACK_50,
      RED_50,
    );

    // SUSPECTED DEFECT (cosmetic): with the spread omitted from the CSS, the
    // compile-time path materialises `spreadDistance: 0` while the runtime path
    // leaves the key off. React Native defaults the spread to 0, so the rendered
    // result is the same - but the two style objects are not equal, which any
    // snapshot or `toStrictEqual` across the routes will trip over.
    expect(routes.literal).toStrictEqual({
      boxShadow: [
        {
          offsetX: 0,
          offsetY: 1,
          blurRadius: 2,
          spreadDistance: 0,
          color: BLACK_50_HEX,
        },
      ],
    });
    expect(routes.nonInlinable).toStrictEqual({
      boxShadow: [
        { offsetX: 0, offsetY: 1, blurRadius: 2, color: BLACK_50_HEX },
      ],
    });
  });
});

describe("color-mix() and relative colour syntax", () => {
  test("color-mix() with one explicit percentage agrees on both routes", () => {
    const literal = styleOf(
      `.mix-literal { border-color: color-mix(in srgb, #f00 50%, #00f); }`,
      "mix-literal",
    );
    const runtime = styleOf(
      `:root { --mix-runtime: #f00; }
       @media (prefers-color-scheme: dark) { :root { --mix-runtime: #0f0; } }
       .mix-runtime { border-color: color-mix(in srgb, var(--mix-runtime) 50%, #00f); }`,
      "mix-runtime",
    );

    // `color-mix(in srgb, #f00 50%, #00f)` is opaque purple: the percentage is
    // the mixing WEIGHT, the omitted one defaults to 100% minus it, and two
    // opaque operands give an opaque result.
    //
    // The two NOTATIONS differ - the compile-time route emits hex, the runtime
    // route emits `rgba()` - but the channels are rounded to whole bytes, so
    // the two strings are the same colour rather than one byte apart: React
    // Native reads an `rgb()` channel with `parseInt`, which would truncate an
    // un-rounded `127.5` to `127` where the hex says `128`.
    expect(literal).toStrictEqual({ borderColor: "#800080" });
    expect(runtime).toStrictEqual({
      borderColor: "rgba(128, 0, 128, 1)",
    });
    expect({
      runtime: processColor("rgba(128, 0, 128, 1)"),
      literal: processColor("#800080"),
      unrounded: processColor("rgba(127.5, 0, 127.5, 1)"),
    }).toStrictEqual({
      runtime: 4286578816,
      literal: 4286578816,
      unrounded: 4286513279,
    });
  });

  test("color-mix() with two explicit percentages is dropped at runtime", () => {
    const literal = styleOf(
      `.mix-both-literal { border-color: color-mix(in srgb, #f00 50%, #00f 50%); }`,
      "mix-both-literal",
    );
    const runtime = styleOf(
      `:root { --mix-both: #f00; }
       @media (prefers-color-scheme: dark) { :root { --mix-both: #0f0; } }
       .mix-both-runtime { border-color: color-mix(in srgb, var(--mix-both) 50%, #00f 50%); }`,
      "mix-both-runtime",
    );

    // SUSPECTED DEFECT: naming BOTH percentages makes the runtime path emit
    // nothing at all - the declaration disappears. The compile-time result is
    // correct.
    expect(literal).toStrictEqual({ borderColor: "#800080" });
    expect(runtime).toBeUndefined();
  });

  test("color-mix() against `transparent` agrees on the colour but not the notation", () => {
    const literal = styleOf(
      `.mix-alpha-literal { border-color: color-mix(in oklab, #f00 50%, transparent); }`,
      "mix-alpha-literal",
    );
    const runtime = styleOf(
      `:root { --mix-alpha: #f00; }
       @media (prefers-color-scheme: dark) { :root { --mix-alpha: #0f0; } }
       .mix-alpha-runtime { border-color: color-mix(in oklab, var(--mix-alpha) 50%, transparent); }`,
      "mix-alpha-runtime",
    );

    // Same colour, different notation - React Native parses both.
    expect(literal).toStrictEqual({ borderColor: "#ff000080" });
    expect(runtime).toStrictEqual({ borderColor: "rgba(255, 0, 0, 0.5)" });
  });

  test("relative colour syntax names the same colour on both routes", () => {
    const literal = styleOf(
      `.relative-literal { border-color: rgb(from #f00 r g b / 50%); }`,
      "relative-literal",
    );
    const runtime = styleOf(
      `:root { --relative: #f00; }
       @media (prefers-color-scheme: dark) { :root { --relative: #0f0; } }
       .relative-runtime { border-color: rgb(from var(--relative) r g b / 50%); }`,
      "relative-runtime",
    );

    // `rgb(from <colour> r g b / 50%)` - css-color-5 §4. lightningcss folds the
    // literal origin away at compile time; the runtime route resolves the
    // origin, binds `r`/`g`/`b` to its channels and serialises the result in
    // the legacy grammar. Two notations, one colour.
    //
    // A comma-joined argument list - the shape a generic function serialiser
    // yields here - is pinned beside them because it is outside React Native's
    // grammar entirely, so it fails as an absent colour rather than a wrong
    // one.
    expect(literal).toStrictEqual({ borderColor: "#ff000080" });
    expect(runtime).toStrictEqual({
      borderColor: "rgba(255, 0, 0, 0.5)",
    });
    expect({
      runtime: processColor("rgba(255, 0, 0, 0.5)"),
      literal: processColor("#ff000080"),
      commaJoined: processColor("rgb(from, red, r, g, b, 50%)"),
    }).toStrictEqual({
      runtime: 2164195328,
      literal: 2164195328,
      commaJoined: undefined,
    });
  });
});

describe("currentcolor beside the `color` it reads", () => {
  test("`text-shadow: currentcolor` reads the element's own colour in either order", () => {
    // CSS Color 4 §6.1: `currentcolor` on any other property is the element's
    // computed `color`, whichever order the two declarations are written in —
    // the cascade has no source-order rule that would make one of them lose.
    //
    // The order matters to the RUNTIME because `calculate-props.ts` parks a
    // `{ [prop]: true }` placeholder for a declaration that reads a variable and
    // swaps it for the resolved value in a delayed pass, so `color` written
    // first has to be resolvable by the time the shadow asks for it.
    const expected = {
      color: "#f00",
      textShadowOffset: { width: 1, height: 2 },
      textShadowRadius: 3,
      textShadowColor: "#f00",
    };

    expect(
      styleOf(
        `.leak-color-first { color: #f00; text-shadow: 1px 2px 3px currentcolor; }`,
        "leak-color-first",
      ),
    ).toStrictEqual(expected);

    expect(
      styleOf(
        `.leak-shadow-first { text-shadow: 1px 2px 3px currentcolor; color: #f00; }`,
        "leak-shadow-first",
      ),
    ).toStrictEqual(expected);
  });

  test("`box-shadow: currentcolor` reads a runtime-resolved colour and leaves it intact", () => {
    // `color` is the property every descendant inherits, so a placeholder
    // surviving into it would corrupt a whole subtree rather than one shadow.
    // Both keys here hold the colour itself.
    expect(
      styleOf(
        `:root { --leak-box: #f00; }
         @media (prefers-color-scheme: dark) { :root { --leak-box: #00f; } }
         .leak-box { color: var(--leak-box); box-shadow: 0 1px 2px currentcolor; }`,
        "leak-box",
      ),
    ).toStrictEqual({
      color: "red",
      boxShadow: [
        {
          offsetX: 0,
          offsetY: 1,
          blurRadius: 2,
          spreadDistance: 0,
          color: "red",
        },
      ],
    });

    // The `text-shadow` spelling of the same pair, which writes three keys
    // rather than one and reaches the colour by a different resolver.
    expect(
      styleOf(
        `:root { --leak-text: #f00; }
         @media (prefers-color-scheme: dark) { :root { --leak-text: #00f; } }
         .leak-text { color: var(--leak-text); text-shadow: 1px 2px 3px currentcolor; }`,
        "leak-text",
      ),
    ).toStrictEqual({
      color: "red",
      textShadowOffset: { width: 1, height: 2 },
      textShadowRadius: 3,
      textShadowColor: "red",
    });
  });
});

describe("light-dark()", () => {
  function darkStyleOf(css: string, className: string): unknown {
    const id = `light-dark-${uniqueId++}`;
    registerCSS(css);
    const { getByTestId } = render(<View testID={id} className={className} />);
    const component = getByTestId(id);
    act(() => {
      colorScheme.set("dark");
    });
    return component.props.style;
  }

  test("colour longhands flip correctly", () => {
    expect(
      darkStyleOf(`.ld-color { color: light-dark(#333, #eee); }`, "ld-color"),
    ).toStrictEqual({ color: "#eee" });

    expect(
      darkStyleOf(
        `.ld-background { background-color: light-dark(#333, #eee); }`,
        "ld-background",
      ),
    ).toStrictEqual({ backgroundColor: "#eee" });

    expect(
      darkStyleOf(
        `.ld-outline-color { outline-color: light-dark(#333, #eee); }`,
        "ld-outline-color",
      ),
    ).toStrictEqual({ outlineColor: "#eee" });
  });

  test("a border-color whose four sides are equal flips, plainly and under @media / !important", () => {
    // SUSPECTED DEFECT: `border-color` is parsed side by side, so each side's
    // `light-dark()` registers its own dark descriptor under that side's
    // LONGHAND key. The four light values then agree, so `addShorthand`
    // collapses THEM into the single `borderColor` key - and the two never
    // meet, leaving the light `#333` in the style beside four dark longhands:
    //
    //   { borderColor: "#333", borderTopColor: "#eee",
    //     borderRightColor: "#eee", borderBottomColor: "#eee",
    //     borderLeftColor: "#eee" }
    //
    // The trigger is the collapse, not `light-dark()`: with the four sides
    // DIFFERENT there is nothing to collapse, so the light rule keeps its four
    // longhands and the dark rule overwrites them one for one
    // (`light-dark-shorthands.test.tsx` pins that case). `border: 2px solid
    // light-dark(…)` below is clean for the same reason - its light colour
    // lands on `border-color`, the key the dark rule targets.
    //
    // `!important` travels in its own lightningcss block and `@media` adds a
    // condition, so both are second routes into the same parser. All three
    // produce the same style object, which is what says the defect is the
    // collapse rather than anything about those two routes.
    expect({
      plain: darkStyleOf(
        `.ld-border-color { border-color: light-dark(#333, #eee); }`,
        "ld-border-color",
      ),
      important: darkStyleOf(
        `.ld-important { border-color: light-dark(#333, #eee) !important; }`,
        "ld-important",
      ),
      media: darkStyleOf(
        `@media (min-width: 1px) { .ld-media { border-color: light-dark(#333, #eee); } }`,
        "ld-media",
      ),
    }).toStrictEqual({
      plain: { borderColor: "#eee" },
      important: { borderColor: "#eee" },
      media: { borderColor: "#eee" },
    });
  });

  test("light-dark() inside `box-shadow` colours the shadow", () => {
    // A colour inside a SHORTHAND belongs on the key the light value landed on,
    // not on the shorthand: `parseColor` takes that key as an argument and the
    // dark rule writes to the same one, so the dark shadow is the light shadow
    // with a different `color` rather than a bare colour standing in for it.
    expect(
      darkStyleOf(
        `.ld-box-shadow { box-shadow: 0 4px 6px -1px light-dark(#333, #eee); }`,
        "ld-box-shadow",
      ),
    ).toStrictEqual({
      boxShadow: [
        {
          offsetX: 0,
          offsetY: 4,
          blurRadius: 6,
          spreadDistance: -1,
          color: "#eee",
        },
      ],
    });
  });

  test("light-dark() inside `text-shadow` colours the shadow", () => {
    // Same targeting as `box-shadow`, on the property React Native spells with
    // three separate keys: only `textShadowColor` changes with the scheme.
    expect(
      darkStyleOf(
        `.ld-text-shadow { text-shadow: 1px 2px 3px light-dark(#333, #eee); }`,
        "ld-text-shadow",
      ),
    ).toStrictEqual({
      textShadowOffset: { width: 1, height: 2 },
      textShadowRadius: 3,
      textShadowColor: "#eee",
    });
  });

  test("light-dark() inside the `border` shorthand colours the border", () => {
    // `parseBorder` writes its colour to `border-color`, and the dark rule
    // targets that same key - so the dark value REPLACES the light one instead
    // of arriving beside it on a key React Native has no meaning for.
    expect(
      darkStyleOf(
        `.ld-border { border: 2px solid light-dark(#333, #eee); }`,
        "ld-border",
      ),
    ).toStrictEqual({
      borderWidth: 2,
      borderStyle: "solid",
      borderColor: "#eee",
    });
  });

  test("light-dark() publishes the active branch to descendants", () => {
    // An inherited property is published through the rule's `v` list, and the
    // dark rule carries its own - so a descendant reading `color` sees the same
    // branch the element itself does, in either scheme.
    registerCSS(`.ld-publish { color: light-dark(#333, #eee); }`);
    const { getByTestId } = render(
      <View testID="ld-publish-parent" className="ld-publish">
        <Text testID="ld-publish-child">text</Text>
      </View>,
    );
    const parent = getByTestId("ld-publish-parent");
    const child = getByTestId("ld-publish-child");

    expect(parent.props.style).toStrictEqual({ color: "#333" });
    expect(child.props.style).toStrictEqual({ color: "#333" });

    act(() => {
      colorScheme.set("dark");
    });

    expect(parent.props.style).toStrictEqual({ color: "#eee" });
    expect(child.props.style).toStrictEqual({ color: "#eee" });
  });
});
