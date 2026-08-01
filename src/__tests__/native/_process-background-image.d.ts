/**
 * React Native's own gradient parser, which ships as a Flow `.js` with no `.d.ts`
 * beside it and is not re-exported from the package root the way `processColor`
 * is (`react-native/types/index.d.ts`). Importing it without this declaration is
 * a `TS7016`.
 *
 * `ReactNativeStyleAttributes.js` declares
 * `experimental_backgroundImage: {process: processBackgroundImage}`, so this is
 * the function every value the compiler puts under that style key is handed
 * before it reaches the host view — which makes it the ground truth for whether
 * a gradient renders at all.
 *
 * The types below mirror `processBackgroundImage.js`'s own Flow types.
 *
 * The leading underscore is what keeps jest off it: `testMatch` claims every
 * `.ts` under `__tests__`, and a declaration file holds no tests, so without the
 * prefix the underscore entry in `testPathIgnorePatterns`
 * (`.config/jest.config.cjs`) does not fire and the file fails as an empty
 * suite — the same convention `_routes` uses.
 */
declare module "react-native/Libraries/StyleSheet/processBackgroundImage" {
  import type { ProcessedColorValue } from "react-native";

  /** `{type: 'angle'}` for a `<angle>`, `{type: 'keyword'}` for `to <side>`. */
  export interface LinearGradientDirection {
    readonly type: "angle" | "keyword";
    readonly value: number | string;
  }

  /** `x` / `y` are the explicit `<length>` form; the rest are the extent keywords. */
  export type RadialGradientSize =
    | "closest-side"
    | "closest-corner"
    | "farthest-side"
    | "farthest-corner"
    | { readonly x: number | string; readonly y: number | string };

  export interface RadialGradientPosition {
    readonly top: number | string;
    readonly left: number | string;
  }

  /**
   * A `null` colour is the transition-hint syntax (`red, 20%, blue`); a `null`
   * position is a stop that did not name one.
   */
  export interface ProcessedColorStop {
    readonly color: ProcessedColorValue | null;
    readonly position: number | string | null;
  }

  export interface ProcessedLinearGradient {
    readonly type: "linear-gradient";
    readonly direction: LinearGradientDirection;
    readonly colorStops: readonly ProcessedColorStop[];
  }

  export interface ProcessedRadialGradient {
    readonly type: "radial-gradient";
    readonly shape: "circle" | "ellipse";
    readonly size: RadialGradientSize;
    readonly position: RadialGradientPosition;
    readonly colorStops: readonly ProcessedColorStop[];
  }

  export type ProcessedBackgroundImage =
    | ProcessedLinearGradient
    | ProcessedRadialGradient;

  /**
   * An empty array means NOTHING RENDERS: one unreadable stop, direction or
   * shape drops the whole declaration, exactly as web does.
   *
   * The parameter is `unknown` rather than React Native's own
   * `ReadonlyArray<BackgroundImageValue> | string` on purpose — a test's job here
   * is to hand it whatever the compiler emitted and find out, so narrowing the
   * argument would hide the mismatch this function exists to reveal.
   */
  export default function processBackgroundImage(
    backgroundImage: unknown,
  ): readonly ProcessedBackgroundImage[];
}
