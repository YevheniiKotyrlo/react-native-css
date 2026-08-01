import { render } from "@testing-library/react-native";
import { ActivityIndicator } from "react-native-css/components/ActivityIndicator";
import { Image } from "react-native-css/components/Image";
import { ImageBackground } from "react-native-css/components/ImageBackground";
import { ScrollView } from "react-native-css/components/ScrollView";
import { Text } from "react-native-css/components/Text";
import { TextInput } from "react-native-css/components/TextInput";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

/**
 * Which React Native PROPS can CSS drive?
 *
 * Several React Native visual behaviours are props, not styles — `numberOfLines`,
 * `pointerEvents`, `resizeMode`, `placeholderTextColor`. This file pins which of
 * them CSS can reach today, and by which of the three mechanisms.
 *
 * THE THREE MECHANISMS
 *
 * 1. A REAL CSS PROPERTY, through a default mapping the compiler ships.
 *    `src/compiler/atRules.ts` seeds `parsePropAtRule` with `caret-color`,
 *    `-webkit-line-clamp`, `fill`, `stroke`, `stroke-width` and the four
 *    `-rn-ripple-*` properties. `parseObjectFit` / `parseObjectPosition` add two
 *    more at parse time. Nothing in userland is needed — the CSS just works.
 *
 * 2. `@nativeMapping`, the compiler-level escape hatch. `@nativeMapping <from>:
 *    <to>` redirects any declaration onto any prop path, `to` accepting dot
 *    notation for nesting (`hitSlop.top`) and a leading `&.` to keep the value in
 *    `style` under a different key. Paired with a `-rn-*` custom property as the
 *    `from`, this reaches essentially every React Native prop. It is the most
 *    powerful of the three and the least documented.
 *
 * 3. `nativeStyleMapping`, the component-level escape hatch, declared in a
 *    component's `StyledConfiguration` (`src/components/TextInput.tsx`,
 *    `Button.tsx`, `ImageBackground.tsx`, `ActivityIndicator.tsx`). It promotes a
 *    resolved STYLE key to a prop. Only the library's own components declare
 *    one; a userland `styled()` component can too.
 *
 * A fourth, quieter route: a `-rn-*` custom property with NO mapping keeps its
 * value in `style` under the camelCased name minus the prefix. That is a route to
 * React Native STYLE keys CSS has no property for (`style.tintColor`,
 * `style.resizeMode`), not to props.
 *
 * `// GAP:` marks a prop no mechanism reaches, or reaches only wrongly.
 */

const source = { uri: "https://example.com/a.png" };

/* ------------------------------------------------------------------ *
 * Text                                                                *
 * ------------------------------------------------------------------ */

test("-webkit-line-clamp drives Text's numberOfLines prop", () => {
  // Mechanism 1. `atRules.ts` seeds `"-webkit-line-clamp": ["numberOfLines"]`,
  // which is what makes Tailwind's `line-clamp-*` utilities work.
  registerCSS(`.clamp { -webkit-line-clamp: 3; }`);

  const component = render(
    <Text testID={testID} className="clamp" />,
  ).getByTestId(testID);

  expect(component.props.numberOfLines).toBe(3);
  expect(component.props.style).toStrictEqual({});
});

test("-webkit-line-clamp composes with overflow, as Tailwind emits it", () => {
  registerCSS(`.clamp-2 { overflow: hidden; -webkit-line-clamp: 2; }`);

  const component = render(
    <Text testID={testID} className="clamp-2" />,
  ).getByTestId(testID);

  expect(component.props.numberOfLines).toBe(2);
  expect(component.props.style).toStrictEqual({ overflow: "hidden" });
});

test("text-overflow is rejected outright", () => {
  // GAP: Text's `ellipsizeMode` prop. CSS `text-overflow` is its natural
  // equivalent, and `text-overflow` is not in `parsers`, so the declaration is
  // dropped with a `properties` warning. `ellipsizeMode` has no real-CSS route —
  // only the `@nativeMapping` escape hatch two tests below.
  const compiled = registerCSS(`.ellipsis { text-overflow: ellipsis; }`);

  expect(compiled.warnings()).toStrictEqual({ properties: ["text-overflow"] });

  const component = render(
    <Text testID={testID} className="ellipsis" />,
  ).getByTestId(testID);

  expect(component.props.style).toBeUndefined();
  expect(component.props.ellipsizeMode).toBeUndefined();
});

