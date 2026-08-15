import type { SupportsCondition } from "lightningcss";

import { parseDeclaration } from "./declarations";
import { lightningcssLoader } from "./lightningcss-loader";
import { getClassNameSelectors } from "./selector-builder";
import { StylesheetBuilder } from "./stylesheet";

/**
 * `@supports` asks one question: can the engine reading this stylesheet render
 * the declaration? For this library the answer is decided by the same parser
 * that compiles every other declaration, so it is answered by COMPILING the
 * declaration and seeing whether anything came out.
 *
 * The feature table this replaced held exactly one entry — a `color-mix` string
 * Tailwind emits — so every real query was answered `false`. That is worse than
 * it sounds, in two directions at once:
 *
 * ```
 * @supports (display: flex)     { … }   the block deleted itself
 * @supports not (display: grid) { … }   inverted to admit precisely what it
 *                                       was written to exclude
 * ```
 *
 * A false negative silently drops correct styling; a false positive through
 * `not` ships styling written for engines that do NOT have the feature.
 */

/**
 * The answer depends only on the library's parser table, never on the options a
 * given compile was invoked with: `inlineRem` and friends change the VALUE a
 * declaration resolves to, not whether a parser accepts it. So one cache spans
 * every compile in the process.
 */
const supportCache = new Map<string, boolean>();
const selectorSupportCache = new Map<string, boolean>();

/**
 * Compile `property: value` on its own and report whether it produced anything.
 *
 * A declaration counts as supported when it lands at least one descriptor AND
 * raises no warning. Both halves are load-bearing: a parser that refuses a
 * value warns and emits nothing, while a property with no parser at all warns
 * without ever being reached.
 */
function declarationCompiles(property: string, value: string): boolean {
  const key = `${property}|${value}`;
  const cached = supportCache.get(key);

  if (cached !== undefined) {
    return cached;
  }

  let supported: boolean;

  try {
    const { lightningcss } = lightningcssLoader();
    const builder = new StylesheetBuilder({});

    lightningcss({
      code: new TextEncoder().encode(`.s{${property}:${value}}`),
      filename: "supports.css",
      visitor: {
        Declaration(declaration) {
          builder.setWarningProperty(property);
          parseDeclaration(declaration, builder);
          return declaration;
        },
      },
    });

    supported =
      builder.hasDeclarations() &&
      Object.keys(builder.getWarnings()).length === 0;
  } catch {
    // lightningcss could not parse the declaration at all, which is the
    // clearest possible "not supported" — a stylesheet cannot rely on a
    // declaration this engine cannot even read.
    supported = false;
  }

  supportCache.set(key, supported);
  return supported;
}

/**
 * Parse `<selector> { color: red }` on its own and report whether this
 * library's selector compiler produced anything for it.
 *
 * `@supports selector(…)` asks whether the engine RECOGNISES the selector, so
 * it is answered by the code path that decides what a selector compiles to —
 * deliberately not by whether the probe rule would end up registered. `:hover`
 * names no class, so it can never be a rule set's key, but the library does
 * support `:hover` and a block guarded on it has to be admitted.
 *
 * A selector lightningcss cannot parse at all throws, which is the clearest
 * possible "not supported".
 */
function selectorCompiles(selector: string): boolean {
  const cached = selectorSupportCache.get(selector);

  if (cached !== undefined) {
    return cached;
  }

  let supported = false;

  try {
    const { lightningcss } = lightningcssLoader();

    lightningcss({
      code: new TextEncoder().encode(`${selector}{color:red}`),
      filename: "supports.css",
      visitor: {
        Rule(rule) {
          if (rule.type === "style") {
            supported = getClassNameSelectors(rule.value.selectors).length > 0;
          }
          return rule;
        },
      },
    });
  } catch {
    supported = false;
  }

  selectorSupportCache.set(selector, supported);
  return supported;
}

export function supportsConditionValid(condition: SupportsCondition): boolean {
  switch (condition.type) {
    case "and":
      return condition.value.every((child) => supportsConditionValid(child));
    case "or":
      return condition.value.some((child) => supportsConditionValid(child));
    case "not":
      return !supportsConditionValid(condition.value);
    case "declaration":
      // lightningcss types this as the boxed `String`, which is a string.
      return declarationCompiles(
        condition.propertyId.property,
        condition.value,
      );
    case "selector":
      // lightningcss types this as the boxed `String`, which is a string.
      return selectorCompiles(condition.value);
    case "unknown":
      return false;
    default:
      condition satisfies never;
      return false;
  }
}
