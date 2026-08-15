import type { RouteCase } from "../harness";

/**
 * Route cases for every border and outline property, and corner-shape.
 *
 * One case per property in this slice. The gate in
 * `route-equivalence-census.test.tsx` reads the property census out of the
 * compiler's own source, so a property missing from here fails the build rather
 * than going untested.
 *
 * The properties this file owns:
 *
 * - `border`
 * - `border-block`
 * - `border-block-color`
 * - `border-block-end`
 * - `border-block-end-color`
 * - `border-block-end-width`
 * - `border-block-start`
 * - `border-block-start-color`
 * - `border-block-end-style`
 * - `border-block-start-style`
 * - `border-block-start-width`
 * - `border-block-style`
 * - `border-block-width`
 * - `border-bottom`
 * - `border-bottom-color`
 * - `border-bottom-left-radius`
 * - `border-bottom-right-radius`
 * - `border-bottom-style`
 * - `border-bottom-width`
 * - `border-color`
 * - `border-end-end-radius`
 * - `border-end-start-radius`
 * - `border-inline`
 * - `border-inline-color`
 * - `border-inline-end`
 * - `border-inline-end-color`
 * - `border-inline-end-style`
 * - `border-inline-end-width`
 * - `border-inline-start`
 * - `border-inline-start-color`
 * - `border-inline-start-style`
 * - `border-inline-start-width`
 * - `border-inline-style`
 * - `border-inline-width`
 * - `border-left`
 * - `border-left-color`
 * - `border-left-style`
 * - `border-left-width`
 * - `border-radius`
 * - `border-right`
 * - `border-right-color`
 * - `border-right-style`
 * - `border-right-width`
 * - `border-start-end-radius`
 * - `border-start-start-radius`
 * - `border-style`
 * - `border-top`
 * - `border-top-color`
 * - `border-top-left-radius`
 * - `border-top-right-radius`
 * - `border-top-style`
 * - `border-top-width`
 * - `border-width`
 * - `corner-shape`
 * - `outline`
 * - `outline-color`
 * - `outline-offset`
 * - `outline-style`
 * - `outline-width`
 */
