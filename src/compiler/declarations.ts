// cSpell:ignore rcap,vmin,svmin,lvmin,dvmin,cqmin,vmax,svmax,lvmax,dvmax,cqmax,currentcolor,oklab,oklch,prophoto,squircle,oldstyle,nums

import Color from "colorjs.io";
import type {
  AbsoluteFontSize,
  Angle,
  BorderSideWidth,
  BorderStyle,
  ColorOrAuto,
  CssColor,
  CustomProperty,
  Declaration,
  DimensionPercentageFor_Angle,
  DimensionPercentageFor_LengthValue,
  EnvironmentVariable,
  FontSize,
  FontStyle,
  FontVariantCaps,
  FontWeight,
  GapValue,
  Gradient,
  GradientItemFor_DimensionPercentageFor_Angle,
  GradientItemFor_DimensionPercentageFor_LengthValue,
  Length,
  LengthPercentageOrAuto,
  LengthValue,
  LineDirection,
  LineHeight,
  LineStyle,
  MaxSize,
  NumberOrPercentage,
  Scale,
  Size,
  Size2DFor_DimensionPercentageFor_LengthValue,
  Time,
  Token,
  TokenOrValue,
  Translate,
  UnresolvedColor,
} from "lightningcss";

import {
  containsStyleFunction,
  isStyleDescriptorArray,
  isStyleFunction,
  narrowFontFamily,
} from "../utilities";
import type {
  MediaCondition,
  StyleDescriptor,
  StyleFunction,
} from "./compiler.types";
import { parseEasingFunction, parseIterationCount } from "./keyframes";
import { toRNProperty } from "./selector-builder";
import { propertyRename, type StylesheetBuilder } from "./stylesheet";

const CommaSeparator = Symbol("CommaSeparator");

/** The condition an extra rule for a `light-dark()` dark branch is gated on. */
const DARK_COLOR_SCHEME: MediaCondition = ["=", "prefers-color-scheme", "dark"];

type DeclarationType<P extends Declaration["property"]> = Extract<
  Declaration,
  { property: P }
>;

type Parser<T extends Declaration["property"] = Declaration["property"]> = (
  declaration: Extract<Declaration, { property: T }>,
  builder: StylesheetBuilder,
  propertyName: string,
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
) => StyleDescriptor | void;

// React Native only supports a uniform borderStyle, so per-edge border
// styles have no native equivalent and are dropped. "solid" is dropped
// silently as it matches React Native's default rendering. A var() keeps the
// value unknown at compile time, and an unknown value is not a known
// non-solid one, so the unparsed path drops these as quietly.
const unsupportedEdgeStyles = new Set([
  "border-block-style",
  "border-block-start-style",
  "border-block-end-style",
  "border-inline-style",
  "border-inline-start-style",
  "border-inline-end-style",
]);

/**
 * Where a two-edge logical shorthand lands once a var() has kept it off the
 * parsed path, at each arity the grammar `<value>{1,2}` allows.
 *
 * `edges` is the [start, end] pair two components feed, one each. One
 * component normally feeds both, since both edges then carry the same value.
 *
 * `axis` is the exception, and it exists because React Native's support is
 * uneven: `borderBlockColor` is the family's only axis-wide property — there
 * is no `borderInlineColor`, and `borderBlockWidth` is in
 * `BaseViewConfig.ios.js` alone — and the parsed path collapses onto it
 * whenever both block edges agree. The unparsed path has to make the same
 * choice, because the two key sets are DISJOINT and so both survive the
 * cascade: emit the pair here and a `borderBlockColor` declared later sits
 * beside it rather than replacing it, React Native's per-edge properties win,
 * and the later declaration silently loses.
 */
const axisExpansion: Record<
  string,
  { readonly edges: readonly [string, string]; readonly axis?: string }
> = {
  "border-block-color": {
    edges: ["border-top-color", "border-bottom-color"],
    axis: "border-block-color",
  },
  "border-block-width": { edges: ["border-top-width", "border-bottom-width"] },
  "border-inline-color": { edges: ["border-start-color", "border-end-color"] },
  "border-inline-width": { edges: ["border-start-width", "border-end-width"] },
};

const unparsedRuntimeParsing = new Set([
  "animation",
  "font",
  "border",
  "border-block",
  "border-block-color",
  "border-block-end",
  "border-block-start",
  "border-block-style",
  "border-block-width",
  "border-bottom",
  "border-color",
  "border-inline",
  "border-inline-color",
  "border-inline-end",
  "border-inline-start",
  "border-inline-style",
  "border-inline-width",
  "border-left",
  "border-radius",
  "border-right",
  "border-style",
  "border-top",
  "border-width",
  "box-shadow",
  // Not shorthands, and here for the same reason: their compile-time parsers
  // write React Native keys that are not the property's own name, and a
  // deferred value has no way to reach those keys by itself.
  "direction",
  "visibility",
  // `filter` takes a LIST, and how many entries a `var()` contributes is only
  // known once it resolves — one for `--f: blur(4px)`, two for
  // `--f: blur(4px) brightness(0.5)`. The compiler cannot answer that, so
  // wrapping the reference into a one-entry list guessed, and guessed wrong for
  // every multi-function variable: React Native's `processFilter` returns `[]`
  // for a nested list, which discards the whole declaration rather than one
  // entry of it. `transform` is the same property shape and is already settled
  // here, by a resolver that flattens what it is handed
  // (`native/styles/shorthands/transform.ts`).
  "filter",
  "flex",
  "flex-flow",
  "font-family",
  // A `<percentage>` font size measures against the PARENT's computed size
  // (css-fonts-4 §3.5), and only the consuming property knows that. Written
  // out, `parseFontSize` reads it as the `em` multiplier it is; stored in a
  // custom property it is the string `"200%"` — the faithful representation,
  // because `:root { --p: 200% }` may be read by `width`, where `"200%"` is
  // correct, and by `font-size` in the same stylesheet. So the reading belongs
  // at render, under the property that asked, which is what the `fontSize`
  // resolver in `native/styles/font-size.ts` does. Without it the string
  // reached React Native raw, where `fontSize` is a `number` and it is inert.
  "font-size",
  // Reached only by `font-variant-caps`, which `propertyRename` turns into
  // `font-variant` a few lines before this set is consulted. lightningcss models
  // the `-caps` longhand and neither of the other two, so `font-variant` and
  // `font-variant-numeric`/`-ligatures` go through `parseCustomDeclaration` and
  // its keyword resolver while this one alone came through the typed table —
  // and shipped a bare `fontVariant: "small-caps"` where React Native's type is
  // `FontVariant[]`. `fontVariant` in `native/styles/functions/keyword-functions.ts`
  // is the resolver all four spellings now share.
  "font-variant",
  "gap",
  "inset",
  "inset-block",
  "inset-inline",
  "line-height",
  "margin",
  "margin-block",
  "margin-inline",
  "outline",
  "overflow",
  "padding",
  "padding-block",
  "padding-inline",
  "place-content",
  "place-items",
  "place-self",
  "rotate",
  "scale",
  "text-decoration",
  "text-decoration-line",
  "text-shadow",
  "transform",
  "transition",
  // `transform-origin` reaches the unparsed route for two reasons — a `var()`,
  // and the whole valid three-value form, which lightningcss's `<position>`
  // grammar cannot represent. Both need the token list assembled into React
  // Native's fixed `[x, y, z]` arity rather than left at its own token count.
  "transform-origin",
  "translate",
]);

/**
 * The properties with no runtime form at all: a deferred value produces no
 * declaration.
 *
 * Each one's compile-time parser produces something a style resolver cannot,
 * so there is no resolver to route it to and nothing to gain by emitting a
 * declaration that would resolve to nothing. Dropping here rather than at
 * render also means the rule carries no empty style object, which is what the
 * literal route produces for the ones that write no style at all.
 *
 * - `container`, `container-name` and `container-type` register the element as
 *   a query container on its RULE, decided while the stylesheet is read.
 * - `font` sets the element's own `em` by publishing `--__rn-css-em` beside
 *   `font-size`; without it the shorthand's unitless `line-height` resolves
 *   against the inherited size instead of the one declared with it.
 *
 * `transition` is the neighbouring case that does NOT belong here: it also has
 * no runtime expansion, but a rule holding only transition props still produces
 * an empty style object, so dropping it in the compiler changes that rule's
 * shape. It goes through `unparsedRuntimeParsing` to a resolver that drops it
 * instead.
 */
const unparsedNoRuntimeForm = new Set([
  "container",
  "container-name",
  "container-type",
]);

const parsers: {
  [K in Declaration["property"]]?: Parser<K>;
} = {
  "align-content": parseAlignContent,
  "align-items": parseAlignItems,
  "align-self": parseAlignSelf,
  "animation": addAnimationValue,
  "animation-delay": addAnimationValue,
  "animation-direction": addAnimationValue,
  "animation-duration": addAnimationValue,
  "animation-fill-mode": addAnimationValue,
  "animation-iteration-count": addAnimationValue,
  "animation-name": addAnimationValue,
  "animation-play-state": addAnimationValue,
  "animation-timing-function": addAnimationValue,
  "aspect-ratio": parseAspectRatio,
  "backface-visibility": parseBackfaceVisibility,
  "background-color": parseColorDeclaration,
  "background-image": parseBackgroundImage,
  // `parseSizeWithAutoDeclaration`, matching `height` — the key it renames to.
  // `block-size: auto` is `height: auto`, so refusing one and accepting the
  // other made the same declaration compile or not depending on how it was
  // spelled.
  "block-size": parseSizeWithAutoDeclaration,
  "border": parseBorder,
  "border-block": parseBorderBlock,
  "border-block-color": parseBorderColor,
  "border-block-end": parseBorderBlockEnd,
  "border-block-end-color": parseColorDeclaration,
  // The opposite edge of `border-block-start-style`, and reached the same two
  // ways: written by hand, and written by `parseUnsupportedEdgeStyle` when the
  // two edges of `border-block-style` disagree. Missing here, one edge of a
  // symmetric pair compiled and the other was reported as a property this
  // library does not handle.
  "border-block-end-style": parseUnsupportedEdgeStyle,
  "border-block-end-width": parseBorderSideWidthDeclaration,
  "border-block-start": parseBorderBlockStart,
  "border-block-start-color": parseColorDeclaration,
  "border-block-start-style": parseUnsupportedEdgeStyle,
  "border-block-start-width": parseBorderSideWidthDeclaration,
  "border-block-style": parseUnsupportedEdgeStyle,
  "border-block-width": parseBorderBlockWidth,
  "border-bottom": parseBorderSide,
  "border-bottom-color": parseColorDeclaration,
  "border-bottom-left-radius": parseSize2DDimensionPercentageDeclaration,
  "border-bottom-right-radius": parseSize2DDimensionPercentageDeclaration,
  "border-bottom-style": parseBorderStyleDeclaration,
  "border-bottom-width": parseBorderSideWidthDeclaration,
  "border-color": parseBorderColor,
  "border-end-end-radius": parseSize2DDimensionPercentageDeclaration,
  "border-end-start-radius": parseSize2DDimensionPercentageDeclaration,
  "border-inline": parseBorderInline,
  "border-inline-color": parseBorderColor,
  "border-inline-end": parseBorderInlineEnd,
  "border-inline-end-color": parseColorDeclaration,
  "border-inline-end-style": parseUnsupportedEdgeStyle,
  "border-inline-end-width": parseBorderSideWidthDeclaration,
  "border-inline-start": parseBorderInlineStart,
  "border-inline-start-color": parseColorDeclaration,
  "border-inline-start-style": parseUnsupportedEdgeStyle,
  "border-inline-start-width": parseBorderSideWidthDeclaration,
  "border-inline-style": parseUnsupportedEdgeStyle,
  "border-inline-width": parseBorderInlineWidth,
  "border-left": parseBorderSide,
  "border-left-color": parseColorDeclaration,
  "border-left-style": parseBorderStyleDeclaration,
  "border-left-width": parseBorderSideWidthDeclaration,
  "border-radius": parseBorderRadius,
  "border-right": parseBorderSide,
  "border-right-color": parseColorDeclaration,
  "border-right-style": parseBorderStyleDeclaration,
  "border-right-width": parseBorderSideWidthDeclaration,
  "border-start-end-radius": parseSize2DDimensionPercentageDeclaration,
  "border-start-start-radius": parseSize2DDimensionPercentageDeclaration,
  "border-style": parseBorderStyleDeclaration,
  "border-top": parseBorderSide,
  "border-top-color": parseColorDeclaration,
  "border-top-left-radius": parseSize2DDimensionPercentageDeclaration,
  "border-top-right-radius": parseSize2DDimensionPercentageDeclaration,
  "border-top-style": parseBorderStyleDeclaration,
  "border-top-width": parseBorderSideWidthDeclaration,
  "border-width": parseBorderWidth,
  "bottom": parseSizeWithAutoDeclaration,
  "box-shadow": parseBoxShadow,
  "box-sizing": parseBoxSizing,
  "caret-color": parseColorOrAutoDeclaration,
  "color": parseFontColorDeclaration,
  "column-gap": parseGap,
  "container": parseContainer,
  "container-name": parseContainerName,
  "container-type": parseContainerType,
  "display": parseDisplay,
  "direction": parseDirection,
  "fill": parseSVGPaint,
  "filter": parseFilter,
  "flex": parseFlex,
  // React Native's `flexBasis` is a `DimensionValue`, and `'auto'` is one of
  // its members — the flex item sizes to its content. Refusing the keyword left
  // the compile-time route producing no declaration at all for
  // `flex-basis: auto`, while the same value through a `var()` produced
  // `{flexBasis: "auto"}`, because the two routes read `auto` from different
  // places. They read it from the same place now: `allowAutoProperties` is
  // derived from this table through `autoAllowingParsers`.
  "flex-basis": parseLengthPercentageOrAutoDeclaration,
  "flex-direction": ({ value }) => value,
  "flex-flow": parseFlexFlow,
  "flex-grow": ({ value }) => value,
  "flex-shrink": ({ value }) => value,
  "flex-wrap": ({ value }) => value,
  "font": parseFont,
  "font-family": parseFontFamily,
  "font-size": parseFontSizeDeclaration,
  "font-style": parseFontStyleDeclaration,
  "font-variant-caps": parseFontVariantCapsDeclaration,
  "font-weight": parseFontWeightDeclaration,
  "gap": parseGap,
  "height": parseSizeWithAutoDeclaration,
  "inline-size": parseSizeWithAutoDeclaration,
  "inset": parseInset,
  "inset-block": parseInsetBlock,
  "inset-block-end": parseLengthPercentageDeclaration,
  "inset-block-start": parseLengthPercentageDeclaration,
  "inset-inline": parseInsetInline,
  "inset-inline-end": parseLengthPercentageDeclaration,
  "inset-inline-start": parseLengthPercentageDeclaration,
  "justify-content": parseJustifyContent,
  "left": parseSizeWithAutoDeclaration,
  "letter-spacing": parseLetterSpacing,
  "line-height": parseLineHeightDeclaration,
  "margin": parseMargin,
  "margin-block": parseMarginBlock,
  "margin-block-end": parseLengthPercentageOrAutoDeclaration,
  "margin-block-start": parseLengthPercentageOrAutoDeclaration,
  "margin-bottom": parseSizeWithAutoDeclaration,
  "margin-inline": parseMarginInline,
  "margin-inline-end": parseLengthPercentageOrAutoDeclaration,
  "margin-inline-start": parseLengthPercentageOrAutoDeclaration,
  "margin-left": parseSizeWithAutoDeclaration,
  "margin-right": parseSizeWithAutoDeclaration,
  "margin-top": parseSizeWithAutoDeclaration,
  "max-block-size": parseSizeDeclaration,
  "max-height": parseSizeDeclaration,
  "max-inline-size": parseSizeDeclaration,
  "max-width": parseSizeDeclaration,
  "min-block-size": parseSizeDeclaration,
  "min-height": parseSizeDeclaration,
  "min-inline-size": parseSizeDeclaration,
  "min-width": parseSizeDeclaration,
  "opacity": ({ value }) => round(value),
  "outline": parseOutline,
  "outline-color": parseColorDeclaration,
  "place-content": parsePlaceContent,
  "place-items": parsePlaceItems,
  "place-self": parsePlaceSelf,
  "outline-style": parseOutlineStyle,
  "outline-width": parseBorderSideWidthDeclaration,
  "overflow": parseOverflow,
  "padding": parsePadding,
  "padding-block": parsePaddingBlock,
  "padding-block-end": parseLengthPercentageDeclaration,
  "padding-block-start": parseLengthPercentageDeclaration,
  "padding-bottom": parseSizeDeclaration,
  "padding-inline": parsePaddingInline,
  "padding-inline-end": parseLengthPercentageDeclaration,
  "padding-inline-start": parseLengthPercentageDeclaration,
  "padding-left": parseSizeDeclaration,
  "padding-right": parseSizeDeclaration,
  "padding-top": parseSizeDeclaration,
  "position": parsePosition,
  "right": parseSizeWithAutoDeclaration,
  "rotate": parseRotate,
  "row-gap": parseGap,
  "scale": parseScale,
  "stroke": parseSVGPaint,
  "stroke-width": parseLengthDeclaration,
  "text-align": parseTextAlign,
  "text-decoration": parseTextDecoration,
  "text-decoration-color": parseColorDeclaration,
  "text-decoration-line": parseTextDecorationLineDeclaration,
  "text-decoration-style": parseTextDecorationStyle,
  "text-shadow": parseTextShadow,
  "text-transform": ({ value }) => value.case,
  "top": parseSizeWithAutoDeclaration,
  "transform": parseTransform,
  "transform-origin": parseTransformOrigin,
  "transition": addTransitionValue,
  "transition-delay": addTransitionValue,
  "transition-duration": addTransitionValue,
  "transition-property": addTransitionValue,
  "transition-timing-function": addTransitionValue,
  "translate": parseTranslate,
  "user-select": parseUserSelect,
  "vertical-align": parseVerticalAlign,
  "visibility": parseVisibility,
  "width": parseSizeWithAutoDeclaration,
  "z-index": parseZIndex,
};

// This is missing LightningCSS types
(parsers as Record<string, Parser>)["pointer-events"] =
  parsePointerEvents as Parser;

const validProperties = new Set(Object.keys(parsers));

export function parseDeclaration(
  declaration: Declaration,
  builder: StylesheetBuilder,
) {
  if ("vendorPrefix" in declaration && declaration.vendorPrefix.length) {
    return;
  }

  if (
    "value" in declaration &&
    typeof declaration.value === "object" &&
    "vendorPrefix" in declaration.value &&
    Array.isArray(declaration.value.vendorPrefix) &&
    declaration.value.vendorPrefix.length
  ) {
    return;
  }

  if (declaration.property === "unparsed") {
    parseUnparsedDeclaration(declaration, builder);
  } else if (declaration.property === "custom") {
    parseCustomDeclaration(declaration, builder);
  } else {
    parseWithParser(declaration, builder);
  }
}

function parseWithParser(declaration: Declaration, builder: StylesheetBuilder) {
  if (declaration.property in parsers) {
    const parser = parsers[declaration.property] as Parser;

    builder.descriptorProperties = [declaration.property];

    builder.setWarningProperty(declaration.property);
    const value = parser(declaration, builder, declaration.property);

    if (value !== undefined) {
      // Unrenamed on purpose: `addDescriptor` is where `propertyRename` is
      // read, so every parser's emit is covered, not only the ones that return.
      builder.addDescriptor(declaration.property, value);
    }
  } else {
    builder.addWarning("property", declaration.property);
  }
}

function parseInsetBlock(
  { value }: DeclarationType<"inset-block">,
  builder: StylesheetBuilder,
) {
  builder.addShorthand("inset-block", {
    "inset-block-start": parseLengthPercentageOrAuto(value.blockStart, builder),
    "inset-block-end": parseLengthPercentageOrAuto(value.blockEnd, builder),
  });
}

function parseInsetInline(
  { value }: DeclarationType<"inset-inline">,
  builder: StylesheetBuilder,
) {
  // The INLINE axis. This wrote `inset-block-*`, so `inset-inline: 4px 8px`
  // positioned the element vertically — the inline shorthand landed on the
  // block axis while each longhand on its own was correct.
  builder.addShorthand("inset-inline", {
    "inset-inline-start": parseLengthPercentageOrAuto(
      value.inlineStart,
      builder,
    ),
    "inset-inline-end": parseLengthPercentageOrAuto(value.inlineEnd, builder),
  });
}

function parseInset(
  { value }: DeclarationType<"inset">,
  builder: StylesheetBuilder,
) {
  builder.addShorthand("inset", {
    top: parseLengthPercentageOrAuto(value.top, builder),
    bottom: parseLengthPercentageOrAuto(value.bottom, builder),
    left: parseLengthPercentageOrAuto(value.left, builder),
    right: parseLengthPercentageOrAuto(value.right, builder),
  });
}

function parseBorderRadius(
  { value }: DeclarationType<"border-radius">,
  builder: StylesheetBuilder,
) {
  const { bottomLeft, bottomRight, topLeft, topRight } = value;

  // Four identical corners are ONE elliptical radius, so the vertical half is
  // dropped once and is reported once — against the shorthand the author wrote.
  // `parseBorderStyle` states the rule this follows: splitting a uniform value
  // React Native cannot express into four identical longhand warnings says the
  // same thing four times and names properties nobody typed.
  //
  // Parsing once is what makes the report happen once — the narrowing IS the
  // parse (`parseSize2DDimensionPercentage`), so there is nothing to
  // de-duplicate afterwards. Corners that differ keep a warning each, because
  // each loses a DIFFERENT vertical radius.
  if (allEqual(bottomLeft, bottomRight, topLeft, topRight)) {
    builder.addDescriptor(
      "border-radius",
      parseSize2DDimensionPercentage(topLeft, builder),
    );
    return;
  }

  builder.addShorthand("border-radius", {
    "border-bottom-left-radius": parseSize2DDimensionPercentage(
      bottomLeft,
      builder,
    ),
    "border-bottom-right-radius": parseSize2DDimensionPercentage(
      bottomRight,
      builder,
    ),
    "border-top-left-radius": parseSize2DDimensionPercentage(topLeft, builder),
    "border-top-right-radius": parseSize2DDimensionPercentage(
      topRight,
      builder,
    ),
  });
}

function parseBorderColor(
  declaration: DeclarationType<
    "border-color" | "border-block-color" | "border-inline-color"
  >,
  builder: StylesheetBuilder,
) {
  // `parseColor` has to be told the key its value lands on, and the collapse is
  // what decides that key, so the four sides are handed over UNPARSED and the
  // collapse is taken on them. Comparing the sources is also the only
  // comparison that separates `light-dark(#333, #eee)` from
  // `light-dark(#333, #000)` — both parse to `#333`, and only one of those two
  // pairs may be collapsed onto a single key.
  if (declaration.property === "border-color") {
    builder.addShorthandFromSource(
      "border-color",
      {
        "border-top-color": declaration.value.top,
        "border-bottom-color": declaration.value.bottom,
        "border-left-color": declaration.value.left,
        "border-right-color": declaration.value.right,
      },
      (color, property) => parseColor(color, builder, property),
    );
  } else {
    // The two-edge shorthands take the same treatment for the same reason: the
    // collapse decides which key `parseColor` is told about, so it has to be
    // settled on the sources, before any parsing. Settled on the parsed values
    // instead, `border-block-color: light-dark(#333, #eee)` put the LIGHT value
    // on `borderBlockColor` while the dark halves were already registered on
    // `borderTopColor` / `borderBottomColor` — so in dark mode the element
    // carried both, and the light one won on two edges.
    //
    // Comparing the sources is also the only comparison that separates
    // `light-dark(#333, #eee)` from `light-dark(#333, #000)`: both parse to
    // `#333`, and only one of the two pairs may collapse onto a single key.
    //
    // Only the BLOCK axis has a key to collapse onto. `borderBlockColor` is a
    // React Native style key; there is no `borderInlineColor`, so the inline
    // axis writes its two edges every time. They are `borderStartColor` /
    // `borderEndColor` by way of `propertyRename` — React Native's own
    // direction-aware spelling of the same two edges.
    if (declaration.property === "border-block-color") {
      builder.addShorthandFromSource(
        "border-block-color",
        {
          "border-top-color": declaration.value.start,
          "border-bottom-color": declaration.value.end,
        },
        (color, property) => parseColor(color, builder, property),
      );
    } else {
      addColorDescriptor(
        builder,
        "border-inline-start-color",
        declaration.value.start,
      );
      addColorDescriptor(
        builder,
        "border-inline-end-color",
        declaration.value.end,
      );
    }
  }
}

