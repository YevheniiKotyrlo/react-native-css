import { processColor } from "react-native";

import { render } from "@testing-library/react-native";
import { Image } from "react-native-css/components/Image";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import processBackgroundImage from "react-native/Libraries/StyleSheet/processBackgroundImage";

/**
 * Reverse coverage: which React Native style keys can a CSS author actually
 * reach?
 *
 * Every other suite in this folder asks "does this CSS declaration compile?".
 * This one asks the opposite question — walk React Native's own style surface
 * (`ViewStyle`, `TextStyle`, `TextStyleIOS`, `TextStyleAndroid`, `ImageStyle`,
 * `FlexStyle`, `ShadowStyleIOS` in `StyleSheetTypes.d.ts`, cross-checked
 * against the runtime whitelist in
 * `Libraries/Components/View/ReactNativeStyleAttributes.js`) and ask, for each
 * key React Native can render, whether any CSS declaration produces it.
 *
 * Three answers turn up, and the tests below pin all three:
 *
 *  1. A real CSS property maps to it. The bulk of the surface.
 *  2. Only the `-rn-<key>` escape hatch reaches it. `-rn-` is a pass-through:
 *     `parseCustomDeclaration` accepts any `-rn-` prefixed property and
 *     `toRNProperty` strips the prefix and camelCases the rest, so
 *     `-rn-tint-color` becomes `tintColor`. It is not mentioned in the README,
 *     so an author has to already know it exists.
 *  3. Nothing reaches it — marked `// GAP:` with the declaration that should.
 *
 * `-rn-` reachability is recorded separately from a real CSS route on purpose:
 * a stylesheet that has to name React Native keys is no longer portable CSS,
 * which is the thing this library exists to allow.
 */

/*****************************************************************************
 * 1. ViewStyle — Android shadow
 ****************************************************************************/

// GAP: `elevation` (ViewStyle, Android) has no CSS route. It is the Android
// half of a drop shadow and `box-shadow` compiles to `boxShadow` instead, so
// there is no declaration that produces it.
test("elevation is unreachable from CSS and warns as an unknown property", () => {
  const compiled = registerCSS(`.rn-elevation-css { elevation: 4; }`);

  const component = render(
    <View testID={testID} className="rn-elevation-css" />,
  ).getByTestId(testID);

  expect(component.props.style).toBeUndefined();
  expect(compiled.warnings()).toStrictEqual({ properties: ["elevation"] });
});

test("elevation is reachable through the -rn- escape hatch", () => {
  registerCSS(`.rn-elevation-hatch { -rn-elevation: 4; }`);

  const component = render(
    <View testID={testID} className="rn-elevation-hatch" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ elevation: 4 });
});

/*****************************************************************************
 * 2. ShadowStyleIOS — the legacy iOS shadow quad
 ****************************************************************************/

// GAP: `shadowColor` / `shadowOpacity` / `shadowRadius` (ShadowStyleIOS) have
// no CSS route. `box-shadow` compiles to React Native's newer `boxShadow`
// array, never to the legacy quad, and `shadow-color` is not a CSS property.
test("the legacy iOS shadow quad is unreachable from CSS", () => {
  const compiled = registerCSS(`
    .rn-shadow-color-css { shadow-color: red; }
    .rn-shadow-opacity-css { shadow-opacity: 0.5; }
    .rn-shadow-radius-css { shadow-radius: 4px; }
  `);

  expect(
    render(
      <View testID={testID} className="rn-shadow-color-css" />,
    ).getByTestId(testID).props.style,
  ).toBeUndefined();

  expect(compiled.warnings()).toStrictEqual({
    properties: ["shadow-color", "shadow-opacity", "shadow-radius"],
  });
});

test("box-shadow reaches boxShadow, not the legacy iOS quad", () => {
  registerCSS(`.rn-boxshadow { box-shadow: 1px 2px 3px 4px #123456; }`);

  const component = render(
    <View testID={testID} className="rn-boxshadow" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    boxShadow: [
      {
        color: "#123456",
        offsetX: 1,
        offsetY: 2,
        blurRadius: 3,
        spreadDistance: 4,
      },
    ],
  });
});

test("shadowColor / shadowOpacity / shadowRadius are reachable through -rn-", () => {
  registerCSS(`
    .rn-shadow-hatch {
      -rn-shadow-color: #123456;
      -rn-shadow-opacity: 0.5;
      -rn-shadow-radius: 4px;
    }
  `);

  const component = render(
    <View testID={testID} className="rn-shadow-hatch" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    shadowColor: "#123456",
    shadowOpacity: 0.5,
    shadowRadius: 4,
  });
});

