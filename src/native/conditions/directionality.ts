/**
 * An element's directionality — HTML's `dir`, which `:dir()` matches and descendants inherit
 * (Selectors 4 §7.1). Held beside the `direction` property rather than derived from it, because
 * the property does not affect whether `:dir()` matches. `auto` never reaches the engine: it
 * resolves from text content, which only the component rendering that text can read.
 */
import { I18nManager } from "react-native";

import type { StyleRule } from "react-native-css/compiler";
import { uaSpecificity } from "react-native-css/utilities";

import type { VariableContextValue } from "../reactivity";

export type Directionality = "ltr" | "rtl";

export const DIRECTIONALITY_VARIABLE = "__rn-css-directionality";

/**
 * The directionality of the root — what an element with no declaration above it has.
 *
 * React Native has no document element: the platform's own layout direction is the root's
 * (`I18nManager.isRTL` is what already mirrors every flex row), so an app that declares nothing
 * keeps reading `rtl:` utilities the way it always has, and a `dir` on any element overrides it
 * for that subtree.
 */
export function resolveInitialDirectionality(): Directionality {
  return I18nManager.isRTL ? "rtl" : "ltr";
}

/** The UA stylesheet rule `[dir=…] { direction: … }` (HTML §15.3.5); `writingDirection` is its text-side twin. */
const UA_DIRECTION_RULES: Record<Directionality, StyleRule> = {
  ltr: { s: uaSpecificity, d: [{ direction: "ltr", writingDirection: "ltr" }] },
  rtl: { s: uaSpecificity, d: [{ direction: "rtl", writingDirection: "rtl" }] },
};

export function resolveDeclaredDirectionality(
  value: unknown,
): Directionality | undefined {
  return value === "ltr" || value === "rtl" ? value : undefined;
}

/**
 * What an element inherits, which is only consulted when it declares nothing itself.
 *
 * Separate from the declared half so a caller that has already resolved `props.dir` — every caller
 * does, to decide whether to publish and take the UA rule — spends one resolve rather than two.
 */
export function resolveInheritedDirectionality(
  inheritedVariables: VariableContextValue,
): Directionality | undefined {
  return resolveDeclaredDirectionality(
    inheritedVariables[DIRECTIONALITY_VARIABLE],
  );
}

export function resolveUaDirectionRule(
  directionality: Directionality,
): StyleRule {
  return UA_DIRECTION_RULES[directionality];
}
