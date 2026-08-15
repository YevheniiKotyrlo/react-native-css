/**
 * React Native's own filter parser, which ships as a Flow `.js` with no `.d.ts`
 * beside it and is not re-exported from the package root the way `processColor`
 * is (`react-native/types/index.d.ts`). Importing it without this declaration is
 * a `TS7016`.
 *
 * `ReactNativeStyleAttributes.js` declares `filter: {process: processFilter}`,
 * so every value the compiler puts under that style key is handed to this
 * function before it reaches the host view. An empty array back means NOTHING
 * RENDERS: one unreadable filter function drops the whole declaration, exactly
 * as web does.
 *
 * The leading underscore keeps jest off it, as `_process-background-image.d.ts`
 * explains.
 */
declare module "react-native/Libraries/StyleSheet/processFilter" {
  /**
   * The parameter is `unknown` rather than React Native's own
   * `ReadonlyArray<FilterFunction> | string` on purpose: a test's job here is to
   * hand it whatever the compiler emitted and find out, so narrowing the
   * argument would hide the mismatch this function exists to reveal.
   */
  export default function processFilter(
    filter: unknown,
  ): readonly Record<string, unknown>[];
}
