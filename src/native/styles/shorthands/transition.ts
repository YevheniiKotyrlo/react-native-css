import type { StyleResolver } from "../resolve";

/**
 * `transition`, dropped rather than expanded.
 *
 * Expanding it needs the four transition props `addTransitionValue` builds in
 * `src/compiler/declarations.ts`, including the style-key rename every property
 * name is read back through and the filter that removes what React Native
 * cannot animate. Both are compiler-side censuses a style resolver cannot see.
 *
 * Dropping is not the same as leaving it alone: `transition` is one of
 * reanimated's own `TRANSITION_PROPS`, so an argument list left on it is read
 * as a transition rather than ignored, and `transition: width 1s ease-in 200ms`
 * becomes a transition on a property named `width1000easeIn200` with a zero
 * duration.
 *
 * The declaration is still emitted, and resolves to nothing here rather than
 * being dropped in the compiler, because a rule holding only transition props
 * still produces an empty style object — and a rule that vanishes entirely
 * produces no style prop at all, which is a different shape again.
 */
export const transition: StyleResolver = () => undefined;