// `shadowOffset` (ShadowStyleIOS) reaches the shape React Native reads —
// `{ width, height }`, which is what `sizesDiffer` in
// `ReactNativeStyleAttributes` compares. Neither route used to produce it:
//   * `-rn-shadow-offset: 1px 2px` landed a two-element ARRAY in the style, so
//     `.width` / `.height` read back `undefined` and the shadow drew at 0,0.
//   * the escaped-dot path form puts the value on a top-level PROP rather than
//     inside `style`, because only the internal `&.` prefix targets the style
//     object and `&` is not a legal CSS property character — so an author
//     cannot write it.
// The `-rn-` branch now emits the `&.` paths itself, which is the same
// mechanism `parseTextShadow` uses for the identically-shaped
// `textShadowOffset`.
test("shadowOffset reaches the { width, height } shape React Native reads", () => {
  registerCSS(`
    .rn-shadow-offset-pair { -rn-shadow-offset: 1px 2px; }
    .rn-shadow-offset-path { -rn-shadow-offset\\.width: 1px; }
  `);

  const pair = render(
    <View testID={testID} className="rn-shadow-offset-pair" />,
  ).getByTestId(testID);
  expect(pair.props.style).toStrictEqual({
    shadowOffset: { width: 1, height: 2 },
  });

  const path = render(
    <View testID={testID} className="rn-shadow-offset-path" />,
  ).getByTestId(testID);
  expect(path.props.style).toStrictEqual({});
  expect(path.props.shadowOffset).toStrictEqual({ width: 1 });
});

test("textShadowOffset — the same nested shape — is produced correctly by text-shadow", () => {
  registerCSS(`.rn-textshadow { text-shadow: 1px 2px 3px #123456; }`);

  const component = render(
    <Text testID={testID} className="rn-textshadow" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    textShadowColor: "#123456",
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 3,
  });
});

/*****************************************************************************
 * 3. ImageStyle
 ****************************************************************************/

// GAP: `tintColor` / `overlayColor` / `resizeMode` (ImageStyle) have no CSS
// route. `tint-color`, `overlay-color` and `resize-mode` are React Native
// names, not CSS properties, so each warns as unknown.
test("tintColor / overlayColor / resizeMode are unreachable from CSS", () => {
  const compiled = registerCSS(`
    .rn-tint-css { tint-color: red; }
    .rn-overlay-css { overlay-color: red; }
    .rn-resize-css { resize-mode: repeat; }
  `);

  expect(
    render(
      <Image testID={testID} className="rn-tint-css" source={{ uri: "x" }} />,
    ).getByTestId(testID).props.style,
  ).toBeUndefined();

  expect(compiled.warnings()).toStrictEqual({
    properties: ["tint-color", "overlay-color", "resize-mode"],
  });
});

test("tintColor / overlayColor / resizeMode are reachable through -rn-", () => {
  registerCSS(`
    .rn-image-hatch {
      -rn-tint-color: #123456;
      -rn-overlay-color: #123456;
      -rn-resize-mode: repeat;
    }
  `);

  const component = render(
    <Image testID={testID} className="rn-image-hatch" source={{ uri: "x" }} />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    tintColor: "#123456",
    overlayColor: "#123456",
    resizeMode: "repeat",
  });
});

// `object-fit` reaches BOTH targets. The declaration is remapped onto a
// `contentFit` PROP — expo-image's API — by the default mapping in
// `parsePropAtRule`, and it also lands on `objectFit`, which is the style key a
// plain React Native `<Image>` reads. Only the prop existed before, so a plain
// `<Image>` received nothing. The two value sets are identical, so neither
// consumer sees a value it cannot read.
test("object-fit reaches both the contentFit prop and the objectFit style key", () => {
  registerCSS(`.rn-objectfit-css { object-fit: contain; }`);

  const component = render(
    <Image
      testID={testID}
      className="rn-objectfit-css"
      source={{ uri: "x" }}
    />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ objectFit: "contain" });
  expect(component.props.contentFit).toBe("contain");
});

test("objectFit as a style key is reachable through -rn-", () => {
  registerCSS(`.rn-objectfit-hatch { -rn-object-fit: contain; }`);

  const component = render(
    <Image
      testID={testID}
      className="rn-objectfit-hatch"
      source={{ uri: "x" }}
    />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ objectFit: "contain" });
});

/*****************************************************************************
 * 4. TextStyleAndroid
 ****************************************************************************/

// GAP: `textAlignVertical` (TextStyleAndroid) has no CSS route. `vertical-align`
// — the closest declaration — compiles to React Native's newer `verticalAlign`
// instead, which covers the same ground on Android except for the `center`
// keyword (`verticalAlign` spells it `middle`).
test("vertical-align reaches verticalAlign, never textAlignVertical", () => {
  registerCSS(`
    .rn-valign-top { vertical-align: top; }
    .rn-valign-middle { vertical-align: middle; }
  `);

  expect(
    render(<Text testID={testID} className="rn-valign-top" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ verticalAlign: "top" });

  expect(
    render(<Text testID={testID} className="rn-valign-middle" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ verticalAlign: "middle" });
});

