import type { StyleDescriptor } from "react-native-css/compiler";
import { isStyleDescriptorArray } from "react-native-css/utilities";

import { ShortHandSymbol } from "../constants";
import type { SimpleResolveValue, StyleResolver } from "../resolve";

/**
 * `Array.isArray` widens an `unknown` to `any[]`, which loses every guarantee
 * the resolved value had. This narrows to the array of unknowns it actually is.
 */
function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * The resolved argument list of a shorthand that was deferred to runtime.
 *
 * A deferred declaration arrives as the style function the compiler wrapped it
 * in — `[{}, "margin", <arguments>, 1]` — so the arguments are the third slot.
 * A shorthand given a single value has no list at all, and is read as a
 * one-value list so the CSS repeat rules below apply to it unchanged.
 */
export function resolveShorthandArguments(
  resolve: SimpleResolveValue,
  value: StyleDescriptor,
): unknown[] | undefined {
  const resolved = isStyleDescriptorArray(value)
    ? resolve(value)
    : Array.isArray(value)
      ? resolve(value[2])
      : value;

  if (resolved === undefined || resolved === null) {
    return undefined;
  }

  return isUnknownArray(resolved) ? resolved.flat() : [resolved];
}

/**
 * A style object carrying the marker that tells `applyValue` to spread these
 * longhands over the element's style rather than write them under one key.
 */
export function shorthandObject(
  longhands: readonly (readonly [string, unknown])[],
): Record<string | symbol, unknown> {
  const target: Record<string | symbol, unknown> = { [ShortHandSymbol]: true };

  for (const [property, value] of longhands) {
    target[property] = value;
  }

  return target;
}

/**
 * One position in a repeat shorthand's value list, named by the React Native
 * longhand it writes. `undefined` is a position CSS defines and React Native
 * has no key for — `place-items`' inline axis, `overflow`'s second value — so
 * the value is accepted by the grammar and then discarded, which is what the
 * compile-time parsers do with it.
 */
type RepeatPosition = string | undefined;

interface RepeatShorthand {
  /**
   * The React Native longhands, in this shorthand's CSS value order.
   *
   * Distinct: every position writes a key of its own, so the values a
   * declaration gives them cannot contradict one another.
   */
  readonly positions: readonly RepeatPosition[];
  /**
   * The React Native key every position collapses onto when they all agree, if
   * one exists. `margin: 10px` is `{ margin: 10 }`, never four equal longhands,
   * because that is what `StylesheetBuilder.addShorthand` emits for it.
   */
  readonly collapseTo?: string;
  /**
   * Whether `auto` is in this property's CSS grammar. It is for `margin`, and
   * is not for `padding` or `inset` — the compile-time parsers refuse it per
   * property (`parseSize`'s `allowAuto`), so the deferred route refuses it on
   * the same terms rather than writing a value the literal route would not.
   */
  readonly allowAuto?: boolean;
  /**
   * The values React Native can render for this property, for a property whose
   * CSS keyword set is wider than React Native's.
   *
   * A position whose value is outside it is dropped rather than written, which
   * is what the compile-time parser does with the same value — it warns and
   * emits nothing for that edge. Omitted where every value CSS allows is one
   * React Native takes, which is every other shorthand here.
   */
  readonly renders?: ReadonlySet<string>;
}

/**
 * css-box-3 §4's 1-to-4 value repeat, as the argument index each position
 * reads. A shorthand with fewer positions truncates the row, which is the same
 * rule for a two-value axis pair: one value fills both, two fill one each.
 */
const REPEAT_BY_VALUE_COUNT: readonly (readonly number[])[] = [
  [],
  [0, 0, 0, 0],
  [0, 1, 0, 1],
  [0, 1, 2, 1],
  [0, 1, 2, 3],
];

/**
 * Expands a shorthand whose values repeat over an ordered list of longhands —
 * every box-model shorthand, plus the two-axis pairs (`gap`, `place-content`).
 *
 * The literal route reaches the same longhands through the per-property parsers
 * in `src/compiler/declarations.ts`; this is the same expansion for the values
 * that only exist once a `var()` has been read.
 */
export function repeatShorthandHandler({
  positions,
  collapseTo,
  allowAuto = false,
  renders,
}: RepeatShorthand): StyleResolver {
  return (resolve, value) => {
    const resolved = resolveShorthandArguments(resolve, value);

    if (resolved === undefined) {
      return undefined;
    }

    // A `/` separates `border-radius`' horizontal radii from its vertical ones.
    // React Native has one radius per corner, so the values after it describe
    // an ellipse it cannot draw — the compile-time parser keeps the horizontal
    // half and this keeps the same half.
    const slash = resolved.indexOf("/");
    const values = slash === -1 ? resolved : resolved.slice(0, slash);

    const repeat = REPEAT_BY_VALUE_COUNT[values.length];

    // More values than the shorthand has positions is not this shorthand's
    // grammar — `margin-inline: 1px 2px 3px` names no third edge.
    if (repeat === undefined || values.length > positions.length) {
      return undefined;
    }

    const longhands: [string, unknown][] = [];
    let everyPositionWritten = true;

    for (const [index, property] of positions.entries()) {
      if (property === undefined) {
        continue;
      }

      const argument = repeat[index];
      const positionValue =
        argument === undefined ? undefined : values[argument];

      if (
        positionValue === undefined ||
        (!allowAuto && positionValue === "auto") ||
        (renders !== undefined &&
          (typeof positionValue !== "string" || !renders.has(positionValue)))
      ) {
        everyPositionWritten = false;
        continue;
      }

      longhands.push([property, positionValue]);
    }

    const first = longhands[0];

    if (first === undefined) {
      return undefined;
    }

    // Collapsing a partial expansion would claim the positions that dropped out
    // agree with the ones that did not: `inset: auto 10px` writes `left` and
    // `right` alone, and `{ inset: 10 }` would place all four sides.
    if (
      collapseTo !== undefined &&
      everyPositionWritten &&
      longhands.every(([, positionValue]) => positionValue === first[1])
    ) {
      return shorthandObject([[collapseTo, first[1]]]);
    }

    return shorthandObject(longhands);
  };
}