export const BORDER_ROUTE_CASES: readonly RouteCase[] = [
  { property: "border", value: "2px solid red", alternate: "4px dashed blue" },
  {
    property: "border-block",
    value: "2px solid red",
    alternate: "4px dashed blue",
  },
  {
    property: "border-block-color",
    value: "red blue",
    alternate: "teal navy",
    divergenceNote:
      "A logical axis shorthand is expanded at COMPILE time, by counting the component values the declaration is written with. `var(--pair)` is one component value however many it later resolves to, so the whole list is assigned to the target the one-value arity picks, while the literal route counts two and splits. The count cannot be taken at compile time, and deferring the axis to a runtime resolver trades this for a worse defect: the resolver writes its keys after the flat ones, so a later declaration of the same property loses to a var() written before it (`native/logical-borders.test.tsx`'s cascade test).",
  },
  {
    property: "border-block-end",
    value: "2px solid red",
    alternate: "4px dashed blue",
  },
  { property: "border-block-end-color", value: "red", alternate: "blue" },
  { property: "border-block-end-width", value: "2px", alternate: "4px" },
  {
    property: "border-block-start",
    value: "2px solid red",
    alternate: "4px dashed blue",
  },
  {
    property: "border-block-end-style",
    value: "dashed",
    alternate: "dotted",
  },
  { property: "border-block-start-color", value: "red", alternate: "blue" },
  {
    property: "border-block-start-style",
    value: "dashed",
    alternate: "dotted",
  },
  { property: "border-block-start-width", value: "2px", alternate: "4px" },
  {
    property: "border-block-style",
    value: "solid dashed",
    alternate: "dotted solid",
  },
  {
    property: "border-block-width",
    value: "1px 2px",
    alternate: "3px 4px",
    divergenceNote:
      "A logical axis shorthand is expanded at COMPILE time, by counting the component values the declaration is written with. `var(--pair)` is one component value however many it later resolves to, so the whole list is assigned to the target the one-value arity picks, while the literal route counts two and splits. The count cannot be taken at compile time, and deferring the axis to a runtime resolver trades this for a worse defect: the resolver writes its keys after the flat ones, so a later declaration of the same property loses to a var() written before it (`native/logical-borders.test.tsx`'s cascade test).",
  },
  {
    property: "border-bottom",
    value: "2px solid red",
    alternate: "4px dashed blue",
  },
  { property: "border-bottom-color", value: "red", alternate: "blue" },
  { property: "border-bottom-left-radius", value: "8px", alternate: "16px" },
  { property: "border-bottom-right-radius", value: "8px", alternate: "16px" },
  { property: "border-bottom-style", value: "dashed", alternate: "dotted" },
  { property: "border-bottom-width", value: "2px", alternate: "4px" },
  {
    property: "border-color",
    value: "red green blue teal",
    alternate: "navy olive maroon purple",
  },
  { property: "border-end-end-radius", value: "8px", alternate: "16px" },
  { property: "border-end-start-radius", value: "8px", alternate: "16px" },
  {
    property: "border-inline",
    value: "2px solid red",
    alternate: "4px dashed blue",
  },
  {
    property: "border-inline-color",
    value: "red blue",
    alternate: "teal navy",
    divergenceNote:
      "A logical axis shorthand is expanded at COMPILE time, by counting the component values the declaration is written with. `var(--pair)` is one component value however many it later resolves to, so the whole list is assigned to the target the one-value arity picks, while the literal route counts two and splits. The count cannot be taken at compile time, and deferring the axis to a runtime resolver trades this for a worse defect: the resolver writes its keys after the flat ones, so a later declaration of the same property loses to a var() written before it (`native/logical-borders.test.tsx`'s cascade test).",
  },
  {
    property: "border-inline-end",
    value: "2px solid red",
    alternate: "4px dashed blue",
  },
  { property: "border-inline-end-color", value: "red", alternate: "blue" },
  { property: "border-inline-end-style", value: "dashed", alternate: "dotted" },
  { property: "border-inline-end-width", value: "2px", alternate: "4px" },
  {
    property: "border-inline-start",
    value: "2px solid red",
    alternate: "4px dashed blue",
  },
  { property: "border-inline-start-color", value: "red", alternate: "blue" },
  {
    property: "border-inline-start-style",
    value: "dashed",
    alternate: "dotted",
  },
  { property: "border-inline-start-width", value: "2px", alternate: "4px" },
  {
    property: "border-inline-style",
    value: "solid dashed",
    alternate: "dotted solid",
  },
  {
    property: "border-inline-width",
    value: "1px 2px",
    alternate: "3px 4px",
    divergenceNote:
      "A logical axis shorthand is expanded at COMPILE time, by counting the component values the declaration is written with. `var(--pair)` is one component value however many it later resolves to, so the whole list is assigned to the target the one-value arity picks, while the literal route counts two and splits. The count cannot be taken at compile time, and deferring the axis to a runtime resolver trades this for a worse defect: the resolver writes its keys after the flat ones, so a later declaration of the same property loses to a var() written before it (`native/logical-borders.test.tsx`'s cascade test).",
  },
  {
    property: "border-left",
    value: "2px solid red",
    alternate: "4px dashed blue",
  },
  { property: "border-left-color", value: "red", alternate: "blue" },
  { property: "border-left-style", value: "dashed", alternate: "dotted" },
  { property: "border-left-width", value: "2px", alternate: "4px" },
  {
    property: "border-radius",
    value: "1px 2px 3px 4px",
    alternate: "5px 6px 7px 8px",
  },
  {
    property: "border-right",
    value: "2px solid red",
    alternate: "4px dashed blue",
  },
  { property: "border-right-color", value: "red", alternate: "blue" },
  { property: "border-right-style", value: "dashed", alternate: "dotted" },
  { property: "border-right-width", value: "2px", alternate: "4px" },
  { property: "border-start-end-radius", value: "8px", alternate: "16px" },
  { property: "border-start-start-radius", value: "8px", alternate: "16px" },
  {
    property: "border-style",
    value: "solid dashed dotted solid",
    alternate: "dotted solid dashed dotted",
  },
  {
    property: "border-top",
    value: "2px solid red",
    alternate: "4px dashed blue",
  },
  { property: "border-top-color", value: "red", alternate: "blue" },
  { property: "border-top-left-radius", value: "8px", alternate: "16px" },
  { property: "border-top-right-radius", value: "8px", alternate: "16px" },
  { property: "border-top-style", value: "dashed", alternate: "dotted" },
  { property: "border-top-width", value: "2px", alternate: "4px" },
  {
    property: "border-width",
    value: "1px 2px 3px 4px",
    alternate: "5px 6px 7px 8px",
  },
  { property: "corner-shape", value: "squircle", alternate: "round" },
  { property: "outline", value: "2px solid red", alternate: "4px dashed blue" },
  { property: "outline-color", value: "red", alternate: "blue" },
  { property: "outline-offset", value: "2px", alternate: "4px" },
  { property: "outline-style", value: "dashed", alternate: "dotted" },
  { property: "outline-width", value: "2px", alternate: "4px" },
];