test("textAlignVertical is reachable through -rn-", () => {
  registerCSS(`.rn-tav-hatch { -rn-text-align-vertical: center; }`);

  const component = render(
    <Text testID={testID} className="rn-tav-hatch" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ textAlignVertical: "center" });
});

// GAP: `includeFontPadding` (TextStyleAndroid) has no CSS route, and the
// escape hatch only reaches HALF of it. React Native defaults the key to
// `true`, so the only value worth writing is `false` — and `false` is dropped
// silently, with no warning, because `parseUnparsed`'s array branch bails on a
// FALSY parsed value (`if (!args) return`). The same bail eats `-rn-<key>: 0`.
test("includeFontPadding: true is reachable through -rn- but false is silently dropped", () => {
  const compiled = registerCSS(`
    .rn-ifp-true { -rn-include-font-padding: true; }
    .rn-ifp-false { -rn-include-font-padding: false; }
  `);

  expect(
    render(<Text testID={testID} className="rn-ifp-true" />).getByTestId(testID)
      .props.style,
  ).toStrictEqual({ includeFontPadding: true });

  // `includeFontPadding` defaults to `true`, so `false` is the only value
  // worth writing — and it was the one value the falsy guard discarded.
  expect(
    render(<Text testID={testID} className="rn-ifp-false" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ includeFontPadding: false });

  expect(compiled.warnings()).toStrictEqual({});
});

test("a falsy value through the -rn- hatch survives for every key, not just booleans", () => {
  registerCSS(`
    .rn-falsy-zero { -rn-elevation: 0; }
    .rn-falsy-zero-px { -rn-elevation: 0px; }
    .rn-falsy-nonzero { -rn-elevation: 1; }
  `);

  expect(
    render(<View testID={testID} className="rn-falsy-zero" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ elevation: 0 });

  expect(
    render(<View testID={testID} className="rn-falsy-zero-px" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ elevation: 0 });

  expect(
    render(<View testID={testID} className="rn-falsy-nonzero" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ elevation: 1 });
});

test("a first-class CSS parser has no such falsy bail — opacity: 0 survives", () => {
  registerCSS(`.rn-opacity-zero { opacity: 0; z-index: 0; flex-grow: 0; }`);

  const component = render(
    <View testID={testID} className="rn-opacity-zero" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    opacity: 0,
    zIndex: 0,
    flexGrow: 0,
  });
});

/*****************************************************************************
 * 5. TextStyleIOS
 ****************************************************************************/

// `direction` reaches BOTH keys. The Yoga layout key `direction` and the Text
// key `writingDirection` do different jobs — box layout direction versus text
// run direction — and CSS spells both of them `direction`, so one declaration
// has to produce both or a `<Text>` gets nothing.
test("direction reaches the layout key AND writingDirection", () => {
  const compiled = registerCSS(`.rn-direction { direction: rtl; }`);

  const component = render(
    <Text testID={testID} className="rn-direction" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    direction: "rtl",
    writingDirection: "rtl",
  });
  // `parseDirection` used to emit the descriptor AND warn unconditionally — a
  // missing `return` — so a perfectly valid `direction: rtl` reported a value
  // warning about itself.
  expect(compiled.warnings()).toStrictEqual({});
});

test("writingDirection is reachable through -rn-", () => {
  registerCSS(`.rn-wd-hatch { -rn-writing-direction: rtl; }`);

  const component = render(
    <Text testID={testID} className="rn-wd-hatch" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ writingDirection: "rtl" });
});

// GAP: `writingDirection: 'auto'` is unreachable even through the escape
// hatch. `auto` is stripped from any value whose property is not on
// `allowAutoProperties`, and a `-rn-` property never is.
test("the -rn- hatch cannot express an `auto` value", () => {
  registerCSS(`.rn-wd-auto { -rn-writing-direction: auto; }`);

  const component = render(
    <Text testID={testID} className="rn-wd-auto" />,
  ).getByTestId(testID);

  expect(component.props.style).toBeUndefined();
});

/*****************************************************************************
 * 6. FlexStyle — overflow
 ****************************************************************************/

// GAP: `overflow: 'scroll'` (FlexStyle) is refused although React Native
// accepts it — `parseOverflow`'s allow-list is `visible | hidden` only. This
// is the one case in this file where a real CSS declaration, valid for the
// exact key React Native renders, is turned away.
test("overflow: scroll reaches the style key React Native renders", () => {
  const compiled = registerCSS(`.rn-overflow-scroll { overflow: scroll; }`);

  const component = render(
    <View testID={testID} className="rn-overflow-scroll" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ overflow: "scroll" });
  expect(compiled.warnings()).toStrictEqual({});
});