test("font-size-adjust is rejected outright", () => {
  // GAP: Text's `adjustsFontSizeToFit` / `minimumFontScale` props. CSS
  // `font-size-adjust` is the nearest concept and is not in `parsers`, so it
  // warns and drops. Neither prop has a real-CSS route.
  const compiled = registerCSS(`.shrink { font-size-adjust: 0.5; }`);

  expect(compiled.warnings()).toStrictEqual({
    properties: ["font-size-adjust"],
  });

  const component = render(
    <Text testID={testID} className="shrink" />,
  ).getByTestId(testID);

  expect(component.props.adjustsFontSizeToFit).toBeUndefined();
});

test("user-select resolves to a style, never Text's selectable prop", () => {
  // `user-select` IS supported — but as `style.userSelect`, which is React
  // Native's own modern spelling, so this is the correct destination.
  //
  // GAP: Text's `selectable` prop specifically. It is the only route on the
  // older React Native surface and nothing sets it. The test below shows why
  // remapping `user-select` onto it does not work either.
  registerCSS(`.pick { user-select: none; }`);

  const component = render(
    <Text testID={testID} className="pick" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ userSelect: "none" });
  expect(component.props.selectable).toBeUndefined();
});

test("@nativeMapping reaches ellipsizeMode", () => {
  // Mechanism 2 — the documented-nowhere escape hatch that closes the
  // `text-overflow` gap above.
  registerCSS(`
    .ellipsize {
      -rn-ellipsize: tail;
      @nativeMapping -rn-ellipsize: ellipsizeMode;
    }
  `);

  const component = render(
    <Text testID={testID} className="ellipsize" />,
  ).getByTestId(testID);

  expect(component.props.ellipsizeMode).toBe("tail");
});

test("@nativeMapping reaches the font-scaling props", () => {
  registerCSS(`
    .autoshrink {
      -rn-adjusts: true;
      -rn-min-scale: 0.5;
      -rn-max-multiplier: 1.5;
      @nativeMapping {
        -rn-adjusts: adjustsFontSizeToFit;
        -rn-min-scale: minimumFontScale;
        -rn-max-multiplier: maxFontSizeMultiplier;
      }
    }
  `);

  const component = render(
    <Text testID={testID} className="autoshrink" />,
  ).getByTestId(testID);

  expect(component.props.adjustsFontSizeToFit).toBe(true);
  expect(component.props.minimumFontScale).toBe(0.5);
  expect(component.props.maxFontSizeMultiplier).toBe(1.5);
});

test("@nativeMapping reaches selectable, but delivers a string", () => {
  // GAP: `selectable` is a BOOLEAN prop. Remapping `user-select` onto it
  // delivers the CSS keyword verbatim, so `user-select: none` produces
  // `selectable: "none"` — a truthy string, i.e. the exact opposite of what the
  // author wrote. Only a `-rn-*` property carrying the literal `true` sets it
  // correctly, and `false` cannot be expressed at all (see the falsy test).
  registerCSS(`
    .no-pick {
      user-select: none;
      @nativeMapping user-select: selectable;
    }
  `);

  const component = render(
    <Text testID={testID} className="no-pick" />,
  ).getByTestId(testID);

  expect(component.props.selectable).toBe("none");
  expect(component.props.selectable).not.toBe(false);
});

/* ------------------------------------------------------------------ *
 * View                                                                *
 * ------------------------------------------------------------------ */

test("pointer-events resolves to a style, not the legacy prop", () => {
  // `pointer-events` is a first-class parser (`parsePointerEvents`, registered
  // separately because lightningcss lacks the type). It lands in `style`, which
  // is React Native's modern home for it — the `pointerEvents` PROP is the
  // legacy spelling. Both keywords survive.
  registerCSS(`.no-touch { pointer-events: none; }`);

  const component = render(
    <View testID={testID} className="no-touch" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ pointerEvents: "none" });
  expect(component.props.pointerEvents).toBeUndefined();
});

