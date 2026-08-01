import type { RouteCase } from "../harness";

/**
 * Route cases for the animation and transition longhands, and their two shorthands.
 *
 * One case per property in this slice. The gate in
 * `route-equivalence-census.test.tsx` reads the property census out of the
 * compiler's own source, so a property missing from here fails the build rather
 * than going untested.
 *
 * The properties this file owns:
 *
 * - `animation`
 * - `animation-delay`
 * - `animation-direction`
 * - `animation-duration`
 * - `animation-fill-mode`
 * - `animation-iteration-count`
 * - `animation-name`
 * - `animation-play-state`
 * - `animation-timing-function`
 * - `transition`
 * - `transition-delay`
 * - `transition-duration`
 * - `transition-property`
 * - `transition-timing-function`
 */
export const ANIMATION_ROUTE_CASES: readonly RouteCase[] = [
  {
    property: "animation",
    value: "route-frames 1s",
    alternate: "route-frames 2s",
  },
  { property: "animation-delay", value: "200ms", alternate: "400ms" },
  { property: "animation-direction", value: "alternate", alternate: "reverse" },
  { property: "animation-duration", value: "1s", alternate: "2s" },
  { property: "animation-fill-mode", value: "both", alternate: "forwards" },
  { property: "animation-iteration-count", value: "3", alternate: "infinite" },
  {
    property: "animation-name",
    value: "route-frames",
    alternate: "route-other-frames",
  },
  { property: "animation-play-state", value: "paused", alternate: "running" },
  {
    property: "animation-timing-function",
    value: "cubic-bezier(0.25, 0.5, 0.75, 1)",
    alternate: "steps(4, end)",
  },
  {
    property: "transition",
    value: "width 1s ease-in 200ms",
    alternate: "opacity 2s linear 300ms",
  },
  { property: "transition-delay", value: "200ms", alternate: "400ms" },
  { property: "transition-duration", value: "1s", alternate: "2s" },
  {
    property: "transition-property",
    value: "width, block-size",
    alternate: "opacity",
  },
  {
    property: "transition-timing-function",
    value: "cubic-bezier(0.25, 0.5, 0.75, 1)",
    alternate: "steps(4, end)",
  },
];