test("overflow: scroll is reachable through -rn-", () => {
  registerCSS(`.rn-overflow-hatch { -rn-overflow: scroll; }`);

  const component = render(
    <View testID={testID} className="rn-overflow-hatch" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ overflow: "scroll" });
});

test("overflow: visible and hidden pass through", () => {
  registerCSS(`
    .rn-overflow-visible { overflow: visible; }
    .rn-overflow-hidden { overflow: hidden; }
  `);

  expect(
    render(
      <View testID={testID} className="rn-overflow-visible" />,
    ).getByTestId(testID).props.style,
  ).toStrictEqual({ overflow: "visible" });

  expect(
    render(<View testID={testID} className="rn-overflow-hidden" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ overflow: "hidden" });
});

/*****************************************************************************
 * 7. ViewStyle — cursor
 ****************************************************************************/

// GAP: `cursor` (ViewStyle, `'auto' | 'pointer'`) has no CSS route — the
// property is not in the parser table at all, so it warns as unknown. Upstream
// PR #346 adds it; until it lands the escape hatch is the only way through.
test("cursor is unreachable from CSS but reachable through -rn-", () => {
  const compiled = registerCSS(`
    .rn-cursor-css { cursor: pointer; }
    .rn-cursor-hatch { -rn-cursor: pointer; }
  `);

  expect(
    render(<View testID={testID} className="rn-cursor-css" />).getByTestId(
      testID,
    ).props.style,
  ).toBeUndefined();
  expect(compiled.warnings()).toStrictEqual({ properties: ["cursor"] });

  expect(
    render(<View testID={testID} className="rn-cursor-hatch" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ cursor: "pointer" });
});

/*****************************************************************************
 * 8. The logical border keys — CSS's inline edges are React Native's start/end
 ****************************************************************************/

// `border-inline-start-color` and `borderStartColor` (ViewStyle) are one
// property: both name the edge the writing direction starts at, so
// `propertyRename` (`compiler/stylesheet.ts`) maps the CSS spelling onto the one
// `ReactNativeStyleAttributes` carries. The same holds for
// `border-inline-start-width` and `borderStartWidth` (FlexStyle), and for both
// end-edge twins. Camel-cased straight through, `borderInlineStartColor` is
// absent from that list: the declaration compiled, produced a style object, and
// rendered nothing.
//
// Note the asymmetry: the INLINE spellings of margin, padding and inset ARE on
// React Native's list (`marginInlineStart`, `paddingInlineStart`,
// `insetInlineStart`), so only the border family needs the rename.
test("border-inline-* compiles to the start/end keys React Native reads", () => {
  registerCSS(`
    .rn-border-logical {
      border-inline-start-color: #123456;
      border-inline-start-width: 3px;
    }
  `);

  const component = render(
    <View testID={testID} className="rn-border-logical" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    borderStartColor: "#123456",
    borderStartWidth: 3,
  });
});

test("borderStartColor / borderStartWidth are reachable through -rn-", () => {
  registerCSS(`
    .rn-border-hatch {
      -rn-border-start-color: #123456;
      -rn-border-start-width: 3px;
    }
  `);

  const component = render(
    <View testID={testID} className="rn-border-hatch" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    borderStartColor: "#123456",
    borderStartWidth: 3,
  });
});

test("the inline spellings React Native DOES read come through from real CSS", () => {
  registerCSS(`
    .rn-inline-spacing {
      margin-inline-start: 1px;
      margin-inline-end: 2px;
      padding-inline-start: 3px;
      padding-inline-end: 4px;
      inset-inline-start: 5px;
    }
  `);

  const component = render(
    <View testID={testID} className="rn-inline-spacing" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    marginInlineStart: 1,
    marginInlineEnd: 2,
    paddingInlineStart: 3,
    paddingInlineEnd: 4,
    insetInlineStart: 5,
  });
});

