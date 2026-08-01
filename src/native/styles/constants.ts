import type { StyleDescriptor } from "react-native-css/compiler";

export const emVariableName = "__rn-css-em";
export const ShortHandSymbol = Symbol();

/**
 * `currentcolor` — the element's own `color`, which the compiler publishes as a
 * variable so every position that defaults to it reads one value.
 *
 * It is the initial value of `border-color`, `outline-color` and
 * `text-decoration-color`, so a shorthand that names no colour writes this
 * rather than a literal, and both routes reach the same colour.
 */
export const CURRENT_COLOR: StyleDescriptor = [{}, "var", "__rn-css-color"];
