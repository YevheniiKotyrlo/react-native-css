import { render } from "@testing-library/react-native";
import type { TokenOrValue } from "lightningcss";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { StyleCollection } from "react-native-css/native";

/**
 * Whether the compiler folds a single-definition custom property into its use
 * sites is an OPTIMISATION. It must not be observable: the same stylesheet
 * compiled with the fold on and with the fold off has to render the same style.
 *
 * The census below is exhaustive over the value kinds lightningcss can put
 * inside a custom property, by construction — both records are keyed by the
 * lightningcss union itself, so a new member fails to compile until it is
 * censused here. An empty list is a kind that cannot be the whole value of a
 * custom property a React Native style consumes, and says why.
 */
type ValueKind = TokenOrValue["type"];
type RawTokenKind = Extract<TokenOrValue, { type: "token" }>["value"]["type"];

interface Shape {
  /** The property that reads the variable. */
  readonly property: string;
  /** The custom property's value. */
  readonly value: string;
  /**
   * A divergence this change does not close, with the reason it is out of
   * reach. Pinned as an exact pair so it cannot drift silently in either
   * direction: a NEW divergence fails, and so does one that quietly goes away.
   */
  readonly knownDivergence?: {
    readonly folded: Record<string, unknown>;
    readonly unfolded: Record<string, unknown>;
    readonly because: string;
  };
}

/**
 * A named CSS colour reaches the second pass as a bare ident, because
 * lightningcss only promotes a custom property's value to a colour node when it
 * is not expressible as one. The folded path then parses it under the consuming
 * property and canonicalises it; the unfolded path stores it under no property
 * at all, so it cannot. Normalising the store instead would break the reverse
 * case — `font-family: var(--v)` over `--v: red` renders "red" on BOTH paths
 * today and would start rendering "#f00" on one of them.
 */
const namedColour = (folded: string, unfolded: string) => ({
  folded: { color: folded },
  unfolded: { color: unfolded },
  because:
    "a named colour is an ident until a property gives it a type; the variable store has no property",
});

const TOKEN_CENSUS: Record<RawTokenKind, readonly Shape[]> = {
  "ident": [
    { property: "position", value: "absolute" },
    {
      property: "color",
      value: "red",
      knownDivergence: namedColour("#f00", "red"),
    },
    {
      property: "color",
      value: "transparent",
      knownDivergence: namedColour("#0000", "transparent"),
    },
    {
      property: "color",
      value: "rebeccapurple",
      knownDivergence: namedColour("#639", "rebeccapurple"),
    },
  ],
  "string": [{ property: "font-family", value: '"Inter"' }],
  "number": [
    { property: "flex-grow", value: "2" },
    { property: "width", value: "0" },
    { property: "opacity", value: "0" },
    { property: "z-index", value: "3" },
  ],
  "percentage": [{ property: "width", value: "50%" }],
  // A length, not a time: `transition-duration: 3s` is the other dimension
  // token a custom property can hold, and it paints nothing on EITHER path
  // because a transition property configures the animation system rather than
  // the style object. That is fold-independent too, but vacuously so, which is
  // what the guard below rejects — so it is pinned by its own test instead.
  "dimension": [{ property: "width", value: "10px" }],
  "delim": [
    { property: "aspect-ratio", value: "16 / 9" },
    // A square ratio has a second canonical form, and the property parser
    // picks it.
    { property: "aspect-ratio", value: "3 / 3" },
  ],
  "hash": [{ property: "color", value: "#123456" }],
  // Not reachable as the whole value of a custom property a style consumes.
  "at-keyword": [],
  "id-hash": [],
  "unquoted-url": [],
  "white-space": [],
  "comment": [],
  "colon": [],
  "semicolon": [],
  "comma": [],
  "include-match": [],
  "dash-match": [],
  "prefix-match": [],
  "suffix-match": [],
  "substring-match": [],
  "cdo": [],
  "cdc": [],
  "function": [],
  "parenthesis-block": [],
  "square-bracket-block": [],
  "curly-bracket-block": [],
  "bad-url": [],
  "bad-string": [],
  "close-parenthesis": [],
  "close-square-bracket": [],
  "close-curly-bracket": [],
};