function parseBorderWidth(
  { value }: DeclarationType<"border-width">,
  builder: StylesheetBuilder,
) {
  builder.addShorthand("border-width", {
    "border-top-width": parseBorderSideWidth(value.top, builder),
    "border-bottom-width": parseBorderSideWidth(value.bottom, builder),
    "border-left-width": parseBorderSideWidth(value.left, builder),
    "border-right-width": parseBorderSideWidth(value.right, builder),
  });
}

function parseBorder(
  { value }: DeclarationType<"border">,
  builder: StylesheetBuilder,
) {
  builder.addShorthand("border", {
    "border-width": parseBorderSideWidth(value.width, builder),
    "border-style": parseBorderStyle(value.style, builder),
    "border-color": parseColor(value.color, builder, "border-color"),
  });
}

function parseBorderSide(
  {
    value,
    property,
  }: DeclarationType<
    "border-top" | "border-bottom" | "border-left" | "border-right"
  >,
  builder: StylesheetBuilder,
) {
  addColorDescriptor(builder, property + "-color", value.color);
  builder.addDescriptor(
    property + "-width",
    parseBorderSideWidth(value.width, builder),
  );
}

// The block axis reaches React Native under two different spellings, and only
// one of them is real. The three block COLOURS are style attributes on both
// platforms, so they keep their own keys. The block WIDTHS live in
// `BaseViewConfig.ios.js` and nowhere else — not in `ReactNativeStyleAttributes`,
// not on Android, not in `ViewStyle` — so an emitted `borderBlockWidth` paints
// on iOS Fabric and is dropped everywhere else. They are written to the
// physical edges every platform reads instead, which is exact rather than an
// approximation: `direction` never flips the block axis, so block-start is the
// top edge and block-end the bottom one on every platform.
function parseBorderBlock(
  { value }: DeclarationType<"border-block">,
  builder: StylesheetBuilder,
) {
  const width = parseBorderSideWidth(value.width, builder);

  addColorDescriptor(builder, "border-block-color", value.color);
  builder.addDescriptor("border-top-width", width);
  builder.addDescriptor("border-bottom-width", width);
  dropUnsupportedEdgeStyle(
    parseBorderStyle(value.style, builder),
    builder,
    "border-block-style",
  );
}

function parseBorderBlockStart(
  { value }: DeclarationType<"border-block-start">,
  builder: StylesheetBuilder,
) {
  addColorDescriptor(builder, "border-block-start-color", value.color);
  builder.addDescriptor(
    "border-top-width",
    parseBorderSideWidth(value.width, builder),
  );
  dropUnsupportedEdgeStyle(
    parseBorderStyle(value.style, builder),
    builder,
    "border-block-start-style",
  );
}

function parseBorderBlockEnd(
  { value }: DeclarationType<"border-block-end">,
  builder: StylesheetBuilder,
) {
  addColorDescriptor(builder, "border-block-end-color", value.color);
  builder.addDescriptor(
    "border-bottom-width",
    parseBorderSideWidth(value.width, builder),
  );
  dropUnsupportedEdgeStyle(
    parseBorderStyle(value.style, builder),
    builder,
    "border-block-end-style",
  );
}

function parseBorderInline(
  { value }: DeclarationType<"border-inline">,
  builder: StylesheetBuilder,
) {
  // Both edges, written out. React Native has `borderStartColor` /
  // `borderEndColor` and `borderStartWidth` / `borderEndWidth` — the same two
  // direction-aware edges CSS names — but no key for the axis as a pair, so
  // `borderInlineColor` and `borderInlineWidth` were style keys nothing reads.
  // `propertyRename` is what turns each longhand into React Native's spelling.
  const width = parseBorderSideWidth(value.width, builder);

  addColorDescriptor(builder, "border-inline-start-color", value.color);
  addColorDescriptor(builder, "border-inline-end-color", value.color);
  builder.addDescriptor("border-inline-start-width", width);
  builder.addDescriptor("border-inline-end-width", width);

  // The style is dropped, as it is for `border-inline-start` / `-end` and for
  // every per-edge style longhand. React Native's only border style is
  // `borderStyle` and it applies to the whole box, so there is no key for one
  // axis to map to and a near-miss would style the block edges too.
  dropUnsupportedEdgeStyle(
    parseBorderStyle(value.style, builder),
    builder,
    "border-inline-style",
  );
}

function parseBorderInlineStart(
  { value }: DeclarationType<"border-inline-start">,
  builder: StylesheetBuilder,
) {
  addColorDescriptor(builder, "border-inline-start-color", value.color);
  builder.addDescriptor(
    "border-inline-start-width",
    parseBorderSideWidth(value.width, builder),
  );
  dropUnsupportedEdgeStyle(
    parseBorderStyle(value.style, builder),
    builder,
    "border-inline-start-style",
  );
}

function parseBorderInlineEnd(
  { value }: DeclarationType<"border-inline-end">,
  builder: StylesheetBuilder,
) {
  addColorDescriptor(builder, "border-inline-end-color", value.color);
  builder.addDescriptor(
    "border-inline-end-width",
    parseBorderSideWidth(value.width, builder),
  );
  dropUnsupportedEdgeStyle(
    parseBorderStyle(value.style, builder),
    builder,
    "border-inline-end-style",
  );
}

export function parseBorderInlineWidth(
  declaration: DeclarationType<"border-inline-width">,
  builder: StylesheetBuilder,
) {
  // Both edges, always. `parseBorderBlockWidth` collapses onto
  // `borderBlockWidth` because React Native has that key; there is no
  // `borderInlineWidth`, so a collapse here would write the two widths into a
  // key nothing reads. `propertyRename` turns each edge into React Native's own
  // `borderStartWidth` / `borderEndWidth`.
  builder.addDescriptor(
    "border-inline-start-width",
    parseBorderSideWidth(declaration.value.start, builder),
  );
  builder.addDescriptor(
    "border-inline-end-width",
    parseBorderSideWidth(declaration.value.end, builder),
  );
}

/**
 * Every per-edge border style, on either logical axis.
 *
 * React Native has no per-edge border style at any layer — the two
 * BaseViewConfigs and ReactNativeStyleAttributes carry `borderStyle` and
 * nothing else, and Android's BorderDrawable holds one style for the whole
 * path — so all six longhands drop rather than reaching a key the platform
 * ignores. The two-value forms name the edge they came from in the warning,
 * so a reader is told which half of the declaration was discarded.
 */
function parseUnsupportedEdgeStyle(
  declaration: DeclarationType<
    | "border-block-style"
    | "border-block-start-style"
    | "border-block-end-style"
    | "border-inline-style"
    | "border-inline-start-style"
    | "border-inline-end-style"
  >,
  builder: StylesheetBuilder,
) {
  if (typeof declaration.value === "string") {
    dropUnsupportedEdgeStyle(
      parseBorderStyle(declaration.value, builder),
      builder,
      declaration.property,
    );
    return;
  }

  const [startProperty, endProperty] =
    declaration.property === "border-block-style"
      ? (["border-block-start-style", "border-block-end-style"] as const)
      : (["border-inline-start-style", "border-inline-end-style"] as const);

  dropUnsupportedEdgeStyle(
    parseBorderStyle(declaration.value.start, builder),
    builder,
    startProperty,
  );
  dropUnsupportedEdgeStyle(
    parseBorderStyle(declaration.value.end, builder),
    builder,
    endProperty,
  );
}

/**
 * The top-level component values of an unparsed value. A component value is a
 * preserved token, a function, or a block, so every entry here is already one
 * — a var(), a calc(), a length, a colour. Whitespace is the only entry that
 * is not, and lightningcss keeps it only sometimes: `var(--a) var(--b)` and
 * `var(--a)var(--b)` both arrive as two bare var tokens, while `red var(--b)`
 * keeps its separator. Dropping whitespace is what makes the two agree.
 */
function unparsedComponentValues(
  tokenOrValues: TokenOrValue[],
): TokenOrValue[] {
  return tokenOrValues.filter(
    (tokenOrValue) =>
      !(
        tokenOrValue.type === "token" &&
        tokenOrValue.value.type === "white-space"
      ),
  );
}

/**
 * Expand a two-edge logical-axis shorthand that a var() kept unparsed, the way
 * parseBorderInline* / parseBorderBlock* expand the parsed form.
 */
function parseUnparsedAxis(
  tokenOrValues: TokenOrValue[],
  { edges: [startProperty, endProperty], axis }: (typeof axisExpansion)[string],
  builder: StylesheetBuilder,
  property: string,
) {
  const components = unparsedComponentValues(tokenOrValues);

  if (components.length === 1) {
    /**
     * One component reaches both edges with the same value, so it lands on the
     * axis property where React Native has one and on the pair where it does
     * not — the choice the parsed path makes for the same declaration.
     * descriptorProperties carries the whole target set so that light-dark(),
     * which writes to the builder from inside parseUnparsed rather than
     * through the returned value, reaches all of the single extra rule it
     * opens.
     */
    const targets = axis === undefined ? [startProperty, endProperty] : [axis];

    builder.descriptorProperties = targets;

    const value = parseUnparsed(components[0], builder, property);

    for (const target of targets) {
      builder.addDescriptor(target, value);
    }
    return;
  }

  if (components.length === 2) {
    builder.descriptorProperties = [startProperty];
    builder.addDescriptor(
      startProperty,
      parseUnparsed(components[0], builder, property),
    );

    builder.descriptorProperties = [endProperty];
    builder.addDescriptor(
      endProperty,
      parseUnparsed(components[1], builder, property),
    );
    return;
  }

  builder.addWarning("value", `${components.length} values (expected 1 or 2)`);
}

function dropUnsupportedEdgeStyle(
  style: string | undefined,
  builder: StylesheetBuilder,
  property: string,
) {
  if (style !== undefined && style !== "solid") {
    builder.addWarning("style", property, style);
  }
}

function parseFlexFlow(
  { value }: DeclarationType<"flex-flow">,
  builder: StylesheetBuilder,
) {
  builder.addDescriptor("flexWrap", value.wrap);
  builder.addDescriptor("flexDirection", value.direction);
}

function parseFlex(
  { value }: DeclarationType<"flex">,
  builder: StylesheetBuilder,
) {
  builder.addDescriptor("flex-grow", value.grow);
  builder.addDescriptor("flex-shrink", value.shrink);
  builder.addDescriptor(
    "flex-basis",
    // `flex: auto` is `1 1 auto` (css-flexbox-1 §7.1.1), so the basis is the
    // whole difference between it and `flex: 1`. Refusing the keyword here left
    // the two shorthands compiling to the identical style.
    parseLengthPercentageOrAuto(value.basis, builder, { allowAuto: true }),
  );
}

function parseMargin(
  { value }: DeclarationType<"margin">,
  builder: StylesheetBuilder,
) {
  builder.addShorthand("margin", {
    "margin-top": parseSize(value.top, builder, { allowAuto: true }),
    "margin-bottom": parseSize(value.bottom, builder, { allowAuto: true }),
    "margin-left": parseSize(value.left, builder, { allowAuto: true }),
    "margin-right": parseSize(value.right, builder, { allowAuto: true }),
  });
}

function parseMarginBlock(
  { value }: DeclarationType<"margin-block">,
  builder: StylesheetBuilder,
) {
  builder.addShorthand("margin-block", {
    "margin-block-start": parseLengthPercentageOrAuto(
      value.blockStart,
      builder,
      { allowAuto: true },
    ),
    "margin-block-end": parseLengthPercentageOrAuto(value.blockEnd, builder, {
      allowAuto: true,
    }),
  });
}

function parseMarginInline(
  { value }: DeclarationType<"margin-inline">,
  builder: StylesheetBuilder,
) {
  builder.addShorthand("margin-inline", {
    "margin-inline-start": parseLengthPercentageOrAuto(
      value.inlineStart,
      builder,
      { allowAuto: true },
    ),
    "margin-inline-end": parseLengthPercentageOrAuto(value.inlineEnd, builder, {
      allowAuto: true,
    }),
  });
}

function parsePadding(
  { value }: DeclarationType<"padding">,
  builder: StylesheetBuilder,
) {
  builder.addShorthand("padding", {
    "padding-top": parseSize(value.top, builder),
    "padding-bottom": parseSize(value.bottom, builder),
    "padding-left": parseSize(value.left, builder),
    "padding-right": parseSize(value.right, builder),
  });
}

function parsePaddingBlock(
  { value }: DeclarationType<"padding-block">,
  builder: StylesheetBuilder,
) {
  builder.addShorthand("padding-block", {
    "padding-block-start": parseLengthPercentageOrAuto(
      value.blockStart,
      builder,
    ),
    "padding-block-end": parseLengthPercentageOrAuto(value.blockEnd, builder),
  });
}

function parsePaddingInline(
  { value }: DeclarationType<"padding-inline">,
  builder: StylesheetBuilder,
) {
  builder.addShorthand("padding-inline", {
    "padding-inline-start": parseLengthPercentageOrAuto(
      value.inlineStart,
      builder,
    ),
    "padding-inline-end": parseLengthPercentageOrAuto(value.inlineEnd, builder),
  });
}

function parseFont(
  { value }: DeclarationType<"font">,
  builder: StylesheetBuilder,
) {
  builder.addDescriptor("font-family", firstFontFamily(value.family));
  builder.addDescriptor(
    "line-height",
    parseLineHeight(value.lineHeight, builder),
  );

  const fontSize = parseFontSize(value.size, builder);
  builder.addDescriptor("font-size", fontSize);
  // Publish `em` exactly as the `font-size` LONGHAND does
  // (`parseFontSizeDeclaration`). Without it the shorthand's own unitless
  // line-height resolved against the root rem instead of the size declared
  // beside it, so `font: 24px/1.5 Arial` gave 21 while the equivalent
  // longhands gave 36.
  publishEmVariable(fontSize, builder);
  builder.addDescriptor("font-style", parseFontStyle(value.style, builder));
  builder.addDescriptor(
    "font-variant-caps",
    parseFontVariantCaps(value.variantCaps, builder),
  );
  builder.addDescriptor("font-weight", parseFontWeight(value.weight, builder));
}

function parseTransform(
  { value }: DeclarationType<"transform">,
  builder: StylesheetBuilder,
) {
  builder.addDescriptor("transform", [
    {},
    "transform",
    value.flatMap((t): StyleDescriptor[] => {
      switch (t.type) {
        case "perspective":
          return [[{}, "perspective", parseLength(t.value, builder)]];
        case "translate":
          return [
            [
              {},
              "translateX",
              parseLengthOrCoercePercentageToRuntime(t.value[0], builder),
            ],
            // NOT wrapped in a second array. React Native's `transform` is a
            // FLAT list of single-key objects, so an extra level of nesting
            // ships an entry whose `keys.length` is 0 and fails
            // `processTransform`'s "exactly one property per transform object".
            [
              {},
              "translateY",
              parseLengthOrCoercePercentageToRuntime(t.value[1], builder),
            ],
          ];
        case "translateX":
          return [
            [
              {},
              "translateX",
              parseLengthOrCoercePercentageToRuntime(t.value, builder),
            ],
          ];
        case "translateY":
          return [
            [
              {},
              "translateY",
              parseLengthOrCoercePercentageToRuntime(t.value, builder),
            ],
          ];
        case "rotate":
          return [[{}, "rotate", parseAngle(t.value, builder)]];
        case "rotateX":
          return [[{}, "rotateX", parseAngle(t.value, builder)]];
        case "rotateY":
          return [[{}, "rotateY", parseAngle(t.value, builder)]];
        case "rotateZ":
          return [[{}, "rotateZ", parseAngle(t.value, builder)]];
        case "scale":
          return [
            [{}, "scaleX", parseScaleComponent(t.value[0], builder)],
            [{}, "scaleY", parseScaleComponent(t.value[1], builder)],
          ];
        case "scaleX":
          return [[{}, "scaleX", parseScaleComponent(t.value, builder)]];
        case "scaleY":
          return [[{}, "scaleY", parseScaleComponent(t.value, builder)]];
        case "skew":
          return [
            [{}, "skewX", parseAngle(t.value[0], builder)],
            [{}, "skewY", parseAngle(t.value[1], builder)],
          ];
        case "skewX":
          return [[{}, "skewX", parseAngle(t.value, builder)]];
        case "skewY":
          return [[{}, "skewY", parseAngle(t.value, builder)]];
        case "translate3d":
          // The x/y half is exact. A non-zero z has no React Native key —
          // there is no `translateZ` — so it is named in a warning rather than
          // dropped in silence.
          if (transformComponentNumber(t.value[2]) !== 0) {
            builder.addWarning("value", "translate3d(<z>)");
          }
          return [
            [
              {},
              "translateX",
              parseLengthOrCoercePercentageToRuntime(t.value[0], builder),
            ],
            [
              {},
              "translateY",
              parseLengthOrCoercePercentageToRuntime(t.value[1], builder),
            ],
          ];
        case "scale3d":
          if (transformComponentNumber(t.value[2]) !== 1) {
            builder.addWarning("value", "scale3d(<z>)");
          }
          return [
            [{}, "scaleX", parseLength(t.value[0], builder)],
            [{}, "scaleY", parseLength(t.value[1], builder)],
          ];
        case "rotate3d": {
          // `rotate3d` is an axis-angle rotation. React Native has only the
          // three Euler rotations, so it is exact for a UNIT AXIS and has no
          // decomposition for anything else.
          const rotation = axisAlignedRotation(
            t.value[0],
            t.value[1],
            t.value[2],
          );
          if (rotation === undefined) {
            builder.addWarning("value", "rotate3d(<axis>)");
            return [];
          }
          const angle = parseAngle(t.value[3], builder);
          return [
            [{}, rotation.axis, rotation.inverted ? negateAngle(angle) : angle],
          ];
        }
        case "matrix":
          // React Native takes a COLUMN-MAJOR 3x3, which is the same layout
          // CSS `matrix(a, b, c, d, e, f)` names: columns (a b 0), (c d 0),
          // (e f 1).
          return [
            [
              {},
              "matrix",
              [
                t.value.a,
                t.value.b,
                0,
                t.value.c,
                t.value.d,
                0,
                t.value.e,
                t.value.f,
                1,
              ],
            ],
          ];
        case "matrix3d":
          // CSS's `m11..m44` argument order IS column-major, and React Native's
          // 16-element form expects the same, so this is a straight copy.
          return [
            [
              {},
              "matrix",
              [
                t.value.m11,
                t.value.m12,
                t.value.m13,
                t.value.m14,
                t.value.m21,
                t.value.m22,
                t.value.m23,
                t.value.m24,
                t.value.m31,
                t.value.m32,
                t.value.m33,
                t.value.m34,
                t.value.m41,
                t.value.m42,
                t.value.m43,
                t.value.m44,
              ],
            ],
          ];
        case "translateZ":
        case "scaleZ":
          // No React Native key exists for either. Returning `[]` drops the
          // function; returning `[[]]` — as this did — ships an EMPTY object
          // into the transform array, which fails React Native's "exactly one
          // property per transform object" invariant and takes every sibling
          // transform down with it.
          builder.addWarning("value", `${t.type}()`);
          return [];
      }
    }),
  ]);
  return;
}

/**
 * Flip an angle's direction. `parseAngle` produces a `<number><unit>` string
 * such as `"45deg"`, so the negation is textual rather than numeric.
 */
function negateAngle(angle: StyleDescriptor): StyleDescriptor {
  if (typeof angle !== "string") {
    return typeof angle === "number" ? -angle : angle;
  }

  return angle.startsWith("-") ? angle.slice(1) : `-${angle}`;
}

/**
 * The number a 3D transform component holds, ignoring its unit.
 *
 * `translate3d`'s z arrives as `{type: "value", value: {unit, value}}` and
 * `scale3d`'s as `{type: "number", value}`, so the leaf sits one or two levels
 * down depending on the function. Only the identity check below reads it, and
 * that comparison does not care about the unit — a z is dropped either way; the
 * question is whether dropping it changes anything.
 */
function transformComponentNumber(component: unknown): number | undefined {
  if (typeof component !== "object" || component === null) {
    return undefined;
  }

  const { value } = component as { value?: unknown };

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "object" && value !== null) {
    const inner = (value as { value?: unknown }).value;
    return typeof inner === "number" ? inner : undefined;
  }

  return undefined;
}

/**
 * `rotate3d(x, y, z, angle)` maps onto one of React Native's Euler rotations
 * only when the axis is a unit axis. Any other axis needs a real rotation
 * matrix, which `transform` has no way to express here.
 */
function axisAlignedRotation(
  x: number,
  y: number,
  z: number,
): { axis: "rotateX" | "rotateY" | "rotateZ"; inverted: boolean } | undefined {
  // The MAGNITUDE does not matter — `rotate3d(0, 0, 2, 45deg)` is the same
  // rotation as `rotate3d(0, 0, 1, 45deg)` — but the SIGN does: rotating about
  // −Z by 45° is rotating about +Z by −45°, so a negative axis has to negate
  // the angle rather than be treated as the same rotation.
  if (x !== 0 && y === 0 && z === 0) {
    return { axis: "rotateX", inverted: x < 0 };
  }
  if (x === 0 && y !== 0 && z === 0) {
    return { axis: "rotateY", inverted: y < 0 };
  }
  if (x === 0 && y === 0 && z !== 0) {
    return { axis: "rotateZ", inverted: z < 0 };
  }
  return;
}

function parseTranslate(
  { value }: DeclarationType<"translate">,
  builder: StylesheetBuilder,
) {
  builder.addDescriptor("translateX", [
    {},
    "translateX",
    parseTranslateProp(value, "x", builder),
  ]);
  builder.addDescriptor("translateY", [
    {},
    "translateY",
    parseTranslateProp(value, "y", builder),
  ]);
}

function parseRotate(
  { value }: DeclarationType<"rotate">,
  builder: StylesheetBuilder,
) {
  if (value.x) {
    builder.addDescriptor("rotateX", [
      {},
      "rotateX",
      parseAngle(value.angle, builder),
    ]);
  }

  if (value.y) {
    builder.addDescriptor("rotateY", [
      {},
      "rotateY",
      parseAngle(value.angle, builder),
    ]);
  }

  if (value.z) {
    builder.addDescriptor("rotateZ", [
      {},
      "rotateZ",
      parseAngle(value.angle, builder),
    ]);
  }
}

function parseScale(
  { value }: DeclarationType<"scale">,
  builder: StylesheetBuilder,
) {
  builder.addDescriptor("scaleX", [
    {},
    "scaleX",
    parseScaleValue(value, "x", builder),
  ]);
  builder.addDescriptor("scaleY", [
    {},
    "scaleY",
    parseScaleValue(value, "y", builder),
  ]);
}

