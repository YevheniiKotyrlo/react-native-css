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

export const specificityCompareFn = (
  a: StyleRule | InlineStyleRecord,
  b: StyleRule | InlineStyleRecord,
) => {
  const aSpec = a.s ? a.s : inlineSpecificity;
  const bSpec = b.s ? b.s : inlineSpecificity;

  if (aSpec[Important] !== bSpec[Important]) {
    return (aSpec[Important] || 0) - (bSpec[Important] || 0);
  } else if (aSpec[Inline] !== bSpec[Inline]) {
    return (aSpec[Inline] || 0) - (bSpec[Inline] || 0);
  } else if (aSpec[Layer] !== bSpec[Layer]) {
    // Above every specificity slot below it: CSS Cascade 5 §6.4.4 puts layer
    // order ahead of specificity, so an unlayered `.x` beats a layered `.x.y`.
    return (aSpec[Layer] || 0) - (bSpec[Layer] || 0);
  } else if (aSpec[Id] !== bSpec[Id]) {
    // An id outranks any number of classes, so it cannot share the class slot.
    // Every rule without one leaves this slot empty, so the comparison falls
    // straight through for them.
    return (aSpec[Id] || 0) - (bSpec[Id] || 0);
  } else if (aSpec[PseudoElements] !== bSpec[PseudoElements]) {
    return (aSpec[PseudoElements] || 0) - (bSpec[PseudoElements] || 0);
  } else if (aSpec[ClassName] !== bSpec[ClassName]) {
    return (aSpec[ClassName] || 0) - (bSpec[ClassName] || 0);
  } else if (aSpec[Order] !== bSpec[Order]) {
    return (aSpec[Order] || 0) - (bSpec[Order] || 0);
  } else {
    return 0;
  }
};