// The inline axis stays on the inline axis, in every authoring shape. Both
// longhands together are folded by lightningcss into the `inset-inline`
// shorthand, so this and the explicit shorthand below take the same code path
// — the one a single longhand never reaches, which is why the pair and the
// shorthand are pinned separately from the single.
test("inset-inline in every shape reaches the inline keys, never the block ones", () => {
  registerCSS(`
    .rn-inset-inline-pair {
      inset-inline-start: 3px;
      inset-inline-end: 4px;
    }
    .rn-inset-inline-shorthand { inset-inline: 3px 4px; }
    .rn-inset-inline-single { inset-inline-start: 3px; }
    .rn-inset-block-pair {
      inset-block-start: 3px;
      inset-block-end: 4px;
    }
  `);

  const pair = render(
    <View testID={testID} className="rn-inset-inline-pair" />,
  ).getByTestId(testID);
  expect(pair.props.style).toStrictEqual({
    insetInlineStart: 3,
    insetInlineEnd: 4,
  });

  const shorthand = render(
    <View testID={testID} className="rn-inset-inline-shorthand" />,
  ).getByTestId(testID);
  expect(shorthand.props.style).toStrictEqual({
    insetInlineStart: 3,
    insetInlineEnd: 4,
  });

  const single = render(
    <View testID={testID} className="rn-inset-inline-single" />,
  ).getByTestId(testID);
  expect(single.props.style).toStrictEqual({ insetInlineStart: 3 });

  // The block axis is a distinct pair of keys and stays untouched — the two
  // axes producing identical output is exactly what a mix-up looks like.
  const block = render(
    <View testID={testID} className="rn-inset-block-pair" />,
  ).getByTestId(testID);
  expect(block.props.style).toStrictEqual({
    insetBlockStart: 3,
    insetBlockEnd: 4,
  });
});

// `addShorthand` collapses a shorthand whose ends are equal back into the
// single React Native key, so the one-value form is a third distinct output.
test("inset-inline with one value collapses to the insetInline key", () => {
  registerCSS(`
    .rn-inset-inline-one { inset-inline: 4px; }
    .rn-inset-block-one { inset-block: 4px; }
  `);

  expect(
    render(
      <View testID={testID} className="rn-inset-inline-one" />,
    ).getByTestId(testID).props.style,
  ).toStrictEqual({ insetInline: 4 });

  expect(
    render(<View testID={testID} className="rn-inset-block-one" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ insetBlock: 4 });
});

/*****************************************************************************
 * 9. React Native's own spacing aliases
 ****************************************************************************/

// GAP: `start` / `end` / `marginStart` / `marginEnd` / `marginHorizontal` /
// `marginVertical` / `paddingStart` / `paddingEnd` / `paddingHorizontal` /
// `paddingVertical` have no CSS route — they are React Native inventions with
// no CSS spelling. Unlike the border family above this costs nothing: the
// logical CSS properties that DO compile (`inset-inline-start`,
// `margin-inline-start`, `padding-block`, …) reach keys React Native reads.
test("React Native's own spacing aliases are reachable only through -rn-", () => {
  registerCSS(`
    .rn-spacing-hatch {
      -rn-start: 1px;
      -rn-end: 2px;
      -rn-margin-horizontal: 3px;
      -rn-padding-vertical: 4px;
      -rn-margin-start: 5px;
      -rn-padding-end: 6px;
    }
  `);

  const component = render(
    <View testID={testID} className="rn-spacing-hatch" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    start: 1,
    end: 2,
    marginHorizontal: 3,
    paddingVertical: 4,
    marginStart: 5,
    paddingEnd: 6,
  });
});

// GAP: `borderBottomStartRadius` / `borderBottomEndRadius` /
// `borderTopStartRadius` / `borderTopEndRadius` have no CSS route. Their CSS
// counterparts are the corner-logical radii, which compile to the OTHER four
// React Native keys (`borderStartStartRadius` and friends) — those React Native
// reads, so nothing is actually lost.
test("the CSS logical radii reach the React Native keys that read them", () => {
  registerCSS(`
    .rn-radii {
      border-start-start-radius: 1px;
      border-start-end-radius: 2px;
      border-end-start-radius: 3px;
      border-end-end-radius: 4px;
    }
  `);

  const component = render(
    <View testID={testID} className="rn-radii" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    borderStartStartRadius: 1,
    borderStartEndRadius: 2,
    borderEndStartRadius: 3,
    borderEndEndRadius: 4,
  });
});

/*****************************************************************************
 * 10. TransformsStyle — the deprecated top-level keys
 ****************************************************************************/