/**
 * The one parser for a scale component, shared by every emitter that produces
 * one: the `scale` longhand, and `scale()` / `scaleX()` / `scaleY()` inside the
 * `transform` shorthand.
 *
 * React Native's transform API is unitless, and enforces it by crashing the
 * screen rather than ignoring the value:
 *
 *   Invariant Violation: Transform with key of "scale" must be a number: {"scale":"75%"}
 *
 * lightningcss already holds a percentage as its fraction
 * (`75%` → `{ type: "percentage", value: 0.75 }`), so the number needed here is
 * the one it parsed. `parseLength` would serialise it back to the string `75%`,
 * which is correct for a layout property and fatal for a transform.
 */
function parseScaleComponent(
  value: NumberOrPercentage,
  builder: StylesheetBuilder,
): StyleDescriptor {
  return value.type === "percentage"
    ? round(value.value)
    : parseLength(value, builder);
}

export function parseScaleValue(
  scale: Scale,
  prop: keyof Extract<Scale, object>,
  builder: StylesheetBuilder,
): StyleDescriptor {
  // `scale: none` means "do not scale", and the transform that does not scale
  // is the identity one. Zero would collapse the element to nothing.
  if (scale === "none") {
    return 1;
  }

  return parseScaleComponent(scale[prop], builder);
}

function parseLetterSpacing(
  { value }: DeclarationType<"letter-spacing">,
  builder: StylesheetBuilder,
) {
  if (value.type === "normal") {
    return;
  }

  return parseLength(value.value, builder);
}

function parseTextDecoration(
  { value }: DeclarationType<"text-decoration">,
  builder: StylesheetBuilder,
) {
  addColorDescriptor(builder, "text-decoration-color", value.color);
  builder.addDescriptor(
    "text-decoration-line",
    parseTextDecorationLine(value.line, builder),
  );
}

function parseZIndex(
  { value }: DeclarationType<"z-index">,
  builder: StylesheetBuilder,
): StyleDescriptor {
  if (value.type === "integer") {
    return parseLength(value.value, builder);
  } else {
    builder.addWarning("value", value.type);
    return;
  }
}

function parseContainerType(
  _declaration: DeclarationType<"container-type">,
  builder: StylesheetBuilder,
) {
  builder.addContainer(["___default___"]);
  return;
}

function parseContainerName(
  { value }: DeclarationType<"container-name">,
  builder: StylesheetBuilder,
) {
  builder.addContainer(value.type === "none" ? false : value.value);
  return;
}

function parseContainer(
  { value }: DeclarationType<"container">,
  builder: StylesheetBuilder,
) {
  builder.addContainer(value.name.type === "none" ? false : value.name.value);
  return;
}

/**
 * The keywords every property accepts, which are never a parse error.
 * lightningcss elides `initial` and `inherit` before the compiler sees them,
 * but `unset` survives and is meaningful — the runtime reads it as "remove this
 * value".
 */
const CSS_WIDE_KEYWORDS = new Set([
  "inherit",
  "initial",
  "revert",
  "revert-layer",
  "unset",
]);

/**
 * The properties whose value is a `<color>` and nothing else, derived from the
 * parser table rather than listed again — so a colour property added there is
 * covered here without a second edit.
 */
const COLOR_PROPERTIES: ReadonlySet<string> = new Set(
  Object.entries(parsers)
    .filter(
      ([, parser]) =>
        parser === parseColorDeclaration ||
        parser === parseFontColorDeclaration ||
        // The shorthands are `<color>{1,4}`, so the same judgement applies to
        // every one of their components.
        parser === parseBorderColor,
    )
    .map(([property]) => property),
);

/** The rejected value, spelled the way the author wrote it, for the warning. */
function stringifyUnparsedTokens(
  tokens: Extract<Declaration, { property: "unparsed" }>["value"]["value"],
): string {
  return tokens
    .map((token) => {
      if (token.type !== "token") {
        return "";
      }
      switch (token.value.type) {
        case "white-space":
          return " ";
        case "ident":
        case "string":
          return token.value.value;
        case "number":
        case "percentage":
          return String(token.value.value);
        case "dimension":
          return `${String(token.value.value)}${token.value.unit}`;
        default:
          return "";
      }
    })
    .join("")
    .trim();
}

/**
 * Whether an unparsed COLOUR value is a plain keyword or number sequence, and
 * therefore invalid.
 *
 * lightningcss hands over an `unparsed` declaration for two very different
 * reasons, and they need opposite treatment:
 *
 * 1. The value needs RUNTIME RESOLUTION — it holds a `var()`, an `env()`, or a
 *    function. Valid CSS; must be deferred.
 * 2. The value does not match the property's grammar. INVALID CSS, which
 *    css-syntax-3 §9 says to ignore — and which used to be forwarded verbatim,
 *    so `background-color: bananas` produced `{backgroundColor: "bananas"}`,
 *    `background-color: 42` produced a NUMBER, and `background-color: red extra`
 *    produced an ARRAY.
 *
 * lightningcss does not distinguish the two: it reports no warning for either
 * (checked with `errorRecovery: true`), so the distinction has to be made here
 * from the value's shape.
 *
 * **Scoped to colour properties, deliberately.** The obvious generalisation —
 * "a bare keyword this compiler could not parse is invalid" — is wrong, because
 * a keyword lightningcss simply chose not to MODEL arrives by the same route:
 * `box-shadow: none`, `text-shadow: none` and `letter-spacing: 5%` are all valid
 * CSS and all land here. Only for a property whose entire grammar is `<color>`
 * can a plain ident be judged from the value alone. The general case needs a
 * per-property validator, which is a larger change than this one.
 *
 * A TYPED value (`length`, `angle`, `color`, …) means lightningcss understood
 * every token and only the SEQUENCE was unacceptable, so those are kept.
 */
function isInvalidUnparsedValue(
  tokens: Extract<Declaration, { property: "unparsed" }>["value"]["value"],
): boolean {
  let sawValue = false;

  for (const token of tokens) {
    if (token.type !== "token") {
      return false;
    }

    switch (token.value.type) {
      case "white-space":
      case "comment":
        continue;
      case "ident":
        if (CSS_WIDE_KEYWORDS.has(token.value.value.toLowerCase())) {
          return false;
        }
        sawValue = true;
        continue;
      case "number":
      case "percentage":
      case "dimension":
        sawValue = true;
        continue;
      default:
        return false;
    }
  }

  return sawValue;
}

export function parseUnparsedDeclaration(
  declaration: Extract<Declaration, { property: "unparsed" }>,
  builder: StylesheetBuilder,
) {
  let property = declaration.value.propertyId.property;

  if (!(property in parsers)) {
    builder.addWarning("property", property);
    return;
  }

  // Nothing is lost that React Native could have rendered: the whole property
  // has no native attribute, at any value. Warning here would fire on every
  // Tailwind v4 border-{x,s,e}-* utility, which emits `var(--tw-border-style)`
  // defaulting to the `solid` the parsed path drops without a word.
  if (unsupportedEdgeStyles.has(property)) {
    return;
  }

  builder.setWarningProperty(property);

  if (
    COLOR_PROPERTIES.has(property) &&
    isInvalidUnparsedValue(declaration.value.value)
  ) {
    builder.addWarning(
      "value",
      stringifyUnparsedTokens(declaration.value.value),
    );
    return;
  }

  /**
   * React Native doesn't support all the logical properties
   */
  const rename = propertyRename[property];
  if (rename) {
    property = rename;
  }

  const expansion = axisExpansion[property];
  if (expansion) {
    parseUnparsedAxis(declaration.value.value, expansion, builder, property);
    return;
  }

  if (unparsedNoRuntimeForm.has(property)) {
    return;
  }

  /**
   * Unparsed shorthand properties need to be parsed at runtime
   */
  builder.descriptorProperties = [property];

  if (unparsedRuntimeParsing.has(property)) {
    const args = parseUnparsed(declaration.value.value, builder, property);

    // Nothing parsed means there is nothing to defer. Wrapping `undefined` in a
    // runtime-parse descriptor still declares the property, so the rule ships a
    // style object asserting a key it could not produce — `transform-origin:
    // inherit` became `{}` rather than no style at all.
    if (args === undefined) {
      return;
    }

    if (property === "animation") {
      builder.addDescriptor("animation", [{}, property, args]);
    } else {
      const descriptor: StyleFunction = [{}, toRNProperty(property), args, 1];

      builder.addDescriptor(property, descriptor);

      // `font-size` publishes its own computed size as `--__rn-css-em`, on
      // every route it takes — the element's `em` lengths and its descendants
      // both read that channel, and a size the compiler could not resolve is
      // still the size those readers need. The RESOLVED descriptor is what is
      // published, not the raw token list, so the two agree by construction,
      // and `publishEmVariable` holds the one case that must not publish.
      if (property === "font-size") {
        publishEmVariable(descriptor, builder);
      }
    }
  } else {
    let value = parseUnparsed(declaration.value.value, builder, property);

    if (property === "font-family") {
      /**
       * The other half of `parseFontFamily`. A `font-family` LightningCSS could
       * not type reaches here instead, and it is still one family to React
       * Native - `font-family: Inter, Helvetica,` is a stack whichever parser
       * saw it. Only a stack whose first usable entry is a `var()` survives to
       * render, because that is the only value the compiler cannot read.
       */
      const narrowing = narrowFontFamily(value);

      switch (narrowing.kind) {
        case "family":
          value = narrowing.family;
          break;
        case "none":
          value = undefined;
          break;
        case "deferred":
          break;
      }
    }

    builder.addDescriptor(property, value);

    if (property === "color") {
      publishInheritedColor(value, builder);
    }
  }
}

/** The variable a color rule publishes and `color: inherit` reads back. */
const INHERITED_COLOR_VARIABLE = "__rn-css-color";

/**
 * A read of the inherited color, as `currentcolor` and `color: inherit` both
 * compile to it. A fresh tuple per call, because a descriptor is owned by the
 * rule it lands in.
 */
function inheritedColorLookup() {
  return [{}, "var", INHERITED_COLOR_VARIABLE] as const satisfies StyleFunction;
}

/**
 * Publish `value` to descendants as the inherited color, unless it reads the
 * inherited color itself.
 *
 * A rule is handed to descendants as an UNRESOLVED descriptor, so a value that
 * reads `--__rn-css-color` and is published under that same name resolves back
 * into itself: the descendant recurses until the stack is exhausted. Withholding
 * the publish leaves the nearest ancestor that names a color of its own as the
 * one descendants inherit — which is exactly right for `inherit`, `unset` and
 * `currentcolor`, and an approximation for a value that DERIVES from the
 * inherited color (`color-mix(in srgb, currentcolor, blue)`), where descendants
 * see the ancestor's color rather than the derived one. Publishing the derived
 * value is only possible once resolution happens in the publisher's own scope.
 */
function publishInheritedColor(
  value: StyleDescriptor,
  builder: StylesheetBuilder,
) {
  if (readsInheritedColor(value)) {
    return;
  }

  builder.addDescriptor(`--${INHERITED_COLOR_VARIABLE}`, value);
}

/**
 * Whether `value` reads `var(--__rn-css-color)` anywhere inside it.
 *
 * The read is not always at the top level. `var(--brand, inherit)` buries it in
 * a fallback, `color-mix(in srgb, currentcolor, blue)` and
 * `rgb(from currentcolor r g b)` bury it in an argument list, and
 * `light-dark(currentcolor, blue)` returns it from a branch — so the whole
 * descriptor tree is walked rather than its first level.
 */
function readsInheritedColor(value: StyleDescriptor): boolean {
  if (!Array.isArray(value)) {
    return false;
  }

  if (isStyleFunction(value)) {
    const args = value[2];

    if (value[1] === "var") {
      // `var()`'s arguments are the name alone, or `[name, fallback]`.
      const name = Array.isArray(args) ? args[0] : args;

      if (name === INHERITED_COLOR_VARIABLE) {
        return true;
      }
    }

    // A style function's other slots are its marker object, its name and the
    // delayed-resolution flag; only the arguments can nest a descriptor.
    return readsInheritedColor(args);
  }

  return value.some((entry) => readsInheritedColor(entry));
}

export function parseCustomDeclaration(
  declaration: Extract<Declaration, { property: "custom" }>,
  builder: StylesheetBuilder,
) {
  const property = declaration.value.name;

  // The third of the three declaration paths, and the last to name itself.
  // `parseWithParser` and `parseUnparsedDeclaration` both do this, so a value
  // warning raised anywhere below is attributed to the declaration that
  // produced it rather than falling back to whichever declaration named itself
  // last. Everything lightningcss does not model arrives here — `isolation`,
  // `mix-blend-mode`, `font-variant-numeric`, every `-rn-*` and every genuine
  // custom property — so without it their warnings were the only ones with no
  // property of their own.
  builder.setWarningProperty(property);

  if (property === "-webkit-line-clamp") {
    builder.addDescriptor(
      property,
      parseUnparsed(declaration.value.value, builder, property),
    );
  } else if (property === "-rn-ripple-style") {
    addKeywordDescriptor(builder, {
      target: property,
      resolver: "rnRippleStyle",
      value: parseUnparsed(declaration.value.value, builder, property),
      parseLiteral: (value) => (value === "borderless" ? true : undefined),
    });
  } else if (property === "-rn-ripple-layer") {
    addKeywordDescriptor(builder, {
      target: property,
      resolver: "rnRippleLayer",
      value: parseUnparsed(declaration.value.value, builder, property),
      parseLiteral: (value) => (value === "foreground" ? true : undefined),
    });
  } else if (property === "-rn-shadow-offset") {
    // React Native reads `shadowOffset` as `{width, height}` — that is what
    // `sizesDiffer` in `ReactNativeStyleAttributes` compares — and NEITHER
    // route produced it. `-rn-shadow-offset: 1px 2px` landed a two-element
    // ARRAY in `style`, so `.width`/`.height` read back `undefined` and the
    // shadow drew at 0,0; the escaped-dot form
    // (`-rn-shadow-offset\.width`) put the object on a top-level PROP instead,
    // because only the internal `&.` prefix targets the style object and `&` is
    // not a legal CSS property character.
    //
    // `&.` is exactly what `parseTextShadow` uses for the identically-shaped
    // `textShadowOffset`, so this is that mechanism reached from the `-rn-`
    // hatch rather than a new one.
    const offset = reduceParseUnparsed(
      declaration.value.value,
      builder,
      property,
      false,
    );

    if (containsStyleFunction(offset)) {
      // The pair is only known at runtime, so the object is assembled there —
      // one descriptor holding the whole `{width, height}` rather than the two
      // deep paths below, which reach the same style object by a different
      // road. Validating the numbers here is impossible when they are still a
      // `var()`, and dropping the declaration instead is what made
      // `-rn-shadow-offset: var(--o)` produce no shadow at all.
      builder.addDescriptor("shadowOffset", [{}, "rnShadowOffset", offset, 1]);
      return;
    }

    const [width, height] = Array.isArray(offset) ? offset : [];

    // Both components have to be plain numbers: React Native's `sizesDiffer`
    // reads `.width`/`.height` off the object arithmetically, so a deferred
    // value or a percentage there is not a shadow offset it can hold.
    if (typeof width === "number" && typeof height === "number") {
      builder.addDescriptor("&.shadowOffset.width", width);
      builder.addDescriptor("&.shadowOffset.height", height);
    } else {
      builder.addWarning("value", "-rn-shadow-offset");
    }
  } else if (property === "object-fit") {
    // https://github.com/parcel-bundler/lightningcss/issues/1046
    parseObjectFit(declaration.value, builder);
  } else if (property === "object-position") {
    // https://github.com/parcel-bundler/lightningcss/issues/1047
    parseObjectPosition(declaration.value, builder);
  } else if (property === "outline-offset") {
    // https://github.com/parcel-bundler/lightningcss/issues/1048
    builder.addDescriptor(
      property,
      parseUnparsed(declaration.value.value, builder, property),
    );
  } else if (property === "corner-shape") {
    addKeywordDescriptor(builder, {
      // React Native's key, not the CSS one: `corner-shape` renames as well as
      // translating its value.
      target: "borderCurve",
      resolver: "cornerShape",
      value: parseUnparsed(declaration.value.value, builder, property),
      parseLiteral: (value) => parseCornerShape(value, builder),
    });
  } else if (
    property === "font-variant" ||
    property === "font-variant-numeric" ||
    property === "font-variant-ligatures"
  ) {
    // lightningcss models none of these three, so they arrive here rather than
    // through `parsers`. All three compile to React Native's one `fontVariant`
    // prop — a LIST — which is why they share a walker and differ only in
    // which keywords each accepts.
    addKeywordDescriptor(builder, {
      target: "font-variant",
      resolver: "fontVariant",
      value: parseUnparsed(declaration.value.value, builder, property),
      parseLiteral: (value) => FONT_VARIANT_PARSERS[property](value, builder),
    });
  } else if (property === "isolation") {
    addKeywordDescriptor(builder, {
      target: "isolation",
      resolver: "isolation",
      value: parseUnparsed(declaration.value.value, builder, property),
      parseLiteral: (value) => parseIsolation(value, builder),
    });
  } else if (property === "mix-blend-mode") {
    addKeywordDescriptor(builder, {
      target: "mix-blend-mode",
      resolver: "mixBlendMode",
      value: parseUnparsed(declaration.value.value, builder, property),
      parseLiteral: (value) => parseMixBlendMode(value, builder),
    });
  } else if (
    validProperties.has(property) ||
    property.startsWith("--") ||
    property.startsWith("-rn-")
  ) {
    builder.addDescriptor(
      property,
      parseUnparsed(declaration.value.value, builder, property),
    );
  } else {
    builder.addWarning("property", declaration.value.name);
  }
}

/**
 * A `<ratio>` written as three tokens, e.g. `16 / 9`.
 *
 * Only a two-term ratio is one: anything longer that happens to contain a `/`
 * is not a ratio and has no canonical form to normalise it to.
 */
function isRatioGroup(
  group: readonly unknown[],
): group is [number, "/", number] {
  return (
    group.length === 3 &&
    typeof group[0] === "number" &&
    group[1] === "/" &&
    typeof group[2] === "number"
  );
}

/**
 * The same value `parseAspectRatio` produces for the same ratio.
 *
 * Whether a `<ratio>` reaches the runtime through the property parser or
 * through this one is decided by whether the compiler folded the variable
 * holding it, and that decision must not be visible in the value.
 */
function ratioDescriptor([width, , height]: [
  number,
  "/",
  number,
]): StyleDescriptor {
  return width === height ? 1 : `${width}/${height}`;
}

export function reduceParseUnparsed(
  tokenOrValues: TokenOrValue[],
  builder: StylesheetBuilder,
  property: string,
  allowAuto: boolean,
  use: ValueUse = valueUseFor(property),
): StyleDescriptor {
  const result = tokenOrValues
    .map((tokenOrValue) =>
      parseUnparsed(tokenOrValue, builder, property, allowAuto, use),
    )
    .filter((v) => v !== undefined);

  if (result.length === 0) {
    return undefined;
  }

  let currentGroup: StyleDescriptor = [];
  let groups: StyleDescriptor[] = [currentGroup];

  for (const value of result) {
    if ((value as unknown) === CommaSeparator) {
      currentGroup = [];
      groups.push(currentGroup);
    } else {
      currentGroup.push(value);
    }
  }

  // Groups are the tokens grouped together by comma location
  // If a group only has 1 item, it shouldn't be an array
  groups = groups.flatMap((group): StyleDescriptor[] => {
    if (!Array.isArray(group)) {
      return [];
    }

    if (group.length === 0) {
      return [];
    } else if (group.length === 1) {
      const first = group[0];

      if (first === undefined) {
        return [];
      } else {
        return [first];
      }
    } else if (isRatioGroup(group)) {
      return [ratioDescriptor(group)];
    } else {
      return [group];
    }
  });

  return groups.length === 1 ? groups[0] : groups;
}

export function unparsedFunction(
  token: Extract<TokenOrValue, { type: "function" }>,
  builder: StylesheetBuilder,
  property: string,
  allowAuto: boolean,
  use: ValueUse = valueUseFor(property),
): StyleFunction {
  return [
    {},
    toRNProperty(token.value.name),
    reduceParseUnparsed(
      token.value.arguments,
      builder,
      property,
      allowAuto,
      use,
    ),
  ];
}

/**
 * When the CSS cannot be parsed (often due to a runtime condition like a CSS variable)
 * This export function best efforts parsing it into a export function that we can evaluate at runtime
 */
/**
 * What a parsed value is FOR, which is what decides whether a length may be
 * folded to a bare number.
 *
 * Folding is lossy in exactly one way that matters: a bare number in
 * `line-height` position is a MULTIPLE of the font size and a length is pixels
 * (css-inline-3 §2.3), so `24px` and `1.5` must stay distinguishable. Whether
 * they have to is decided by who reads the value next, and there are only two
 * answers.
 */
type ValueUse =
  /**
   * The value IS the property's value. Its consumer is known here, it is the
   * one that asked, and it can land in the static declaration record without
   * passing through `resolveValue` at all — where a suffixed string would reach
   * React Native raw, as `{outlineOffset: "1px"}` for a key whose type is a
   * number.
   */
  | "declared"
  /**
   * The value is STORED, to be substituted somewhere else later, and read back
   * by a runtime resolver that will know no more about it than the descriptor
   * carries.
   */
  | "substituted";

/**
 * The use a value takes from the property it is written under.
 *
 * A custom property is the whole of it: css-variables-1 §2 makes its value an
 * uninterpreted token stream that means nothing until it is substituted, so
 * nothing is known here about what it will be asked to be. Every other property
 * consumes what it is given.
 *
 * A `var()` FALLBACK is the case this default cannot answer, and is the reason
 * the use is threaded rather than derived at each site: a fallback's tokens are
 * parsed under the CONSUMING property — they have to be, or `auto` and a
 * font-relative percentage would be read wrong — but they are then stored
 * inside the `var()` descriptor and read back by `resolveDimension`, which is
 * in exactly the position a custom property's consumer is in. So the site that
 * builds a fallback names the use, and everything below it inherits.
 */
function valueUseFor(property: string): ValueUse {
  return property.startsWith("--") ? "substituted" : "declared";
}

/**
 * A length with the one fact folding destroys kept: that it is a LENGTH.
 *
 * The sibling of `allowsAutoKeyword`, and the same shape — a question about the
 * value's context that the value itself cannot answer.
 *
 * A `px` suffix is what `native/styles/dimension.ts` already classifies as a
 * length, and `resolveValue`'s `PIXEL_LENGTH` branch reads it back as the
 * number every other consumer wanted. It is also what the provider route
 * produces — `native/styles/parse-value.ts`'s `classifyNumeric` keeps `px` on a
 * tokenised value for this reason — so every entry point into a stored value is
 * one representation rather than three.
 *
 * Only a bare number is rewritten. A percentage string, a length FUNCTION
 * (`em`, `vw`, a `calc()`) and a keyword all carry their own type already.
 */
function asDeclaredLength(
  value: StyleDescriptor,
  use: ValueUse,
): StyleDescriptor {
  return typeof value === "number" && use === "substituted"
    ? `${value}px`
    : value;
}

