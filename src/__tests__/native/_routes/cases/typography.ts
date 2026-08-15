import type { RouteCase } from "../harness";

/**
 * Route cases for text: the font family, every `text-*` property, colour and
 * the inline metrics.
 *
 * One case per property in this slice. The gate in
 * `route-equivalence-census.test.tsx` reads the property census out of the
 * compiler's own source, so a property missing from here fails the build rather
 * than going untested.
 *
 * The properties this file owns: `caret-color`, `color`, `font`, `font-family`,
 * `font-size`, `font-style`, `font-variant`, `font-variant-caps`,
 * `font-variant-ligatures`, `font-variant-numeric`, `font-weight`,
 * `letter-spacing`, `line-height`, `text-align`, `text-decoration`,
 * `text-decoration-color`, `text-decoration-line`, `text-decoration-style`,
 * `text-shadow`, `text-transform`, `vertical-align`.
 */
export const TYPOGRAPHY_ROUTE_CASES: readonly RouteCase[] = [
  // `caret-color` is the one property here that is not a style key at all:
  // `atRules.ts` seeds it into the PROP mapping as `cursorColor`, so the value
  // lands on `props.cursorColor` and `props.style` stays empty on every route.
  // The case holds the census slot; the routes it compares are all empty.
  {
    property: "caret-color",
    value: "magenta",
    alternate: "cyan",
    surface: "text",
  },
  // `color` shows why the harness compares what React Native RENDERS rather
  // than the string it receives: the compile-time routes give `#f00` and the
  // runtime routes give `red`, and `processColor` says those are one colour.
  { property: "color", value: "red", alternate: "blue", surface: "text" },
  // The full shorthand, because it is the form that expands: style, size,
  // line-height and family in one declaration, which every route splits into
  // six longhands. A single-value `font` would be a family and would say
  // nothing about the expansion.
  //
  // The LENGTH line-height is the load-bearing half: `30px` and the ratio
  // `2.5` are the same bare number once a `var()` has been resolved, so this
  // case is what holds the runtime resolver to reading the DECLARED token
  // rather than guessing from the resolved one.
  {
    property: "font",
    value: "italic 12px/30px Georgia",
    alternate: "bold 16px/1.5 Verdana",
    surface: "text",
  },
  // A font STACK, which is how the property is written: React Native's
  // `fontFamily` is one family, so the value has to be narrowed to the first
  // one, and a single-family value would not reach that narrowing.
  {
    property: "font-family",
    value: "Georgia, serif",
    alternate: "Verdana, sans-serif",
    surface: "text",
  },
  { property: "font-size", value: "20px", alternate: "24px", surface: "text" },
  {
    property: "font-style",
    value: "italic",
    alternate: "normal",
    surface: "text",
  },
  // The shorthand takes a keyword from any of its longhands and as many at once
  // as the author writes, which is the shape React Native's `fontVariant` list
  // exists for.
  {
    property: "font-variant",
    value: "small-caps tabular-nums",
    alternate: "all-small-caps",
    surface: "text",
  },
  {
    property: "font-variant-caps",
    value: "small-caps",
    alternate: "all-small-caps",
    surface: "text",
  },
  // `none` rather than a keyword list: it is the one `font-variant-ligatures`
  // value that is TRANSLATED rather than passed through — CSS defines it as
  // switching off all four ligature groups and React Native has no single
  // keyword for that, so it expands to four `no-*` keywords. A pass-through
  // keyword would exercise neither the expansion nor the list shape.
  {
    property: "font-variant-ligatures",
    value: "none",
    alternate: "common-ligatures",
    surface: "text",
  },
  // `ordinal` is a CSS keyword React Native cannot express and `tabular-nums`
  // is one it can, so the value exercises the rule that an unrenderable keyword
  // does not discard its neighbours — a filter the compiler and the runtime
  // resolver each hold their own copy of.
  {
    property: "font-variant-numeric",
    value: "ordinal tabular-nums",
    alternate: "lining-nums",
    surface: "text",
  },
  {
    property: "font-weight",
    value: "700",
    alternate: "400",
    surface: "text",
  },
  {
    property: "letter-spacing",
    value: "2px",
    alternate: "4px",
    surface: "text",
  },
  // A LENGTH, not the ratio `1.5`, because the length is the half of the
  // ratio-or-length seam that a variable can lose: `24` on its own is
  // indistinguishable from the multiplier `24`, while a ratio needs no unit to
  // survive and reads correctly whichever way it is classified.
  {
    property: "line-height",
    value: "24px",
    alternate: "32px",
    surface: "text",
  },
  {
    property: "text-align",
    value: "center",
    alternate: "right",
    surface: "text",
  },
  // Line and colour together: the shorthand's whole job is splitting into
  // `text-decoration-line` and `text-decoration-color`, and `textDecoration` is
  // not a React Native key, so a value left whole has nowhere to land.
  {
    property: "text-decoration",
    value: "underline red",
    alternate: "line-through blue",
    surface: "text",
  },
  {
    property: "text-decoration-color",
    value: "green",
    alternate: "purple",
    surface: "text",
  },
  // Both lines at once: React Native spells that as the single union member
  // `'underline line-through'`, so the two CSS keywords have to be joined
  // rather than carried as a list.
  {
    property: "text-decoration-line",
    value: "underline line-through",
    alternate: "underline",
    surface: "text",
  },
  {
    property: "text-decoration-style",
    value: "double",
    alternate: "dotted",
    surface: "text",
  },
  // Offset, blur and colour: the offset is the only value in this slice that
  // reaches React Native through a NESTED path (`textShadowOffset.width`), and
  // it only exists when both components are present.
  {
    property: "text-shadow",
    value: "1px 2px 3px red",
    alternate: "4px 5px 6px blue",
    surface: "text",
  },
  {
    property: "text-transform",
    value: "uppercase",
    alternate: "lowercase",
    surface: "text",
  },
  {
    property: "vertical-align",
    value: "middle",
    alternate: "top",
    surface: "text",
  },
];