// `transformMatrix` (TransformsStyle, deprecated) has no route, and needs none:
// `transform: matrix(...)` reaches React Native's `{ matrix: [...] }`, which is
// what the deprecation notice points at. `processTransform` accepts a 9-element
// (2D) or 16-element (3D) COLUMN-MAJOR matrix, and CSS's argument order for both
// functions is already column-major.
test("transform: matrix() reaches React Native's matrix transform", () => {
  registerCSS(`
    .rn-matrix-2d { transform: matrix(1, 0, 0, 1, 10, 20); }
    .rn-matrix-3d { transform: matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1); }
  `);

  expect(
    render(<View testID={testID} className="rn-matrix-2d" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ transform: [{ matrix: [1, 0, 0, 0, 1, 0, 10, 20, 1] }] });

  expect(
    render(<View testID={testID} className="rn-matrix-3d" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({
    transform: [{ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
  });
});

test("the other transform functions do reach the transform array", () => {
  registerCSS(`
    .rn-transform-fns {
      transform: perspective(100px) skewX(10deg) skewY(20deg) translateX(50%);
    }
  `);

  const component = render(
    <View testID={testID} className="rn-transform-fns" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    transform: [
      { perspective: 100 },
      { skewX: "10deg" },
      { skewY: "20deg" },
      { translateX: "50%" },
    ],
  });
});

test("the standalone rotate / scale / translate properties fold into transform", () => {
  registerCSS(`
    .rn-standalone-rotate { rotate: 45deg; }
    .rn-standalone-scale { scale: 2; }
    .rn-standalone-translate { translate: 10px 20px; }
  `);

  expect(
    render(
      <View testID={testID} className="rn-standalone-rotate" />,
    ).getByTestId(testID).props.style,
  ).toStrictEqual({ transform: [{ rotateZ: "45deg" }] });

  expect(
    render(
      <View testID={testID} className="rn-standalone-scale" />,
    ).getByTestId(testID).props.style,
  ).toStrictEqual({ transform: [{ scaleX: 2 }, { scaleY: 2 }] });

  expect(
    render(
      <View testID={testID} className="rn-standalone-translate" />,
    ).getByTestId(testID).props.style,
  ).toStrictEqual({ transform: [{ translateX: 10 }, { translateY: 20 }] });
});

// The deprecated top-level transform keys are reachable through `-rn-`, but
// they are dead ends: `transformMatrix`, `rotation`, `scaleX`, `scaleY`,
// `translateX` and `translateY` are absent from `ReactNativeStyleAttributes`,
// so React Native's renderer ignores whatever lands there. Pinned so that a
// future change to the escape hatch is visible.
test("the deprecated transform keys can be written through -rn- but React Native no longer reads them", () => {
  registerCSS(`
    .rn-deprecated-transform {
      -rn-transform-matrix: 1 0 0 1 10 20;
      -rn-rotation: 45;
      -rn-scale-x: 2;
      -rn-translate-y: 10px;
    }
  `);

  const component = render(
    <View testID={testID} className="rn-deprecated-transform" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    transformMatrix: [1, 0, 0, 1, 10, 20],
    rotation: 45,
    scaleX: 2,
    translateY: 10,
  });
});

/*****************************************************************************
 * 11. TextStyle — fontVariant
 ****************************************************************************/

// `fontVariant` is an ARRAY of keywords, and the CSS `font-variant` shorthand
// is a list of the same keywords — so the multi-keyword form is the shape the
// prop exists for, not an edge case. `font-variant-ligatures` reaches it too:
// React Native's `FontVariant` union carries all eight of its keywords.
test("font-variant reaches the whole array, from every spelling", () => {
  const compiled = registerCSS(`
    .rn-fv-single { font-variant: small-caps; }
    .rn-fv-numeric { font-variant-numeric: tabular-nums; }
    .rn-fv-multi { font-variant: small-caps tabular-nums; }
    .rn-fv-lig { font-variant-ligatures: no-common-ligatures contextual; }
    .rn-fv-lig-none { font-variant-ligatures: none; }
  `);

  const styleOfText = (className: string): unknown =>
    render(<Text testID={testID} className={className} />).getByTestId(testID)
      .props.style as unknown;

  expect(styleOfText("rn-fv-single")).toStrictEqual({
    fontVariant: ["small-caps"],
  });
  expect(styleOfText("rn-fv-numeric")).toStrictEqual({
    fontVariant: ["tabular-nums"],
  });
  expect(styleOfText("rn-fv-multi")).toStrictEqual({
    fontVariant: ["small-caps", "tabular-nums"],
  });
  expect(styleOfText("rn-fv-lig")).toStrictEqual({
    fontVariant: ["no-common-ligatures", "contextual"],
  });

  // `none` switches off all four ligature groups, and React Native has no
  // single keyword for that — so it becomes the four it means. Without the
  // expansion `none` would be the one spelling that did nothing.
  expect(styleOfText("rn-fv-lig-none")).toStrictEqual({
    fontVariant: [
      "no-common-ligatures",
      "no-discretionary-ligatures",
      "no-historical-ligatures",
      "no-contextual",
    ],
  });

  expect(compiled.warnings()).toStrictEqual({});
});

test("font-variant: normal cancels a variant inherited from an ancestor", () => {
  // `normal` is exclusive — it means "no variants" — and React Native spells
  // that as the empty list. It is the only way to undo an ancestor's variant,
  // so emitting nothing for it would leave the inherited value in force.
  registerCSS(`
    .rn-fv-anc { font-variant: small-caps; }
    .rn-fv-cancel { font-variant: normal; }
  `);

  const { getByTestId } = render(
    <Text className="rn-fv-anc">
      <Text testID={testID} className="rn-fv-cancel" />
    </Text>,
  );

  expect(getByTestId(testID).props.style).toStrictEqual({ fontVariant: [] });
});

/*****************************************************************************
 * 12. The keys that DO have a real CSS route — the positive half of the census
 ****************************************************************************/

test("ViewStyle keys reachable from a real CSS property", () => {
  registerCSS(`
    .rn-view-reachable {
      background-color: #123456;
      backface-visibility: hidden;
      border-color: #123456;
      border-radius: 4px;
      border-style: dashed;
      border-width: 2px;
      box-sizing: border-box;
      isolation: isolate;
      mix-blend-mode: multiply;
      opacity: 0.5;
      outline-offset: 2px;
      pointer-events: box-none;
      z-index: 5;
    }
  `);

  const component = render(
    <View testID={testID} className="rn-view-reachable" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    backgroundColor: "#123456",
    backfaceVisibility: "hidden",
    borderColor: "#123456",
    borderRadius: 4,
    borderStyle: "dashed",
    borderWidth: 2,
    boxSizing: "border-box",
    isolation: "isolate",
    mixBlendMode: "multiply",
    opacity: 0.5,
    outlineOffset: 2,
    pointerEvents: "box-none",
    zIndex: 5,
  });
});

// `outlineColor` / `outlineStyle` / `outlineWidth` used to become UNREACHABLE
// once all three were declared — which is how an outline is normally written.
// lightningcss folds them into the `outline` shorthand, `outline` had no entry
// in the parser table, and the whole thing was dropped with a single
// unknown-property warning. Any two of the three still compiled, so writing MORE
// CSS produced LESS style.
test("outline-color + outline-style + outline-width together compile", () => {
  const compiled = registerCSS(`
    .rn-outline-triple {
      outline-color: #123456;
      outline-style: dotted;
      outline-width: 2px;
    }
  `);

  const component = render(
    <View testID={testID} className="rn-outline-triple" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    outlineColor: "#123456",
    outlineStyle: "dotted",
    outlineWidth: 2,
  });
  expect(compiled.warnings()).toStrictEqual({});
});