test("pointer-events keeps React Native's box-none keyword", () => {
  registerCSS(`.box-none { pointer-events: box-none; }`);

  const component = render(
    <View testID={testID} className="box-none" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ pointerEvents: "box-none" });
});

test("@nativeMapping promotes pointer-events to the legacy prop", () => {
  // The escape hatch can retarget a real CSS property, not only a `-rn-*` one.
  registerCSS(`
    .legacy-touch {
      pointer-events: none;
      @nativeMapping pointer-events: pointerEvents;
    }
  `);

  const component = render(
    <View testID={testID} className="legacy-touch" />,
  ).getByTestId(testID);

  expect(component.props.pointerEvents).toBe("none");
  expect(component.props.style).toStrictEqual({});
});

test("@nativeMapping reaches hitSlop, flat and nested", () => {
  // `hitSlop` accepts either a number or a per-edge object, and the escape
  // hatch's dot notation builds the object.
  registerCSS(`
    .slop-flat { -rn-slop: 12; @nativeMapping -rn-slop: hitSlop; }
    .slop-edge { -rn-slop-top: 8; @nativeMapping -rn-slop-top: hitSlop.top; }
  `);

  const flat = render(
    <View testID={testID} className="slop-flat" />,
  ).getByTestId(testID);
  expect(flat.props.hitSlop).toBe(12);

  const edge = render(
    <View testID={testID} className="slop-edge" />,
  ).getByTestId(testID);
  expect(edge.props.hitSlop).toStrictEqual({ top: 8 });
});

test("@nativeMapping reaches the compositing props", () => {
  // None of these has a CSS equivalent at all — `will-change` is the closest
  // idea and is rejected (see the next test). The escape hatch is their only
  // route, and it works.
  registerCSS(`
    .composite {
      -rn-hardware: true;
      -rn-raster: true;
      -rn-alpha: true;
      @nativeMapping {
        -rn-hardware: renderToHardwareTextureAndroid;
        -rn-raster: shouldRasterizeIOS;
        -rn-alpha: needsOffscreenAlphaCompositing;
      }
    }
  `);

  const component = render(
    <View testID={testID} className="composite" />,
  ).getByTestId(testID);

  expect(component.props.renderToHardwareTextureAndroid).toBe(true);
  expect(component.props.shouldRasterizeIOS).toBe(true);
  expect(component.props.needsOffscreenAlphaCompositing).toBe(true);
});

test("will-change is rejected outright", () => {
  // GAP: `renderToHardwareTextureAndroid` / `shouldRasterizeIOS` are React
  // Native's rasterisation hints and `will-change` is the CSS property that
  // expresses the same intent. It is not in `parsers`, so it warns and drops.
  const compiled = registerCSS(`.promote { will-change: transform; }`);

  expect(compiled.warnings()).toStrictEqual({ properties: ["will-change"] });

  const component = render(
    <View testID={testID} className="promote" />,
  ).getByTestId(testID);

  expect(component.props.style).toBeUndefined();
});

/* ------------------------------------------------------------------ *
 * Image                                                               *
 * ------------------------------------------------------------------ */

test("object-fit drives contentFit, which is not React Native's resizeMode", () => {
  // GAP: React Native `Image`'s `resizeMode` prop. `parseObjectFit` maps
  // `object-fit` onto `contentFit` — expo-image's prop name. On a React Native
  // `<Image>` the emitted prop is inert: `resizeMode` stays unset and the image
  // keeps its default `cover`.
  registerCSS(`.fit { object-fit: contain; }`);

  const component = render(
    <Image testID={testID} source={source} className="fit" />,
  ).getByTestId(testID);

  expect(component.props.contentFit).toBe("contain");
  expect(component.props.resizeMode).toBeUndefined();
});

