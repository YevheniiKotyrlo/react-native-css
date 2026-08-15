import type { Getter } from "../reactivity";
import { resolveDimension } from "./dimension";
import type {
  ResolveValueOptions,
  SimpleResolveValue,
  StyleFunctionResolver,
} from "./resolve";
import { lookupVariable } from "./variables";

/**
 * `font-size` when the declaration still holds a `var()` at runtime.
 *
 * The twin of `./line-height.ts`, and it exists for the same reason: CSS gives
 * a `<percentage>` here a meaning only the consuming property knows, and the
 * value arrives having lost the evidence. `parseFontSize`
 * (`compiler/declarations.ts`) reads `200%` as the `em` multiplier it is
 * because lightningcss hands it a TYPED value; a custom property's value is an
 * uninterpreted token stream, so `--p: 200%` reaches the runtime as the string
 * `"200%"` — which is the FAITHFUL storage, since `:root { --p: 200% }` may be
 * read by `width`, where that string is exactly right, and by `font-size` in
 * the same stylesheet. Nothing can be decided at store time; it is decided
 * here.
 *
 * `resolveDimension` reads the KIND off the descriptor before it is flattened,
 * so this makes the same split `parseFontSize` makes, and the written-out and
 * stored spellings of one declaration land on one number.
 *
 * The difference from `lineHeight` is the base. A unitless `line-height`
 * multiplies the element's OWN font size; a percentage `font-size` multiplies
 * the PARENT's (css-fonts-4 §3.5). Reading the element's own would also be
 * circular — the size being computed is what this rule publishes as
 * `--__rn-css-em` — so the parent's is both the correct base and the only one
 * that terminates.
 */
export const fontSize: StyleFunctionResolver = (
  resolve,
  func,
  get,
  options,
) => {
  const dimension = resolveDimension(func[2], resolve, get, options);

  if (dimension.value === undefined) {
    return;
  }

  switch (dimension.kind) {
    case "length":
      // Already an absolute number of pixels: `2rem`, `1.5em` and `10vw`
      // resolved against their own base on the way here.
      return round(dimension.value);
    case "percentage": {
      const parentEm = resolveParentEm(resolve, get, options);

      return parentEm === undefined
        ? undefined
        : round((dimension.value / 100) * parentEm);
    }
    case "number":
      // A unitless number is not a `font-size` in CSS, but it is what a
      // variable holding a bare `16` resolves to, and React Native reads it as
      // the size the author plainly meant. Dropping it would make
      // `--size: 16` the one spelling that does nothing.
      return round(dimension.value);
    case "unknown":
      return;
    default:
      dimension.kind satisfies never;
      return;
  }
};

/**
 * The font size a percentage measures against: the PARENT's.
 *
 * Looked up with the element's OWN declarations excluded, which is the whole
 * point — `--__rn-css-em` on this rule is the size being computed, so consulting
 * it would multiply the percentage by its own result. `lookupVariable` walks
 * inherited, then universal, then root, and pushes the render guard that makes
 * this element recompute when an ancestor's size changes; only the first source
 * in its cascade is skipped.
 *
 * An element with no ancestor size falls back to the root rem, which is the
 * base a percentage is measured against at the top of the tree.
 */
function resolveParentEm(
  resolve: SimpleResolveValue,
  get: Getter,
  options: ResolveValueOptions,
): number | undefined {
  const inherited = lookupVariable(resolve, "__rn-css-em", get, {
    ...options,
    inlineVariables: undefined,
  });

  if (inherited.kind === "declared" && typeof inherited.value === "number") {
    return inherited.value;
  }

  const rem = resolve([{}, "var", ["__rn-css-rem"]]);

  return typeof rem === "number" ? rem : undefined;
}

function round(number: number) {
  return Math.round((number + Number.EPSILON) * 100) / 100;
}