test("the outline shorthand compiles to the same three keys", () => {
  const compiled = registerCSS(
    `.rn-outline-shorthand { outline: 2px dotted #123456; }`,
  );

  const component = render(
    <View testID={testID} className="rn-outline-shorthand" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    outlineColor: "#123456",
    outlineStyle: "dotted",
    outlineWidth: 2,
  });
  expect(compiled.warnings()).toStrictEqual({});
});

test("outline longhands compile as long as they cannot be folded into the shorthand", () => {
  registerCSS(`
    .rn-outline-pair {
      outline-color: #123456;
      outline-width: 2px;
    }
    .rn-outline-style-only { outline-style: dotted; }
  `);

  expect(
    render(<View testID={testID} className="rn-outline-pair" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ outlineColor: "#123456", outlineWidth: 2 });

  expect(
    render(
      <View testID={testID} className="rn-outline-style-only" />,
    ).getByTestId(testID).props.style,
  ).toStrictEqual({ outlineStyle: "dotted" });
});

// `borderCurve` is iOS-only and its CSS route is not an obvious one: the
// property is `corner-shape`, whose `round` / `squircle` keywords map onto
// React Native's `circular` / `continuous`.
test("borderCurve is reachable from corner-shape", () => {
  registerCSS(`
    .rn-curve-round { corner-shape: round; }
    .rn-curve-squircle { corner-shape: squircle; }
  `);

  expect(
    render(<View testID={testID} className="rn-curve-round" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ borderCurve: "circular" });

  expect(
    render(<View testID={testID} className="rn-curve-squircle" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ borderCurve: "continuous" });
});

test("filter and experimental_backgroundImage are reachable", () => {
  registerCSS(`
    .rn-modern-view {
      filter: drop-shadow(1px 2px 3px #123456);
      background-image: linear-gradient(red, blue);
    }
  `);

  const component = render(
    <View testID={testID} className="rn-modern-view" />,
  ).getByTestId(testID);

  const style = component.props.style as Record<string, unknown>;

  expect(style).toStrictEqual({
    filter: [
      {
        dropShadow: {
          offsetX: 1,
          offsetY: 2,
          standardDeviation: 3,
          color: "#123456",
        },
      },
    ],
    experimental_backgroundImage: "linear-gradient(to bottom, #f00, #00f)",
  });

  // `experimental_backgroundImage` is one of the keys whose view config runs a
  // processor over the value (`ReactNativeStyleAttributes.js`), and that
  // processor answers an unreadable gradient with an EMPTY ARRAY rather than an
  // error — so "reachable" is only settled by parsing it.
  expect(
    processBackgroundImage(style.experimental_backgroundImage),
  ).toStrictEqual([
    {
      type: "linear-gradient",
      direction: { type: "angle", value: 180 },
      colorStops: [
        { color: processColor("red"), position: null },
        { color: processColor("blue"), position: null },
      ],
    },
  ]);
});

