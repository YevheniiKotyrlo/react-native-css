/**
 * React Native's own transform validator, which ships as a Flow `.js` with no
 * `.d.ts` beside it and is not re-exported from the package root the way
 * `processColor` is (`react-native/types/index.d.ts`). Importing it without this
 * declaration is a `TS7016`.
 *
 * `ReactNativeStyleAttributes.js` declares `transform: {process:
 * processTransform}`, so every value the compiler puts under that style key is
 * handed to this function before it reaches the host view. It is the ground
 * truth for whether a transform renders — and, unlike most of these processors,
 * for whether it renders AT ALL: an unreadable component throws an invariant out
 * of render rather than being dropped, which unmounts the tree.
 *
 * The leading underscore keeps jest off it, as `_process-background-image.d.ts`
 * explains.
 */
declare module "react-native/Libraries/StyleSheet/processTransform" {
  /**
   * The parameter is `unknown` rather than React Native's own
   * `ReadonlyArray<...> | string` on purpose: a test's job here is to hand it
   * whatever the compiler emitted and find out, so narrowing the argument would
   * hide the mismatch this function exists to reveal.
   */
  export default function processTransform(
    transform: unknown,
  ): readonly Record<string, unknown>[] | number[];
}
