import type { RouteCase } from "../harness";

/**
 * Route cases for the box model: margin, padding, inset, the physical and logical sizes, and gap.
 *
 * One case per property in this slice. The gate in
 * `route-equivalence-census.test.tsx` reads the property census out of the
 * compiler's own source, so a property missing from here fails the build rather
 * than going untested.
 *
 * The properties this file owns:
 *
 * - `aspect-ratio`
 * - `block-size`
 * - `bottom`
 * - `box-sizing`
 * - `column-gap`
 * - `gap`
 * - `height`
 * - `inline-size`
 * - `inset`
 * - `inset-block`
 * - `inset-block-end`
 * - `inset-block-start`
 * - `inset-inline`
 * - `inset-inline-end`
 * - `inset-inline-start`
 * - `left`
 * - `margin`
 * - `margin-block`
 * - `margin-block-end`
 * - `margin-block-start`
 * - `margin-bottom`
 * - `margin-inline`
 * - `margin-inline-end`
 * - `margin-inline-start`
 * - `margin-left`
 * - `margin-right`
 * - `margin-top`
 * - `max-block-size`
 * - `max-height`
 * - `max-inline-size`
 * - `max-width`
 * - `min-block-size`
 * - `min-height`
 * - `min-inline-size`
 * - `min-width`
 * - `padding`
 * - `padding-block`
 * - `padding-block-end`
 * - `padding-block-start`
 * - `padding-bottom`
 * - `padding-inline`
 * - `padding-inline-end`
 * - `padding-inline-start`
 * - `padding-left`
 * - `padding-right`
 * - `padding-top`
 * - `right`
 * - `row-gap`
 * - `top`
 * - `width`
 */

export const BOX_MODEL_ROUTE_CASES: readonly RouteCase[] = [
  // No divergence note: every route serialises a `<ratio>` the same way. The
  // runtime tokeniser mirrors the compiler's `ratioDescriptor` rather than
  // joining the token stream verbatim, so `16 / 9` is `16/9` whichever route it
  // arrives by. React Native would read both — `processAspectRatio` splits on
  // `/` and trims — but the descriptors are what these routes compare.
  { property: "aspect-ratio", value: "16 / 9", alternate: "4 / 3" },
  { property: "block-size", value: "120px", alternate: "160px" },
  { property: "bottom", value: "12px", alternate: "24px" },
  { property: "box-sizing", value: "border-box", alternate: "content-box" },
  { property: "column-gap", value: "12px", alternate: "20px" },
  { property: "gap", value: "12px 24px", alternate: "4px 8px" },
  { property: "height", value: "120px", alternate: "160px" },
  { property: "inline-size", value: "140px", alternate: "180px" },
  { property: "inset", value: "10px 20px", alternate: "4px 8px" },
  { property: "inset-block", value: "10px 20px", alternate: "4px 8px" },
  { property: "inset-block-end", value: "12px", alternate: "24px" },
  { property: "inset-block-start", value: "12px", alternate: "24px" },
  { property: "inset-inline", value: "10px 20px", alternate: "4px 8px" },
  { property: "inset-inline-end", value: "12px", alternate: "24px" },
  { property: "inset-inline-start", value: "12px", alternate: "24px" },
  { property: "left", value: "12px", alternate: "24px" },
  { property: "margin", value: "10px 20px", alternate: "4px 8px" },
  { property: "margin-block", value: "10px 20px", alternate: "4px 8px" },
  { property: "margin-block-end", value: "12px", alternate: "24px" },
  { property: "margin-block-start", value: "12px", alternate: "24px" },
  { property: "margin-bottom", value: "12px", alternate: "24px" },
  // FAILING, and deliberately so — no note, because the fallback route is
  // WRONG here rather than merely different. `margin-inline: var(--x, 12px
  // auto)` compiles the fallback tokens under the consuming property's name,
  // where `allowsAutoKeyword("margin-inline")` is false
  // (`src/compiler/declarations.ts:3914`), so `auto` is dropped at
  // `declarations.ts:1739` and the surviving `12px` repeat-fills both sides as
  // `{ marginInline: 12 }`. React Native's `DimensionValue` includes `'auto'`
  // (`StyleSheetTypes.d.ts:23`) and the literal and deferred routes both emit
  // it, so the value is expressible and this route loses it.
  { property: "margin-inline", value: "12px auto", alternate: "4px 8px" },
  { property: "margin-inline-end", value: "12px", alternate: "24px" },
  { property: "margin-inline-start", value: "12px", alternate: "24px" },
  // FAILING, and deliberately so — the same break with nothing else in the
  // way: `margin-left: var(--x, auto)` renders `{}` on the fallback route and
  // `{ marginLeft: "auto" }` on the other four.
  { property: "margin-left", value: "auto", alternate: "12px" },
  { property: "margin-right", value: "12px", alternate: "24px" },
  { property: "margin-top", value: "12px", alternate: "24px" },
  { property: "max-block-size", value: "320px", alternate: "400px" },
  { property: "max-height", value: "320px", alternate: "400px" },
  { property: "max-inline-size", value: "320px", alternate: "400px" },
  // A percentage is a `DimensionValue` React Native keeps as the STRING
  // `"100%"`, so the routes have to agree on a string and not on a number.
  { property: "max-width", value: "100%", alternate: "50%" },
  { property: "min-block-size", value: "40px", alternate: "64px" },
  { property: "min-height", value: "40px", alternate: "64px" },
  { property: "min-inline-size", value: "40px", alternate: "64px" },
  { property: "min-width", value: "40px", alternate: "64px" },
  { property: "padding", value: "10px 20px", alternate: "4px 8px" },
  { property: "padding-block", value: "10px 20px", alternate: "4px 8px" },
  { property: "padding-block-end", value: "12px", alternate: "24px" },
  { property: "padding-block-start", value: "12px", alternate: "24px" },
  { property: "padding-bottom", value: "12px", alternate: "24px" },
  { property: "padding-inline", value: "10px 20px", alternate: "4px 8px" },
  { property: "padding-inline-end", value: "12px", alternate: "24px" },
  { property: "padding-inline-start", value: "12px", alternate: "24px" },
  { property: "padding-left", value: "12px", alternate: "24px" },
  { property: "padding-right", value: "12px", alternate: "24px" },
  { property: "padding-top", value: "12px", alternate: "24px" },
  { property: "right", value: "12px", alternate: "24px" },
  { property: "row-gap", value: "12px", alternate: "20px" },
  { property: "top", value: "12px", alternate: "24px" },
  { property: "width", value: "50%", alternate: "75%" },
];