export function parseUnparsed(
  tokenOrValue:
    | TokenOrValue
    | TokenOrValue[]
    | string
    | number
    | undefined
    | null,
  builder: StylesheetBuilder,
  property: string,
  allowAuto = allowsAutoKeyword(property),
  use: ValueUse = valueUseFor(property),
): StyleDescriptor {
  if (tokenOrValue === undefined || tokenOrValue === null) {
    return;
  }

  if (typeof tokenOrValue === "string") {
    if (tokenOrValue === "true") {
      return true;
    } else if (tokenOrValue === "false") {
      return false;
    } else if (tokenOrValue === "currentcolor") {
      return inheritedColorLookup();
    } else {
      return tokenOrValue;
    }
  }

  if (typeof tokenOrValue === "number") {
    return round(tokenOrValue);
  }

  if (Array.isArray(tokenOrValue)) {
    const args = reduceParseUnparsed(
      tokenOrValue,
      builder,
      property,
      allowAuto,
      use,
    );
    // `reduceParseUnparsed` signals "nothing usable" as exactly `undefined`, so
    // that is what this must test. A falsy check also discarded the legitimate
    // values `0`, `""` and `false` — which meant `width: 0`, `margin: 0`,
    // `top: 0`, `gap: 0`, `z-index: 0` and `-rn-include-font-padding: false`
    // silently produced no style whenever the declaration took the runtime
    // path. `0%` survived, because a string is truthy, which is what made the
    // fault look property-specific rather than type-specific.
    if (args === undefined) return;
    if (Array.isArray(args) && args.length === 1) {
      return args[0];
    } else if (
      (property === "filter" || property === "transform") &&
      isStyleFunction(args)
    ) {
      return [args];
    } else {
      return args;
    }
  }

  switch (tokenOrValue.type) {
    case "unresolved-color": {
      return parseUnresolvedColor(
        tokenOrValue.value,
        builder,
        property,
        allowAuto,
        use,
      );
    }
    case "var": {
      let args: StyleDescriptor = tokenOrValue.value.name.ident.slice(2);
      // The fallback is STORED, whatever the enclosing declaration is doing
      // with its own value — it goes inside the descriptor below and is read
      // back by `resolveDimension` only if the variable is missing at render.
      // Parsed as a declared value it folded `24px` to `24`, and
      // `line-height: var(--never, 24px)` rendered 24 font sizes where
      // `line-height: var(--x)` with `--x: 24px` rendered 24 pixels.
      //
      // The PROPERTY stays the consuming one: `auto` and a font-relative
      // percentage are still read against the declaration that will consume the
      // fallback. Only the use changes.
      const fallback = parseUnparsed(
        tokenOrValue.value.fallback,
        builder,
        property,
        allowAuto,
        "substituted",
      );
      if (fallback !== undefined) {
        args = [args, fallback];
      }

      return [{}, "var", args, 1];
    }
    case "function": {
      // `shadow` is deliberately absent from this list: it was on it with no
      // runtime resolver anywhere, so `box-shadow: shadow(var(--x))` reached
      // React Native as the literal string `"shadow(1)"`. There is no such CSS
      // function, and nothing in this library emits one.
      //
      // This list is the RUNTIME half of `parseTransform`'s compile-time switch,
      // and the two drifted apart: `matrix`, `matrix3d`, `perspective`,
      // `rotateZ` and `skew` were handled at compile time and missing here, so
      // each was warned about and DROPPED the moment its value had to be
      // resolved at runtime. `transform: rotateZ(var(--a))` lost the rotation
      // while `transform: rotateZ(45deg)` kept it.
      switch (tokenOrValue.value.name) {
        case "blur":
        case "brightness":
        case "contrast":
        case "cubic-bezier":
        case "drop-shadow":
        case "fontScale":
        case "getPixelSizeForLayoutSize":
        case "grayscale":
        case "hsl":
        case "hsla":
        case "hue-rotate":
        case "invert":
        case "opacity":
        case "pixelScale":
        case "platformColor":
        case "rgb":
        case "rgba":
        case "matrix":
        case "matrix3d":
        case "perspective":
        case "rotate":
        case "rotateX":
        case "rotateY":
        case "rotate3d":
        case "rotateZ":
        case "roundToNearestPixel":
        case "saturate":
        case "scale":
        case "scale3d":
        case "scaleX":
        case "scaleY":
        case "sepia":
        case "skew":
        case "skewX":
        case "skewY":
        case "steps":
        case "translate":
        case "translate3d":
        case "translateX":
        case "translateY":
          return unparsedFunction(
            tokenOrValue,
            builder,
            property,
            allowAuto,
            use,
          );
        case "conic-gradient":
        case "linear-gradient":
        case "radial-gradient":
        case "repeating-conic-gradient":
        case "repeating-linear-gradient":
        case "repeating-radial-gradient":
          // Every gradient family keeps its name VERBATIM, where the generic
          // `unparsedFunction` below would run it through `toRNProperty` and
          // hand back `conicGradient`. The hyphen is not cosmetic: it is the
          // name the runtime resolver is registered under
          // (`native/styles/functions/gradient-functions.ts` exports one
          // resolver under all six), and it is the name React Native's own
          // `processBackgroundImage` parses. A camelCased name resolves to
          // nothing and the declaration disappears.
          //
          // All six are listed because all six are reachable here — this is
          // the route a gradient takes when a `var()` anywhere inside it
          // defers the declaration to runtime, and that is independent of
          // which families React Native can paint today. Naming only the two
          // it paints dropped the other four on the runtime route while the
          // compile-time route emitted them, so one stylesheet rendered
          // differently depending on whether its gradient was written out or
          // reached through a variable.
          return [
            {},
            tokenOrValue.value.name,
            reduceParseUnparsed(
              tokenOrValue.value.arguments,
              builder,
              property,
              allowAuto,
              use,
            ),
          ];
        case "hairlineWidth":
          return [{}, tokenOrValue.value.name, []];
        case "calc":
        case "max":
        case "min":
        case "clamp":
          return parseCalcFn(
            tokenOrValue.value.name,
            tokenOrValue.value.arguments,
            builder,
            property,
            use,
          );
        case "color-mix":
          return parseColorMix(tokenOrValue.value.arguments, builder, property);
        default: {
          builder.addWarning("value", `${tokenOrValue.value.name}()`);
          return;
        }
      }
    }
    case "length":
      return asDeclaredLength(parseLength(tokenOrValue.value, builder), use);
    case "angle":
      return parseAngle(tokenOrValue.value, builder);
    case "token":
      switch (tokenOrValue.value.type) {
        case "string":
        case "ident": {
          const value = tokenOrValue.value.value;
          if (!allowAuto && value === "auto") {
            builder.addWarning("value", value);
            return;
          }

          // CSS-wide keywords and `currentcolor` are case-insensitive, and
          // lightningcss hands them through unfolded.
          const keyword = value.toLowerCase();

          // Per CSS Color, `currentcolor` as the value of `color` is defined as
          // `inherit`; and per CSS Cascade, `unset` on an inherited property
          // (`color` is inherited) computes to `inherit` too. So `currentcolor`
          // (valid on any property) and `inherit` / `unset` on `color` all
          // resolve to the inherited-color variable every color rule publishes
          // to its subtree (see publishInheritedColor).
          //
          // `color: currentcolor` does not arrive here — lightningcss parses it
          // into a CssColor, so parseColor handles it. This clause serves the
          // UNPARSED properties: box-shadow, filter: drop-shadow(), and custom
          // properties, whose values reach the compiler as raw tokens.
          if (
            keyword === "currentcolor" ||
            ((keyword === "inherit" || keyword === "unset") &&
              property === "color")
          ) {
            return inheritedColorLookup();
          }

          // `inherit` on any other property has no per-property inheritance
          // context here, `initial` has no per-property initial value, and
          // React Native has no cascade origins for `revert` / `revert-layer`
          // to roll back to. None of them has a value to compile to, so they
          // drop with a warning rather than reaching the style as a literal.
          //
          // `unset` on a non-color property is the exception: it means
          // `initial` there, and the runtime already turns the literal into
          // `null`, which is how `background-color: unset` clears a color.
          if (
            keyword === "inherit" ||
            keyword === "initial" ||
            keyword === "revert" ||
            keyword === "revert-layer"
          ) {
            builder.addWarning("value", value);
            return;
          }

          if (value === "true") {
            return true;
          } else if (value === "false") {
            return false;
          } else if (value === "infinity") {
            return Number.MAX_SAFE_INTEGER;
          } else {
            return value;
          }
        }
        case "number": {
          return round(tokenOrValue.value.value);
        }
        case "function":
          builder.addWarning("value", tokenOrValue.value.value);
          return;
        case "percentage":
          // The consuming property decides what a percentage measures against,
          // and here it is known — this is the value written in a `var()`
          // fallback, parsed under the property that will read it. `font-size`
          // measures against the parent's size and so takes the `em` its typed
          // route produces; every other property keeps the `"50%"` string
          // React Native reads as a fraction of its container.
          return PARENT_FONT_RELATIVE_PERCENTAGE_PROPERTIES.has(property)
            ? percentageAsEm(tokenOrValue.value.value)
            : `${round(tokenOrValue.value.value * 100)}%`;
        case "dimension":
          return asDeclaredLength(
            parseDimension(tokenOrValue.value, builder),
            use,
          );
        case "comma":
          return CommaSeparator as unknown as StyleDescriptor;
        case "delim": {
          if (tokenOrValue.value.value === "/") {
            return tokenOrValue.value.value;
          }
          return;
        }
        case "at-keyword":
        case "hash":
        case "id-hash":
        case "unquoted-url":
        case "white-space":
        case "comment":
        case "colon":
        case "semicolon":
        case "include-match":
        case "dash-match":
        case "prefix-match":
        case "suffix-match":
        case "substring-match":
        case "cdo":
        case "cdc":
        case "parenthesis-block":
        case "square-bracket-block":
        case "curly-bracket-block":
        case "bad-url":
        case "bad-string":
        case "close-parenthesis":
        case "close-square-bracket":
        case "close-curly-bracket":
          return;
        default: {
          tokenOrValue.value satisfies never;
          return;
        }
      }
    case "color":
      return parseColor(tokenOrValue.value, builder);
    case "env":
      return parseEnv(tokenOrValue.value, builder);
    case "time":
      return parseTime(tokenOrValue.value);
    case "url":
    case "resolution":
    case "dashed-ident":
    case "animation-name":
      return;
    default: {
      tokenOrValue satisfies never;
    }
  }

  return;
}

export function parseLengthDeclaration(
  declaration: {
    value:
      | number
      | Length
      | DimensionPercentageFor_LengthValue
      | NumberOrPercentage
      | LengthValue;
  },
  builder: StylesheetBuilder,
) {
  return parseLength(declaration.value, builder);
}

export function parseLength(
  length:
    | number
    | Length
    | DimensionPercentageFor_LengthValue
    | NumberOrPercentage
    | LengthValue,
  builder: StylesheetBuilder,
): StyleDescriptor {
  const { inlineRem = 14 } = builder.getOptions();

  if (typeof length === "number") {
    return round(length);
  }

  if ("unit" in length) {
    switch (length.unit) {
      case "px": {
        if (length.value === Infinity) {
          return Number.MAX_SAFE_INTEGER;
        } else if (length.value === -Infinity) {
          return Number.MIN_SAFE_INTEGER;
        } else {
          // Normalize large values to safe integers, e.g. `calc(infinity * 1px)`
          const value = Math.max(
            Math.min(length.value, Number.MAX_SAFE_INTEGER),
            Number.MIN_SAFE_INTEGER,
          );
          return round(value);
        }
      }
      case "rem":
        if (typeof inlineRem === "number") {
          return length.value * inlineRem;
        } else {
          return [{}, "rem", round(length.value)];
        }
      case "vw":
      case "vh":
      case "em":
        return [{}, length.unit, round(length.value), 1];
      // The absolute units are exact multiples of a CSS pixel (css-values-4
      // §6.2), so they fold here with no device input.
      //
      // The compiler's `Length` visitor folds them too, one pass earlier — but
      // it only sees values lightningcss PARSED as lengths, and a custom
      // property's value is an untyped token list. `--x: 10pt; width: var(--x)`
      // therefore reaches this switch with the unit intact, and used to be
      // warned about and dropped. `rem` has always had a branch here for
      // exactly that reason; these are its missing siblings.
      case "in":
      case "cm":
      case "mm":
      case "q":
      case "pt":
      case "pc":
        return round(length.value * ABSOLUTE_UNIT_PIXELS[length.unit]);
      case "ex":
      case "rex":
      case "ch":
      case "rch":
      case "cap":
      case "rcap":
      case "ic":
      case "ric":
      case "lh":
      case "rlh":
      case "lvw":
      case "svw":
      case "dvw":
      case "cqw":
      case "lvh":
      case "svh":
      case "dvh":
      case "cqh":
      case "vi":
      case "svi":
      case "lvi":
      case "dvi":
      case "cqi":
      case "vb":
      case "svb":
      case "lvb":
      case "dvb":
      case "cqb":
      case "vmin":
      case "svmin":
      case "lvmin":
      case "dvmin":
      case "cqmin":
      case "vmax":
      case "svmax":
      case "lvmax":
      case "dvmax":
      case "cqmax":
        builder.addWarning("value", `${length.value}${length.unit}`);
        return undefined;
      default: {
        length.unit satisfies never;
      }
    }
  } else {
    switch (length.type) {
      case "calc": {
        // TODO: Add the calc polyfill
        return undefined;
      }
      case "number": {
        return round(length.value);
      }
      case "percentage": {
        return `${round(length.value * 100)}%`;
      }
      case "dimension":
      case "value": {
        return parseLength(length.value, builder);
      }
    }
  }

  return;
}

/**
 * Write a colour to a style key, telling `parseColor` where it is going.
 *
 * The one call shape for every colour descriptor, so the key a colour lands on
 * and the key its `light-dark()` dark rule lands on are the same string by
 * construction rather than by two call sites agreeing.
 */
function addColorDescriptor(
  builder: StylesheetBuilder,
  property: string,
  cssColor: CssColor,
) {
  builder.addDescriptor(property, parseColor(cssColor, builder, property));
}

/**
 * CSS system colours (css-color-4 §6.2) as `PlatformColor` name lists.
 *
 * Each entry is `[iOS name, Android theme attribute, Android fallback]`.
 * `PlatformColor` takes the first name that resolves, so ONE descriptor serves
 * both platforms — iOS matches a `UIColor` semantic name and skips the rest,
 * Android skips the iOS name and resolves a `?attr/`, then a framework
 * resource.
 *
 * **The Android fallback is not optional.** `ColorPropConverter` THROWS a
 * `JSApplicationCausedNativeException` when nothing in the list resolves, so
 * every chain has to end in an `@android:color/…` that always exists.
 *
 * Without this table every one of these dropped with no warning, though the
 * mechanism was already in the library — `platformColor()` and the
 * `currentcolor` default both use it.
 *
 * Only three pairings are EXACT (`canvas`, `canvastext`, `linktext`); the rest
 * are the closest role each platform has, and a few have no equivalent at all
 * on one side. That is the nature of a system colour: it names a role, and the
 * two platforms do not carve their roles the same way. The deprecated set
 * (css-color-4 §6.3 — `window`, `menutext`, `threedface` and friends) maps onto
 * whichever modern colour supersedes it.
 */
const SYSTEM_COLORS: Record<string, readonly string[] | undefined> = {
  // Exact on both platforms.
  canvas: ["systemBackgroundColor", "?android:attr/colorBackground"],
  canvastext: ["labelColor", "?android:attr/textColorPrimary"],
  linktext: ["linkColor", "?android:attr/textColorLink"],

  // Close — both name the disabled / tertiary text role.
  graytext: ["tertiaryLabelColor", "?android:attr/textColorTertiary"],

  // Approximations. Neither platform has an "input surface" colour, a button
  // face (iOS buttons are borderless), or a visited-link colour.
  accentcolor: [
    "systemBlueColor",
    "?attr/colorAccent",
    "?android:attr/colorAccent",
  ],
  accentcolortext: [
    "systemBackgroundColor",
    "?android:attr/textColorPrimaryInverse",
  ],
  activetext: ["systemRedColor", "?android:attr/textColorLink"],
  buttonborder: [
    "separatorColor",
    "?attr/colorControlNormal",
    "?android:attr/colorControlNormal",
  ],
  buttonface: [
    "secondarySystemFillColor",
    "?attr/colorButtonNormal",
    "?android:attr/colorButtonNormal",
  ],
  buttontext: ["linkColor", "?android:attr/textColorPrimary"],
  field: ["secondarySystemBackgroundColor", "?android:attr/colorBackground"],
  fieldtext: ["labelColor", "?android:attr/textColorPrimary"],
  highlight: ["systemBlueColor", "?android:attr/textColorHighlight"],
  highlighttext: ["systemBackgroundColor", "?android:attr/textColorPrimary"],
  mark: ["systemYellowColor", "?android:attr/textColorHighlight"],
  marktext: ["labelColor", "?android:attr/textColorPrimary"],
  selecteditem: [
    "systemBlueColor",
    "?attr/colorControlActivated",
    "?android:attr/colorAccent",
  ],
  selecteditemtext: [
    "systemBackgroundColor",
    "?android:attr/textColorPrimaryInverse",
  ],
  visitedtext: ["systemPurpleColor", "?android:attr/textColorLink"],
};

// The deprecated system colours, each pointing at the modern colour that
// supersedes it (css-color-4 §6.3). Written as aliases rather than repeated
// entries so the two can never disagree.
for (const [deprecated, modern] of [
  ["activeborder", "buttonborder"],
  ["activecaption", "canvastext"],
  ["appworkspace", "canvas"],
  ["background", "canvas"],
  ["buttonhighlight", "buttonface"],
  ["buttonshadow", "buttonface"],
  ["captiontext", "canvastext"],
  ["inactiveborder", "buttonborder"],
  ["inactivecaption", "canvas"],
  ["inactivecaptiontext", "graytext"],
  ["infobackground", "canvas"],
  ["infotext", "canvastext"],
  ["menu", "canvas"],
  ["menutext", "canvastext"],
  ["scrollbar", "canvas"],
  ["threeddarkshadow", "buttonborder"],
  ["threedface", "buttonface"],
  ["threedhighlight", "buttonborder"],
  ["threedlightshadow", "buttonborder"],
  ["threedshadow", "buttonborder"],
  ["window", "canvas"],
  ["windowframe", "buttonborder"],
  ["windowtext", "canvastext"],
] as const) {
  SYSTEM_COLORS[deprecated] = SYSTEM_COLORS[modern];
}

/**
 * How many CSS pixels one of each absolute unit is worth — css-values-4 §6.2,
 * which fixes all of them against the inch (1in = 96px) rather than against the
 * device, so the conversion needs no device input and can happen at build time.
 *
 * Read from two places, and both are needed: the compiler's first-pass `Length`
 * visitor folds every length lightningcss PARSED as one, and `parseLength`
 * below catches the values that arrive as raw tokens — a custom property's
 * value, which lightningcss does not type.
 */
export const ABSOLUTE_UNIT_PIXELS: Record<
  "cm" | "in" | "mm" | "pc" | "pt" | "q",
  number
> = {
  cm: 96 / 2.54,
  in: 96,
  mm: 96 / 25.4,
  pc: 16,
  pt: 96 / 72,
  q: 96 / 101.6,
};

export function parseAngle(angle: Angle | number, builder: StylesheetBuilder) {
  if (typeof angle === "number") {
    return `${angle}deg`;
  }

  switch (angle.type) {
    case "deg":
    case "rad":
      return `${angle.value}${angle.type}`;
    // The compiler's `Angle` visitor normalises these one pass earlier, but it
    // only sees values lightningcss PARSED as angles — a custom property's
    // value is an untyped token list, so `--a: 0.25turn; transform:
    // rotate(var(--a))` reaches here with the unit intact.
    //
    // Dropping it was worse than losing the rotation: `rotate(undefined)` is an
    // object with no live key, and React Native's `processTransform` rejects an
    // entry that does not have exactly one property by discarding the WHOLE
    // transform list.
    case "turn":
      return `${round(angle.value * 360)}deg`;
    case "grad":
      return `${round(angle.value * 0.9)}deg`;
    default:
      // Every CSS angle unit is now handled, so a new one becomes a compile
      // error here rather than a silently dropped rotation. `builder` is kept
      // in the signature because that is what a future unhandled unit will need.
      angle satisfies never;
      void builder;
      return undefined;
  }
}

export function parseSizeDeclaration(
  declaration: { value: Size | MaxSize },
  builder: StylesheetBuilder,
) {
  return parseSize(declaration.value, builder);
}

export function parseSizeWithAutoDeclaration(
  declaration: { value: Size | MaxSize },
  builder: StylesheetBuilder,
) {
  return parseSize(declaration.value, builder, { allowAuto: true });
}

export function parsePointerEvents(
  { value }: { value: string },
  builder: StylesheetBuilder,
) {
  switch (value) {
    case "none":
    case "box-none":
    case "box-only":
    case "auto":
      return value;
    case "visible":
    case "visiblePainted":
    case "visibleFill":
    case "visibleStroke":
    case "painted":
    case "fill":
    case "stroke":
      builder.addWarning("value", value);
  }

  return;
}

export function parseSize(
  size: Size | MaxSize,
  builder: StylesheetBuilder,
  options?: { allowAuto?: boolean },
): StyleDescriptor;
export function parseSize(
  size: Size | MaxSize,
  builder: StylesheetBuilder,
  property: string,
  options?: { allowAuto?: boolean },
): StyleDescriptor;
export function parseSize(
  size: Size | MaxSize,
  builder: StylesheetBuilder,
  options?: string | { allowAuto?: boolean },
  { allowAuto = false } = {},
) {
  allowAuto =
    (typeof options === "object" ? options.allowAuto : allowAuto) ?? false;

  switch (size.type) {
    case "length-percentage":
      return parseLength(size.value, builder);
    case "none":
      return size.type;
    case "auto":
      if (allowAuto) {
        return size.type;
      } else {
        builder.addWarning("value", size.type);
        return undefined;
      }
    case "min-content":
    case "max-content":
    case "fit-content":
    case "fit-content-function":
    case "stretch":
    case "contain":
      builder.addWarning("value", size.type);
      return undefined;
    default: {
      size satisfies never;
    }
  }

  return;
}

export function parseColorOrAutoDeclaration(
  { value }: { value: ColorOrAuto },
  builder: StylesheetBuilder,
) {
  if (value.type === "auto") {
    builder.addWarning("value", `Invalid color value ${value.type}`);
    return;
  } else {
    return parseColor(value.value, builder);
  }
}

export function parseFontColorDeclaration(
  declaration: Extract<Declaration, { value: CssColor }>,
  builder: StylesheetBuilder,
) {
  // Parsed once, for the declaration and the published variable both:
  // `light-dark()` pushes an extra `prefers-color-scheme: dark` rule as a side
  // effect, so a second parse emits a second copy of that rule.
  const value = parseColor(declaration.value, builder);

  builder.addDescriptor(declaration.property, value);
  publishInheritedColor(value, builder);
}

export function parseColorDeclaration(
  declaration: Extract<Declaration, { value: CssColor }>,
  builder: StylesheetBuilder,
) {
  addColorDescriptor(builder, declaration.property, declaration.value);
  // Returns nothing on purpose: `parseWithParser` adds a descriptor for any
  // non-`undefined` return, and this function has already added its own.
}

/**
 * Lab/LCH/OKLab/OKLCH channels can be `NaN` when lightningcss resolves a
 * degenerate `color-mix()` at compile time (e.g. mixing black with
 * `transparent` in oklab yields `NaN` for the a/b chromaticity channels).
 * Passing `NaN` to colorjs.io produces an invalid string such as
 * `#NaNNaNNaN80`, which React Native silently discards. Per CSS Color 4 a
 * missing component is treated as `0`, so coerce `NaN` to `0`.
 */
