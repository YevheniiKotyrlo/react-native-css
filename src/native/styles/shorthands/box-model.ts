import { repeatShorthandHandler } from "./_expand";

/**
 * The box-model shorthands, expanded from the values a `var()` supplied.
 *
 * Each table is the CSS value order for that shorthand — `margin` is
 * top/right/bottom/left, `border-radius` is the four corners clockwise from the
 * top-left, an axis pair is start/end — and the repeat rule fills the rest.
 * `collapseTo` names the single React Native key the longhands fold onto when
 * they all agree, matching what the literal route emits for the same value.
 */

export const margin = repeatShorthandHandler({
  positions: ["marginTop", "marginRight", "marginBottom", "marginLeft"],
  collapseTo: "margin",
  allowAuto: true,
});

export const marginBlock = repeatShorthandHandler({
  positions: ["marginBlockStart", "marginBlockEnd"],
  collapseTo: "marginBlock",
  allowAuto: true,
});

export const marginInline = repeatShorthandHandler({
  positions: ["marginInlineStart", "marginInlineEnd"],
  collapseTo: "marginInline",
  allowAuto: true,
});

export const padding = repeatShorthandHandler({
  positions: ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
  collapseTo: "padding",
});

export const paddingBlock = repeatShorthandHandler({
  positions: ["paddingBlockStart", "paddingBlockEnd"],
  collapseTo: "paddingBlock",
});

export const paddingInline = repeatShorthandHandler({
  positions: ["paddingInlineStart", "paddingInlineEnd"],
  collapseTo: "paddingInline",
});

export const inset = repeatShorthandHandler({
  positions: ["top", "right", "bottom", "left"],
  collapseTo: "inset",
});

export const insetBlock = repeatShorthandHandler({
  positions: ["insetBlockStart", "insetBlockEnd"],
  collapseTo: "insetBlock",
});

export const insetInline = repeatShorthandHandler({
  positions: ["insetInlineStart", "insetInlineEnd"],
  collapseTo: "insetInline",
});

export const gap = repeatShorthandHandler({
  positions: ["rowGap", "columnGap"],
  collapseTo: "gap",
});

export const borderWidth = repeatShorthandHandler({
  positions: [
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
  ],
  collapseTo: "borderWidth",
});

export const borderColor = repeatShorthandHandler({
  positions: [
    "borderTopColor",
    "borderRightColor",
    "borderBottomColor",
    "borderLeftColor",
  ],
  collapseTo: "borderColor",
});

export const borderBlockColor = repeatShorthandHandler({
  positions: ["borderTopColor", "borderBottomColor"],
  collapseTo: "borderBlockColor",
});

/**
 * The inline AXIS, which React Native spells `borderStart*` / `borderEnd*`.
 *
 * {inline-start, inline-end} = {start, end} whichever way the direction runs,
 * so the mapping is direction-invariant and renders correctly under RTL. There
 * is NO axis-level key to collapse into — `borderInlineColor` does not exist in
 * React Native — so `collapseTo` is deliberately absent and two equal sides
 * stay two keys.
 */
export const borderInlineColor = repeatShorthandHandler({
  positions: ["borderStartColor", "borderEndColor"],
});

/**
 * `border-style`, which is two declarations wearing one name.
 *
 * React Native renders ONE `borderStyle` for the whole box, so four edges that
 * agree are that key — and four that disagree are not expressible at all. The
 * per-edge CSS names are written for them anyway, because a name React Native
 * ignores is inert while collapsing to one edge's style would be silently wrong
 * about the other three. `parseBorderStyle` makes the same split at compile
 * time, and `capability-gap-fidelity.test.tsx` is the contract.
 *
 * `renders` is React Native's own `borderStyle` union. A CSS style outside it —
 * `none`, `double`, `groove` — is dropped per edge rather than written, so a
 * declaration whose every edge is unrenderable produces nothing at all, which is
 * what the compile-time route produces (plus a warning this side cannot emit).
 */
export const borderStyle = repeatShorthandHandler({
  positions: [
    "borderTopStyle",
    "borderRightStyle",
    "borderBottomStyle",
    "borderLeftStyle",
  ],
  collapseTo: "borderStyle",
  renders: new Set(["solid", "dotted", "dashed"]),
});

export const borderBlockWidth = repeatShorthandHandler({
  positions: ["borderBlockStartWidth", "borderBlockEndWidth"],
  collapseTo: "borderBlockWidth",
});

export const borderInlineWidth = repeatShorthandHandler({
  positions: ["borderStartWidth", "borderEndWidth"],
});

export const borderBlockStyle = repeatShorthandHandler({
  positions: ["borderBlockStartStyle", "borderBlockEndStyle"],
  collapseTo: "borderBlockStyle",
});

export const borderInlineStyle = repeatShorthandHandler({
  positions: ["borderInlineStartStyle", "borderInlineEndStyle"],
  collapseTo: "borderInlineStyle",
});

export const borderRadius = repeatShorthandHandler({
  positions: [
    "borderTopLeftRadius",
    "borderTopRightRadius",
    "borderBottomRightRadius",
    "borderBottomLeftRadius",
  ],
  collapseTo: "borderRadius",
});
