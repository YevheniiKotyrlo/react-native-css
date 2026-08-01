import type { StyleFunctionResolver } from "./resolve";

/**
 * `transform-origin` on the runtime route.
 *
 * Two kinds of declaration land here rather than in the compiler's
 * `parseTransformOrigin`:
 *
 * 1. **Anything containing a `var()`**, because the value cannot be known
 *    until the variable is resolved.
 * 2. **Every valid three-value form** — `transform-origin: 10px 20px 30px`.
 *    lightningcss parses this property with the `<position>` grammar, and
 *    `Position` carries only `x` and `y`, so a third component fails to parse
 *    and the declaration falls through as `unparsed`.
 *
 * Both used to arrive at React Native as an array whose length was whatever the
 * declaration's token count happened to be, and React Native's
 * `processTransformOrigin` accepts exactly three:
 *
 * ```
 * Invariant Violation: Transform origin must have exactly 3 values.
 * ```
 *
 * That is thrown from `render`, so it unmounts the tree rather than dropping
 * the style. React Native normalises its own STRING form to three values and
 * validates the ARRAY form instead of normalising it, which is why a hand
 * written `transformOrigin: [0, 0]` crashes while `transformOrigin: '0 0'` does
 * not — but a stylesheet has no business relying on either, so this resolver
 * produces the three-value shape unconditionally.
 *
 * It implements `transform-origin`'s OWN grammar, which the `<position>`
 * grammar lightningcss uses for the parsed route is not:
 *
 * ```
 * [ left | center | right | top | bottom | <length-percentage> ]
 * |
 * [ left | center | right | <length-percentage> ]
 * [ top | center | bottom | <length-percentage> ] <length>?
 * |
 * [[ center | left | right ] && [ center | top | bottom ]] <length>?
 * ```
 *
 * The `&&` in the third production is what makes `top left` mean the same as
 * `left top`, so the axis of a keyword decides which slot it fills, not its
 * position.
 */

/** React Native's own defaults, from `processTransformOrigin`'s string branch. */
const DEFAULT_X = "50%";
const DEFAULT_Y = "50%";
const DEFAULT_Z = 0;

/**
 * The five side keywords, as the percentages css-transforms-1 §5.2 defines them
 * to be. `left` and `top` are `"0%"` for the same reason `center` is `"50%"` —
 * the spec states the equivalence, and a keyword has no other meaning.
 *
 * The near sides were the number `0` here, which names the same point. See
 * `asOriginComponent` in `compiler/declarations.ts` for why the percentage is
 * the better spelling, and
 * Both routes converge on the percentage, so a declaration cannot render one
 * way written out and another through a variable.
 */
const HORIZONTAL_KEYWORDS: Record<string, string | number | undefined> = {
  left: "0%",
  center: "50%",
  right: "100%",
};

const VERTICAL_KEYWORDS: Record<string, string | number | undefined> = {
  top: "0%",
  center: "50%",
  bottom: "100%",
};

/** `top` / `bottom` can only ever be the y-component. */
const isVerticalOnly = (value: unknown): boolean =>
  typeof value === "string" &&
  (value.toLowerCase() === "top" || value.toLowerCase() === "bottom");

/** `left` / `right` can only ever be the x-component. */
const isHorizontalOnly = (value: unknown): boolean =>
  typeof value === "string" &&
  (value.toLowerCase() === "left" || value.toLowerCase() === "right");

/**
 * A component is a keyword, a percentage string, or a number of points.
 * Anything else makes the declaration invalid, which CSS says to drop.
 */
function resolveComponent(
  value: unknown,
  keywords: Record<string, string | number | undefined>,
  fallback: string | number,
): string | number | undefined {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return undefined;
    }

    // A zero length is the same point as `0%`, and the percentage is the
    // spelling that renders correctly — the keyword table above carries the
    // reasoning. Applied to the resolved NUMBER rather than only to the
    // keywords so `transform-origin: 0px 0px 30px` and a `var()` resolving to
    // zero reach the same value the keyword form does.
    return value === 0 ? "0%" : value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const keyword = keywords[value.toLowerCase()];
  if (keyword !== undefined) {
    return keyword;
  }

  return value.endsWith("%") && Number.isFinite(Number.parseFloat(value))
    ? value
    : undefined;
}

export function normalizeTransformOrigin(
  components: unknown[],
): [string | number, string | number, number] | undefined {
  if (components.length === 0 || components.length > 3) {
    return;
  }

  // The z-component is a `<length>`. A percentage is invalid there, and React
  // Native rejects anything but a plain number, so the two agree.
  const z = components.length === 3 ? components[2] : DEFAULT_Z;
  if (typeof z !== "number" || !Number.isFinite(z)) {
    return;
  }

  const [first, second] = components;

  // `top left` and `left top` are the same position — a keyword that can only
  // belong to one axis claims that axis wherever it was written.
  const isSwapped =
    components.length >= 2 &&
    (isVerticalOnly(first) || isHorizontalOnly(second));

  // A lone `top` is a y-component; a lone `10px` or `left` is an x-component.
  const singleIsVertical = components.length === 1 && isVerticalOnly(first);

  const rawX = singleIsVertical ? undefined : isSwapped ? second : first;
  const rawY = singleIsVertical ? first : isSwapped ? first : second;

  const x = resolveComponent(rawX, HORIZONTAL_KEYWORDS, DEFAULT_X);
  const y = resolveComponent(rawY, VERTICAL_KEYWORDS, DEFAULT_Y);

  if (x === undefined || y === undefined) {
    return;
  }

  return [x, y, z];
}

export const transformOrigin: StyleFunctionResolver = (resolve, descriptor) => {
  const resolved = resolve(descriptor[2]);

  // A single-component declaration resolves to a scalar rather than a list.
  // `.flat()` because a `var()` holding two components resolves to a nested
  // array, and `transform-origin: var(--position)` is one declaration however
  // many components the variable turns out to hold.
  const components = (Array.isArray(resolved) ? resolved : [resolved])
    .flat()
    .filter((component) => component !== undefined);

  return normalizeTransformOrigin(components);
};