function nanToZero(value: number): number {
  return Number.isNaN(value) ? 0 : value;
}

export function parseColor(
  cssColor: CssColor,
  builder: StylesheetBuilder,
  /**
   * The style key this colour will be written to.
   *
   * Only `light-dark()` reads it, and only to place its DARK value on the same
   * key as its light one. Every caller that writes the result with
   * `addDescriptor(key, …)` should pass that key — `addColorDescriptor` below
   * does it for them, so the two can never disagree.
   */
  lightDarkTarget?: string,
) {
  if (typeof cssColor === "string") {
    if (namedColors.has(cssColor)) {
      return cssColor;
    }

    const systemColor = SYSTEM_COLORS[cssColor.toLowerCase()];
    if (systemColor) {
      // `PlatformColor` takes a LIST and uses the first name that resolves, so
      // one descriptor covers both platforms: iOS matches a `UIColor` semantic
      // name and skips the Android resource paths, Android the reverse.
      const platformColorFunction: StyleDescriptor = [
        {},
        "platformColor",
        [...systemColor],
        1,
      ];
      return platformColorFunction;
    }

    return;
  }

  let color: Color | undefined;

  const { hexColors = true, colorPrecision } = builder.getOptions();

  switch (cssColor.type) {
    case "currentcolor":
      return inheritedColorLookup();
    case "light-dark": {
      const extraRule = builder.openExtraRule(DARK_COLOR_SCHEME);

      // The dark value must land on the SAME key the light value does.
      // `addUnnamedDescriptor` reads the ambient `descriptorProperty`, which for
      // a colour inside a SHORTHAND names the shorthand — so
      // `box-shadow: 0 4px 6px light-dark(#333, #eee)` put `boxShadow: "#eee"`
      // on the dark rule, replacing the whole shadow with a bare colour.
      // `text-shadow` and `border` produced the same shape: the light value on
      // the right key, a junk value on the shorthand key beside it.
      if (lightDarkTarget !== undefined) {
        builder.addDescriptor(
          lightDarkTarget,
          parseColor(cssColor.dark, builder, lightDarkTarget),
          false,
          extraRule,
        );
      } else {
        builder.addUnnamedDescriptor(
          parseColor(cssColor.dark, builder),
          false,
          extraRule,
        );
      }

      return parseColor(cssColor.light, builder, lightDarkTarget);
    }
    case "rgb": {
      color = new Color({
        space: "sRGB",
        coords: [cssColor.r / 255, cssColor.g / 255, cssColor.b / 255],
        alpha: cssColor.alpha,
      });
      break;
    }
    case "hsl":
      color = new Color({
        space: cssColor.type,
        coords: [cssColor.h, cssColor.s, cssColor.l],
        alpha: cssColor.alpha,
      });
      break;
    case "hwb":
      color = new Color({
        space: cssColor.type,
        coords: [cssColor.h, cssColor.w, cssColor.b],
        alpha: cssColor.alpha,
      });
      break;
    case "lab":
      color = new Color({
        space: cssColor.type,
        coords: [
          nanToZero(cssColor.l),
          nanToZero(cssColor.a),
          nanToZero(cssColor.b),
        ],
        alpha: cssColor.alpha,
      });
      break;
    case "lch":
      color = new Color({
        space: cssColor.type,
        coords: [
          nanToZero(cssColor.l),
          nanToZero(cssColor.c),
          nanToZero(cssColor.h),
        ],
        alpha: cssColor.alpha,
      });
      break;
    case "oklab":
      color = new Color({
        space: cssColor.type,
        coords: [
          nanToZero(cssColor.l),
          nanToZero(cssColor.a),
          nanToZero(cssColor.b),
        ],
        alpha: cssColor.alpha,
      });
      break;
    case "oklch":
      color = new Color({
        space: cssColor.type,
        coords: [
          nanToZero(cssColor.l),
          nanToZero(cssColor.c),
          nanToZero(cssColor.h),
        ],
        alpha: cssColor.alpha,
      });
      break;
    case "srgb":
      color = new Color({
        space: cssColor.type,
        coords: [cssColor.r, cssColor.g, cssColor.b],
        alpha: cssColor.alpha,
      });
      break;
    case "srgb-linear":
      color = new Color({
        space: cssColor.type,
        coords: [cssColor.r, cssColor.g, cssColor.b],
        alpha: cssColor.alpha,
      });
      break;
    case "display-p3":
      color = new Color({
        space: "p3",
        coords: [cssColor.r, cssColor.g, cssColor.b],
        alpha: cssColor.alpha,
      });
      break;
    case "a98-rgb":
      color = new Color({
        space: "a98rgb",
        coords: [cssColor.r, cssColor.g, cssColor.b],
        alpha: cssColor.alpha,
      });
      break;
    case "prophoto-rgb":
      color = new Color({
        space: "prophoto",
        coords: [cssColor.r, cssColor.g, cssColor.b],
        alpha: cssColor.alpha,
      });
      break;
    case "rec2020":
      color = new Color({
        space: cssColor.type,
        coords: [cssColor.r, cssColor.g, cssColor.b],
        alpha: cssColor.alpha,
      });
      break;
    case "xyz-d50":
      color = new Color({
        space: cssColor.type,
        coords: [cssColor.x, cssColor.y, cssColor.z],
        alpha: cssColor.alpha,
      });
      break;
    case "xyz-d65":
      color = new Color({
        space: cssColor.type,
        coords: [cssColor.x, cssColor.y, cssColor.z],
        alpha: cssColor.alpha,
      });
      break;
    default: {
      cssColor satisfies never;
    }
  }

  if (!hexColors || colorPrecision) {
    return color?.toString({ precision: colorPrecision ?? 3 });
  } else {
    return color?.toString({ format: "hex" });
  }
}

export function parseLengthPercentageDeclaration(
  value: { value: LengthPercentageOrAuto },
  builder: StylesheetBuilder,
) {
  return parseLengthPercentageOrAuto(value.value, builder);
}

export function parseLengthPercentageOrAutoDeclaration(
  value: { value: LengthPercentageOrAuto },
  builder: StylesheetBuilder,
) {
  return parseLengthPercentageOrAuto(value.value, builder, { allowAuto: true });
}

export function parseLengthPercentageOrAuto(
  lengthPercentageOrAuto: LengthPercentageOrAuto,
  builder: StylesheetBuilder,
  { allowAuto = false } = {},
) {
  switch (lengthPercentageOrAuto.type) {
    case "auto":
      if (allowAuto) {
        return lengthPercentageOrAuto.type;
      } else {
        builder.addWarning("value", lengthPercentageOrAuto.type);
        return undefined;
      }
    case "length-percentage":
      return parseLength(lengthPercentageOrAuto.value, builder);
    default: {
      lengthPercentageOrAuto satisfies never;
    }
  }

  return;
}

export function parseJustifyContent(
  declaration: DeclarationType<"justify-content">,
  builder: StylesheetBuilder,
) {
  const allowed = new Set([
    "flex-start",
    "flex-end",
    "center",
    "space-between",
    "space-around",
    "space-evenly",
  ]);

  let value: string | undefined;

  switch (declaration.value.type) {
    case "normal":
    case "left":
    case "right":
      value = declaration.value.type;
      break;
    case "content-distribution":
    case "content-position":
      value = declaration.value.value;
      break;
    default: {
      declaration.value satisfies never;
    }
  }

  if (value && !allowed.has(value)) {
    builder.addWarning("value", value);
    return;
  }

  return value;
}

export function parseAlignContent(
  declaration: DeclarationType<"align-content">,
  builder: StylesheetBuilder,
) {
  const allowed = new Set([
    "flex-start",
    "flex-end",
    "center",
    "stretch",
    "space-between",
    "space-around",
    "space-evenly",
  ]);

  let value: string | undefined;

  switch (declaration.value.type) {
    case "normal":
      value = declaration.value.type;
      break;
    // `baseline-position` is lightningcss's name for the SHAPE of the value,
    // not a keyword any stylesheet contains. React Native's `alignContent` has
    // no baseline member either way, so this is rejected below — but the
    // warning has to name what the author wrote, and `parseAlignItems` already
    // reads the same shape as `baseline`.
    case "baseline-position":
      value = "baseline";
      break;
    case "content-distribution":
    case "content-position":
      value = declaration.value.value;
      break;
    default: {
      declaration.value satisfies never;
    }
  }

  if (value && !allowed.has(value)) {
    builder.addWarning("value", value);
    return;
  }

  return value;
}

/**
 * The `place-*` shorthands.
 *
 * These are never written by hand in the stylesheets this library sees — they
 * arrive because lightningcss's SERIALISER merges the two longhands, and this
 * compiler runs lightningcss twice. So `align-items: center; justify-items:
 * center` became `place-items: center`, which had no parser, and the author lost
 * BOTH declarations by writing the second one. The same inversion the `outline`
 * shorthand had: more CSS producing less style.
 *
 * Only the ALIGN half of `place-items` and `place-self` survives, and that is
 * complete rather than partial: `justify-items` and `justify-self` are grid
 * properties with no effect in a flex container (css-align-3 §6.2, §6.3), and
 * every React Native layout is a flex container. Nothing is lost, so nothing is
 * warned about. `place-content` is different — `justify-content` works in flex
 * and React Native has it — so both halves are emitted.
 */
function parsePlaceItems(
  declaration: DeclarationType<"place-items">,
  builder: StylesheetBuilder,
) {
  builder.addDescriptor(
    "align-items",
    parseAlignItems(
      {
        property: "align-items",
        value: declaration.value.align,
        vendorPrefix: [],
      },
      builder,
    ),
  );
}

function parsePlaceSelf(
  declaration: DeclarationType<"place-self">,
  builder: StylesheetBuilder,
) {
  builder.addDescriptor(
    "align-self",
    parseAlignSelf(
      {
        property: "align-self",
        value: declaration.value.align,
        vendorPrefix: [],
      },
      builder,
    ),
  );
}

function parsePlaceContent(
  declaration: DeclarationType<"place-content">,
  builder: StylesheetBuilder,
) {
  // The only one of the three where React Native has both halves.
  builder.addDescriptor(
    "align-content",
    parseAlignContent(
      {
        property: "align-content",
        value: declaration.value.align,
        vendorPrefix: [],
      },
      builder,
    ),
  );
  builder.addDescriptor(
    "justify-content",
    parseJustifyContent(
      {
        property: "justify-content",
        value: declaration.value.justify,
        vendorPrefix: [],
      },
      builder,
    ),
  );
}

export function parseAlignItems(
  alignItems: DeclarationType<"align-items">,
  builder: StylesheetBuilder,
) {
  const allowed = new Set([
    "auto",
    "flex-start",
    "flex-end",
    "center",
    "stretch",
    "baseline",
  ]);

  let value: string | undefined;

  switch (alignItems.value.type) {
    case "normal":
      value = "auto";
      break;
    case "stretch":
      value = alignItems.value.type;
      break;
    case "baseline-position":
      value = "baseline";
      break;
    case "self-position":
      value = alignItems.value.value;
      break;
    default: {
      alignItems.value satisfies never;
    }
  }

  if (value && !allowed.has(value)) {
    builder.addWarning("value", value);
    return;
  }

  return value;
}

export function parseAlignSelf(
  alignSelf: DeclarationType<"align-self">,
  builder: StylesheetBuilder,
) {
  const allowed = new Set([
    "auto",
    "flex-start",
    "flex-end",
    "center",
    "stretch",
    "baseline",
  ]);

  let value: string | undefined;

  switch (alignSelf.value.type) {
    case "normal":
    case "auto":
      value = "auto";
      break;
    case "stretch":
      value = alignSelf.value.type;
      break;
    case "baseline-position":
      value = "baseline";
      break;
    case "self-position":
      value = alignSelf.value.value;
      break;
    default: {
      alignSelf.value satisfies never;
    }
  }

  if (value && !allowed.has(value)) {
    builder.addWarning("value", value);
    return;
  }

  return value;
}

export function parseFontWeightDeclaration(
  declaration: DeclarationType<"font-weight">,
  builder: StylesheetBuilder,
) {
  return parseFontWeight(declaration.value, builder);
}

export function parseFontWeight(
  fontWeight: FontWeight,
  builder: StylesheetBuilder,
) {
  switch (fontWeight.type) {
    case "absolute":
      if (fontWeight.value.type === "weight") {
        return fontWeight.value.value;
      } else {
        return fontWeight.value.type;
      }
    case "bolder":
    case "lighter":
      builder.addWarning("value", fontWeight.type);
      return;
    default: {
      fontWeight satisfies never;
    }
  }

  return;
}

/**
 * A `<length>` spelled the way it was written, for a warning.
 *
 * Warnings name the value that was rejected, and `parseLength` cannot: it
 * FOLDS, so `2px` comes back as `2` and the author is told a number they did
 * not write. A `calc()` has no single dimension to name and says so.
 */
function stringifyLength(length: Length): string {
  return length.type === "value"
    ? `${length.value.value}${length.value.unit}`
    : "calc()";
}

export function parseTextShadow(
  declaration: DeclarationType<"text-shadow">,
  builder: StylesheetBuilder,
) {
  const [textShadow, ...dropped] = declaration.value;

  if (!textShadow) {
    return;
  }

  // React Native has ONE `textShadowColor` / `textShadowOffset` /
  // `textShadowRadius` triple per element, so a list of shadows has nowhere to
  // put its second entry. The drop is forced by that; the silence was not, and
  // it is the worse half — the CSS is valid, the compile is clean, and the only
  // symptom is a shadow that is thinner than the one written.
  //
  // The geometry alone names which shadow was dropped, which is what the
  // warning is for. The colour is deliberately not reconstructed: `parseColor`
  // is the only thing that can spell a `CssColor` back, and it is not pure —
  // a `light-dark()` registers an extra rule — so asking it about a shadow that
  // is not being emitted would add a dark-mode rule for a shadow nothing draws.
  for (const shadow of dropped) {
    builder.addWarning(
      "value",
      [shadow.xOffset, shadow.yOffset, shadow.blur]
        .map(stringifyLength)
        .join(" "),
    );
  }

  addColorDescriptor(builder, "textShadowColor", textShadow.color);
  builder.addDescriptor(
    "&.textShadowOffset.width",
    parseLength(textShadow.xOffset, builder),
  );
  builder.addDescriptor(
    "&.textShadowOffset.height",
    parseLength(textShadow.yOffset, builder),
  );
  builder.addDescriptor(
    "textShadowRadius",
    parseLength(textShadow.blur, builder),
  );
}

export function parseTextDecorationStyle(
  declaration: DeclarationType<"text-decoration-style">,
  builder: StylesheetBuilder,
) {
  const allowed = new Set(["solid", "double", "dotted", "dashed"]);

  if (allowed.has(declaration.value)) {
    return declaration.value;
  }

  builder.addWarning("value", declaration.value);
  return;
}

export function parseTextDecorationLineDeclaration(
  declaration: DeclarationType<"text-decoration-line">,
  builder: StylesheetBuilder,
) {
  return parseTextDecorationLine(declaration.value, builder);
}

export function parseTextDecorationLine(
  value: DeclarationType<"text-decoration-line">["value"],
  builder: StylesheetBuilder,
) {
  if (!Array.isArray(value)) {
    if (value === "none") {
      return value;
    }
    builder.addWarning("value", value);
    return;
  }

  const set = new Set(value);

  if (set.has("underline")) {
    if (set.has("line-through")) {
      return "underline line-through";
    } else {
      return "underline";
    }
  } else if (set.has("line-through")) {
    return "line-through";
  }

  builder.addWarning("value", value.join(" "));
  return undefined;
}

export function parsePosition(
  { value }: DeclarationType<"position">,
  builder: StylesheetBuilder,
) {
  if (
    value.type === "absolute" ||
    value.type === "relative" ||
    value.type === "static"
  ) {
    return value.type;
  }

  builder.addWarning("value", value.type);
  return;
}

export function parseOverflow(
  { value }: DeclarationType<"overflow">,
  builder: StylesheetBuilder,
) {
  // `scroll` is an exact match for React Native's own `FlexStyle["overflow"]`
  // (`'visible' | 'hidden' | 'scroll'`), and was the one case where a valid CSS
  // declaration for a value React Native renders was turned away.
  //
  // CSS `auto` and `clip` are deliberately still refused: `auto` means "scroll
  // only if needed", which React Native has no way to express, and treating it
  // as `scroll` would show an indicator on content that fits.
  const allowed = new Set(["visible", "hidden", "scroll"]);

  if (allowed.has(value.x)) {
    return value.x;
  }

  builder.addWarning("value", value.x);
  return undefined;
}

export function parseBorderStyleDeclaration(
  declaration: Extract<
    DeclarationType<Declaration["property"]>,
    { value: LineStyle | BorderStyle }
  >,
  builder: StylesheetBuilder,
) {
  return parseBorderStyle(declaration.value, builder);
}

export function parseBorderStyle(
  value: BorderStyle | LineStyle,
  builder: StylesheetBuilder,
) {
  const allowed = new Set(["solid", "dotted", "dashed"]);

  if (typeof value === "string") {
    if (allowed.has(value)) {
      return value;
    } else {
      builder.addWarning("value", value);
      return undefined;
    }
  }

  const isUniform =
    value.top === value.bottom &&
    value.top === value.left &&
    value.top === value.right;

  if (isUniform) {
    // One value for four edges, which is exactly React Native's own shape. If
    // it is a style React Native renders it goes to `borderStyle`; if not, the
    // declaration is reported ONCE, against the shorthand the author wrote —
    // splitting a uniform value into four identical longhand warnings says the
    // same thing four times and names a property nobody typed.
    if (allowed.has(value.top)) {
      return value.top;
    }

    builder.addWarning("value", value.top);
    return undefined;
  }

  // Four edges that do not agree. React Native's `borderStyle` is ONE key for
  // all four (`StyleSheetTypes.d.ts`: `'solid' | 'dotted' | 'dashed'`), so there
  // is nothing here that can hold them — and `border-width` and `border-color`
  // in the same model ARE fully per-edge, which is what makes this a hole in
  // React Native rather than a simplification of it.
  //
  // The per-edge keys are emitted anyway, under the names React Native would
  // give them. They are inert today and start working the day it adds them.
  // Collapsing to one edge's style instead would be silently wrong on the other
  // three, which is the one outcome worse than nothing.
  const edges = {
    "border-top-style": value.top,
    "border-right-style": value.right,
    "border-bottom-style": value.bottom,
    "border-left-style": value.left,
  };

  for (const [property, edge] of Object.entries(edges)) {
    if (allowed.has(edge)) {
      builder.addDescriptor(property, edge);
    } else {
      builder.addWarning("value", edge, property);
    }
  }

  // The shorthand key itself gets nothing: a single value would be a claim
  // about all four edges that the declaration did not make.
  return undefined;
}

/**
 * Both edges, always. There is no collapse: `borderBlockWidth` is not a key
 * React Native reads outside iOS Fabric, so two equal widths written to it
 * would paint on one platform and vanish on the others. The physical edges the
 * block axis maps to carry it everywhere.
 */
export function parseBorderBlockWidth(
  declaration: DeclarationType<"border-block-width">,
  builder: StylesheetBuilder,
) {
  builder.addDescriptor(
    "border-top-width",
    parseBorderSideWidth(declaration.value.start, builder),
  );
  builder.addDescriptor(
    "border-bottom-width",
    parseBorderSideWidth(declaration.value.end, builder),
  );
}

export function parseBorderSideWidthDeclaration(
  declaration: Extract<Declaration, { value: BorderSideWidth }>,
  builder: StylesheetBuilder,
) {
  builder.addDescriptor(
    propertyRename[declaration.property] ?? declaration.property,
    parseBorderSideWidth(declaration.value, builder),
  );
}

export function parseBorderSideWidth(
  value: BorderSideWidth,
  builder: StylesheetBuilder,
) {
  if (value.type === "length") {
    return parseLength(value.value, builder);
  }

  builder.addWarning("value", value.type);
  return undefined;
}

export function parseVerticalAlign(
  { value }: DeclarationType<"vertical-align">,
  builder: StylesheetBuilder,
) {
  if (value.type === "length") {
    return undefined;
  }

  const allowed = new Set(["auto", "top", "bottom", "middle"]);

  if (allowed.has(value.value)) {
    return value.value;
  }

  builder.addWarning("value", value.value);
  return undefined;
}

function parseFontFamily({
  value,
}: DeclarationType<"font-family">): StyleDescriptor {
  return firstFontFamily(value);
}

/**
 * React Native only allows one font family, so every path that produces
 * `font-family` narrows the stack it was given. This one is reached when
 * LightningCSS could type the declaration, which means every entry is a family
 * name and the answer is always the first of them.
 */
function firstFontFamily(stack: readonly string[]): StyleDescriptor {
  const narrowing = narrowFontFamily(stack);

  return narrowing.kind === "family" ? narrowing.family : undefined;
}

export function parseLineHeightDeclaration(
  declaration: DeclarationType<"line-height">,
  builder: StylesheetBuilder,
) {
  // `parseLineHeight` already returns the FINAL descriptor: an absolute number
  // for a length (`32px` -> 32), or an `em` function for a unitless multiplier
  // (`1.5` -> 1.5 x font-size). Wrapping it in a `lineHeight` function on top
  // of that multiplied by `em` a SECOND time, so `line-height: 32px` would
  // have resolved to 32 x fontSize. It never actually did, because the wrapper
  // also array-wrapped its argument while the resolver expected a bare number
  // — so the whole property silently resolved to nothing, in every form.
  //
  // Emitting the parsed descriptor directly is what `parseFont` already does
  // for the `font` shorthand's line-height, so the longhand and the shorthand
  // now agree.
  builder.addDescriptor(
    "line-height",
    parseLineHeight(declaration.value, builder),
  );
}

export function parseLineHeight(
  value: LineHeight,
  builder: StylesheetBuilder,
): StyleDescriptor {
  switch (value.type) {
    case "normal":
      return undefined;
    case "number":
      // The argument is a BARE number, matching what the `em` resolver reads
      // (`func[2]`, checked with `typeof value !== "number"`). Array-wrapping
      // it made the resolver bail, which is why a unitless line-height
      // resolved to nothing. Compare `[{}, "rem", round(length.value)]`
      // elsewhere in this file, which has always been unwrapped and works.
      return [{}, "em", value.value, 1];
    case "length": {
      const length = value.value;

      switch (length.type) {
        case "dimension":
          return parseLength(length, builder);
        case "percentage":
        case "calc":
          builder.addWarning(
            "style",
            "line-height",
            typeof length.value === "number"
              ? length.value
              : JSON.stringify(length.value),
          );
          return;
        default: {
          length satisfies never;
        }
      }

      return;
    }
    default: {
      value satisfies never;
    }
  }

  return;
}

/**
 * Whether a size reads `--__rn-css-em` in order to produce its own value.
 *
 * An `em` anywhere inside the tree makes it so, not only at the top: the
 * runtime route wraps its value in a `fontSize` function and a `var()`
 * fallback nests the `em` two levels down, so `font-size: var(--x, 200%)`
 * carries one where a top-level test finds nothing.
 */
function readsEmVariable(size: StyleDescriptor): boolean {
  if (isStyleFunction(size)) {
    return size[1] === "em" || readsEmVariable(size[2]);
  }

  return isStyleDescriptorArray(size) && size.some(readsEmVariable);
}

