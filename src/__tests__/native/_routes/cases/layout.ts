import type { RouteCase } from "../harness";

/**
 * Route cases for flexbox, alignment, display, position and the container-query properties.
 *
 * One case per property in this slice. The gate in
 * `route-equivalence-census.test.tsx` reads the property census out of the
 * compiler's own source, so a property missing from here fails the build rather
 * than going untested.
 *
 * The properties this file owns:
 *
 * - `align-content`
 * - `align-items`
 * - `align-self`
 * - `backface-visibility`
 * - `container`
 * - `container-name`
 * - `container-type`
 * - `direction`
 * - `display`
 * - `flex`
 * - `flex-basis`
 * - `flex-direction`
 * - `flex-flow`
 * - `flex-grow`
 * - `flex-shrink`
 * - `flex-wrap`
 * - `justify-content`
 * - `overflow`
 * - `place-content`
 * - `place-items`
 * - `place-self`
 * - `position`
 * - `user-select`
 * - `visibility`
 * - `z-index`
 */
export const LAYOUT_ROUTE_CASES: readonly RouteCase[] = [
  { property: "align-content", value: "space-between", alternate: "center" },
  { property: "align-items", value: "flex-start", alternate: "center" },
  { property: "align-self", value: "flex-end", alternate: "center" },
  { property: "backface-visibility", value: "hidden", alternate: "visible" },
  // The three container properties register a CONTAINER, which is a rule-level
  // fact rather than a style: `builder.addContainer` runs while the rule is
  // being built, and a `var()` has no value then. So the compile-time routes
  // register the container — and the element becomes a measured, focusable
  // Pressable, which is what the prop comparison sees — while the runtime
  // routes register nothing.
  //
  // Not closable at the runtime end. A container is matched by NAME when a
  // descendant's `@container` query compiles, and that matching has already
  // happened by the time a runtime value exists. `props.style` is `undefined`
  // on all five routes, which is why the style-only comparison was blind to
  // this until props were compared too.
  //
  // The container shorthand names a container AND types it, so it is the
  // multi-value form of the two longhands beside it.
  {
    property: "container",
    value: "sidebar / inline-size",
    alternate: "main / inline-size",
    divergenceNote:
      "A DELIBERATE LIMIT rather than an unfinished feature. A container is " +
      "registered while the rule is read, so a value only known at render " +
      "registers nothing and the element is not a container. Closing it would " +
      "mean an element could BECOME or STOP BEING a containment context " +
      "mid-life, which forces re-evaluating every descendant's container " +
      "queries whenever any variable changes — a cost paid by every container " +
      "on the screen. And the value nobody varies: `container-type` and " +
      "`container-name` are structural declarations, `this box is a " +
      "containment context` and `it is called X`, not themeable values. The " +
      "literal form works, which is every way the property is actually " +
      "written.",
  },
  {
    property: "container-name",
    value: "sidebar",
    alternate: "main",
    divergenceNote:
      "A DELIBERATE LIMIT rather than an unfinished feature. A container is " +
      "registered while the rule is read, so a value only known at render " +
      "registers nothing and the element is not a container. Closing it would " +
      "mean an element could BECOME or STOP BEING a containment context " +
      "mid-life, which forces re-evaluating every descendant's container " +
      "queries whenever any variable changes — a cost paid by every container " +
      "on the screen. And the value nobody varies: `container-type` and " +
      "`container-name` are structural declarations, `this box is a " +
      "containment context` and `it is called X`, not themeable values. The " +
      "literal form works, which is every way the property is actually " +
      "written.",
  },
  {
    property: "container-type",
    value: "inline-size",
    alternate: "size",
    divergenceNote:
      "A DELIBERATE LIMIT rather than an unfinished feature. A container is " +
      "registered while the rule is read, so a value only known at render " +
      "registers nothing and the element is not a container. Closing it would " +
      "mean an element could BECOME or STOP BEING a containment context " +
      "mid-life, which forces re-evaluating every descendant's container " +
      "queries whenever any variable changes — a cost paid by every container " +
      "on the screen. And the value nobody varies: `container-type` and " +
      "`container-name` are structural declarations, `this box is a " +
      "containment context` and `it is called X`, not themeable values. The " +
      "literal form works, which is every way the property is actually " +
      "written.",
  },
  { property: "direction", value: "rtl", alternate: "ltr" },
  { property: "display", value: "flex", alternate: "none" },
  // The three-value form: the one that has to expand into `flexGrow`,
  // `flexShrink` and `flexBasis` rather than survive under its own key.
  { property: "flex", value: "1 1 0%", alternate: "0 1 auto" },
  { property: "flex-basis", value: "120px", alternate: "160px" },
  { property: "flex-direction", value: "row-reverse", alternate: "column" },
  { property: "flex-flow", value: "row wrap", alternate: "column nowrap" },
  { property: "flex-grow", value: "2", alternate: "1" },
  { property: "flex-shrink", value: "0", alternate: "1" },
  { property: "flex-wrap", value: "wrap-reverse", alternate: "nowrap" },
  { property: "justify-content", value: "space-between", alternate: "center" },
  { property: "overflow", value: "hidden", alternate: "visible" },
  {
    property: "place-content",
    value: "center space-between",
    alternate: "flex-start center",
  },
  { property: "place-items", value: "center start", alternate: "stretch end" },
  { property: "place-self", value: "center start", alternate: "flex-end end" },
  { property: "position", value: "absolute", alternate: "relative" },
  { property: "user-select", value: "none", alternate: "text" },
  { property: "visibility", value: "hidden", alternate: "visible" },
  { property: "z-index", value: "10", alternate: "20" },
];