test("a userland @nativeMapping composes with the built-in one", () => {
  // The repair for the test above — remapping `object-fit` onto `resizeMode` —
  // used to do nothing: `parseObjectFit` called `builder.addMapping` while
  // parsing the declaration, overwriting the mapping the at-rule installed, and
  // the author's own `@nativeMapping` was silently ignored.
  //
  // `parseObjectFit` now emits TWO descriptors — the kebab `object-fit`, which
  // the built-in mapping sends to `contentFit`, and the camel `objectFit`, which
  // is React Native's own style key. The at-rule keys on the camel form, so it
  // captures the second one and both props are set. Without an at-rule the
  // second lands in `style` instead (see the object-fit tests in
  // `rn-style-coverage.test.tsx`).
  registerCSS(`
    .fit-remap {
      object-fit: contain;
      @nativeMapping object-fit: resizeMode;
    }
  `);

  const component = render(
    <Image testID={testID} source={source} className="fit-remap" />,
  ).getByTestId(testID);

  expect(component.props.contentFit).toBe("contain");
  expect(component.props.resizeMode).toBe("contain");
  expect(component.props.style).toStrictEqual({});
});

test("a -rn- property with no mapping reaches style.resizeMode", () => {
  // The fourth route. React Native's `ImageStyle` carries `resizeMode`, so
  // parking the value in `style` under that key is a genuine fix for the gap
  // above — no at-rule needed.
  registerCSS(`.fit-style { -rn-resize-mode: contain; }`);

  const component = render(
    <Image testID={testID} source={source} className="fit-style" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ resizeMode: "contain" });
});

test("@nativeMapping reaches the resizeMode and resizeMethod props", () => {
  registerCSS(`
    .fit-prop {
      -rn-fit: contain;
      -rn-method: resize;
      @nativeMapping {
        -rn-fit: resizeMode;
        -rn-method: resizeMethod;
      }
    }
  `);

  const component = render(
    <Image testID={testID} source={source} className="fit-prop" />,
  ).getByTestId(testID);

  expect(component.props.resizeMode).toBe("contain");
  expect(component.props.resizeMethod).toBe("resize");
});

test("object-position drives contentPosition", () => {
  // Same shape as `object-fit`: a real CSS property, mapped by the compiler onto
  // expo-image's prop rather than anything React Native's own `Image` reads.
  registerCSS(`.pos { object-position: top left; }`);

  const component = render(
    <Image testID={testID} source={source} className="pos" />,
  ).getByTestId(testID);

  expect(component.props.contentPosition).toBe("top left");
});

test("filter: blur() resolves to a style, not Image's blurRadius prop", () => {
  // GAP: `Image`'s `blurRadius` prop. `filter: blur()` is supported and produces
  // React Native 0.76+'s `style.filter`, which is the right destination on new
  // architecture — but it leaves `blurRadius` unset, so an author targeting the
  // prop has to reach for the escape hatch.
  registerCSS(`.blurred { filter: blur(4px); }`);

  const component = render(
    <Image testID={testID} source={source} className="blurred" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ filter: [{ blur: 4 }] });
  expect(component.props.blurRadius).toBeUndefined();
});

test("@nativeMapping reaches blurRadius and tintColor", () => {
  registerCSS(`
    .tinted {
      -rn-blur: 4;
      -rn-tint: red;
      @nativeMapping {
        -rn-blur: blurRadius;
        -rn-tint: tintColor;
      }
    }
  `);

  const component = render(
    <Image testID={testID} source={source} className="tinted" />,
  ).getByTestId(testID);

  expect(component.props.blurRadius).toBe(4);
  expect(component.props.tintColor).toBe("red");
});

test("a -rn- property with no mapping reaches style.tintColor", () => {
  // `tintColor` is also an `ImageStyle` key, so the no-at-rule route works here
  // too. Note the value is passed through verbatim rather than parsed as a
  // colour — `red` stays the string `red`, where a real colour property would
  // have normalised it to `#f00`.
  registerCSS(`.tint-style { -rn-tint-color: red; }`);

  const component = render(
    <Image testID={testID} source={source} className="tint-style" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ tintColor: "red" });
});