/**
 * `font-size` publishes itself as `--__rn-css-em` so descendants — and its own
 * rule's `em` lengths — can resolve against it. A size that READS that variable
 * to produce its own value cannot be published that way: resolving the variable
 * would read the variable, and each turn of the loop multiplies the size by
 * itself.
 *
 * Skipping the publish is what makes the `em` inside it mean what CSS says it
 * means — the PARENT's size, which is the value the lookup finds once this
 * rule stops shadowing it, falling back to the root rem at the top of the tree.
 * A descendant then inherits no em of its own, which is the accepted
 * imprecision of this channel rather than a decision taken here.
 */
function publishEmVariable(
  fontSize: StyleDescriptor,
  builder: StylesheetBuilder,
) {
  if (readsEmVariable(fontSize)) {
    return;
  }

  builder.addDescriptor("--__rn-css-em", fontSize);
}

export function parseFontSizeDeclaration(
  declaration: DeclarationType<"font-size">,
  builder: StylesheetBuilder,
) {
  const fontSize = parseFontSize(declaration.value, builder);
  builder.addDescriptor("fontSize", fontSize);
  publishEmVariable(fontSize, builder);
}

/**
 * The properties whose `<percentage>` is measured against the PARENT's font
 * size rather than against the containing block, and which therefore take an
 * `em` where every other property takes a `"50%"` string.
 *
 * `font-size` is the whole set (css-fonts-4 §3.5). `line-height` is the near
 * miss: its percentage is also font-relative, but against the element's OWN
 * size rather than the parent's, so it is not this quantity and has its own
 * resolver.
 */
const PARENT_FONT_RELATIVE_PERCENTAGE_PROPERTIES: ReadonlySet<string> = new Set(
  ["font-size"],
);

/**
 * A `<percentage>` as the `em` multiplier it is — `1.5` for `150%`.
 *
 * The two spellings are the same quantity for every property whose percentage
 * is measured against the parent's font size, and `em` is the one multiplier of
 * that size this compiler resolves at render. Both routes into a font size go
 * through this, so a percentage cannot mean one thing written out and another
 * through a `var()`.
 */
function percentageAsEm(fraction: number): StyleFunction {
  return [{}, "em", round(fraction), 1];
}

export function parseFontSize(
  value: FontSize,
  builder: StylesheetBuilder,
): StyleDescriptor {
  switch (value.type) {
    case "length":
      // A `<percentage>` font size is measured against the PARENT's computed
      // size (css-fonts-4 §3.5), which is the same quantity `em` measures — so
      // `font-size: 150%` and `font-size: 1.5em` are one declaration written
      // two ways. `parseLength` answers for `width: 50%`, where a percentage is
      // a fraction of the containing block and the `"50%"` string is what React
      // Native reads; `fontSize` is a `number`, so the same string reached it as
      // a value it drops.
      return value.value.type === "percentage"
        ? percentageAsEm(value.value.value)
        : parseLength(value.value, builder);
    case "absolute":
      // Through `parseLength`'s `rem` branch, so the keyword sizes honour
      // `inlineRem` exactly as `1rem` does — one base, one folding decision.
      return parseLength(
        { unit: "rem", value: ABSOLUTE_FONT_SIZES[value.value] },
        builder,
      );
    case "relative":
      return [
        {},
        "em",
        round(
          value.value === "smaller"
            ? 1 / RELATIVE_FONT_SIZE_RATIO
            : RELATIVE_FONT_SIZE_RATIO,
        ),
        1,
      ];
    default: {
      value satisfies never;
    }
  }

  return;
}

/**
 * The `<absolute-size>` keywords as multiples of the user's default font size
 * (css-fonts-4 §3.5, Table 1). That default is what `rem` measures here, so
 * each keyword is its factor in `rem` and needs no separate scale.
 *
 * Typed against lightningcss's own union rather than a `string` index, so a
 * keyword added upstream is a compile error rather than an `undefined` length.
 */
const ABSOLUTE_FONT_SIZES: Record<AbsoluteFontSize, number> = {
  "xx-small": 3 / 5,
  "x-small": 3 / 4,
  "small": 8 / 9,
  "medium": 1,
  "large": 6 / 5,
  "x-large": 3 / 2,
  "xx-large": 2,
  "xxx-large": 3,
};

/**
 * `larger` and `smaller` scale the INHERITED size, so they are an `em` — the
 * one unit this compiler already resolves against the ancestor's font size.
 * css-fonts-4 §3.5 leaves the ratio to the user agent and names 1.2 as the
 * value they use.
 */
const RELATIVE_FONT_SIZE_RATIO = 1.2;

export function parseFontStyleDeclaration(
  declaration: DeclarationType<"font-style">,
  builder: StylesheetBuilder,
) {
  return parseFontStyle(declaration.value, builder);
}

export function parseFontStyle(value: FontStyle, builder: StylesheetBuilder) {
  switch (value.type) {
    case "normal":
    case "italic":
      return value.type;
    case "oblique":
      builder.addWarning("value", value.type);
      return undefined;
    default: {
      value satisfies never;
    }
  }

  return;
}

export function parseFontVariantCapsDeclaration(
  declaration: DeclarationType<"font-variant-caps">,
  builder: StylesheetBuilder,
) {
  return parseFontVariantCaps(declaration.value, builder);
}

/**
 * `font-variant-caps`, through the walker the other two spellings already use.
 *
 * React Native types `fontVariant` as `FontVariant[]`, so this returns a list
 * for a single keyword exactly as `font-variant` and `font-variant-numeric` do
 * — one React Native prop, one shape, whichever CSS spelling produced it.
 *
 * Sharing the walker is what makes `normal` mean the same thing here as it does
 * there: it is the initial value of all three properties and asks for NO
 * variants, which React Native spells as the empty list. Read against a
 * keyword allow-list instead it looked like an unrenderable value, so the one
 * declaration written to cancel a variant produced no style and a warning about
 * a value the author had spelled correctly — and every `font` shorthand
 * produced that warning too, because lightningcss fills the shorthand's
 * unwritten longhands with their initial values.
 */
export function parseFontVariantCaps(
  value: FontVariantCaps,
  builder: StylesheetBuilder,
): StyleDescriptor {
  return parseFontVariantKeywords(
    value,
    builder,
    "font-variant-caps",
    fontVariantCapsValues,
  );
}

export function parseLengthOrCoercePercentageToRuntime(
  value: Length | DimensionPercentageFor_LengthValue | NumberOrPercentage,
  builder: StylesheetBuilder,
): StyleDescriptor {
  return parseLength(value, builder);
}

export function parseGap(
  declaration: DeclarationType<"gap" | "column-gap" | "row-gap">,
  builder: StylesheetBuilder,
) {
  if ("column" in declaration.value) {
    const row = parseGapValue(declaration.value.row, builder);
    const column = parseGapValue(declaration.value.column, builder);

    if (row !== column) {
      builder.addDescriptor("row-gap", row);
      builder.addDescriptor("column-gap", column);
    } else {
      builder.addDescriptor("gap", row);
    }
  } else if (declaration.value.type === "normal") {
    builder.addWarning("value", declaration.value.type);
  } else {
    return parseLength(declaration.value.value, builder);
  }

  return;
}

function parseGapValue(
  value: GapValue,
  builder: StylesheetBuilder,
): StyleDescriptor {
  if (value.type === "normal") {
    return;
  } else {
    return parseLength(value.value, builder);
  }
}

export function parseTextAlign(
  { value }: DeclarationType<"text-align">,
  builder: StylesheetBuilder,
) {
  const allowed = new Set(["auto", "left", "right", "center", "justify"]);
  if (allowed.has(value)) {
    return value;
  }

  // `start` and `end` are the CSS logical values, and this is an exact mapping
  // rather than an LTR-only fallback: React Native's `left`/`right` are ALREADY
  // logical on both platforms. Android's `TextLayoutManager.getTextAlignment`
  // resolves `right` to `ALIGN_OPPOSITE` and lets `left` fall through to
  // `ALIGN_NORMAL`; iOS's `RCTTextAttributes.effectiveParagraphStyle` swaps
  // Left and Right whenever the Yoga-resolved layout direction is RTL.
  //
  // Do NOT "correct" this with an `I18nManager.isRTL` swap. Because RN's
  // left/right are not physical, a manual swap double-flips and inverts the
  // alignment under RTL — the bug that reads as the fix.
  if (value === "start") {
    return "left";
  }

  if (value === "end") {
    return "right";
  }

  builder.addWarning("value", value);
  return undefined;
}

export function parseBoxShadow(
  { value }: DeclarationType<"box-shadow">,
  builder: StylesheetBuilder,
) {
  for (const [index, shadow] of value.entries()) {
    addColorDescriptor(builder, `&.boxShadow.[${index}].color`, shadow.color);
    builder.addDescriptor(
      `&.boxShadow.[${index}].offsetX`,
      parseLength(shadow.xOffset, builder),
    );
    builder.addDescriptor(
      `&.boxShadow.[${index}].offsetY`,
      parseLength(shadow.yOffset, builder),
    );
    builder.addDescriptor(
      `&.boxShadow.[${index}].blurRadius`,
      parseLength(shadow.blur, builder),
    );
    builder.addDescriptor(
      `&.boxShadow.[${index}].spreadDistance`,
      parseLength(shadow.spread, builder),
    );
    builder.addDescriptor(
      `&.boxShadow.[${index}].inset`,
      shadow.inset ? true : undefined,
    );
  }
}

export function parseBoxSizing(
  declaration: DeclarationType<"box-sizing">,
  builder: StylesheetBuilder,
) {
  if (["border-box", "content-box"].includes(declaration.value)) {
    return declaration.value;
  }

  builder.addWarning("value", declaration.value);
  return undefined;
}

export function parseDisplay(
  { value }: DeclarationType<"display">,
  builder: StylesheetBuilder,
) {
  if (value.type === "keyword") {
    if (value.value === "none" || value.value === "contents") {
      return value.value;
    } else {
      builder.addWarning("value", value.value);
      return;
    }
  } else {
    if (value.outside === "block") {
      switch (value.inside.type) {
        case "flow":
          if (value.isListItem) {
            builder.addWarning("value", "list-item");
          } else {
            builder.addWarning("value", "block");
          }
          return;
        case "flex":
          return value.inside.type;
        case "flow-root":
        case "table":
        case "box":
        case "grid":
        case "ruby":
          builder.addWarning("value", value.inside.type);
          return;
      }
    } else {
      switch (value.inside.type) {
        case "flow":
          builder.addWarning("value", "inline");
          return;
        case "flow-root":
          builder.addWarning("value", "inline-block");
          return;
        case "table":
          builder.addWarning("value", "inline-table");
          return;
        case "flex":
          builder.addWarning("value", "inline-flex");
          return;
        case "box":
        case "grid":
          builder.addWarning("value", "inline-grid");
          return;
        case "ruby":
          builder.addWarning("value", value.inside.type);
          return;
      }
    }
  }
}

export function parseDirection(
  declaration: DeclarationType<"direction">,
  builder: StylesheetBuilder,
) {
  // `direction` is typed `"ltr" | "rtl"`, and lightningcss hands anything else
  // over as an unparsed token rather than a `direction` declaration — so every
  // value reaching this parser is valid and there is nothing here to reject.
  builder.addDescriptor("direction", declaration.value);
  builder.addDescriptor("--__rn-css-direction", declaration.value);
  // React Native's `writingDirection` (`TextStyle`) is the Text-side twin of
  // the layout `direction`. Emitting both means one declaration works on a
  // `<View>` and on a `<Text>` alike.
  builder.addDescriptor("writingDirection", declaration.value);
}

/**
 * `aspect-ratio`, which is `auto || <ratio>` — either half may be absent and
 * both may be present (css-sizing-4 §2).
 *
 * The RATIO is read first, because it is the half that describes a shape.
 * `auto <ratio>` uses the box's natural aspect ratio when it has one and the
 * written ratio otherwise, and no React Native box has a natural one — layout
 * takes `aspectRatio` or nothing — so the ratio is what this declaration
 * renders on either kind of box. Answering `auto` for it instead threw away the
 * half that renders.
 *
 * `auto` on its own is carried rather than dropped. React Native's
 * `processAspectRatio` reads it as no aspect ratio at all, which is what CSS
 * means by it, and carrying it is what lets the declaration do the only job it
 * has: CANCEL a ratio an earlier rule set. Producing nothing left the earlier
 * rule's ratio in place, and left the `var()` route — which has no parser to
 * drop it and ships the keyword — rendering something the literal route did not.
 */
export function parseAspectRatio({
  value,
}: DeclarationType<"aspect-ratio">): StyleDescriptor {
  if (value.ratio) {
    const [width, height] = value.ratio;

    return width === height ? 1 : `${width}/${height}`;
  }

  return value.auto ? "auto" : undefined;
}

export function parseBackfaceVisibility(
  { value }: DeclarationType<"backface-visibility">,
  builder: StylesheetBuilder,
): StyleDescriptor {
  if (["visible", "hidden"].includes(value)) {
    return value;
  } else {
    builder.addWarning("value", value);
    return;
  }
}

export function parseDimension(
  { unit, value }: Extract<Token, { type: "dimension" }>,
  builder: StylesheetBuilder,
): StyleDescriptor {
  switch (unit) {
    case "px":
      if (value === Infinity) {
        return 9999;
      } else {
        return value;
      }
    case "%":
      return `${value}%`;
    // `rnh` / `rnw` are this library's own spelling of the viewport units, and
    // they emitted their OWN function names — which no runtime resolver
    // answered, and whose argument shape (pre-divided, wrapped in an array) did
    // not match the `vh` / `vw` resolvers either. `50rnh` reached React Native
    // as the literal string `"rnh(0.5)"`. They are the same measurement, so they
    // emit the same function.
    case "rnh":
      return [{}, "vh", round(value), 1];
    case "rnw":
      return [{}, "vw", round(value), 1];
    default: {
      builder.addWarning("value", `${value}${unit}`);
      return;
    }
  }
}

/**
 * React Native's `BlendMode` union (`StyleSheetTypes`), which is every value
 * `blendModeFromString` accepts in `ReactCommon/react/renderer/graphics/
 * BlendMode.h`. CSS defines one more — `plus-darker` — which React Native does
 * not implement, so it warns rather than being handed over and rejected.
 */
const blendModes = new Set([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "plus-lighter",
]);

export function parseMixBlendMode(
  value: StyleDescriptor,
  builder: StylesheetBuilder,
): StyleDescriptor {
  // CSS keywords are ASCII case-insensitive, and React Native expects the
  // canonical lowercase spelling.
  if (typeof value === "string" && blendModes.has(value.toLowerCase())) {
    return value.toLowerCase();
  }

  if (value === undefined) {
    // Nothing came through, which means an earlier stage rejected the value
    // and has already said so. A second warning here would name `undefined` —
    // no value at all — and report one bad declaration twice.
    return;
  }

  // A descriptor may be an unresolved function/object; stringify safely so
  // the warning names the value rather than "[object Object]".
  builder.addWarning(
    "value",
    typeof value === "string" ? value : JSON.stringify(value),
  );
  return;
}

/**
 * The `font-variant-numeric` keywords React Native's `FontVariant` union can
 * express.
 *
 * CSS also defines `ordinal`, `slashed-zero`, `diagonal-fractions` and
 * `stacked-fractions`; React Native has no equivalent for any of them, so they
 * are dropped rather than passed through as values it would ignore.
 */
/**
 * The `font-variant-caps` keywords React Native's `FontVariant` union can
 * express.
 *
 * `small-caps` is the whole of it. CSS's other five caps keywords —
 * `all-small-caps`, `petite-caps`, `all-petite-caps`, `unicase`,
 * `titling-caps` — have no member of that union and are reported rather than
 * approximated by `small-caps`, which draws different letterforms.
 */
const fontVariantCapsValues = new Set(["small-caps"]);

const fontVariantNumericValues = new Set([
  "lining-nums",
  "oldstyle-nums",
  "proportional-nums",
  "tabular-nums",
]);

/**
 * The `font-variant-ligatures` keywords React Native's `FontVariant` union can
 * express — all of them, on both sides of every sub-group.
 *
 * CSS spells the contextual pair `contextual` / `no-contextual`, and so does
 * React Native, so every keyword in the property's grammar maps across
 * unchanged. Only `normal` and `none` need interpreting, and
 * `parseFontVariantLigatures` does that before the shared walker runs.
 */
const fontVariantLigatureValues = new Set([
  "common-ligatures",
  "no-common-ligatures",
  "discretionary-ligatures",
  "no-discretionary-ligatures",
  "historical-ligatures",
  "no-historical-ligatures",
  "contextual",
  "no-contextual",
]);

/**
 * Every keyword React Native's `FontVariant` union accepts — the census the
 * `font-variant` SHORTHAND is validated against.
 *
 * The shorthand is the union of its longhands, so it is built from their sets
 * rather than transcribed: a keyword added to one of them is reachable through
 * the shorthand in the same change. `stylistic-one` … `stylistic-twenty` are
 * React Native's spelling of `font-variant-alternates: styleset()`, which CSS
 * writes as a function and so cannot arrive as a bare keyword here.
 */
const fontVariantValues = new Set([
  ...fontVariantCapsValues,
  ...fontVariantNumericValues,
  ...fontVariantLigatureValues,
]);

/**
 * The keyword-list walker the three `font-variant*` properties share.
 *
 * All three compile to React Native's one `fontVariant` prop, which is a LIST,
 * and all three accept several keywords at once — so the only thing that
 * differs between them is which keywords are legal. That difference is the
 * `allowed` argument; everything else — the list-or-string shape, the
 * case-insensitive comparison, `normal` contributing nothing, a rejected
 * keyword not discarding its neighbours — is identical, and was three copies.
 *
 * Walked rather than filtered: `StyleDescriptor` includes readonly tuple
 * members, and `Array.isArray` does not narrow those to an element type a
 * predicate can refine.
 */
function parseFontVariantKeywords(
  value: StyleDescriptor,
  builder: StylesheetBuilder,
  property: string,
  allowed: ReadonlySet<string>,
): StyleDescriptor {
  const keywords: string[] = [];

  if (typeof value === "string") {
    keywords.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        keywords.push(entry);
      }
    }
  }

  if (keywords.length === 0) {
    // Not a keyword list at all — most often a chain of `var()` references the
    // compiler cannot evaluate, which is how Tailwind writes this property. The
    // per-keyword loop below would say nothing, and a declaration producing no
    // style and no diagnostic is the hardest kind to find; the PROPERTY is what
    // could not be used, so that is what the warning names. Reporting the value
    // instead would print the unresolved descriptor, which names nothing an
    // author wrote.
    //
    // `undefined` is the exception: an earlier stage already rejected it and
    // reported, so warning here would count one bad declaration twice.
    if (value !== undefined) {
      builder.addWarning("property", property);
    }

    return undefined;
  }

  // `normal` is the initial value of all three properties and is EXCLUSIVE: it
  // means "no variants", so it cannot be combined with a keyword that asks for
  // one. On its own it is a real declaration with a real effect — it CANCELS a
  // variant the element would otherwise inherit — and React Native spells that
  // as the empty list, `fontVariant` being `FontVariant[]`. Emitting nothing
  // instead left `font-variant: normal` unable to undo an ancestor's
  // `small-caps`, which is the one thing an author writes it for.
  if (keywords.length === 1 && keywords[0]?.toLowerCase() === "normal") {
    return [];
  }

  const expressible: string[] = [];

  for (const keyword of keywords) {
    // CSS keywords are ASCII case-insensitive.
    const normalized = keyword.toLowerCase();

    if (allowed.has(normalized)) {
      expressible.push(normalized);
    } else {
      // Reaching here with `normal` means it was written beside another
      // keyword, which no `font-variant*` grammar allows.
      builder.addWarning("value", keyword);
    }
  }

  // React Native types `fontVariant` as `FontVariant[]`, so the value is an
  // array even for a single keyword. A keyword React Native cannot express
  // does NOT discard the ones it can — `ordinal tabular-nums` still yields
  // tabular figures, the closest rendering available.
  return expressible.length > 0 ? expressible : undefined;
}

export function parseFontVariantNumeric(
  value: StyleDescriptor,
  builder: StylesheetBuilder,
): StyleDescriptor {
  return parseFontVariantKeywords(
    value,
    builder,
    "font-variant-numeric",
    fontVariantNumericValues,
  );
}

/**
 * `font-variant-ligatures` — every keyword of which React Native renders.
 *
 * `none` is the one value that is not a pass-through: CSS defines it as
 * switching off all four ligature groups, and React Native has no single
 * keyword for that, so it becomes the four `no-*` keywords it means. Without
 * the expansion `none` would be the only way to say "no ligatures" and the one
 * spelling that did nothing.
 */
export function parseFontVariantLigatures(
  value: StyleDescriptor,
  builder: StylesheetBuilder,
): StyleDescriptor {
  if (typeof value === "string" && value.toLowerCase() === "none") {
    return [
      "no-common-ligatures",
      "no-discretionary-ligatures",
      "no-historical-ligatures",
      "no-contextual",
    ];
  }

  return parseFontVariantKeywords(
    value,
    builder,
    "font-variant-ligatures",
    fontVariantLigatureValues,
  );
}

/**
 * The `font-variant` shorthand, which takes a keyword from any of its
 * longhands and as many of them at once as the author likes.
 *
 * `font-variant: small-caps tabular-nums` is ordinary CSS and lands exactly on
 * React Native's `fontVariant: ['small-caps', 'tabular-nums']` — the shorthand
 * and the prop are both lists of the same keywords. Validating the whole value
 * as ONE keyword rejected every multi-keyword declaration, so the shape React
 * Native's prop exists for was the one shape the property could not produce.
 */
export function parseFontVariantShorthand(
  value: StyleDescriptor,
  builder: StylesheetBuilder,
): StyleDescriptor {
  return parseFontVariantKeywords(
    value,
    builder,
    "font-variant",
    fontVariantValues,
  );
}

/**
 * The three CSS spellings that reach React Native's `fontVariant`, to the
 * parser each one's grammar calls for. Keyed by the CSS property name so
 * `parseCustomDeclaration` dispatches on the same string it matched.
 */
const FONT_VARIANT_PARSERS = {
  "font-variant": parseFontVariantShorthand,
  "font-variant-numeric": parseFontVariantNumeric,
  "font-variant-ligatures": parseFontVariantLigatures,
} satisfies Record<
  string,
  (value: StyleDescriptor, builder: StylesheetBuilder) => StyleDescriptor
>;

const isolationValues = new Set(["auto", "isolate"]);

export function parseIsolation(
  value: StyleDescriptor,
  builder: StylesheetBuilder,
): StyleDescriptor {
  if (typeof value === "string") {
    // CSS keywords are ASCII case-insensitive; React Native expects the
    // canonical lowercase spelling. `auto` is among them — it is the initial
    // value and the only way to switch isolation back off, so it is emitted
    // rather than elided (see `allowAutoProperties`).
    const normalized = value.toLowerCase();

    if (isolationValues.has(normalized)) {
      return normalized;
    }
  }

  if (value === undefined) {
    // Nothing came through, which means an earlier stage rejected the value
    // and has already said so. A second warning here would name `undefined` —
    // no value at all — and report one bad declaration twice.
    return;
  }

  // A descriptor may be an unresolved function/object; stringify safely so
  // the warning names the value rather than "[object Object]".
  builder.addWarning(
    "value",
    typeof value === "string" ? value : JSON.stringify(value),
  );
  return;
}

