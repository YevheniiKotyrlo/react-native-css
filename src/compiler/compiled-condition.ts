import type { MediaCondition } from "./compiler.types";

/**
 * The result of compiling a conditional group rule's condition — the prelude
 * of an `@media` or `@container` block.
 *
 * The three states exist because two of them are otherwise indistinguishable,
 * and confusing them inverts the rule. "There is no condition to check"
 * (`@media all`) and "the condition could not be compiled" (`@container
 * style(...)`, a feature value this compiler cannot resolve) both yield no
 * `MediaCondition`, but the first means the block always applies and the
 * second means it can never be shown to apply. Treating the second as the
 * first emits the block's declarations with no condition at all, so they apply
 * to every element carrying the class — the opposite of what the author wrote,
 * and worse than dropping the block.
 */
export type CompiledCondition =
  | { type: "always" }
  | { type: "never" }
  | { type: "condition"; condition: MediaCondition };

/**
 * A container query's prelude is always a condition, so unlike `@media` it has
 * no "always" state. Derived rather than restated, so a new state has to be
 * ruled out here deliberately.
 */
export type CompiledContainerCondition = Exclude<
  CompiledCondition,
  { type: "always" }
>;

/**
 * Whether a compiled condition can ever be shown to be TRUE.
 *
 * `["?"]` is a condition this compiler could not represent, and the runtime
 * evaluates it as UNKNOWN rather than as false — which is what keeps
 * `not (unrepresentable)` from becoming a query that always matches. Unknown
 * never satisfies a rule, so a whole block guarded by one can be dropped
 * instead of shipped and never matched. Every operator below is the same
 * three-valued question the runtime asks, read backwards: an AND is settled by
 * one arm that cannot be true, an OR needs one arm that can be, and a NOT of
 * unknown is unknown rather than true.
 *
 * Only a condition that is unrepresentable at its ROOT can drop a block. A
 * nested one is carried through to the runtime, where it still has to be
 * weighed against the arms beside it.
 */
export function neverMatches(condition: MediaCondition): boolean {
  switch (condition[0]) {
    case "?":
      return true;
    case "!":
      return neverMatches(condition[1]);
    case "&":
      return condition[1].some(neverMatches);
    case "|":
      return condition[1].every(neverMatches);
    default:
      return false;
  }
}
