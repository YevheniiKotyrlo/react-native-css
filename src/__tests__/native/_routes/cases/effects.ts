import type { RouteCase } from "../harness";

/**
 * Route cases for paint and transform: backgrounds, shadows, filters, blend modes, the transform family and the -rn- escape hatch.
 *
 * One case per property in this slice. The gate in
 * `route-equivalence-census.test.tsx` reads the property census out of the
 * compiler's own source, so a property missing from here fails the build rather
 * than going untested.
 *
 * Every value here is the MULTI-PART form of its property wherever the property
 * has one. This slice is the one where the routes agreeing is not enough:
 * `transform`, `transform-origin`, `box-shadow`, `filter` and `background-image`
 * all compile to a value React Native then hands to a processor of its own
 * (`ReactNativeStyleAttributes`), and a processor answers `[]` — or throws out of
 * render — to shapes the routes can agree on. `transform: scale(2)` alone hides
 * the arity bugs that `translateX(10px) scale(2)` finds, and
 * `transform-origin: 10px 20px` hides the z-component the `<position>` grammar
 * drops, which is why `left top 30px` is the spelling here.
 *
 * The properties this file owns:
 *
 * - `-rn-ripple-layer`
 * - `-rn-ripple-style`
 * - `-rn-shadow-offset`
 * - `-webkit-line-clamp`
 * - `background-color`
 * - `background-image`
 * - `box-shadow`
 * - `fill`
 * - `filter`
 * - `isolation`
 * - `mix-blend-mode`
 * - `object-fit`
 * - `object-position`
 * - `opacity`
 * - `rotate`
 * - `scale`
 * - `stroke`
 * - `stroke-width`
 * - `transform`
 * - `transform-origin`
 * - `translate`
 */
export const EFFECT_ROUTE_CASES: readonly RouteCase[] = [
  {
    property: "-rn-ripple-layer",
    value: "foreground",
    alternate: "background",
  },
  {
    property: "-rn-ripple-style",
    value: "borderless",
    alternate: "bordered",
  },
  {
    property: "-rn-shadow-offset",
    value: "1px 2px",
    alternate: "3px 4px",
  },
  {
    property: "-webkit-line-clamp",
    value: "3",
    alternate: "2",
  },
  // The comma-separated function form, so the runtime routes exercise
  // `reduceParseUnparsed`'s comma grouping and the `rgba` resolver rather than a
  // bare hex the token stream carries through untouched.
  {
    property: "background-color",
    value: "rgba(18, 52, 86, 0.5)",
    alternate: "#654321",
  },
  {
    property: "background-image",
    value: "linear-gradient(to right, #123456 0%, #654321 100%)",
    alternate: "linear-gradient(to left, #abcdef, #fedcba)",
  },
  {
    property: "box-shadow",
    value: "1px 2px 3px 4px #123456",
    alternate: "2px 3px 4px 5px #654321",
  },
  {
    property: "fill",
    value: "#123456",
    alternate: "#654321",
  },
  {
    property: "filter",
    value: "blur(4px) brightness(0.5)",
    alternate: "grayscale(1)",
  },
  {
    property: "isolation",
    value: "isolate",
    alternate: "auto",
  },
  {
    property: "mix-blend-mode",
    value: "multiply",
    alternate: "screen",
  },
  {
    property: "object-fit",
    value: "contain",
    alternate: "cover",
  },
  {
    property: "object-position",
    value: "10px 20px",
    alternate: "30px 40px",
  },
  {
    property: "opacity",
    value: "0.5",
    alternate: "0.25",
  },
  {
    property: "rotate",
    value: "45deg",
    alternate: "90deg",
    divergenceNote:
      "`rotate: 45deg` is a rotation about z, and the routes spell it with the " +
      "two keys React Native accepts for that one rotation: the compile-time " +
      "routes emit `[{rotateZ:'45deg'}]` and the runtime routes emit " +
      "`[{rotate:'45deg'}]`. `processTransform` returns both unchanged, and " +
      "React Native's own conversion reads them as the same operation — " +
      '`operation == "rotateZ" || operation == "rotate"` builds one ' +
      "`TransformOperationType::Rotate` about z " +
      "(`react-native/ReactCommon/react/renderer/components/view/conversions.h`) " +
      "— so every route renders the same 45 degree turn.",
  },
  {
    property: "scale",
    value: "2 3",
    alternate: "1.5 0.5",
  },
  {
    property: "stroke",
    value: "#123456",
    alternate: "#654321",
  },
  {
    property: "stroke-width",
    value: "2px",
    alternate: "4px",
  },
  {
    property: "transform",
    value: "translateX(10px) scale(2)",
    alternate: "rotate(45deg)",
    // A one-argument `scale()` reaches React Native as the `scaleX`/`scaleY`
    // pair on the compile-time routes and as a single `scale` on the runtime
    // ones. `processTransform` returns BOTH unchanged — measured, both shapes —
    // so this is a difference in spelling and not in what renders.
    //
    // Making the runtime split to match was tried and is a regression: `scale`
    // is resolved inside the `transform` list, and returning a pair from there
    // loses the whole function. Closing this properly means changing how the
    // transform list flattens a multi-entry member, which is a wider change
    // than the difference is worth.
    divergenceNote:
      "one-argument scale() is `{scale}` at runtime and the `scaleX`/`scaleY` " +
      "pair at compile time; processTransform accepts both unchanged",
  },
  {
    property: "transform-origin",
    value: "left top 30px",
    alternate: "right bottom 10%",
  },
  {
    property: "translate",
    value: "10px 20px",
    alternate: "30px 40px",
  },
];
