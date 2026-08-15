/* eslint-disable */
import type {
  InlineVariable,
  StyleDeclaration,
  StyleRule,
} from "react-native-css/compiler";
import { Specificity as S } from "react-native-css/utilities";

import type { RenderGuard } from "../conditions/guards";
import { applyValue, getDeepPath } from "../objects";
import {
  VAR_SYMBOL,
  type Getter,
  type VariableContextValue,
} from "../reactivity";
import { transformKeys } from "./defaults";
import { resolveValue } from "./resolve";
import type { ResolvedVariable } from "./variables";

export function calculateProps(
  get: Getter,
  rules: (StyleRule | InlineVariable | VariableContextValue)[],
  guards: RenderGuard[] = [],
  inheritedVariables: VariableContextValue = {
    [VAR_SYMBOL]: true,
  },
  inlineVariables: InlineVariable = {
    [VAR_SYMBOL]: "inline",
  },
) {
  let normal: Record<string, any> | undefined;
  let important: Record<string, any> | undefined;

  const delayedStyles: (() => void)[] = [];
  const transformStyles: DeferredTransform[] = [];

  // One `var()` memo for the whole element, matching the scope of
  // `inlineVariables` beside it. `varResolver` used to memoise INTO
  // `inlineVariables`, which meant the memo overwrote the declarations.
  const resolvedVariables: Record<string, ResolvedVariable> = {};

  for (const rule of rules) {
    if (VAR_SYMBOL in rule) {
      if (typeof rule[VAR_SYMBOL] === "string") {
        Object.assign(inlineVariables, rule);
      } else {
        Object.assign(inheritedVariables, rule);
      }
      continue;
    }

    if (rule.v) {
      for (const variable of rule.v) {
        inlineVariables[variable[0]] = variable[1];
      }
    }

    if (rule.d) {
      let topLevelTarget = rule.s?.[S.Important]
        ? (important ??= {})
        : (normal ??= {});
      let target = topLevelTarget;

      const ruleTarget = rule.target || "style";

      if (typeof ruleTarget === "string") {
        target = target[ruleTarget] ??= {};
      } else if (ruleTarget) {
        for (const path of ruleTarget) {
          target = target[path] ??= {};
        }
      }

      applyDeclarations(
        get,
        rule.d,
        inlineVariables,
        inheritedVariables,
        delayedStyles,
        transformStyles,
        guards,
        target,
        topLevelTarget,
        resolvedVariables,
      );
    }
  }

  for (const delayedStyle of delayedStyles) {
    delayedStyle();
  }

  for (const transformStyle of orderTransforms(transformStyles)) {
    transformStyle.apply();
  }

  return {
    normal,
    guards,
    important,
  };
}

/**
 * One individual transform property waiting to be written into the element's
 * `transform` array.
 *
 * They are held rather than applied in place because a transform key's value
 * can need another declaration's result — and because the ORDER they are
 * written in is not the order they were declared in.
 */
interface DeferredTransform {
  /** css-transforms-2 §3.1's composition order — see `transformCompositionRank`. */
  readonly rank: number;
  /**
   * Where this one sat among the declarations, which decides ties.
   *
   * Declaration order IS cascade order by the time it reaches here — the rules
   * arrive sorted by specificity — so two declarations of the same property
   * must stay in it, or the losing one would win.
   */
  readonly sequence: number;
  readonly apply: () => void;
}

/**
 * css-transforms-2 §3.1: an element's transform is `translate`, then `rotate`,
 * then `scale`, then the `transform` property — whatever order the declarations
 * were written in, and whichever rules they came from.
 *
 * Derived from the property's NAME rather than listed, so it covers every
 * member of `transformKeys` and cannot fall out of step when one is added:
 * `translateX` composes with `translate` because it is the same operation on one
 * axis.
 *
 * The functions React Native accepts that CSS has no individual property for —
 * `skewX`, `matrix`, `perspective` — rank last and keep their declaration order
 * among themselves. They can only be written through the `transform` property,
 * which is itself applied last.
 */
function transformCompositionRank(prop: string | number): number {
  const name = String(prop);

  if (name.startsWith("translate")) {
    return 0;
  }

  if (name.startsWith("rotate")) {
    return 1;
  }

  if (name.startsWith("scale")) {
    return 2;
  }

  return 3;
}

/**
 * Sorted by composition rank, ties broken by declaration order.
 *
 * The tie-break is explicit rather than left to `Array.prototype.sort`'s
 * stability, because the cascade depends on it and the engines this runs on are
 * not one implementation.
 */
function orderTransforms(transforms: DeferredTransform[]): DeferredTransform[] {
  return [...transforms].sort(
    (left, right) =>
      left.rank - right.rank || left.sequence - right.sequence,
  );
}