test("FlexStyle keys reachable from a real CSS property", () => {
  registerCSS(`
    .rn-flex-reachable {
      align-content: space-around;
      align-items: center;
      align-self: stretch;
      aspect-ratio: 16 / 9;
      column-gap: 1px;
      display: contents;
      flex-basis: 50%;
      flex-direction: row-reverse;
      flex-grow: 2;
      flex-shrink: 3;
      flex-wrap: wrap-reverse;
      height: 4px;
      max-height: 5px;
      min-width: 6px;
      position: static;
      row-gap: 7px;
      width: 8px;
    }
    .rn-flex-justify { justify-content: space-evenly; }
  `);

  const component = render(
    <View testID={testID} className="rn-flex-reachable" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    alignContent: "space-around",
    alignItems: "center",
    alignSelf: "stretch",
    // React Native accepts `number | string`; the compiler always emits the
    // string ratio form, never a pre-divided number.
    aspectRatio: "16/9",
    columnGap: 1,
    display: "contents",
    flexBasis: "50%",
    flexDirection: "row-reverse",
    flexGrow: 2,
    flexShrink: 3,
    flexWrap: "wrap-reverse",
    height: 4,
    maxHeight: 5,
    minWidth: 6,
    position: "static",
    rowGap: 7,
    width: 8,
  });

  expect(
    render(<View testID={testID} className="rn-flex-justify" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ justifyContent: "space-evenly" });
});

// `alignContent` (FlexStyle) used to become UNREACHABLE the moment
// `justify-content` was declared beside it — lightningcss folds the pair into
// `place-content`, which had no entry in the parser table, so BOTH were dropped.
// `align-items` beside `justify-items` and `align-self` beside `justify-self`
// failed the same way, taking the React Native-supported half of each pair down
// with the half React Native has no key for.
//
// `justify-items` and `justify-self` are grid properties with no effect in a
// flex container (css-align-3 §6.2, §6.3), and every React Native layout is a
// flex container — so dropping those two halves is complete rather than partial,
// and warns about nothing.
test("the place-* shorthands keep the align-* keys React Native supports", () => {
  const compiled = registerCSS(`
    .rn-place-content {
      align-content: space-around;
      justify-content: space-evenly;
    }
    .rn-place-items {
      align-items: center;
      justify-items: center;
    }
    .rn-place-self {
      align-self: center;
      justify-self: center;
    }
  `);

  // `place-content` is the one of the three where React Native has BOTH halves.
  expect(
    render(<View testID={testID} className="rn-place-content" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({
    alignContent: "space-around",
    justifyContent: "space-evenly",
  });

  expect(
    render(<View testID={testID} className="rn-place-items" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ alignItems: "center" });

  expect(
    render(<View testID={testID} className="rn-place-self" />).getByTestId(
      testID,
    ).props.style,
  ).toStrictEqual({ alignSelf: "center" });

  expect(compiled.warnings()).toStrictEqual({});
});

test("TextStyle keys reachable from a real CSS property", () => {
  registerCSS(`
    .rn-text-reachable {
      color: #123456;
      font-family: Arial;
      font-size: 16px;
      font-style: italic;
      font-weight: 600;
      letter-spacing: 2px;
      line-height: 20px;
      text-align: justify;
      text-decoration-color: #123456;
      text-decoration-line: underline line-through;
      text-decoration-style: double;
      text-transform: uppercase;
      user-select: contain;
    }
  `);

  const component = render(
    <Text testID={testID} className="rn-text-reachable" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    color: "#123456",
    fontFamily: "Arial",
    fontSize: 16,
    fontStyle: "italic",
    fontWeight: 600,
    letterSpacing: 2,
    lineHeight: 20,
    textAlign: "justify",
    textDecorationColor: "#123456",
    textDecorationLine: "underline line-through",
    textDecorationStyle: "double",
    textTransform: "uppercase",
    userSelect: "contain",
  });
});

test("transformOrigin is reachable from transform-origin", () => {
  registerCSS(`.rn-transform-origin { transform-origin: 10px 20px; }`);

  const component = render(
    <View testID={testID} className="rn-transform-origin" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ transformOrigin: [10, 20, 0] });
});