/**
 * `transform-origin` -> React Native's `transformOrigin`, which accepts
 * `[x, y, z]`: x and y each a length in points or a percentage string, z a
 * plain number.
 *
 * A side keyword resolves to the percentage it means, so `left top` and
 * `0% 0%` produce the same value — React Native has no keyword form.
 *
 * lightningcss parses `transform-origin` with the `<position>` grammar, which
 * is `background-position`'s rather than `transform-origin`'s. Two consequences
 * are visible here: a `side <offset>` component exists at all (transform-origin
 * has no such form), and the z-component does not — `Position` carries only
 * `x` and `y`. The genuine three-value form therefore never reaches this
 * parser; it fails `Position` and falls through to the unparsed route, where
 * `transformOrigin` in `native/styles/transform-origin.ts` takes it. The two
 * routes agree by test (`native/transform-path-equivalence.test.tsx`).
 */
/**
 * A zero x/y origin component, written as `"0%"` rather than the number `0`.
 *
 * The two are the same point by definition — zero percent of any reference
 * length is zero — so this is a spelling choice, and css-transforms-1 §5.2 has
 * already made it: `left` and `top` ARE `0%`, exactly as `center` is `50%` and
 * `right` is `100%`. Emitting the number for two of the five keywords and the
 * percentage for the other three was the odd case, not this.
 *
 * The percentage spelling is ALSO the one that survives a lightningcss round
 * trip, which matters to a consumer that runs one before this compiler. That
 * is a separate defect and not this function's to fix: lightningcss types
 * `transform-origin` as `Position`, which carries no z, and rewrites
 * `left top 30px` to `0 30px` — a different transform. `compiler/transform-origin.ts`
 * repairs that inside this compiler's first pass, and cannot repair it when
 * some earlier pass has already done the damage.
 *
 * So this function is a consistency fix, not a workaround. Do not describe it
 * as fixing a rendering defect; it does not.
 *
 * This converts every case where a percentage spelling EXISTS, which is every
 * zero: `left`, `top`, `0`, `0px`, `0%` and lightningcss's folded forms all
 * name the same point. A non-zero length has no percentage form a compiler can
 * write — the percentage depends on the element's measured size, which is not
 * known until layout — so those keep their number and remain exposed to the
 * same defect. That residual is React Native's to fix and is filed as such.
 */
function asOriginComponent(value: StyleDescriptor): StyleDescriptor {
  return value === 0 ? "0%" : value;
}

function parseTransformOriginComponent(
  component:
    | { type: "center" }
    | { type: "length"; value: DimensionPercentageFor_LengthValue }
    | {
        type: "side";
        side: string;
        offset?: DimensionPercentageFor_LengthValue | null;
      },
  builder: StylesheetBuilder,
): StyleDescriptor {
  switch (component.type) {
    case "center":
      return "50%";
    case "length":
      return parseLength(component.value, builder);
    case "side": {
      // `right` and `bottom` are the FAR sides: an offset counts inward from
      // 100%, where `left` and `top` count outward from 0.
      const isFarSide =
        component.side === "right" || component.side === "bottom";

      if (component.offset !== undefined && component.offset !== null) {
        const offset = parseLength(component.offset, builder);

        // `left 10px` measures from the near side, so the offset IS the
        // value. lightningcss normalises most of these away before we see
        // them, but the AST permits the form and a `var()` offset survives it.
        if (!isFarSide) {
          return offset;
        }

        // `right 10%` is 10% in from the right, which is 90% from the left —
        // expressible. `right 10px` is `calc(100% - 10px)`, which React Native
        // has no origin syntax for.
        if (typeof offset === "string" && offset.endsWith("%")) {
          const percentage = Number.parseFloat(offset);
          if (Number.isFinite(percentage)) {
            return `${100 - percentage}%`;
          }
        }

        builder.addWarning("value", `${component.side} <offset>`);
        return;
      }

      // `"0%"` for the near sides, which is what css-transforms-1 §5.2 says
      // `left` and `top` MEAN — the same definition that gives `center` 50%
      // and `right` 100%. Every route funnels its zero through
      // `asOriginComponent`, so the folded forms lightningcss produces for
      // `0`, `0px` and `0%` all arrive at this same spelling and the position
      // cannot emit two shapes depending on how it was written.
      return isFarSide ? "100%" : "0%";
    }
    default:
      return;
  }
}

/** How many value warnings a property has accumulated so far. */
function countValueWarnings(
  builder: StylesheetBuilder,
  property: string,
): number {
  return builder.getWarnings().values?.[property]?.length ?? 0;
}

export function parseTransformOrigin(
  { value }: DeclarationType<"transform-origin">,
  builder: StylesheetBuilder,
): StyleDescriptor {
  const warningsBefore = countValueWarnings(builder, "transform-origin");

  const x = parseTransformOriginComponent(value.x, builder);
  const y = parseTransformOriginComponent(value.y, builder);

  if (x === undefined || y === undefined) {
    // `parseLength` returns nothing for a mixed-unit `calc()` WITHOUT warning,
    // so `transform-origin: calc(100% - 10px) 0` produced no style and no
    // diagnostic — the hardest kind of failure to find. Only warn when nothing
    // below has already said something, so the cases that do report (an
    // unsupported unit, a far-side px offset) keep naming the actual value.
    if (countValueWarnings(builder, "transform-origin") === warningsBefore) {
      builder.addWarning("value", "transform-origin");
    }
    return;
  }

  // THREE values, always — see `native/styles/transform-origin.ts` for why the
  // arity is a hard requirement rather than a convention. The z is 0 here
  // because a declaration that HAS one never reaches this parser: the compiler's
  // first pass rewrites the folded-z shape into three lengths
  // (`compiler/transform-origin.ts`), which lightningcss cannot read as a
  // `Position`, so it arrives on the unparsed route instead.
  return [asOriginComponent(x), asOriginComponent(y), 0];
}

export function parseUserSelect(
  { value }: DeclarationType<"user-select">,
  builder: StylesheetBuilder,
) {
  const allowed = ["auto", "text", "none", "contain", "all"];
  if (allowed.includes(value)) {
    return value;
  } else {
    builder.addWarning("value", value);
    return;
  }
}

export function parseSVGPaint(
  { value, property }: DeclarationType<"fill" | "stroke">,
  builder: StylesheetBuilder,
) {
  let parsedValue: StyleDescriptor | undefined;

  if (value.type === "none") {
    parsedValue = "transparent";
  } else if (value.type === "color") {
    parsedValue = parseColor(value.value, builder);
  } else {
    return;
  }

  builder.addDescriptor(property, parsedValue);
}

export function round(number: number) {
  return Math.round((number + Number.EPSILON) * 10000) / 10000;
}

export function parseDimensionPercentageFor_LengthValue(
  value: DimensionPercentageFor_LengthValue,
  builder: StylesheetBuilder,
) {
  if (value.type === "calc") {
    return undefined;
  } else if (value.type === "percentage") {
    return `${value.value}%`;
  } else {
    return parseLength(value.value, builder);
  }
}

/**
 * The parsers that accept `auto` as a value, rather than as the "compute it
 * yourself" keyword React Native cannot express.
 *
 * Identity, not names: each of these passes `allowAuto: true` down to
 * `parseSize` or `parseLengthPercentageOrAuto`, so which PROPERTIES accept
 * `auto` is already decided by which parser the `parsers` table gives them. The
 * set below is the answer to "which parsers", and `allowAutoProperties` derives
 * the property list from it — so moving a property to a different parser moves
 * its `auto` handling with it, on both routes at once.
 */
const autoAllowingParsers: ReadonlySet<unknown> = new Set([
  parseSizeWithAutoDeclaration,
  parseLengthPercentageOrAutoDeclaration,
  parseColorOrAutoDeclaration,
  parseFlex,
  parseMargin,
  parseMarginBlock,
  parseMarginInline,
  parseInset,
  parseInsetBlock,
  parseInsetInline,
]);

/**
 * Properties for which `auto` is a value React Native renders.
 *
 * ONE census, read by BOTH declaration routes. The typed route asks its parser,
 * which knows; the unparsed route — everything reached through a `var()` — asks
 * this set. They disagreed while this was a hand-written pair of names, and the
 * disagreement was invisible in the ordinary spelling: `margin-left: auto`
 * compiled, and `margin-left: var(--x, auto)` compiled to nothing, because the
 * fallback's tokens are parsed under the CONSUMING property's name and
 * `margin-left` was not in the list. `inset: var(--x, auto 10px)` was worse than
 * nothing — `auto` was dropped, the surviving `10px` repeat-filled all four
 * sides under css-box-3 §4, and the element was pinned where CSS says it should
 * float.
 *
 * The two additions are the properties whose parser is not one of the size
 * family: `pointer-events` and `isolation` each take `auto` as one keyword of a
 * closed set (`isolation` is `'auto' | 'isolate'` in React Native's own types,
 * and `auto` is the only way to switch isolation back off).
 */
const allowAutoProperties = new Set([
  ...Object.entries(parsers)
    .filter(([, parser]) => autoAllowingParsers.has(parser))
    .map(([property]) => property),
  "pointer-events",
  "isolation",
]);

/**
 * Whether `auto` is a value to KEEP for this property, rather than the "compute
 * it yourself" keyword React Native has no way to express.
 *
 * A **custom property** always keeps it. CSS Variables Level 1 §2 makes a custom
 * property's value an arbitrary token stream that means nothing until it is
 * substituted, so nothing is known here about what `auto` will be asked to be —
 * the property that eventually consumes it decides, and that is where the
 * question already gets asked. Rejecting it at declaration time emptied the
 * variable instead, so `--x: auto` reached every consumer as nothing at all and
 * `pointer-events: var(--x)` did not work while `pointer-events: auto` did.
 *
 * Every other property asks `allowAutoProperties`, which is derived from the
 * same parser table the typed route uses — so the two routes cannot answer
 * differently.
 */
function allowsAutoKeyword(property: string): boolean {
  return property.startsWith("--") || allowAutoProperties.has(property);
}

export function parseEnv(
  value: EnvironmentVariable,
  builder: StylesheetBuilder,
): StyleFunction | undefined {
  switch (value.name.type) {
    case "ua":
      switch (value.name.value) {
        case "safe-area-inset-top":
        case "safe-area-inset-right":
        case "safe-area-inset-bottom":
        case "safe-area-inset-left": {
          // Stored inside the `var()` below and read back by the same
          // `resolveDimension` a custom property's value reaches, so it takes
          // the same treatment as a `var()` fallback — see `ValueUse`.
          const fallback = parseUnparsed(
            value.fallback,
            builder,
            value.name.value,
            allowsAutoKeyword(value.name.value),
            "substituted",
          );

          // "Was a fallback written?" is the question, and only `undefined`
          // answers no — `parseUnparsed` returns exactly that for a value it
          // could not use. A truth test answered a different question and got
          // `0` wrong, which is the fallback a stylesheet writes most:
          // `env(safe-area-inset-bottom, 0px)` means "the inset, or nothing",
          // and without the fallback the `var()` resolved to nothing at all on
          // a device with no safe-area provider, so the declaration vanished
          // where any non-zero fallback kept it.
          return fallback === undefined
            ? [{}, "var", [`react-native-css-${value.name.value}`], 1]
            : [
                {},
                "var",
                [`react-native-css-${value.name.value}`, fallback],
                1,
              ];
        }
        case "viewport-segment-width":
        case "viewport-segment-height":
        case "viewport-segment-top":
        case "viewport-segment-left":
        case "viewport-segment-bottom":
        case "viewport-segment-right":
      }
      break;
    case "custom":
    case "unknown":
  }

  return;
}

export function parseCalcFn(
  name: string,
  tokens: TokenOrValue[],
  builder: StylesheetBuilder,
  property: string,
  use: ValueUse = valueUseFor(property),
): StyleDescriptor {
  const args = parseCalcArguments(tokens, builder, property, use);
  if (args) {
    return [{}, name, args];
  }

  return;
}

export function parseColorMix(
  tokens: TokenOrValue[],
  builder: StylesheetBuilder,
  property: string,
): StyleDescriptor {
  const [inToken, whitespace, colorSpace, comma, ...rest] = tokens;
  if (
    typeof inToken !== "object" ||
    inToken.type !== "token" ||
    inToken.value.type !== "ident" ||
    inToken.value.value !== "in"
  ) {
    return;
  }

  if (
    typeof whitespace !== "object" ||
    whitespace.type !== "token" ||
    whitespace.value.type !== "white-space"
  ) {
    return;
  }

  if (
    typeof comma !== "object" ||
    comma.type !== "token" ||
    comma.value.type !== "comma"
  ) {
    return;
  }

  const colorSpaceArg = parseUnparsed(colorSpace, builder, property);
  if (typeof colorSpaceArg !== "string") {
    return;
  }

  let nextToken = rest.shift();

  const leftColorArg = parseUnparsed(nextToken, builder, property);

  if (!leftColorArg) {
    return;
  }

  nextToken = rest.shift();

  let leftColorPercentage: StyleDescriptor | undefined;
  if (nextToken?.type !== "token" || nextToken.value.type !== "comma") {
    leftColorPercentage = parseUnparsed(nextToken, builder, property);
    nextToken = rest.shift();
  }

  if (
    typeof nextToken !== "object" ||
    nextToken.type !== "token" ||
    nextToken.value.type !== "comma"
  ) {
    return;
  }

  nextToken = rest.shift();

  const rightColorArg = parseUnparsed(nextToken, builder, property);

  if (rightColorArg === "transparent") {
    // Ignore the rest, treat as single color with alpha
    return [{}, "colorMix", [colorSpaceArg, leftColorArg, leftColorPercentage]];
  }

  nextToken = rest.shift();
  let rightColorPercentage: StyleDescriptor | undefined;
  if (nextToken?.type !== "token" || nextToken.value.type !== "comma") {
    rightColorPercentage = parseUnparsed(nextToken, builder, property);
    nextToken = rest.shift();
  }

  // We should have expired all tokens now
  if (nextToken) {
    return;
  }

  return [
    {},
    "colorMix",
    [
      colorSpaceArg,
      leftColorArg,
      leftColorPercentage,
      rightColorArg,
      rightColorPercentage,
    ],
  ];
}

export function parseCalcArguments(
  [...args]: TokenOrValue[],
  builder: StylesheetBuilder,
  property: string,
  use: ValueUse = valueUseFor(property),
) {
  const parsed: StyleDescriptor[] = [];

  for (const arg of args) {
    switch (arg.type) {
      case "env": {
        parsed.push(parseEnv(arg.value, builder));
        break;
      }
      case "var":
      case "function":
      case "unresolved-color": {
        const value = parseUnparsed(
          arg,
          builder,
          property,
          allowsAutoKeyword(property),
          use,
        );

        if (value === undefined) {
          return undefined;
        }

        parsed.push(value);
        break;
      }
      case "length": {
        // A term of a stored `calc()` is a stored length like any other. Folded
        // to a bare number, `--x: calc(24px * 1)` reached `resolveDimension` as
        // the ratio 24 — the same loss `asDeclaredLength` exists to prevent one
        // level up, and the reason the provider tokeniser and the compiler
        // produced two shapes for one declaration.
        const value = asDeclaredLength(parseLength(arg.value, builder), use);
        if (value !== undefined) {
          parsed.push(value);
        }
        break;
      }
      case "color":
      case "url":
      case "angle":
      case "time":
      case "resolution":
      case "dashed-ident":
        break;
      case "token":
        switch (arg.value.type) {
          case "delim":
            switch (arg.value.value) {
              case "+":
              case "-":
              case "*":
              case "/":
                parsed.push(arg.value.value);
                break;
            }
            break;
          case "percentage":
            parsed.push(`${round(arg.value.value * 100)}%`);
            break;
          case "number": {
            parsed.push(round(arg.value.value));
            break;
          }
          case "parenthesis-block": {
            parsed.push("(");
            break;
          }
          case "close-parenthesis":
            parsed.push(")");
            break;
          case "string":
          case "function":
          case "ident":
          case "at-keyword":
          case "hash":
          case "id-hash":
          case "unquoted-url":
          case "dimension":
          case "white-space":
          case "comment":
          case "colon":
          case "semicolon":
          case "comma":
          case "include-match":
          case "dash-match":
          case "prefix-match":
          case "suffix-match":
          case "substring-match":
          case "cdo":
          case "cdc":
          case "square-bracket-block":
          case "curly-bracket-block":
          case "bad-url":
          case "bad-string":
          case "close-square-bracket":
          case "close-curly-bracket":
        }
    }
  }

  return parsed;
}

export function parseTranslateProp(
  value: Translate,
  prop: keyof Extract<Translate, object>,
  builder: StylesheetBuilder,
): StyleDescriptor {
  if (value === "none") {
    return 0;
  }

  return parseLength(value[prop], builder);
}

/**
 * colorjs.io holds sRGB in the 0-1 range while `rgba()` takes 0-255 channels.
 * A `null` coordinate is a missing component, which CSS Color 4 treats as `0`.
 */
function toRgbChannel(coordinate: number | null): number {
  return Math.round((coordinate ?? 0) * 255);
}

/**
 * A hue reaches this function as a 32-bit float, because the compiler runs
 * lightningcss twice and the second pass reparses the first pass's serialized
 * output. `2 ** 32` is where one step of that grid first covers a whole turn: a
 * float32 holds a 24-bit significand, so its ULP at `2 ** exponent` is
 * `2 ** (exponent - 23)`, which reaches 512 at an exponent of 32.
 *
 * `src/__tests__/native/colors.test.tsx` brackets this constant rather than
 * pinning it. A hue between `2 ** 31` and `2 ** 32` must still reduce and
 * `2 ** 32` itself must not, so any constant between those two passes. The
 * window is about a factor of two wide because the derivation above only
 * resolves to a power of two — the ULP steps from 256 straight to 512, and no
 * authored hue can land between them.
 */
const SMALLEST_UNNAMEABLE_HUE = 2 ** 32;

/**
 * Past {@link SMALLEST_UNNAMEABLE_HUE} every representable neighbour lands on a
 * different angle, so reducing the arriving float modulo a turn reports the
 * float grid rather than the declaration, and the value is a range limit rather
 * than a hue.
 *
 * Both lightningcss passes contribute, and they saturate different inputs. A
 * visitor is what materialises the AST into JavaScript and back, and the hue
 * saturates to i64 on that round trip: pass one's declaration visitor saturates
 * `1e19` through `1e38`, serializing all of them as `9223370000000000000`,
 * while pass two's rule visitor saturates `calc(infinity)`, which pass one
 * leaves at the float32 maximum `3.40282e38`. They arrive here as
 * `9223369837831520000` and `9223372036854776000`. `Infinity`, which is how a
 * `calc(NaN)` hue arrives, is the same condition at the top of the range.
 *
 * This threshold is about where a hue stops naming an angle, not about where it
 * stops being exact. lightningcss's serializer keeps six significant digits, so
 * from about `1e6` the arriving float already names a different angle than the
 * author wrote — `12345678` arrives as `12345700`, `123456789` as `123457000` —
 * and those hues are still reduced, from a number the serializer chose. That
 * loss is upstream of this function and no threshold here recovers it.
 *
 * CSS Color 4 makes a missing component `0`, so an unnameable hue takes `0`.
 * That is also what lightningcss's own resolved path produces for most such
 * hues, with the divergence recorded in `src/__tests__/native/colors.test.tsx`.
 * `Math.abs` covers `NaN` and both infinities on its own — every comparison
 * against them is `false` — so a separate finiteness test would be dead code.
 */
function toHueDegrees(hue: number): number {
  return Math.abs(hue) < SMALLEST_UNNAMEABLE_HUE ? hue : 0;
}

export function parseUnresolvedColor(
  color: UnresolvedColor,
  builder: StylesheetBuilder,
  property: string,
  allowAuto: boolean,
  use: ValueUse = valueUseFor(property),
): StyleDescriptor {
  switch (color.type) {
    case "rgb":
      // lightningcss resolves rgb channels to integers in the 0-255 range,
      // including the percentage syntax, so they are already the values
      // `rgba()` takes.
      return [
        {},
        "rgba",
        [
          color.r,
          color.g,
          color.b,
          parseUnparsed(color.alpha, builder, property, allowAuto, use),
        ],
      ];
    case "hsl": {
      // An `UnresolvedColor` always leaves the alpha as a `var()`, and an unset
      // variable with no fallback drops that argument. `hsla()` is rejected
      // three-argument, so it cannot carry an alpha that may vanish, while
      // `rgba()` stays valid and renders opaque. lightningcss resolves the hue,
      // saturation and lightness, so they convert to the sRGB channels
      // `parseColor` writes for the resolved spelling and share the shape above.
      //
      // The hue is the only unbounded channel: lightningcss clamps saturation,
      // lightness and every rgb channel to their range, so the hue is the one
      // place an out-of-range `calc()` reaches this function. `toHueDegrees`
      // decides which arriving floats still name an angle.
      const { coords } = new Color({
        space: "hsl",
        coords: [toHueDegrees(color.h), color.s, color.l],
      }).to("srgb");

      return [
        {},
        "rgba",
        [
          toRgbChannel(coords[0]),
          toRgbChannel(coords[1]),
          toRgbChannel(coords[2]),
          parseUnparsed(color.alpha, builder, property, allowAuto, use),
        ],
      ];
    }
    case "light-dark": {
      const extraRule = builder.openExtraRule(DARK_COLOR_SCHEME);

      builder.addUnnamedDescriptor(
        reduceParseUnparsed(color.dark, builder, property, allowAuto, use),
        false,
        extraRule,
      );
      return reduceParseUnparsed(
        color.light,
        builder,
        property,
        allowAuto,
        use,
      );
    }
    default:
      color satisfies never;
  }

  return;
}

export function allEqual(...params: unknown[]) {
  return params.every((param, index, array) => {
    return index === 0 ? true : equal(array[0], param);
  });
}
export function equal(a: unknown, b: unknown) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!equal(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    if (Object.keys(a).length !== Object.keys(b).length) return false;
    for (const key in a) {
      if (
        !equal(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        )
      )
        return false;
    }
    return true;
  }

  return false;
}

export function parseTime(time: Time) {
  return round(time.type === "milliseconds" ? time.value : time.value * 1000);
}

export function parseSize2DDimensionPercentageDeclaration(
  declaration: { value: Size2DFor_DimensionPercentageFor_LengthValue },
  builder: StylesheetBuilder,
) {
  return parseSize2DDimensionPercentage(declaration.value, builder);
}

/**
 * A CSS `<size-2d>` — a horizontal radius and a vertical one — as the single
 * radius React Native holds.
 *
 * `borderTopLeftRadius` and its siblings take ONE value
 * (`AnimatableNumericValue | string` in `StyleSheetTypes`), so every corner in
 * React Native is a circular arc and css-backgrounds-3 §5.1's elliptical form
 * has no representation. The HORIZONTAL radius is kept, because it renders; the
 * vertical one is reported, because dropping half a declaration silently is how
 * an author ends up debugging a shape that is subtly wrong with nothing to look
 * at.
 *
 * This is a narrowing, and the library does not narrow lightly — a CSS feature
 * React Native has not implemented is normally emitted anyway and left inert.
 * Here the faithful value would replace a rounding that works with one React
 * Native cannot read, so the concession buys a rendering. The gap itself is
 * upstream.
 */
/** A radius as a warning names it — a number or percentage verbatim, anything
 * else by its shape rather than as `[object Object]`. */
function describeRadius(value: StyleDescriptor): string {
  return typeof value === "number" || typeof value === "string"
    ? String(value)
    : JSON.stringify(value);
}

