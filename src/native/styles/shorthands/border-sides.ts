import { CURRENT_COLOR } from "../constants";
import type { StyleResolver } from "../resolve";
import { shorthandHandler } from "./_handler";

/**
 * The `<line-width> || <line-style> || <color>` shorthands — `border` itself,
 * one per border edge, plus `outline` — expanded from the values a `var()`
 * supplied.
 *
 * None of `border`, `borderTop`, `borderBlock`, `borderInlineStart` or
 * `outline` is a React Native style key, so a value left on one of them loses
 * the width, the style and the colour together with nothing to show for it.
 *
 * Each edge names the keys it writes. A `undefined` key is a component React
 * Native has no key for at that edge: it has one `borderStyle` for the whole
 * box and none per edge on either axis, so every edge's style but the box's own
 * is read and discarded — which is what the compile-time parsers do with it.
 */
interface BorderSideKeys {
  readonly width: string | undefined;
  readonly style: string | undefined;
  readonly color: string | undefined;
}

/** css-backgrounds-3 §4.2's `<line-style>`, which is a closed keyword set. */
const LINE_STYLES = [
  "none",
  "hidden",
  "dotted",
  "dashed",
  "solid",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
] as const;

/**
 * css-backgrounds-3 §4.1's keyword widths.
 *
 * React Native has no name for them, so they are read and discarded — which
 * leaves the declaration's other components, exactly as the compile-time route
 * leaves them.
 */
const LINE_WIDTH_KEYWORDS = ["thin", "medium", "thick"] as const;

function borderSideHandler(keys: BorderSideKeys): StyleResolver {
  const width = [keys.width, "number"] as const;
  const widthKeyword = [undefined, LINE_WIDTH_KEYWORDS] as const;
  const style = [keys.style, LINE_STYLES] as const;
  const color = [keys.color, "color", CURRENT_COLOR] as const;

  // The components are `||`-combined, so each is optional and a declaration of
  // one value is complete. The keyword sets are what tell those one-value rows
  // apart: `solid` is a style and `red` is a colour, and both are strings.
  //
  // The colour is a DEFAULT rather than another row, because `border-color`'s
  // initial value is `currentcolor` and the compile-time route writes it for
  // every declaration that names no colour.
  return shorthandHandler(
    [
      [width, style, color],
      [style, color],
      [width, style],
      [width],
      [style],
      [widthKeyword],
      [color],
    ],
    [color],
  );
}

/**
 * The whole box, which is the same grammar written to the box-level keys.
 *
 * React Native carries `borderStyle` for the box but not per edge, so this is
 * the one member of the family whose style component has a key to write to.
 */
export const border = borderSideHandler({
  width: "borderWidth",
  style: "borderStyle",
  color: "borderColor",
});

export const borderTop = borderSideHandler({
  width: "borderTopWidth",
  style: undefined,
  color: "borderTopColor",
});

export const borderRight = borderSideHandler({
  width: "borderRightWidth",
  style: undefined,
  color: "borderRightColor",
});

export const borderBottom = borderSideHandler({
  width: "borderBottomWidth",
  style: undefined,
  color: "borderBottomColor",
});

export const borderLeft = borderSideHandler({
  width: "borderLeftWidth",
  style: undefined,
  color: "borderLeftColor",
});

/**
 * An AXIS shorthand, which sets BOTH of its axis's edges.
 *
 * Neither axis has a full set of axis-level keys to collapse into, so each
 * component is written to one edge's key by `start` and mirrored onto the
 * other, which is what the compile-time parser produces for the same
 * declaration.
 *
 * Mirrored after the fact rather than declared as a two-key target, because a
 * LIST in a `shorthandHandler` mapping is a deep PATH (`android_ripple.color`),
 * not several keys: naming both would nest the second inside the first.
 */
function axisHandler(
  start: StyleResolver,
  twins: Readonly<Record<string, string>>,
): StyleResolver {
  return (resolve, value, get, options) => {
    const resolved = start(resolve, value, get, options);

    if (typeof resolved !== "object" || resolved === null) {
      return resolved;
    }

    // Spread rather than mutate: the handler's result carries `ShortHandSymbol`,
    // and a spread copies own symbol keys along with the string ones.
    const both: Record<string, unknown> = { ...resolved };

    for (const [startKey, endKey] of Object.entries(twins)) {
      if (startKey in both) {
        both[endKey] = both[startKey];
      }
    }

    return both;
  };
}

// The block AXIS reaches the PHYSICAL edges, both halves.
//
// `borderBlockColor` exists as a style attribute on both platforms, which makes
// writing to it look correct — but the two platforms rank it against
// `borderTopColor` in OPPOSITE orders, so an element carrying both keys paints
// a different colour on each. Android reads `BLOCK_START ?: TOP ?: BLOCK`
// (`BorderColors.kt`), so the physical edge wins; iOS assigns
// `borderTopColor = _borderBlockColor` whenever the axis key is set
// (`RCTView.m`), so the axis key wins. A later declaration that collapsed onto
// the axis key would therefore sit BESIDE an earlier one that expanded to the
// edges, and which of the two paints would depend on the platform. Emitting one
// key set — the physical edges, which every platform reads the same way —
// is what makes the cascade mean the same thing on both.
//
// `borderBlockWidth` and the two per-edge block widths live in
// `BaseViewConfig.ios.js` and nowhere else, so a width written to them paints
// on iOS Fabric and vanishes on Android and the old architecture — the physical
// edges carry it for the same reason. `direction` never flips the block axis,
// so block-start is the top edge and block-end the bottom one on every
// platform, which makes that exact rather than an approximation.
export const borderBlock = axisHandler(
  borderSideHandler({
    width: "borderTopWidth",
    style: undefined,
    color: "borderTopColor",
  }),
  {
    borderTopWidth: "borderBottomWidth",
    borderTopColor: "borderBottomColor",
  },
);

export const borderBlockStart = borderSideHandler({
  width: "borderTopWidth",
  style: undefined,
  color: "borderBlockStartColor",
});

export const borderBlockEnd = borderSideHandler({
  width: "borderBottomWidth",
  style: undefined,
  color: "borderBlockEndColor",
});

// The inline AXIS shorthand sets both inline edges, and {inline-start,
// inline-end} = {start, end} whichever way the direction runs — so React
// Native's `borderStart*` / `borderEnd*` are exactly this, and there is no
// axis-level key to collapse into.
export const borderInline = axisHandler(
  borderSideHandler({
    width: "borderStartWidth",
    style: undefined,
    color: "borderStartColor",
  }),
  {
    borderStartWidth: "borderEndWidth",
    borderStartColor: "borderEndColor",
  },
);

export const borderInlineStart = borderSideHandler({
  width: "borderStartWidth",
  style: undefined,
  color: "borderStartColor",
});

export const borderInlineEnd = borderSideHandler({
  width: "borderEndWidth",
  style: undefined,
  color: "borderEndColor",
});

export const outline = borderSideHandler({
  width: "outlineWidth",
  style: "outlineStyle",
  color: "outlineColor",
});