test("defaultSource needs the nested form, and url() is dropped", () => {
  // GAP: `defaultSource` takes an object, and `url()` — the one CSS function
  // that means "an image" — is dropped silently, with no warning and no style.
  // The nested `@nativeMapping` target builds the object from a bare string, so
  // the prop IS reachable, just not through the CSS spelling anyone would try.
  const compiled = registerCSS(`
    .src-url { -rn-fallback: url("https://x.test/a.png"); @nativeMapping -rn-fallback: defaultSource; }
    .src-nested { -rn-fallback-uri: "https://x.test/a.png"; @nativeMapping -rn-fallback-uri: defaultSource.uri; }
  `);

  expect(compiled.warnings()).toStrictEqual({});

  const dropped = render(
    <Image testID={testID} source={source} className="src-url" />,
  ).getByTestId(testID);
  expect(dropped.props.defaultSource).toBeUndefined();

  const nested = render(
    <Image testID={testID} source={source} className="src-nested" />,
  ).getByTestId(testID);
  expect(nested.props.defaultSource).toStrictEqual({
    uri: "https://x.test/a.png",
  });
});

/* ------------------------------------------------------------------ *
 * TextInput                                                           *
 * ------------------------------------------------------------------ */

test("caret-color drives cursorColor", () => {
  // Mechanism 1 — `atRules.ts` seeds `"caret-color": ["cursorColor"]`, and the
  // value goes through the real colour parser, so it normalises.
  registerCSS(`.caret { caret-color: red; }`);

  const component = render(
    <TextInput testID={testID} className="caret" />,
  ).getByTestId(testID);

  expect(component.props.cursorColor).toBe("#f00");
});

test("caret-color: auto warns rather than emitting a bad colour", () => {
  const compiled = registerCSS(`.caret-auto { caret-color: auto; }`);

  expect(compiled.warnings()).toStrictEqual({
    values: { "caret-color": ["Invalid color value auto"] },
  });

  const component = render(
    <TextInput testID={testID} className="caret-auto" />,
  ).getByTestId(testID);

  expect(component.props.cursorColor).toBeUndefined();
});

test("::placeholder colour drives placeholderTextColor", () => {
  // A real CSS PSEUDO-ELEMENT, handled in `applyRuleToSelectors` — the rule is
  // rewritten so its `color` lands on the `placeholderTextColor` prop instead of
  // in `style`. This is the closest the library comes to genuine web parity for
  // a prop-shaped behaviour, and it is undocumented.
  registerCSS(`.ph::placeholder { color: red; }`);

  const component = render(
    <TextInput testID={testID} className="ph" />,
  ).getByTestId(testID);

  expect(component.props.placeholderTextColor).toBe("#f00");
  expect(component.props.style).toStrictEqual({});
});

test("::placeholder and the element's own colour stay separate", () => {
  registerCSS(`
    .ph-both { color: blue; }
    .ph-both::placeholder { color: red; }
  `);

  const component = render(
    <TextInput testID={testID} className="ph-both" />,
  ).getByTestId(testID);

  expect(component.props.placeholderTextColor).toBe("#f00");
  expect(component.props.style).toStrictEqual({ color: "#00f" });
});

test("::selection colour drives selectionColor", () => {
  registerCSS(`.sel::selection { color: red; }`);

  const component = render(
    <TextInput testID={testID} className="sel" />,
  ).getByTestId(testID);

  expect(component.props.selectionColor).toBe("#f00");
});

test("text-align is promoted from style to prop by nativeStyleMapping", () => {
  // Mechanism 3. `src/components/TextInput.tsx` declares
  // `nativeStyleMapping: { textAlign: true }` — `true` meaning "promote under
  // the same name". The key is DELETED from `style` as it moves.
  registerCSS(`.align { text-align: center; }`);

  const component = render(
    <TextInput testID={testID} className="align" />,
  ).getByTestId(testID);

  expect(component.props.textAlign).toBe("center");
  expect(component.props.style).toStrictEqual({});
});

test("@nativeMapping reaches underlineColorAndroid", () => {
  // GAP: `underlineColorAndroid` has no CSS equivalent — `border-bottom-color`
  // is the nearest idea and resolves to a real border style instead. The escape
  // hatch is its only route.
  registerCSS(`
    .underline {
      -rn-underline: red;
      @nativeMapping -rn-underline: underlineColorAndroid;
    }
  `);

  const component = render(
    <TextInput testID={testID} className="underline" />,
  ).getByTestId(testID);

  expect(component.props.underlineColorAndroid).toBe("red");
});

