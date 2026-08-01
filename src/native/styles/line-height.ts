import { resolveDimension } from "./dimension";
import type { SimpleResolveValue, StyleFunctionResolver } from "./resolve";

/**
 * `line-height` when the declaration still holds a `var()` at runtime.
 *
 * The compile-time twin is `parseLineHeight` (`compiler/declarations.ts`), and
 * the two make the same decision from different evidence. CSS gives a bare
 * `<number>` here a different meaning from a `<length>` — `1.5` is one and a
 * half font sizes, `22px` is twenty-two pixels — and `parseLineHeight` can tell
 * them apart because lightningcss hands it a TYPED value.
 *
 * This resolver used to ask the same question of the RESOLVED value, which is
 * the one thing that cannot answer it: by the time `var(--x)` has become `22`,
 * the `px` is gone and it is indistinguishable from the multiplier `1.375`. So
 * every length arriving through a variable was multiplied by the font size a
 * second time — `line-height: var(--leading)` with `--leading: 22px` rendered
 * 374 at a 17px font size.
 *
 * `resolveDimension` reads the KIND off the descriptor before it is flattened,
 * so the decision is made from the same information the compiler had, and the
 * two routes agree.
 */
export const lineHeight: StyleFunctionResolver = (
  resolve,
  func,
  get,
  options,
) => {
  const dimension = resolveDimension(func[2], resolve, get, options);

  if (dimension.value === undefined) {
    return;
  }

  if (dimension.kind === "length") {
    // Already an absolute number of pixels. `2rem`, `1.5em` and `10vw` resolved
    // against their own base on the way here; multiplying again would apply the
    // font size twice.
    return round(dimension.value);
  }

  const emValue = resolveEm(resolve);

  if (emValue === undefined) {
    return;
  }

  // css-inline-3 §2.2: a percentage line-height is that percentage OF the font
  // size, which is expressible in React Native. It used to reach the numeric
  // guard as the string `"150%"` and be dropped with no warning — quieter than
  // the literal route, which at least reports itself.
  return round(
    dimension.kind === "percentage"
      ? (dimension.value / 100) * emValue
      : dimension.value * emValue,
  );
};

/**
 * The font size a ratio multiplies: the element's own, published as
 * `--__rn-css-em` by whichever declaration set it, falling back to the root rem
 * for an element that declares no size of its own.
 */
function resolveEm(resolve: SimpleResolveValue): number | undefined {
  const em = resolve([{}, "var", ["__rn-css-em"]]);

  if (typeof em === "number") {
    return em;
  }

  const rem = resolve([{}, "var", ["__rn-css-rem"]]);

  return typeof rem === "number" ? rem : undefined;
}

function round(number: number) {
  return Math.round((number + Number.EPSILON) * 100) / 100;
}
