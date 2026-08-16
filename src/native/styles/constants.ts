import type { StyleDescriptor } from "react-native-css/compiler";
import { INHERITED_COLOR_VARIABLE } from "react-native-css/utilities";

export const emVariableName = "__rn-css-em";
export const ShortHandSymbol = Symbol();

/**
 * `currentcolor` — the element's own `color`, which the compiler publishes as
 * an inherited property so every position that defaults to it reads one value.
 *
 * It is the initial value of `border-color`, `outline-color` and
 * `text-decoration-color`, so a shorthand that names no colour writes this
 * rather than a literal, and both routes reach the same colour.
 *
 * A CASCADING read, deliberately: on a property that is not `color`, the
 * keyword is the element's OWN computed colour (css-color-4 §6.2), so
 * `.x { color: blue; border-color: currentcolor }` must give a blue border even
 * though the ancestor's colour is red. The element's own `color` declaration
 * publishes into this same channel, so the cascade answers with it. `color`
 * itself is the one property where the keyword means `inherit` instead, and the
 * compiler re-points that read rather than this constant.
 */
export const CURRENT_COLOR: StyleDescriptor = [
  {},
  "var",
  INHERITED_COLOR_VARIABLE,
];