/* ------------------------------------------------------------------ *
 * ScrollView                                                          *
 * ------------------------------------------------------------------ */

test("the scrollbar-* properties are rejected outright", () => {
  // GAP: `showsVerticalScrollIndicator` / `showsHorizontalScrollIndicator` /
  // `indicatorStyle`. CSS `scrollbar-width` and `scrollbar-color` are their
  // direct equivalents; neither is in `parsers`, so both warn and drop.
  const compiled = registerCSS(`
    .bar-width { scrollbar-width: none; }
    .bar-color { scrollbar-color: red blue; }
  `);

  expect(compiled.warnings()).toStrictEqual({
    properties: ["scrollbar-width", "scrollbar-color"],
  });

  const component = render(
    <ScrollView testID={testID} className="bar-width" />,
  ).getByTestId(testID);

  expect(component.props.showsVerticalScrollIndicator).toBeUndefined();
});

test("@nativeMapping reaches the scroll indicator props", () => {
  registerCSS(`
    .indicators {
      -rn-show-bar: true;
      -rn-bar-style: white;
      @nativeMapping {
        -rn-show-bar: showsVerticalScrollIndicator;
        -rn-bar-style: indicatorStyle;
      }
    }
  `);

  const component = render(
    <ScrollView testID={testID} className="indicators" />,
  ).getByTestId(testID);

  expect(component.props.showsVerticalScrollIndicator).toBe(true);
  expect(component.props.indicatorStyle).toBe("white");
});

/* ------------------------------------------------------------------ *
 * nativeStyleMapping — the component-level hatch                      *
 * ------------------------------------------------------------------ */

test("ActivityIndicator promotes color to its prop", () => {
  // `nativeStyleMapping: { color: "color" }` with `target: "style"`. React
  // Native's `ActivityIndicator` reads a `color` PROP and ignores `style.color`,
  // so this mapping is what makes `text-*` colour utilities work on it.
  registerCSS(`.spinner { color: red; }`);

  const component = render(
    <ActivityIndicator testID={testID} className="spinner" />,
  ).getByTestId(testID);

  expect(component.props.color).toBe("#f00");
  expect(component.props.style).toStrictEqual({});
});

test("ImageBackground promotes background-color to a prop", () => {
  registerCSS(`.backdrop { background-color: red; }`);

  const component = render(
    <ImageBackground testID={testID} source={source} className="backdrop" />,
  ).getByTestId(testID);

  expect(component.props.backgroundColor).toBe("#f00");
});

/* ------------------------------------------------------------------ *
 * The -rn- namespace itself                                           *
 * ------------------------------------------------------------------ */

test("an unmapped -rn- property keeps its value in style, camelCased", () => {
  // `toRNProperty` strips the `-rn-` prefix and camelCases the rest. There is no
  // validation against React Native's style keys, so this is equally a route to
  // a real `ImageStyle` key and a way to park a key React Native will ignore.
  registerCSS(`.raw { -rn-whatever-key: 5; }`);

  const component = render(
    <View testID={testID} className="raw" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ whateverKey: 5 });
});

test("-rn-ripple-* drives the android_ripple prop object", () => {
  // Mechanism 1, and the only `-rn-*` family with default mappings. All four
  // properties collapse into one nested prop object.
  //
  // Observed on a `View` because React Native's own `Pressable` consumes
  // `android_ripple` internally and never forwards it to the host view.
  registerCSS(`
    .ripple {
      -rn-ripple-color: red;
      -rn-ripple-radius: 10;
      -rn-ripple-style: borderless;
      -rn-ripple-layer: foreground;
    }
  `);

  const component = render(
    <View testID={testID} className="ripple" />,
  ).getByTestId(testID);

  expect(component.props.android_ripple).toStrictEqual({
    color: "red",
    radius: 10,
    borderless: true,
    foreground: true,
  });
});