export function applyDeclarations(
  get: Getter,
  declarations: StyleDeclaration[],
  inlineVariables: InlineVariable,
  inheritedVariables: VariableContextValue,
  delayedStyles: (() => void)[] = [],
  transformStyles: DeferredTransform[] = [],
  guards: RenderGuard[] = [],
  target: Record<string, any> = {},
  topLevelTarget = target,
  resolvedVariables: Record<string, ResolvedVariable> = {},
) {
  const originalTarget = target;

  /**
   * The placeholder a `transform` declaration parked, if a transform-key
   * declaration later took `target.transform` over to park its own.
   */
  let displacedTransform: unknown;

  for (const declaration of declarations) {
    target = originalTarget;

    if (!Array.isArray(declaration)) {
      // Static styles
      Object.assign(target, declaration);
    } else {
      // Dynamic styles
      let value: any = declaration[0];
      let propPath = declaration[1];
      let prop: string | number;

      if (Array.isArray(propPath)) {
        const [first, ...rest] = propPath;

        if (!first) {
          continue;
        }

        const final = rest.pop();

        if (final) {
          if (first !== "&") {
            topLevelTarget[first] ??= {};
            target = topLevelTarget[first];
          }

          let previousProp: string | number = first;
          let previousTarget = topLevelTarget;

          for (prop of rest) {
            if (prop.startsWith("[") && prop.endsWith("]")) {
              prop = Number(prop.slice(1, -1));

              if (!Array.isArray(previousTarget[previousProp])) {
                previousTarget[previousProp] = [];
                target = previousTarget[previousProp];
              }
            }
            previousTarget = target;
            previousProp = prop;

            target[prop] ??= {};
            target = target[prop];
          }

          prop = final;
        } else {
          target = topLevelTarget;
          prop = first;
        }
      } else {
        prop = propPath;
      }

      const shouldDelay = declaration[2];

      /**
       * The object THIS declaration writes to.
       *
       * `target` is one binding shared by every iteration: it is reset to
       * `originalTarget` at the top of the loop and an array `propPath` moves
       * it elsewhere — to `topLevelTarget` for a mapped PROP, or to a nested
       * object for a deep path. A deferred callback runs after the whole loop,
       * so reading `target` from inside one reads whatever the LAST declaration
       * left behind rather than the object this declaration resolved. Both
       * halves of the swap then land on the wrong object: the read-back fails
       * to recognise the placeholder, so the resolved value is never written
       * and the placeholder ships as the value.
       *
       * Without it, `-webkit-line-clamp: var(--n); color: var(--c)` delivers
       * `numberOfLines: {numberOfLines: true}`, and the same two declarations
       * in the opposite order deliver `style.color: {color: true}` — the fault
       * is the shared binding, not the prop side of it.
       */
      const declarationTarget = target;

      if (shouldDelay || transformKeys.has(prop)) {
        /**
         * We need to delay the resolution of this value until after all
         * styles have been calculated. But another style might override
         * this value. So we set a placeholder value and only override
         * if the placeholder is preserved
         *
         * This also ensures the props exist, so setValue will properly
         * mutate the props object and not create a new one
         */
        const originalValue = value;
        // This needs to be a object with the [prop] so we can discover in transform arrays
        value = { [prop]: true };

        if (transformKeys.has(prop)) {
          const placeholder = value;

          transformStyles.push({
            rank: transformCompositionRank(prop),
            sequence: transformStyles.length,
            apply: () => {
              value = resolveValue(originalValue, get, {
                inlineVariables,
                inheritedVariables,
                renderGuards: guards,
                resolvedVariables,
                calculateProps,
              });

              if (value === undefined) {
                // `applyValue` reads `undefined` as "set nothing", which is
                // right for a value that was never placed and wrong for one
                // that was: the placeholder is already IN the transform array,
                // so a resolution that fails leaves the sentinel behind as the
                // style. `translate: var(--pv)` shipped
                // `transform: [{translate: true}]`.
                //
                // Removed by IDENTITY, so this only ever drops the sentinel this
                // declaration parked — never a value another rule set for the
                // same transform key in between.
                removeTransform(declarationTarget, placeholder);
                return;
              }

              applyValue(declarationTarget, prop, value);
            },
          });

          // A `transform` declaration that is ITSELF awaiting resolution holds
          // `target.transform` as its own placeholder OBJECT. Parking a
          // transform-key placeholder replaces it with a fresh ARRAY to hold
          // that one — so the `transform` declaration's read-back below finds
          // something it does not recognise, treats itself as overridden, and
          // drops. `transform: var(--t); translate: var(--o)` rendered the
          // translate alone.
          //
          // Recording what was displaced is what lets that read-back tell being
          // DISPLACED (the two properties compose, and `transformStyles` run
          // after `delayedStyles` so the transform keys are re-applied on top)
          // from being OVERRIDDEN by a later declaration of the same property.
          if (
            declarationTarget["transform"] !== undefined &&
            !Array.isArray(declarationTarget["transform"])
          ) {
            displacedTransform = declarationTarget["transform"];
          }
        } else {
          delayedStyles.push(() => {
            // The second arm is the DISPLACED case above. It is guarded on
            // `displacedTransform` being set, because `value` is reassigned to
            // the resolution result by the body below — so once that result is
            // `undefined`, an unguarded comparison would match the unset
            // `displacedTransform` and re-run for every property.
            if (
              getDeepPath(declarationTarget, prop) === value ||
              (displacedTransform !== undefined && value === displacedTransform)
            ) {
              delete declarationTarget[prop];
              value = resolveValue(originalValue, get, {
                inlineVariables,
                inheritedVariables,
                renderGuards: guards,
                resolvedVariables,
                calculateProps,
              });
              applyValue(declarationTarget, prop, value);
            }
          });
        }
      } else {
        value = resolveValue(value, get, {
          inlineVariables,
          inheritedVariables,
          renderGuards: guards,
          resolvedVariables,
          calculateProps,
        });
      }

      applyValue(declarationTarget, prop, value);
    }
  }
}

/** Drop one entry from a target's `transform` array, matched by identity. */
function removeTransform(target: Record<string, any>, entry: unknown) {
  if (Array.isArray(target.transform)) {
    target.transform = target.transform.filter((value) => value !== entry);
  }
}