export function parseSize2DDimensionPercentage(
  value: Size2DFor_DimensionPercentageFor_LengthValue,
  builder: StylesheetBuilder,
) {
  const horizontal = parseLength(value[0], builder);
  const vertical = parseLength(value[1], builder);

  if (vertical !== undefined && vertical !== horizontal) {
    // Both are a `StyleDescriptor`, which admits a style function — an object
    // whose default stringification says nothing. `JSON.stringify` names the
    // shape instead, and leaves the ordinary number and percentage cases
    // reading exactly as they were written.
    builder.addWarning(
      "value",
      `${describeRadius(horizontal)} / ${describeRadius(vertical)}`,
    );
  }

  return horizontal;
}

export function addTransitionValue(
  declaration: Extract<
    Declaration,
    { property: `transition${string}` | "transition" }
  >,
  builder: StylesheetBuilder,
) {
  switch (declaration.property) {
    case "transition": {
      const grouped: Record<string, unknown[]> = {};

      for (const animation of declaration.value) {
        for (const [key, value] of Object.entries(animation)) {
          grouped[key] ??= [];
          grouped[key].push(value);
        }
      }

      for (const [property, value] of Object.entries(grouped)) {
        addTransitionValue(
          {
            property: `transition-${kebabCase(property)}`,
            value,
          } as Extract<
            Declaration,
            { property: `transition${string}` | "transition" }
          >,
          builder,
        );
      }
      break;
    }
    case "transition-property": {
      builder.addDescriptor(
        declaration.property,
        declaration.value
          .map((v) => v.property)
          .filter(
            (v) =>
              (v in parsers && !["visibility"].includes(v)) ||
              v === "all" ||
              v === "none",
          )
          // Through `propertyRename`, because this list is READ BACK against
          // the style keys a rule produced: a transition names the key it
          // animates. `block-size` is written to `height` and
          // `background-image` to `experimental_backgroundImage`, so the
          // camelCase of the CSS name names nothing and the transition could
          // never match the declaration it was written for.
          .map((v) => toRNProperty(propertyRename[v] ?? v)),
      );
      return;
    }
    case "transition-duration":
      builder.addDescriptor(
        declaration.property,
        declaration.value.map((t) => parseTime(t)),
      );
      return;
    case "transition-delay":
      builder.addDescriptor(
        declaration.property,
        declaration.value.map((t) => parseTime(t)),
      );
      return;
    case "transition-timing-function":
      builder.addDescriptor(
        declaration.property,
        parseEasingFunction(declaration.value),
      );
      return;
  }
}

export function addAnimationValue(
  declaration: Extract<
    Declaration,
    { property: `animation${string}` | "animation" }
  >,
  builder: StylesheetBuilder,
) {
  switch (declaration.property) {
    case "animation": {
      const grouped: Record<string, unknown[]> = {};

      for (const animation of declaration.value) {
        for (const [key, value] of Object.entries(animation)) {
          grouped[key] ??= [];
          grouped[key].push(value);
        }
      }

      for (const [property, value] of Object.entries(grouped)) {
        addAnimationValue(
          {
            property: `animation-${kebabCase(property)}`,
            value,
          } as Extract<
            Declaration,
            { property: `animation${string}` | "animation" }
          >,
          builder,
        );
      }
      break;
    }
    case "animation-delay": {
      builder.addDescriptor(
        declaration.property,
        declaration.value.map((t) => parseTime(t)),
      );
      break;
    }
    case "animation-direction": {
      builder.addDescriptor(declaration.property, declaration.value);
      break;
    }
    case "animation-duration": {
      builder.addDescriptor(
        declaration.property,
        declaration.value.map((t) => parseTime(t)),
      );
      break;
    }
    case "animation-fill-mode": {
      builder.addDescriptor(declaration.property, declaration.value);
      break;
    }
    case "animation-iteration-count": {
      builder.addDescriptor(
        declaration.property,
        parseIterationCount(declaration.value),
      );
      break;
    }
    case "animation-name": {
      builder.addDescriptor(
        declaration.property,
        declaration.value.map((v) =>
          v.type === "none"
            ? "none"
            : ([{}, "animationName", [v.value], 1] as StyleDescriptor),
        ),
      );
      break;
    }
    case "animation-play-state": {
      builder.addDescriptor(declaration.property, declaration.value);
      break;
    }
    case "animation-timing-function": {
      builder.addDescriptor(
        declaration.property,
        parseEasingFunction(declaration.value),
      );
      break;
    }
  }
}

export function kebabCase(str: string) {
  return str.replace(
    /[A-Z]+(?![a-z])|[A-Z]/g,
    ($, ofs) => (ofs ? "-" : "") + $.toLowerCase(),
  );
}

function parseBackgroundImage(
  declaration: DeclarationType<"background-image">,
  builder: StylesheetBuilder,
) {
  const layers = declaration.value.flatMap((image): StyleDescriptor[] => {
    switch (image.type) {
      case "gradient": {
        const gradient = parseGradient(image.value, builder);
        return gradient ? [gradient] : [];
      }
      case "none":
        return ["none"];
    }

    return [];
  });

  if (layers.length === 0) {
    return;
  }

  // ONE comma-separated string, which is what `background-image` is in CSS and
  // what React Native reads.
  //
  // `processBackgroundImage` accepts a CSS string or an array of gradient
  // OBJECTS; an array of gradient STRINGS is neither, and it reads
  // `.colorStops.length` off each member, so a layer list threw
  // `Cannot read properties of undefined (reading 'length')` on device. The
  // deferred route already produced the string form — this is the literal route
  // joining to the same thing, and `join` defers to runtime so a layer whose
  // colour is still a `var()` is resolved before it is written into the text.
  builder.addDescriptor("experimental_backgroundImage", [
    {},
    "join",
    [layers, ", "],
  ]);
}

function parseGradient(
  gradient: Gradient,
  builder: StylesheetBuilder,
): StyleDescriptor {
  switch (gradient.type) {
    case "linear": {
      return [
        {},
        "linear-gradient",
        [
          parseLineDirection(gradient.direction, builder),
          ...gradient.items.map((item) => parseGradientItem(item, builder)),
        ],
      ];
    }
    case "repeating-linear": {
      // Emitted, not dropped. React Native's parser answers an empty list for
      // this family, which is INERT rather than fatal — so shipping the
      // faithful value costs nothing today and starts painting the day the
      // parser learns the function, with no change here.
      // `native-support-census.test.ts` holds that verdict against React
      // Native's own module, so it cannot quietly stop being true.
      builder.addWarning("value", "repeating-linear-gradient()");
      return [
        {},
        "repeating-linear-gradient",
        [
          parseLineDirection(gradient.direction, builder),
          ...gradient.items.map((item) => parseGradientItem(item, builder)),
        ],
      ];
    }
    case "radial": {
      // React Native has implemented radial gradients since 0.81
      // (`processBackgroundImage`'s `parseRadialGradientCSSString`), and this
      // case's absence made `background-image: radial-gradient(…)` compile to
      // an EMPTY layer list with no warning — the only gradient family the
      // library dropped outright.
      return [
        {},
        "radial-gradient",
        [
          parseRadialPrelude(gradient, builder),
          ...gradient.items.map((item) => parseGradientItem(item, builder)),
        ],
      ];
    }
    case "repeating-radial": {
      builder.addWarning("value", "repeating-radial-gradient()");
      return [
        {},
        "repeating-radial-gradient",
        [
          parseRadialPrelude(gradient, builder),
          ...gradient.items.map((item) => parseGradientItem(item, builder)),
        ],
      ];
    }
    case "conic": {
      builder.addWarning("value", "conic-gradient()");
      return [
        {},
        "conic-gradient",
        [
          parseConicPrelude(gradient, builder),
          ...gradient.items.map((item) =>
            parseConicGradientItem(item, builder),
          ),
        ],
      ];
    }
    case "repeating-conic": {
      builder.addWarning("value", "repeating-conic-gradient()");
      return [
        {},
        "repeating-conic-gradient",
        [
          parseConicPrelude(gradient, builder),
          ...gradient.items.map((item) =>
            parseConicGradientItem(item, builder),
          ),
        ],
      ];
    }
  }

  // `webkit-gradient()` is the only family left, and it is a different grammar
  // rather than a missing one — a legacy prefixed function with `from()`/`to()`
  // points, which no target reads and CSS has superseded.
  builder.addWarning("value", `${gradient.type}()`);
  return;
}

/**
 * The `[from <angle>]? [at <position>]?` head of a `conic-gradient()`, as the
 * CSS text a parser reads back.
 *
 * Both parts are omitted at their initial values — `from 0deg` and `at center
 * center` — because a prelude naming only defaults is noise a reader has to
 * check, and the grammar treats its absence as exactly those values.
 */
function parseConicPrelude(
  gradient: Extract<Gradient, { type: "conic" | "repeating-conic" }>,
  builder: StylesheetBuilder,
): StyleDescriptor {
  const parts: string[] = [];
  const angle = parseAngle(gradient.angle, builder);

  if (typeof angle === "string" && angle !== "0deg") {
    parts.push("from", angle);
  }

  const x = serializePositionComponent(gradient.position.x);
  const y = serializePositionComponent(gradient.position.y);

  if (x === undefined || y === undefined) {
    return;
  }

  if (x !== "center" || y !== "center") {
    parts.push("at", x, y);
  }

  return parts.length === 0 ? undefined : parts.join(" ");
}

/**
 * A conic stop, whose position is an ANGLE rather than a length — the one way
 * this family's stop list differs from the other four.
 *
 * Kept separate from `parseGradientItem` rather than branching inside it: the
 * two grammars accept different position types, and a single function would
 * have to guess which it was handed from the shape of the value.
 */
function parseConicGradientItem(
  item: GradientItemFor_DimensionPercentageFor_Angle,
  builder: StylesheetBuilder,
): StyleDescriptor {
  switch (item.type) {
    case "color-stop": {
      const color = parseColor(item.color, builder);

      return item.position === undefined || item.position === null
        ? color
        : [color, serializeAnglePercentage(item.position, builder)];
    }
    case "hint":
      return serializeAnglePercentage(item.value, builder);
  }
}

/** An angle-or-percentage stop position, as its CSS text. */
function serializeAnglePercentage(
  value: DimensionPercentageFor_Angle,
  builder: StylesheetBuilder,
): StyleDescriptor {
  switch (value.type) {
    case "dimension":
      return parseAngle(value.value, builder);
    case "percentage":
      return serializePercentage(value.value);
    default:
      // A `calc()` over angles, which no target resolves for a gradient stop.
      return;
  }
}

/**
 * The `[<shape> || <size>]? [at <position>]?` head of a `radial-gradient()`,
 * as the CSS text React Native's own parser reads.
 */
function parseRadialPrelude(
  gradient: Extract<Gradient, { type: "radial" | "repeating-radial" }>,
  builder: StylesheetBuilder,
): StyleDescriptor {
  const parts: string[] = [];

  switch (gradient.shape.type) {
    case "circle":
      switch (gradient.shape.value.type) {
        case "extent":
          parts.push("circle", gradient.shape.value.value);
          break;
        case "radius": {
          // A circle's radius is a `<length>`, so it is a `Length` rather than
          // a `DimensionPercentage` — percentages are not valid here.
          const radius =
            gradient.shape.value.value.type === "value"
              ? serializeLengthValue(gradient.shape.value.value.value)
              : undefined;
          if (radius === undefined) {
            return;
          }
          parts.push("circle", radius);
          break;
        }
      }
      break;
    case "ellipse":
      switch (gradient.shape.value.type) {
        case "extent":
          parts.push("ellipse", gradient.shape.value.value);
          break;
        case "size": {
          const x = serializeDimension(gradient.shape.value.x);
          const y = serializeDimension(gradient.shape.value.y);
          if (x === undefined || y === undefined) {
            return;
          }
          parts.push("ellipse", x, y);
          break;
        }
      }
      break;
  }

  const x = serializePositionComponent(gradient.position.x);
  const y = serializePositionComponent(gradient.position.y);

  if (x === undefined || y === undefined) {
    builder.addWarning("value", "radial-gradient(at <position>)");
    return parts.join(" ");
  }

  parts.push("at", x, y);

  return parts.join(" ");
}

/**
 * A raw `{unit, value}` as CSS text.
 *
 * The compiler's `Length` visitor has already folded `rem` and every absolute
 * unit to px, so anything still carrying another unit needs a layout pass and
 * cannot be written into a string React Native parses at style time.
 */
function serializeLengthValue(value: {
  unit: string;
  value: number;
}): string | undefined {
  return value.unit === "px" ? `${String(value.value)}px` : undefined;
}

/** A `<length-percentage>` as CSS text, or nothing if it cannot be written. */
/**
 * A percentage as its CSS text, from the fraction lightningcss models it as.
 *
 * The rounding is not cosmetic. lightningcss stores the fraction as a 32-bit
 * float, so `30%` arrives as `0.30000001192092896` and the naive `x * 100`
 * writes `30.000001192092896%` into the gradient text — which is what shipped.
 * Six significant digits is past any precision a stylesheet can express and
 * short of the noise, so an authored value comes back as authored.
 */
function serializePercentage(fraction: number): string {
  return `${String(Number((fraction * 100).toPrecision(6)))}%`;
}

function serializeDimension(
  value: DimensionPercentageFor_LengthValue,
): string | undefined {
  if (value.type === "percentage") {
    return serializePercentage(value.value);
  }

  return value.type === "dimension"
    ? serializeLengthValue(value.value)
    : undefined;
}

function serializePositionComponent(component: {
  type: string;
  side?: string;
  offset?: DimensionPercentageFor_LengthValue | null;
  value?: DimensionPercentageFor_LengthValue;
}): string | undefined {
  switch (component.type) {
    case "center":
      return "center";
    case "length":
      return component.value ? serializeDimension(component.value) : undefined;
    case "side": {
      if (component.side === undefined) {
        return;
      }
      if (component.offset === undefined || component.offset === null) {
        return component.side;
      }
      const offset = serializeDimension(component.offset);
      return offset === undefined ? undefined : `${component.side} ${offset}`;
    }
    default:
      return;
  }
}

function parseLineDirection(
  lineDirection: LineDirection,
  builder: StylesheetBuilder,
): StyleDescriptor {
  switch (lineDirection.type) {
    case "corner":
      return `to ${lineDirection.horizontal} ${lineDirection.vertical}`;
    case "horizontal":
    case "vertical":
      return `to ${lineDirection.value}`;
    case "angle":
      return parseAngle(lineDirection.value, builder);
    default: {
      lineDirection satisfies never;
    }
  }

  return;
}

function parseGradientItem(
  item: GradientItemFor_DimensionPercentageFor_LengthValue,
  builder: StylesheetBuilder,
): StyleDescriptor {
  switch (item.type) {
    case "color-stop": {
      const color = parseColor(item.color, builder);

      // The stop's own tokens, colour first, exactly as CSS writes them. The
      // gradient resolver reads a stop list back by that grammar — a colour
      // opens a stop, a number or percentage is its position — so this is the
      // shape both routes hand it and neither can drift from the other.
      //
      // NOT a `@colorStop(…)` wrapper. That marker is this library's own, and
      // React Native has never known it: `experimental_backgroundImage` runs
      // through `processBackgroundImage`
      // (`Libraries/Components/View/ReactNativeStyleAttributes.js`), which reads
      // `.colorStops.length` off each layer — so a layer that is the STRING
      // `"linear-gradient(to right, @colorStop(#123456, 0%), …)"` threw
      // `Cannot read properties of undefined (reading 'length')` on device. The
      // plain CSS spelling parses into a real gradient, which is what the
      // deferred route was already producing and the literal route was not.
      return item.position === undefined || item.position === null
        ? color
        : [color, parseLength(item.position, builder)];
    }
    case "hint":
      return parseLength(item.value, builder);
  }
}

function parseObjectFit(
  declaration: CustomProperty,
  builder: StylesheetBuilder,
) {
  const value = parseUnparsed(declaration.value, builder, "object-fit");

  // BOTH targets. The mapping sends the value to a `contentFit` PROP, which is
  // expo-image's API; React Native's own `<Image>` reads an `objectFit` STYLE
  // key, which nothing reached. The two value sets are identical — CSS's
  // `fill | contain | cover | none | scale-down` is exactly React Native's
  // `objectFit` union and exactly expo-image's `ImageContentFit` — so no
  // conversion is needed and neither consumer sees a value it cannot read.
  builder.addMapping({
    "object-fit": ["contentFit"],
  });
  builder.addDescriptor("object-fit", value);
  builder.addDescriptor("objectFit", value);
}

function parseObjectPosition(
  declaration: CustomProperty,
  builder: StylesheetBuilder,
) {
  builder.addMapping({
    "object-position": ["contentPosition"],
  });
  builder.addDescriptor("object-position", [
    {},
    "join",
    [parseUnparsed(declaration.value, builder, "object-position"), " "],
  ]);
}

/**
 * `corner-shape` to React Native's `borderCurve`, which is the only part of the
 * property React Native implements: `'circular' | 'continuous'`.
 */
function parseCornerShape(
  shape: StyleDescriptor,
  builder: StylesheetBuilder,
): StyleDescriptor {
  if (shape === "round") {
    return "circular";
  }

  if (shape === "squircle") {
    return "continuous";
  }

  if (shape === undefined) {
    // An earlier stage rejected the value and has already reported it —
    // `superellipse(2)` arrives this way, as a function nothing can resolve.
    return undefined;
  }

  // `bevel`, `scoop` and `notch` are valid CSS with no React Native curve to
  // land on. Passing straight through left the rule doing nothing and saying
  // nothing, which is the one outcome an author cannot debug: the declaration
  // is spelled correctly, so there is nothing to look at.
  builder.addWarning(
    "value",
    typeof shape === "string" ? shape : JSON.stringify(shape),
  );

  return undefined;
}

/**
 * How a KEYWORD property reaches the stylesheet, on whichever of the three
 * routes its value took.
 *
 * `isolation`, `corner-shape` and the three `font-variant*` spellings all
 * accept a closed set of keywords, and `corner-shape` renames the property as
 * well as the value. That translation can only happen here when the value is
 * known here — so a value still carrying a `var()` is handed to the RUNTIME
 * resolver of the same name (`native/styles/functions/keyword-functions.ts`)
 * instead of being validated against a keyword it has not resolved to yet.
 *
 * Dropping it instead is what made a theme variable silently do nothing: the
 * literal spelling of the same declaration worked, so the fault read as a
 * problem with the theme rather than with the property.
 */
interface KeywordDescriptor {
  /** The CSS property the descriptor is added under. */
  readonly target: string;
  /** The runtime resolver's name, for a value only it can decide. */
  readonly resolver: string;
  /** The value as far as the compiler could take it. */
  readonly value: StyleDescriptor;
  /** How the same keyword is read when it IS known at compile time. */
  readonly parseLiteral: (value: StyleDescriptor) => StyleDescriptor;
}

function addKeywordDescriptor(
  builder: StylesheetBuilder,
  { target, resolver, value, parseLiteral }: KeywordDescriptor,
): void {
  if (isStyleFunction(value)) {
    builder.addDescriptor(target, [{}, resolver, value, 1]);
    return;
  }

  const parsed = parseLiteral(value);

  if (parsed !== undefined) {
    builder.addDescriptor(target, parsed);
  }
}

function parseVisibility(
  declaration: DeclarationType<"visibility">,
  builder: StylesheetBuilder,
) {
  // The property itself, on every value. React Native has no `visibility` key
  // today — it is not in `StyleSheetTypes` or `ReactNativeStyleAttributes` — so
  // this is inert, and it is emitted anyway: a compiler that drops a CSS
  // property because the target does not implement it yet can never carry the
  // property the day the target does, and it hides the gap from the person who
  // could report it. The approximation below is what renders meanwhile.
  builder.addDescriptor("visibility", declaration.value);

  switch (declaration.value) {
    case "visible":
      builder.addDescriptor("opacity", 1);
      builder.addDescriptor("pointerEvents", "auto");
      return;
    // BOTH halves. `opacity: 0` alone makes the element invisible and leaves it
    // fully hit-testable, so a hidden button still takes taps — the opposite of
    // what `visibility: hidden` means, and worse than not supporting it at all,
    // because the author cannot see the difference.
    //
    // `pointerEvents` is a real React Native style key (`ViewStyle`), not just a
    // prop, so it composes through the cascade like any other declaration.
    //
    // `collapse` collapses a table row or column, and falls back to `hidden`
    // everywhere else — which is everywhere React Native has.
    case "hidden":
    case "collapse":
      builder.addDescriptor("opacity", 0);
      builder.addDescriptor("pointerEvents", "none");
      return;
    default:
      declaration.value satisfies never;
      return;
  }
}

/** React Native's `outlineStyle` union. `auto` has no equivalent. */
const OUTLINE_STYLES = new Set(["solid", "dotted", "dashed"]);

function addOutlineStyle(
  value: DeclarationType<"outline-style">["value"],
  builder: StylesheetBuilder,
) {
  if (value.type !== "auto" && OUTLINE_STYLES.has(value.value)) {
    builder.addDescriptor("outlineStyle", value.value);
  } else {
    builder.addWarning("value", value.type === "auto" ? "auto" : value.value);
  }
}

function parseOutlineStyle(
  declaration: DeclarationType<"outline-style">,
  builder: StylesheetBuilder,
) {
  addOutlineStyle(declaration.value, builder);
}

/**
 * The `outline` shorthand.
 *
 * Without it, writing all three longhands lost ALL THREE: lightningcss
 * recombines `outline-width` + `outline-style` + `outline-color` into the
 * `outline` shorthand, which had no parser, so the declaration was warned about
 * and dropped. Writing any TWO of them worked. More CSS producing less style is
 * the sharpest form the drift takes.
 *
 * React Native carries all four longhands (`outlineColor`, `outlineOffset`,
 * `outlineStyle`, `outlineWidth`) on its runtime whitelist, so nothing here is
 * an approximation.
 */
function parseOutline(
  declaration: DeclarationType<"outline">,
  builder: StylesheetBuilder,
) {
  const { color, style, width } = declaration.value;

  builder.addDescriptor("outlineWidth", parseBorderSideWidth(width, builder));
  addOutlineStyle(style, builder);
  addColorDescriptor(builder, "outlineColor", color);
}

function parseFilter(
  declaration: DeclarationType<"filter">,
  builder: StylesheetBuilder,
) {
  if (declaration.value.type === "none") {
    return "unset";
  }

  return declaration.value.value
    .map((value) => {
      switch (value.type) {
        case "opacity":
        case "blur":
        case "brightness":
        case "contrast":
        case "grayscale":
        case "invert":
        case "saturate":
        case "sepia":
          return {
            [value.type]: parseLength(value.value, builder),
          } as unknown as StyleDescriptor;
        case "hue-rotate":
          // `toRNProperty`, like the `drop-shadow` case below, because this is
          // the one filter function whose CSS and React Native spellings
          // differ: `FilterFunction` declares `hueRotate`. Emitting the kebab
          // name made `processFilter` fall through to its `default` and return
          // an EMPTY list, so `filter: blur(2px) hue-rotate(45deg)` rendered no
          // blur either — one unmapped function discarded the whole
          // declaration. The runtime `var()` path already spelled it camelCase,
          // so the two routes disagreed.
          return {
            [toRNProperty(value.type)]: parseAngle(value.value, builder),
          } as unknown as StyleDescriptor;
        case "drop-shadow":
          return [
            {},
            toRNProperty(value.type),
            [
              parseLength(value.value.xOffset, builder),
              parseLength(value.value.yOffset, builder),
              parseLength(value.value.blur, builder),
              parseColor(value.value.color, builder),
            ],
          ] as unknown as StyleDescriptor;
        case "url":
          return;
      }
    })
    .filter((value) => value !== undefined);
}

const namedColors = new Set([
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
]);