test("-rn-ripple-style only recognises the borderless keyword", () => {
  // `parseCustomDeclaration` emits a descriptor only for `borderless`, so the
  // bordered case is expressed by omission — there is no way to write
  // `borderless: false` explicitly.
  registerCSS(`.ripple-bordered { -rn-ripple-style: bordered; }`);

  const component = render(
    <View testID={testID} className="ripple-bordered" />,
  ).getByTestId(testID);

  expect(component.props.android_ripple).toBeUndefined();
});

test("a bare @nativeMapping retargets every declaration in the rule", () => {
  // The prelude-only form installs a `*` mapping, so EVERY property in the rule
  // is redirected — including ones whose value makes no sense at the
  // destination. Worth knowing before reaching for the shorthand.
  registerCSS(`.wildcard { @nativeMapping numberOfLines; color: red; }`);

  const component = render(
    <Text testID={testID} className="wildcard" />,
  ).getByTestId(testID);

  expect(component.props.numberOfLines).toBe("#f00");
  expect(component.props.style).toStrictEqual({});
});

/* ------------------------------------------------------------------ *
 * The cross-cutting gap: no prop can be set to a falsy value          *
 * ------------------------------------------------------------------ */

test("a custom property whose value is false reaches the prop", () => {
  // `parseUnparsed` guarded its array branch with `if (!args) return;` — a
  // TRUTHINESS check on an already-parsed value. The ident `false` parses
  // correctly to boolean `false` and was then thrown away by that guard,
  // producing no descriptor, no rule, and no warning.
  //
  // That made every React Native boolean prop one-way: reachable as `true`,
  // unreachable as `false` — and `false` is the useful direction for most of
  // them (`collapsable`, `allowFontScaling`, `adjustsFontSizeToFit`,
  // `showsVerticalScrollIndicator`, `selectable`).
  const compiled = registerCSS(`
    .off { -rn-flag: false; @nativeMapping -rn-flag: collapsable; }
    .on { -rn-flag-on: true; @nativeMapping -rn-flag-on: collapsable; }
  `);

  expect(compiled.warnings()).toStrictEqual({});

  const off = render(<View testID={testID} className="off" />).getByTestId(
    testID,
  );
  expect(off.props.collapsable).toBe(false);
  expect(off.props.style).toStrictEqual({});

  const on = render(<View testID={testID} className="on" />).getByTestId(
    testID,
  );
  expect(on.props.collapsable).toBe(true);
  // Both directions leave the same empty style behind: `@nativeMapping` lifts
  // the value out of `style` into the prop, and the emptied object remains.
  expect(on.props.style).toStrictEqual({});
});

test("the same guard drops zero and the empty string", () => {
  // The guard is truthiness, not a boolean special case, so `0` and `""` go the
  // same way. `-webkit-line-clamp: 0` is the case an author would actually hit:
  // it is the CSS spelling of "no clamp" and it silently does nothing.
  const compiled = registerCSS(`
    .zero { -rn-count: 0; @nativeMapping -rn-count: numberOfLines; }
    .empty { -rn-text: ""; @nativeMapping -rn-text: ellipsizeMode; }
    .clamp-zero { -webkit-line-clamp: 0; }
  `);

  expect(compiled.warnings()).toStrictEqual({});

  const zero = render(<Text testID={testID} className="zero" />).getByTestId(
    testID,
  );
  expect(zero.props.numberOfLines).toBe(0);

  const empty = render(<Text testID={testID} className="empty" />).getByTestId(
    testID,
  );
  expect(empty.props.ellipsizeMode).toBe("");

  const clampZero = render(
    <Text testID={testID} className="clamp-zero" />,
  ).getByTestId(testID);
  expect(clampZero.props.numberOfLines).toBe(0);
});

test("typed style parsers keep falsy values, so the gap is the custom path only", () => {
  // The contrast that localises the bug. `opacity` and `z-index` have their own
  // entries in `parsers` and never reach `parseUnparsed`'s array branch, so zero
  // survives for them. Only custom properties — `-rn-*` and `-webkit-*` — are
  // affected.
  registerCSS(`.transparent { opacity: 0; z-index: 0; }`);

  const component = render(
    <View testID={testID} className="transparent" />,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ opacity: 0, zIndex: 0 });
});