const VALUE_CENSUS: Record<ValueKind, readonly Shape[]> = {
  "token": Object.values(TOKEN_CENSUS).flat(),
  "color": [
    { property: "color", value: "#12345678" },
    { property: "color", value: "rgba(255, 0, 0, 0.5)" },
    { property: "color", value: "oklch(63.7% 0.237 25.331)" },
  ],
  "length": [
    { property: "width", value: "10px" },
    { property: "width", value: "0px" },
    { property: "margin-top", value: "-4px" },
    { property: "width", value: "1rem" },
  ],
  "angle": [
    {
      property: "rotate",
      value: "45deg",
      knownDivergence: {
        folded: { transform: [{ rotateZ: "45deg" }] },
        unfolded: { transform: [{ rotate: "45deg" }] },
        because:
          "`rotate` is renamed to `rotateZ` by the static parser and left alone by the runtime one; fold-independent, and closing it is a runtime shorthand change",
      },
    },
  ],
  "function": [
    { property: "width", value: "calc(10px + 2px)" },
    { property: "transform", value: "translateX(10px)" },
  ],
  "var": [
    {
      property: "color",
      value: "var(--inner)",
      knownDivergence: namedColour("#008080", "teal"),
    },
  ],
  // Both paths agree, and both are wrong about the red channel by a factor of
  // 255. That is `parseUnresolvedColor`'s bug, not a fold one, and parity is
  // all this census claims.
  "unresolved-color": [
    { property: "color", value: "rgb(255 0 0 / var(--alpha))" },
  ],
  // Not reachable, or not a style value React Native consumes.
  "url": [],
  "env": [],
  "time": [],
  "resolution": [],
  "dashed-ident": [],
  "animation-name": [],
};

/**
 * Shorthands are a family rather than a shape, and they are here because they
 * are the class most likely to diverge: the static parser expands them into
 * their longhands, so the runtime one has to expand them the same way or the
 * fold decision becomes visible. It does — `native/styles/shorthands/box-model.ts`
 * is the runtime half — so these carry no divergence and go through the generic
 * assertion below.
 *
 * React Native has no array form for any of them (`margin` and `padding` are
 * `DimensionValue`, `borderWidth` a `number`), so the expansion is not a
 * cosmetic choice between two renderable shapes: it is the only one that
 * renders.
 */
const SHORTHANDS: readonly Shape[] = (
  [
    ["margin", "1px 2px"],
    ["padding", "1px 2px"],
    ["border-width", "1px 2px"],
  ] as const
).map(([property, value]) => ({ property, value }));

const SHAPES: readonly Shape[] = [
  ...Object.values(VALUE_CENSUS).flat(),
  ...SHORTHANDS,
];

function renderShape(
  shape: Shape,
  inlineVariables: boolean,
): Record<string, unknown> {
  // `--inner` and `--alpha` back the two shapes whose value is itself a
  // reference; every other shape ignores them.
  const css = `.a { --inner: teal; --alpha: 0.5; --v: ${shape.value}; ${shape.property}: var(--v); }`;
  StyleCollection.styles.clear();
  registerCSS(css, inlineVariables ? {} : { inlineVariables: false });
  const { style } = render(<View testID={testID} className="a" />).getByTestId(
    testID,
  ).props as { style?: Record<string, unknown> };

  return style ?? {};
}

test("the census covers something", () => {
  // Deriving the table from a union buys a drift failure at the cost of a
  // vacuity one: every list could be empty and every case below would vanish.
  expect(SHAPES.length).toBeGreaterThan(20);
});

describe.each(SHAPES)("$property: var(--v) over $value", (shape) => {
  test("the fold decision is unobservable", () => {
    const folded = renderShape(shape, true);
    const unfolded = renderShape(shape, false);

    if (shape.knownDivergence) {
      expect(folded).toStrictEqual(shape.knownDivergence.folded);
      expect(unfolded).toStrictEqual(shape.knownDivergence.unfolded);
      return;
    }

    // A shape that renders nothing on both paths agrees vacuously, which is
    // exactly how a typo in the census would pass.
    expect(folded).not.toStrictEqual({});
    expect(unfolded).toStrictEqual(folded);
  });
});

test("a transition property paints nothing, folded or not", () => {
  // The one shape that is fold-independent VACUOUSLY, which is why it is here
  // rather than in the census: a transition property configures the animation
  // system and writes no style key, so both paths render nothing and the guard
  // above would read that as a census typo.
  //
  // Both paths, and that is the claim. `rule.a` is decided by the PROPERTY, so
  // an unfolded `var()` is still recognised as a transition — deciding it by
  // the resolved value's function name instead left `transitionDuration: 3000`
  // sitting in the rendered style under a key React Native has never had.
  const shape = { property: "transition-duration", value: "3s" } as const;

  expect(renderShape(shape, true)).toStrictEqual({});
  expect(renderShape(shape, false)).toStrictEqual({});
});
