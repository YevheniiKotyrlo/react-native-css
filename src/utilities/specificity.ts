/* eslint-disable */
import type { SpecificityArray, StyleRule } from "../compiler";
import type { InlineStyleRecord } from "../runtime.types";

export const Specificity = {
  Order: 0,
  ClassName: 1,
  Important: 2,
  Inline: 3,
  PseudoElements: 4,
  Id: 5,
  /**
   * The cascade layer the rule was declared in — CSS Cascade Level 5 §6.4.4.
   *
   * `0` is UNLAYERED, which outranks every layer; a rule inside `@layer` gets a
   * NEGATIVE rank, more negative the lower its layer sits. So a rule that
   * predates layers, or that was never in one, leaves the slot empty and keeps
   * its meaning unchanged.
   *
   * Ranked above every specificity slot because layer order beats specificity:
   * an unlayered `.x` wins over a layered `.x.y`. The compiler assigns the rank
   * in `StylesheetBuilder.addDescriptor`.
   */
  Layer: 6,
  PseudoClass: 1,
  // StyleSheet: 0, - We don't support multiple stylesheets
};

const Important = Specificity.Important;
const Inline = Specificity.Inline;
const Layer = Specificity.Layer;
const Id = Specificity.Id;
const PseudoElements = Specificity.PseudoElements;
const ClassName = Specificity.ClassName;
const Order = Specificity.Order;

export const inlineSpecificity: SpecificityArray = [];
inlineSpecificity[Specificity.Inline] = 1;

/**
 * What a slot is worth. An unset slot is worth nothing, however it is spelled.
 *
 * A specificity array is SPARSE: a rule that sets `PseudoElements` never writes
 * `Important` or `Inline`, so those sit as holes inside the array's length. A
 * hole reads as `undefined` in memory, and the sheet reaches a native runtime
 * through `JSON.stringify` (`metro/injection-code.ts`), which has no holes and
 * writes each one as `null`. Both mean "unset", so both must rank the same.
 *
 * Comparing the RAW slots therefore found a difference between two rules that
 * both left a slot empty and returned the `0` that difference computes to,
 * settling on the first such slot and never reaching the one that decides. On a
 * device that made an unlayered rule tie with a layered one instead of
 * outranking it; in the tests, which inject the compiler's own object, both
 * sides were `undefined` and the bug was invisible.
 */
const rank = (spec: SpecificityArray, slot: number): number => spec[slot] || 0;

export const specificityCompareFn = (
  a: StyleRule | InlineStyleRecord,
  b: StyleRule | InlineStyleRecord,
) => {
  const aSpec = a.s ? a.s : inlineSpecificity;
  const bSpec = b.s ? b.s : inlineSpecificity;

  // Compare the RANKED value, never the raw slot. Branching on the raw slot
  // while returning a normalised difference is what let `undefined !== null`
  // enter a branch and answer `0 - 0`.
  for (const slot of [
    Important,
    Inline,
    // Above every specificity slot below it: CSS Cascade 5 §6.4.4 puts layer
    // order ahead of specificity, so an unlayered `.x` beats a layered `.x.y`.
    Layer,
    // An id outranks any number of classes, so it cannot share the class slot.
    // Every rule without one leaves this slot empty, so the comparison falls
    // straight through for them.
    Id,
    PseudoElements,
    ClassName,
    Order,
  ]) {
    const difference = rank(aSpec, slot) - rank(bSpec, slot);

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
};
