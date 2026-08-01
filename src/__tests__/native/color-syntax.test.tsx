import { processColor } from "react-native";

import { act, render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { colorScheme } from "react-native-css/runtime";
import processBackgroundImage from "react-native/Libraries/StyleSheet/processBackgroundImage";

/**
 * These tests pin the observed behaviour of every CSS colour syntax against
 * `background-color` / `color` / `border-color`.
 *
 * The reference for "what React Native could have expressed instead" is
 * `@react-native/normalize-colors`, whose grammar is asserted in the first test
 * below. Anything outside that grammar has to be resolved by the compiler; a
 * string that falls outside it is silently discarded by React Native at render.
 */

function styleOf(className: string): Record<string, unknown> | undefined {
  render(<View testID={testID} className={className} />);
  const style = screen.getByTestId(testID).props.style as
    | Record<string, unknown>
    | undefined;
  screen.unmount();
  return style;
}

test("react-native's own colour grammar — the target this library compiles to", () => {
  // `normalize-colors` accepts hex 3/4/6/8, rgb()/rgba() with number channels
  // (comma, space, or slash-alpha), hsl()/hsla() with percentage S/L, hwb(),
  // and the CSS named colours. Everything else is `undefined` — dropped.
  expect({
    hex3: processColor("#f00"),
    hex4: processColor("#f008"),
    hex6: processColor("#ff0000"),
    hex8: processColor("#ff000080"),
    rgbComma: processColor("rgb(255, 0, 0)"),
    rgbSpace: processColor("rgb(255 0 0)"),
    rgbaSlash: processColor("rgba(255 0 0 / 0.5)"),
    hslComma: processColor("hsl(0, 100%, 50%)"),
    hwb: processColor("hwb(0 0% 0%)"),
    named: processColor("rebeccapurple"),
    transparent: processColor("transparent"),
    // Everything below is outside the grammar
    rgbPercentChannels: processColor("rgb(100% 0% 0%)"),
    rgbPercentAlpha: processColor("rgb(255 0 0 / 50%)"),
    hslUnitless: processColor("hsl(0 100 50)"),
    oklch: processColor("oklch(0.628 0.2577 29.23)"),
    lab: processColor("lab(54.29% 80.81 69.89)"),
    colorFunction: processColor("color(display-p3 1 0 0)"),
    systemColor: processColor("canvastext"),
  }).toStrictEqual({
    hex3: 4294901760,
    hex4: 2298413056,
    hex6: 4294901760,
    hex8: 2164195328,
    rgbComma: 4294901760,
    rgbSpace: 4294901760,
    rgbaSlash: 2164195328,
    hslComma: 4294901760,
    hwb: 4294901760,
    named: 4284887961,
    transparent: 0,
    rgbPercentChannels: undefined,
    rgbPercentAlpha: undefined,
    hslUnitless: undefined,
    oklch: undefined,
    lab: undefined,
    colorFunction: undefined,
    systemColor: undefined,
  });
});

describe("hex notation — CSS Color 4 §5.2", () => {
  test("3, 4, 6 and 8 digit forms all resolve, shortened where lossless", () => {
    registerCSS(`
      .hex-three { background-color: #f00; }
      .hex-four { background-color: #f008; }
      .hex-six { background-color: #ff0000; }
      .hex-eight { background-color: #ff000080; }
      .hex-upper { background-color: #FF0000; }
    `);

    expect({
      three: styleOf("hex-three"),
      four: styleOf("hex-four"),
      six: styleOf("hex-six"),
      eight: styleOf("hex-eight"),
      upper: styleOf("hex-upper"),
    }).toStrictEqual({
      three: { backgroundColor: "#f00" },
      four: { backgroundColor: "#f008" },
      six: { backgroundColor: "#f00" },
      eight: { backgroundColor: "#ff000080" },
      upper: { backgroundColor: "#f00" },
    });
  });

  test("fully opaque and fully transparent alpha channels", () => {
    registerCSS(`
      .hex-opaque-long { background-color: #ff0000ff; }
      .hex-opaque-short { background-color: #f00f; }
      .hex-clear-long { background-color: #ff000000; }
      .hex-clear-short { background-color: #f000; }
      .hex-invalid { background-color: #gg0000; }
    `);

    expect({
      opaqueLong: styleOf("hex-opaque-long"),
      opaqueShort: styleOf("hex-opaque-short"),
      clearLong: styleOf("hex-clear-long"),
      clearShort: styleOf("hex-clear-short"),
      // An unparseable hex is correctly dropped rather than passed through.
      invalid: styleOf("hex-invalid"),
    }).toStrictEqual({
      opaqueLong: { backgroundColor: "#f00" },
      opaqueShort: { backgroundColor: "#f00" },
      clearLong: { backgroundColor: "#f000" },
      clearShort: { backgroundColor: "#f000" },
      invalid: undefined,
    });
  });
});

describe("rgb() / rgba() — CSS Color 4 §5.1", () => {
  test("legacy comma and modern space syntax, percentage channels, both alpha spellings", () => {
    registerCSS(`
      .rgb-comma { background-color: rgb(255, 0, 0); }
      .rgb-space { background-color: rgb(255 0 0); }
      .rgb-percent { background-color: rgb(100% 0% 0%); }
      .rgba-comma { background-color: rgba(255, 0, 0, 0.5); }
      .rgba-comma-percent { background-color: rgba(255, 0, 0, 50%); }
      .rgb-slash-number { background-color: rgb(255 0 0 / 0.5); }
      .rgb-slash-percent { background-color: rgb(255 0 0 / 50%); }
      .rgba-space { background-color: rgba(255 0 0 / 50%); }
    `);

    // Every spelling collapses to the same hex — the compiler normalises the
    // percentage channels and the two alpha notations that React Native's own
    // parser would have rejected.
    expect({
      comma: styleOf("rgb-comma"),
      space: styleOf("rgb-space"),
      percent: styleOf("rgb-percent"),
      alphaComma: styleOf("rgba-comma"),
      alphaCommaPercent: styleOf("rgba-comma-percent"),
      alphaSlashNumber: styleOf("rgb-slash-number"),
      alphaSlashPercent: styleOf("rgb-slash-percent"),
      alphaSpace: styleOf("rgba-space"),
    }).toStrictEqual({
      comma: { backgroundColor: "#f00" },
      space: { backgroundColor: "#f00" },
      percent: { backgroundColor: "#f00" },
      alphaComma: { backgroundColor: "#ff000080" },
      alphaCommaPercent: { backgroundColor: "#ff000080" },
      alphaSlashNumber: { backgroundColor: "#ff000080" },
      alphaSlashPercent: { backgroundColor: "#ff000080" },
      alphaSpace: { backgroundColor: "#ff000080" },
    });
  });

  test("out-of-range channels clamp, floats round, calc() channels resolve", () => {
    registerCSS(`
      .rgb-clamp { background-color: rgb(300 -20 0); }
      .rgb-float { background-color: rgb(255.5 0.4 0); }
      .rgb-calc-channel { background-color: rgb(calc(100 + 155) 0 0); }
      .rgb-calc-alpha { background-color: rgb(255 0 0 / calc(1 / 2)); }
    `);

    expect({
      clamp: styleOf("rgb-clamp"),
      float: styleOf("rgb-float"),
      calcChannel: styleOf("rgb-calc-channel"),
      calcAlpha: styleOf("rgb-calc-alpha"),
    }).toStrictEqual({
      clamp: { backgroundColor: "#f00" },
      float: { backgroundColor: "#f00" },
      calcChannel: { backgroundColor: "#f00" },
      calcAlpha: { backgroundColor: "#ff000080" },
    });
  });

  test("the `none` keyword resolves each missing component to zero", () => {
    // CSS Color 4 §4.4: a missing component is treated as zero when the colour
    // is used, so `rgb(none 0 0)` is black and `/ none` is fully transparent.
    registerCSS(`
      .rgb-none-channel { background-color: rgb(none 0 0); }
      .rgb-none-alpha { background-color: rgb(255 0 0 / none); }
      .hsl-none-hue { background-color: hsl(none 100% 50%); }
      .oklch-none-chroma { background-color: oklch(0.628 none none); }
    `);

    expect({
      channel: styleOf("rgb-none-channel"),
      alpha: styleOf("rgb-none-alpha"),
      hue: styleOf("hsl-none-hue"),
      chroma: styleOf("oklch-none-chroma"),
    }).toStrictEqual({
      channel: { backgroundColor: "#000" },
      alpha: { backgroundColor: "#f000" },
      hue: { backgroundColor: "#f00" },
      chroma: { backgroundColor: "#888" },
    });
  });
});

describe("hsl() / hwb() — CSS Color 4 §7.1, §7.2", () => {
  test("every hue unit and both legacy and modern argument syntax", () => {
    registerCSS(`
      .hsl-space { background-color: hsl(0 100% 50%); }
      .hsl-comma { background-color: hsl(0, 100%, 50%); }
      .hsl-deg { background-color: hsl(0deg 100% 50%); }
      .hsl-turn { background-color: hsl(0.5turn 100% 50%); }
      .hsl-rad { background-color: hsl(3.14159rad 100% 50%); }
      .hsl-unitless { background-color: hsl(0 100 50); }
      .hsl-slash { background-color: hsl(0 100% 50% / 50%); }
      .hsla-comma { background-color: hsla(0, 100%, 50%, 0.5); }
    `);

    expect({
      space: styleOf("hsl-space"),
      comma: styleOf("hsl-comma"),
      deg: styleOf("hsl-deg"),
      // 0.5turn and pi radians are both 180deg — cyan.
      turn: styleOf("hsl-turn"),
      rad: styleOf("hsl-rad"),
      // CSS Color 4 allows bare <number> for saturation/lightness.
      unitless: styleOf("hsl-unitless"),
      slash: styleOf("hsl-slash"),
      legacyAlpha: styleOf("hsla-comma"),
    }).toStrictEqual({
      space: { backgroundColor: "#f00" },
      comma: { backgroundColor: "#f00" },
      deg: { backgroundColor: "#f00" },
      turn: { backgroundColor: "#0ff" },
      rad: { backgroundColor: "#0ff" },
      unitless: { backgroundColor: "#f00" },
      slash: { backgroundColor: "#ff000080" },
      legacyAlpha: { backgroundColor: "#ff000080" },
    });
  });

  test("hwb() with and without alpha", () => {
    registerCSS(`
      .hwb-plain { background-color: hwb(0 0% 0%); }
      .hwb-alpha { background-color: hwb(0 0% 0% / 50%); }
      .hwb-mixed { background-color: hwb(120 20% 30%); }
    `);

    expect({
      plain: styleOf("hwb-plain"),
      alpha: styleOf("hwb-alpha"),
      mixed: styleOf("hwb-mixed"),
    }).toStrictEqual({
      plain: { backgroundColor: "#f00" },
      alpha: { backgroundColor: "#ff000080" },
      mixed: { backgroundColor: "#33b333" },
    });
  });
});

describe("lab() / lch() / oklab() / oklch() — CSS Color 4 §9", () => {
  test("all four CIE functions resolve to sRGB hex at compile time", () => {
    registerCSS(`
      .lab-plain { background-color: lab(54.29% 80.81 69.89); }
      .lab-alpha { background-color: lab(54.29% 80.81 69.89 / 50%); }
      .lch-plain { background-color: lch(54.29% 106.84 40.85); }
      .lch-alpha { background-color: lch(54.29% 106.84 40.85 / 0.5); }
      .oklab-plain { background-color: oklab(62.8% 0.225 0.126); }
      .oklab-alpha { background-color: oklab(62.8% 0.225 0.126 / 50%); }
      .oklch-plain { background-color: oklch(0.628 0.2577 29.23); }
      .oklch-alpha { background-color: oklch(0.628 0.2577 29.23 / 50%); }
      .oklch-percent-deg { background-color: oklch(62.8% 0.2577 29.23deg); }
      .oklch-calc { background-color: oklch(calc(0.5 + 0.128) 0.2577 29.23); }
    `);

    expect({
      lab: styleOf("lab-plain"),
      labAlpha: styleOf("lab-alpha"),
      lch: styleOf("lch-plain"),
      lchAlpha: styleOf("lch-alpha"),
      oklab: styleOf("oklab-plain"),
      oklabAlpha: styleOf("oklab-alpha"),
      oklch: styleOf("oklch-plain"),
      oklchAlpha: styleOf("oklch-alpha"),
      oklchPercentDeg: styleOf("oklch-percent-deg"),
      oklchCalc: styleOf("oklch-calc"),
    }).toStrictEqual({
      lab: { backgroundColor: "#f00" },
      labAlpha: { backgroundColor: "#ff000080" },
      lch: { backgroundColor: "#f00" },
      lchAlpha: { backgroundColor: "#ff000080" },
      oklab: { backgroundColor: "#f00" },
      oklabAlpha: { backgroundColor: "#ff000080" },
      oklch: { backgroundColor: "#f00" },
      oklchAlpha: { backgroundColor: "#ff000080" },
      oklchPercentDeg: { backgroundColor: "#f00" },
      oklchCalc: { backgroundColor: "#f00" },
    });
  });
});

describe("color() — CSS Color 4 §10", () => {
  test("every predefined colour space converts into sRGB", () => {
    registerCSS(`
      .cs-srgb { background-color: color(srgb 1 0 0); }
      .cs-srgb-alpha { background-color: color(srgb 1 0 0 / 0.5); }
      .cs-srgb-linear { background-color: color(srgb-linear 1 0 0); }
      .cs-display-p3 { background-color: color(display-p3 1 0 0); }
      .cs-a98 { background-color: color(a98-rgb 1 0 0); }
      .cs-prophoto { background-color: color(prophoto-rgb 1 0 0); }
      .cs-rec2020 { background-color: color(rec2020 1 0 0); }
      .cs-xyz { background-color: color(xyz 1 0 0); }
      .cs-xyz-d50 { background-color: color(xyz-d50 1 0 0); }
      .cs-xyz-d65 { background-color: color(xyz-d65 1 0 0); }
    `);

    // GAP (lossy, not dropped): CSS Color 4 §10.1 defines wide-gamut spaces
    // whose primaries sit outside sRGB. React Native's colour value is an
    // sRGB int, so the conversion is unavoidable there — but iOS can express
    // Display-P3 through `PlatformColor`/`DynamicColorIOS`, which this library
    // already reaches for elsewhere, so the P3 primary need not be gamut-mapped
    // to `#ff0b0c` on that platform.
    expect({
      srgb: styleOf("cs-srgb"),
      srgbAlpha: styleOf("cs-srgb-alpha"),
      srgbLinear: styleOf("cs-srgb-linear"),
      displayP3: styleOf("cs-display-p3"),
      a98: styleOf("cs-a98"),
      prophoto: styleOf("cs-prophoto"),
      rec2020: styleOf("cs-rec2020"),
      xyz: styleOf("cs-xyz"),
      xyzD50: styleOf("cs-xyz-d50"),
      xyzD65: styleOf("cs-xyz-d65"),
    }).toStrictEqual({
      srgb: { backgroundColor: "#f00" },
      srgbAlpha: { backgroundColor: "#ff000080" },
      srgbLinear: { backgroundColor: "#f00" },
      displayP3: { backgroundColor: "#ff0b0c" },
      a98: { backgroundColor: "#ff5a48" },
      prophoto: { backgroundColor: "#f56" },
      rec2020: { backgroundColor: "#ff494f" },
      // `xyz` is the documented alias of `xyz-d65`.
      xyz: { backgroundColor: "#a20052" },
      xyzD50: { backgroundColor: "#6b003a" },
      xyzD65: { backgroundColor: "#a20052" },
    });
  });

  test("a custom colour profile is dropped, with a warning", () => {
    // GAP: CSS Color 5 §"Custom color spaces" lets `color()` name a profile
    // declared with `@color-profile`. The whole declaration is discarded here.
    // React Native could have expressed the fallback the spec requires authors
    // to pair it with; instead the element gets no background at all.
    const compiled = registerCSS(`
      .cs-custom { background-color: color(--my-space 1 0 0); }
    `);

    expect(styleOf("cs-custom")).toBeUndefined();
    expect(compiled.warnings()).toStrictEqual({
      values: { "background-color": ["color()"] },
    });
  });
});

describe("colour keywords — CSS Color 4 §6", () => {
  test("named colours and `transparent`, case-insensitively", () => {
    registerCSS(`
      .kw-named { background-color: red; }
      .kw-named-upper { background-color: RED; }
      .kw-rebecca { background-color: rebeccapurple; }
      .kw-transparent { background-color: transparent; }
      .kw-transparent-border { border-color: transparent; }
    `);

    expect({
      named: styleOf("kw-named"),
      upper: styleOf("kw-named-upper"),
      rebecca: styleOf("kw-rebecca"),
      transparent: styleOf("kw-transparent"),
      transparentBorder: styleOf("kw-transparent-border"),
    }).toStrictEqual({
      named: { backgroundColor: "#f00" },
      upper: { backgroundColor: "#f00" },
      rebecca: { backgroundColor: "#639" },
      transparent: { backgroundColor: "#0000" },
      transparentBorder: { borderColor: "#0000" },
    });
  });

  test("every CSS system colour resolves through PlatformColor", () => {
    // CSS Color 4 §6.2 "System Colors" defines these as real keywords resolving
    // to the platform's current UI palette. React Native has the exact mechanism
    // to express them — `PlatformColor()` — and this library already used it for
    // the `currentcolor` default, so the whole gap was a missing table.
    //
    // Each list is `[iOS name, Android theme attribute, Android fallback]`.
    // `PlatformColor` uses the first name that RESOLVES, so one value serves
    // both platforms. The Android fallback is not optional: Android's
    // `ColorPropConverter` throws when nothing in the list resolves.
    registerCSS(`
      .sys-canvas { background-color: canvas; }
      .sys-canvastext { background-color: canvastext; }
      .sys-linktext { background-color: linktext; }
      .sys-buttonface { background-color: buttonface; }
      .sys-buttontext { background-color: buttontext; }
      .sys-accentcolor { background-color: accentcolor; }
      .sys-field { background-color: field; }
      .sys-highlight { background-color: highlight; }
      .sys-graytext { background-color: graytext; }
    `);

    expect({
      canvas: styleOf("sys-canvas"),
      canvastext: styleOf("sys-canvastext"),
      linktext: styleOf("sys-linktext"),
      graytext: styleOf("sys-graytext"),
    }).toStrictEqual({
      canvas: {
        backgroundColor: {
          semantic: ["systemBackgroundColor", "?android:attr/colorBackground"],
        },
      },
      canvastext: {
        backgroundColor: {
          semantic: ["labelColor", "?android:attr/textColorPrimary"],
        },
      },
      linktext: {
        backgroundColor: {
          semantic: ["linkColor", "?android:attr/textColorLink"],
        },
      },
      graytext: {
        backgroundColor: {
          semantic: ["tertiaryLabelColor", "?android:attr/textColorTertiary"],
        },
      },
    });

    // The approximations resolve too — the point of the table is that no system
    // colour drops, not that every mapping is exact.
    for (const className of [
      "sys-buttonface",
      "sys-buttontext",
      "sys-accentcolor",
      "sys-field",
      "sys-highlight",
    ]) {
      expect(styleOf(className)).toStrictEqual({
        backgroundColor: { semantic: expect.any(Array) as string[] },
      });
    }
  });

  test("the DEPRECATED system colours alias their modern replacements", () => {
    // CSS Color 4 §6.3 deprecates ~20 keywords onto the modern set. They are
    // written as aliases in the table rather than repeated entries, so the two
    // cannot disagree.
    registerCSS(`
      .sys-window { background-color: window; }
      .sys-canvas2 { background-color: canvas; }
      .sys-menutext { background-color: menutext; }
      .sys-threedface { background-color: threedface; }
    `);

    // `window` is deprecated in favour of `canvas`, so the two are the same
    // value — asserted against each other rather than against a literal, which
    // is what makes the alias load-bearing.
    expect(styleOf("sys-window")).toStrictEqual(styleOf("sys-canvas2"));
    expect(styleOf("sys-menutext")).toStrictEqual({
      backgroundColor: {
        semantic: ["labelColor", "?android:attr/textColorPrimary"],
      },
    });
    expect(styleOf("sys-threedface")).toStrictEqual({
      backgroundColor: { semantic: expect.any(Array) as string[] },
    });
  });

  test("a system colour inside box-shadow reaches the shadow", () => {
    // Same §6.2 keywords. The shadow used to survive MINUS its colour key, so
    // React Native fell back to its default shadow colour rather than the
    // platform text colour the author asked for.
    registerCSS(`.sys-shadow { box-shadow: 0 0 4px canvastext; }`);

    expect(styleOf("sys-shadow")).toStrictEqual({
      boxShadow: [
        {
          blurRadius: 4,
          offsetX: 0,
          offsetY: 0,
          spreadDistance: 0,
          color: { semantic: ["labelColor", "?android:attr/textColorPrimary"] },
        },
      ],
    });
  });

  test("`platformColor()` is the escape hatch that does reach the platform", () => {
    registerCSS(`
      .pc-red { background-color: platformColor(systemRed); }
      .pc-blue { color: platformColor(systemBlue); }
    `);

    expect({
      background: styleOf("pc-red"),
      color: styleOf("pc-blue"),
    }).toStrictEqual({
      background: { backgroundColor: { semantic: ["systemRed"] } },
      color: { color: { semantic: ["systemBlue"] } },
    });
  });
});

describe("invalid colour values", () => {
  test("an unrecognised identifier is dropped, with a warning", () => {
    // CSS Syntax 3 §"Parse a declaration" and CSS 2.1 §4.2 "Rules for handling
    // parsing errors" both require a declaration whose value does not match the
    // property's grammar to be ignored entirely.
    //
    // The raw token used to be handed to React Native, which cannot parse it —
    // `processColor` returns undefined — so it landed in the style object as
    // dead weight, with no warning to tell the author their stylesheet has a
    // typo.
    const compiled = registerCSS(`
      .bad-background { background-color: bananas; }
      .bad-color { color: bananas; }
      .bad-border { border-color: bananas; }
    `);

    expect(processColor("bananas")).toBeUndefined();
    expect({
      background: styleOf("bad-background"),
      color: styleOf("bad-color"),
      border: styleOf("bad-border"),
    }).toStrictEqual({
      background: undefined,
      color: undefined,
      border: undefined,
    });
    expect(compiled.warnings()).toStrictEqual({
      values: {
        "background-color": ["bananas"],
        "color": ["bananas"],
        "border-color": ["bananas"],
      },
    });
  });

  test("a bare number and a multi-token value are dropped", () => {
    // Same parsing rule. `background-color` accepts neither a `<number>` nor
    // two colours, yet both used to reach the style object — the second as a
    // JavaScript ARRAY, a shape React Native's colour prop cannot consume.
    registerCSS(`
      .bad-number { background-color: 42; }
      .bad-pair { background-color: red extra; }
    `);

    expect({
      number: styleOf("bad-number"),
      pair: styleOf("bad-pair"),
    }).toStrictEqual({
      number: undefined,
      pair: undefined,
    });
  });

  test("the CSS-wide keywords split two ways", () => {
    // `unset` is the one keyword the runtime carries: it reads as "remove this
    // value", so it leaves an explicitly-undefined key. The other three are
    // instructions to the cascade with no React Native form — `revert` and
    // `revert-layer` (CSS Cascade 5 §"Rolling Back The Cascade") no less than
    // `inherit` and `initial` — so each is dropped with a warning rather than
    // reaching the style object as its own text.
    const compiled = registerCSS(`
      .kw-inherit { background-color: inherit; }
      .kw-initial { background-color: initial; }
      .kw-unset { background-color: unset; }
      .kw-revert { background-color: revert; }
      .kw-revert-layer { background-color: revert-layer; }
    `);

    expect({
      inherit: styleOf("kw-inherit"),
      initial: styleOf("kw-initial"),
      unset: styleOf("kw-unset"),
      revert: styleOf("kw-revert"),
      revertLayer: styleOf("kw-revert-layer"),
    }).toStrictEqual({
      inherit: undefined,
      initial: undefined,
      unset: { backgroundColor: undefined },
      revert: undefined,
      revertLayer: undefined,
    });

    expect(compiled.warnings()).toStrictEqual({
      values: {
        "background-color": ["inherit", "initial", "revert", "revert-layer"],
      },
    });
  });
});

describe("currentcolor — CSS Color 4 §6.1", () => {
  test("with no colour in scope it resolves to the platform label colour", () => {
    registerCSS(`
      .cc-background { background-color: currentcolor; }
      .cc-mixed-case { background-color: CurrentColor; }
    `);

    expect({
      lower: styleOf("cc-background"),
      mixedCase: styleOf("cc-mixed-case"),
    }).toStrictEqual({
      lower: { backgroundColor: { semantic: ["label", "labelColor"] } },
      mixedCase: { backgroundColor: { semantic: ["label", "labelColor"] } },
    });
  });

  test("it picks up `color` from the same element and from an ancestor", () => {
    registerCSS(`
      .cc-self { color: rgb(0 128 0); background-color: currentcolor; }
      .cc-parent { color: rgb(0 128 0); }
      .cc-child { background-color: currentcolor; }
    `);

    expect(styleOf("cc-self")).toStrictEqual({
      color: "#008000",
      backgroundColor: "#008000",
    });

    render(
      <View testID="currentcolor-parent" className="cc-parent">
        <View testID={testID} className="cc-child" />
      </View>,
    );
    expect(screen.getByTestId(testID).props.style).toStrictEqual({
      backgroundColor: "#008000",
    });
  });
});

describe("light-dark() — CSS Color 5", () => {
  test("both branches resolve and swap with the colour scheme", () => {
    registerCSS(`.ld-literal { background-color: light-dark(red, blue); }`);

    render(<View testID={testID} className="ld-literal" />);
    expect(screen.getByTestId(testID).props.style).toStrictEqual({
      backgroundColor: "#f00",
    });

    act(() => {
      colorScheme.set("dark");
    });
    expect(screen.getByTestId(testID).props.style).toStrictEqual({
      backgroundColor: "#00f",
    });
  });

  test("both branches may be variables, resolved at runtime", () => {
    registerCSS(
      `.ld-var {
        --light-brand: red;
        --dark-brand: blue;
        background-color: light-dark(var(--light-brand), var(--dark-brand));
      }`,
      { inlineVariables: false },
    );

    render(<View testID={testID} className="ld-var" />);
    // The variable's raw token reaches React Native — a named colour, which its
    // parser accepts, so this works even though it is not normalised to hex.
    expect(screen.getByTestId(testID).props.style).toStrictEqual({
      backgroundColor: "red",
    });

    act(() => {
      colorScheme.set("dark");
    });
    expect(screen.getByTestId(testID).props.style).toStrictEqual({
      backgroundColor: "blue",
    });
  });
});

describe("color-mix() resolved at compile time — CSS Color 5 §3", () => {
  test("every interpolation space mixes correctly when both colours are literals", () => {
    registerCSS(`
      .mix-srgb { background-color: color-mix(in srgb, red, blue); }
      .mix-weighted { background-color: color-mix(in srgb, red 25%, blue); }
      .mix-transparent { background-color: color-mix(in oklab, red 50%, transparent); }
      .mix-hue-shorter { background-color: color-mix(in hsl shorter hue, red, blue); }
      .mix-nested { background-color: color-mix(in srgb, color-mix(in srgb, red, blue), green); }
      .mix-lch { background-color: color-mix(in lch, red, blue); }
      .mix-xyz { background-color: color-mix(in xyz, red, blue); }
      .mix-hwb { background-color: color-mix(in hwb, red, blue); }
      .mix-srgb-linear { background-color: color-mix(in srgb-linear, red, blue); }
    `);

    expect({
      srgb: styleOf("mix-srgb"),
      weighted: styleOf("mix-weighted"),
      transparent: styleOf("mix-transparent"),
      hueShorter: styleOf("mix-hue-shorter"),
      nested: styleOf("mix-nested"),
      lch: styleOf("mix-lch"),
      xyz: styleOf("mix-xyz"),
      hwb: styleOf("mix-hwb"),
      srgbLinear: styleOf("mix-srgb-linear"),
    }).toStrictEqual({
      srgb: { backgroundColor: "#800080" },
      weighted: { backgroundColor: "#4000bf" },
      transparent: { backgroundColor: "#ff000080" },
      hueShorter: { backgroundColor: "#f0f" },
      nested: { backgroundColor: "#404040" },
      lch: { backgroundColor: "#cd007e" },
      xyz: { backgroundColor: "#bc00bc" },
      hwb: { backgroundColor: "#f0f" },
      srgbLinear: { backgroundColor: "#bc00bc" },
    });
  });
});

describe("color-mix() resolved at runtime — CSS Color 5 §3", () => {
  test("an unweighted two-colour mix is correct", () => {
    registerCSS(
      `.rt-mix-even {
        --brand: red;
        --accent: blue;
        background-color: color-mix(in srgb, var(--brand), var(--accent));
      }`,
      { inlineVariables: false },
    );

    // Byte-identical to the compile-time `#800080`. The channels are ROUNDED to
    // whole bytes, which is what makes the two routes name one colour rather
    // than two: `@react-native/normalize-colors` reads an `rgb()` channel with
    // `parseInt`, so an un-rounded `127.5` truncates to `127` (`0x7f`) while
    // the hex says `128` (`0x80`).
    expect(styleOf("rt-mix-even")).toStrictEqual({
      backgroundColor: "rgba(128, 0, 128, 1)",
    });

    expect({
      runtime: processColor("rgba(128, 0, 128, 1)"),
      compileTime: processColor("#800080"),
      unrounded: processColor("rgba(127.5, 0, 127.5, 1)"),
    }).toStrictEqual({
      runtime: 4286578816,
      compileTime: 4286578816,
      unrounded: 4286513279,
    });
  });

  test("a percentage on the left colour is the mixing ratio", () => {
    // CSS Color 5 §3.2 defines `color-mix(in srgb, A p1%, B)` as the
    // percentage-weighted average of A and B, with p2 defaulting to 100% - p1
    // and the result's alpha coming from the operands' own alphas. The
    // percentage is a MIXING WEIGHT and never an alpha, so two opaque operands
    // give an opaque result at every weight.
    registerCSS(
      `.rt-mix-quarter {
        --brand: red;
        --accent: blue;
        background-color: color-mix(in srgb, var(--brand) 25%, var(--accent));
      }
      .rt-mix-half {
        --brand: red;
        --accent: blue;
        background-color: color-mix(in srgb, var(--brand) 50%, var(--accent));
      }
      .rt-mix-both {
        --brand: red;
        --accent: blue;
        background-color: color-mix(in srgb, var(--brand) 30%, var(--accent) 70%);
      }`,
      { inlineVariables: false },
    );

    // 0.25 x 255 = 63.75 -> 64 and 0.75 x 255 = 191.25 -> 191; 0.30 x 255 =
    // 76.5 -> 77 and 0.70 x 255 = 178.5 -> 179. Each row is byte-identical to
    // what the compile-time path computes for the same declaration written with
    // literals: `#4000bf`, `#800080` and `#4d00b3`.
    expect({
      quarter: styleOf("rt-mix-quarter"),
      half: styleOf("rt-mix-half"),
      both: styleOf("rt-mix-both"),
    }).toStrictEqual({
      quarter: { backgroundColor: "rgba(64, 0, 191, 1)" },
      half: { backgroundColor: "rgba(128, 0, 128, 1)" },
      both: { backgroundColor: "rgba(77, 0, 179, 1)" },
    });

    expect({
      quarter: processColor("rgba(64, 0, 191, 1)"),
      quarterHex: processColor("#4000bf"),
      half: processColor("rgba(128, 0, 128, 1)"),
      halfHex: processColor("#800080"),
      both: processColor("rgba(77, 0, 179, 1)"),
      bothHex: processColor("#4d00b3"),
    }).toStrictEqual({
      quarter: 4282384575,
      quarterHex: 4282384575,
      half: 4286578816,
      halfHex: 4286578816,
      both: 4283236531,
      bothHex: 4283236531,
    });
  });

  test("`transparent` contributes only its alpha, on either side", () => {
    // CSS Color 5 §3.2 defers to CSS Color 4 §12.3, which interpolates with
    // PREMULTIPLIED alpha: a fully transparent operand carries no colour into
    // the mix, only its transparency. So the two orderings differ in nothing
    // but operand order and both give red at half opacity — an un-premultiplied
    // average would fold `transparent`'s black channels in and halve the
    // brightness as well.
    //
    // The two sides reach that answer by different routes: the compiler folds
    // `C p%, transparent` into a single-colour-with-alpha (`parseColorMix`),
    // while `transparent, C p%` goes through the general mix. They agree.
    registerCSS(
      `.rt-mix-right {
        --brand: red;
        background-color: color-mix(in srgb, var(--brand) 50%, transparent);
      }
      .rt-mix-left {
        --brand: red;
        background-color: color-mix(in srgb, transparent, var(--brand) 50%);
      }`,
      { inlineVariables: false },
    );

    expect({
      right: styleOf("rt-mix-right"),
      left: styleOf("rt-mix-left"),
    }).toStrictEqual({
      right: { backgroundColor: "rgba(255, 0, 0, 0.5)" },
      left: { backgroundColor: "rgba(255, 0, 0, 0.5)" },
    });

    // Both spellings land on the compile-time literal's `#ff000080`; the
    // un-premultiplied average is a visibly different colour, not a rounding
    // difference.
    expect({
      mixed: processColor("rgba(255, 0, 0, 0.5)"),
      compileTime: processColor("#ff000080"),
      unpremultiplied: processColor("rgba(127.5, 0, 0, 0.5)"),
    }).toStrictEqual({
      mixed: 2164195328,
      compileTime: 2164195328,
      unpremultiplied: 2155806720,
    });
  });

  test("every interpolation space CSS Color 5 lists is registered", () => {
    // CSS Color 5 §3.1 lists srgb, srgb-linear, lab, oklab, xyz, xyz-d50,
    // xyz-d65, hsl, hwb, lch and oklch as valid `<color-interpolation-method>`
    // values. Each is registered with colorjs.io under the name CSS spells it,
    // so naming one resolves rather than throwing inside the resolver and
    // taking the whole declaration with it.
    registerCSS(
      `.rt-space-srgb {
        --brand: red; --accent: blue;
        background-color: color-mix(in srgb, var(--brand), var(--accent));
      }
      .rt-space-oklab {
        --brand: red; --accent: blue;
        background-color: color-mix(in oklab, var(--brand), var(--accent));
      }
      .rt-space-hsl {
        --brand: red; --accent: blue;
        background-color: color-mix(in hsl, var(--brand), var(--accent));
      }
      .rt-space-lch {
        --brand: red; --accent: blue;
        background-color: color-mix(in lch, var(--brand), var(--accent));
      }
      .rt-space-xyz {
        --brand: red; --accent: blue;
        background-color: color-mix(in xyz, var(--brand), var(--accent));
      }
      .rt-space-oklch-hue {
        --brand: red; --accent: blue;
        background-color: color-mix(in oklch longer hue, var(--brand), var(--accent));
      }`,
      { inlineVariables: false },
    );

    expect({
      srgb: styleOf("rt-space-srgb"),
      oklab: styleOf("rt-space-oklab"),
      hsl: styleOf("rt-space-hsl"),
      lch: styleOf("rt-space-lch"),
      xyz: styleOf("rt-space-xyz"),
      oklchHue: styleOf("rt-space-oklch-hue"),
    }).toStrictEqual({
      srgb: { backgroundColor: "rgba(128, 0, 128, 1)" },
      oklab: { backgroundColor: "rgba(140, 83, 162, 1)" },
      hsl: { backgroundColor: "rgba(255, 0, 255, 1)" },
      // `lch` and `xyz` are WIDER than sRGB, so interpolating in them lands
      // outside it — as a negative channel, or as one so near zero it
      // serialises in exponent form. The result is gamut-mapped into sRGB
      // before it is written, which keeps the hue the author asked for and
      // keeps the string inside the grammar React Native parses.
      lch: { backgroundColor: "rgba(205, 0, 126, 1)" },
      xyz: { backgroundColor: "rgba(188, 0, 188, 1)" },
      // GAP: `oklch longer hue` — the interpolation-method HUE modifier — is
      // dropped at COMPILE time. `parseColorMix` reads the space as a single
      // token, so `longer hue` never reaches the resolver, which does accept
      // all four CSS Color 4 §12.4 hue methods.
      oklchHue: undefined,
    });

    // Each mapped colour is byte-identical to the compile-time route's hex, and
    // the raw out-of-gamut channels are not merely a shade off: an exponent in
    // the string takes the whole colour out of
    // `@react-native/normalize-colors`' number pattern, so it parses to null.
    expect({
      lch: processColor("rgba(205, 0, 126, 1)"),
      lchHex: processColor("#cd007e"),
      lchRaw: processColor(
        "rgba(244.96131705347807, -100.85733209123327, 134.09760672003702, 1)",
      ),
      xyz: processColor("rgba(188, 0, 188, 1)"),
      xyzHex: processColor("#bc00bc"),
      xyzRaw: processColor(
        "rgba(187.51603067837462, -2.2860879855812755e-13, 187.51603067837462, 1)",
      ),
      oklab: processColor("rgba(140, 83, 162, 1)"),
      oklabHex: processColor("#8c53a2"),
    }).toStrictEqual({
      lch: 4291625086,
      lchHex: 4291625086,
      lchRaw: 4294180998,
      xyz: 4290511036,
      xyzHex: 4290511036,
      xyzRaw: undefined,
      oklab: 4287386530,
      oklabHex: 4287386530,
    });
  });

  test("currentcolor inside color-mix() drops the declaration entirely", () => {
    // GAP: CSS Color 4 §6.1 makes `currentcolor` usable anywhere a `<color>` is,
    // including inside `color-mix()` (CSS Color 5 §3). The compiler emits a
    // runtime `colorMix` whose left operand is the `currentcolor` variable, but
    // the resolver hands that value straight to colorjs.io's `parse()` — which
    // needs a string — so it throws and the background is dropped. It fails both
    // when `color` is set on the same element and when it is inherited, so
    // `color-mix(in srgb, currentcolor 50%, transparent)` — the shape any
    // "half-opacity current text colour" rule takes — never renders. React
    // Native could have received `rgba(0, 128, 0, 0.5)`.
    registerCSS(`
      .cm-self {
        color: rgb(0 128 0);
        background-color: color-mix(in srgb, currentcolor 50%, transparent);
      }
      .cm-parent { color: rgb(0 128 0); }
      .cm-child {
        background-color: color-mix(in srgb, currentcolor 50%, transparent);
      }
    `);

    expect(styleOf("cm-self")).toStrictEqual({ color: "#008000" });

    render(
      <View testID="colormix-parent" className="cm-parent">
        <View testID={testID} className="cm-child" />
      </View>,
    );
    expect(screen.getByTestId(testID).props.style).toBeUndefined();
  });
});

describe("relative colour syntax — CSS Color 5 §4", () => {
  test("a literal origin colour is resolved at compile time", () => {
    registerCSS(`
      .rel-rgb { background-color: rgb(from red r g b); }
      .rel-rgb-alpha { background-color: rgb(from red r g b / 50%); }
      .rel-hsl-calc { background-color: hsl(from red h s calc(l * 0.5)); }
      .rel-oklch-calc { background-color: oklch(from red calc(l - 0.1) c h); }
    `);

    expect({
      rgb: styleOf("rel-rgb"),
      rgbAlpha: styleOf("rel-rgb-alpha"),
      hslCalc: styleOf("rel-hsl-calc"),
      oklchCalc: styleOf("rel-oklch-calc"),
    }).toStrictEqual({
      rgb: { backgroundColor: "#f00" },
      rgbAlpha: { backgroundColor: "#ff000080" },
      hslCalc: { backgroundColor: "#800000" },
      oklchCalc: { backgroundColor: "#d20000" },
    });
  });

  test("a variable or currentcolor origin is computed at runtime", () => {
    // CSS Color 5 §4 allows the origin colour to be any `<color>`, including
    // `var()` and `currentcolor` — that is the whole point of the syntax for
    // theming. The runtime resolver converts the origin into the function's own
    // space, binds `r`/`g`/`b` and `alpha` to its channels, and serialises the
    // result in the legacy grammar React Native parses.
    //
    // GAP: an origin that resolves to a `PlatformColor` descriptor rather than
    // to a string has no channels to read, so the declaration is dropped. With
    // no `color` in scope `currentcolor` is exactly that, which is why the
    // third case has no `backgroundColor` at all. React Native cannot apply an
    // alpha to a `PlatformColor` either, so there is no string to emit — but a
    // warning would make the loss visible.
    registerCSS(
      `.rel-var {
        --brand: red;
        background-color: rgb(from var(--brand) r g b / 50%);
      }
      .rel-current {
        color: green;
        background-color: rgb(from currentcolor r g b / 50%);
      }
      .rel-current-unset {
        background-color: rgb(from currentcolor r g b / 50%);
      }`,
      { inlineVariables: false },
    );

    expect({
      variable: styleOf("rel-var"),
      current: styleOf("rel-current"),
      currentUnset: styleOf("rel-current-unset"),
    }).toStrictEqual({
      variable: { backgroundColor: "rgba(255, 0, 0, 0.5)" },
      current: {
        color: "#008000",
        backgroundColor: "rgba(0, 128, 0, 0.5)",
      },
      currentUnset: {},
    });

    // Both computed strings are byte-identical to what the compile-time route
    // produces for the same declaration written with a literal origin, and a
    // comma-joined argument list — the shape a generic function serialiser
    // yields for this syntax — is outside React Native's grammar entirely.
    expect({
      variable: processColor("rgba(255, 0, 0, 0.5)"),
      variableHex: processColor("#ff000080"),
      current: processColor("rgba(0, 128, 0, 0.5)"),
      currentHex: processColor("#00800080"),
      commaJoined: processColor("rgb(from, red, r, g, b, 50%)"),
    }).toStrictEqual({
      variable: 2164195328,
      variableHex: 2164195328,
      current: 2147516416,
      currentHex: 2147516416,
      commaJoined: undefined,
    });
  });
});

describe("colour functions over runtime variables", () => {
  test("a variable supplies the channels in either grammar", () => {
    // CSS Color 4 §5.1/§7.1 allow `var()` to supply any part of a colour
    // function's argument list, and the function has two grammars to supply it
    // in: legacy comma-separated, and modern space-separated with a `/` before
    // the alpha. Each function has a resolver that reads its arguments in
    // EITHER spelling — flattening a variable that stands in for a whole
    // channel group — and emits the one legacy form React Native parses
    // unambiguously. So the alpha notation the author chose decides nothing.
    registerCSS(
      `.var-rgb {
        --channels: 255 0 0;
        background-color: rgb(var(--channels));
      }
      .var-rgba {
        --channels: 255 0 0;
        background-color: rgba(var(--channels), 0.5);
      }
      .var-rgb-slash {
        --channels: 255 0 0;
        background-color: rgb(var(--channels) / 50%);
      }
      .var-hsl {
        --hue: 0 100% 50%;
        background-color: hsl(var(--hue));
      }
      .var-hsla {
        --hue: 0 100% 50%;
        background-color: hsla(var(--hue), 0.5);
      }
      .var-plain {
        --brand: red;
        background-color: var(--brand);
      }`,
      { inlineVariables: false },
    );

    expect({
      rgb: styleOf("var-rgb"),
      rgba: styleOf("var-rgba"),
      rgbSlash: styleOf("var-rgb-slash"),
      hsl: styleOf("var-hsl"),
      hsla: styleOf("var-hsla"),
      plain: styleOf("var-plain"),
    }).toStrictEqual({
      rgb: { backgroundColor: "rgb(255, 0, 0)" },
      rgba: { backgroundColor: "rgba(255, 0, 0, 0.5)" },
      rgbSlash: { backgroundColor: "rgba(255, 0, 0, 0.5)" },
      hsl: { backgroundColor: "hsl(0, 100%, 50%)" },
      hsla: { backgroundColor: "hsla(0, 100%, 50%, 0.5)" },
      plain: { backgroundColor: "red" },
    });

    // Every emitted spelling is inside React Native's grammar, and the three
    // alpha-bearing ones name the same colour whichever notation the author
    // used. The hybrid spellings a grammar-blind comma-join would produce are
    // pinned beside them, because they parse to null rather than to a wrong
    // colour — a silent absence, not a visible mistake.
    expect({
      rgb: processColor("rgb(255, 0, 0)"),
      rgba: processColor("rgba(255, 0, 0, 0.5)"),
      hsl: processColor("hsl(0, 100%, 50%)"),
      hsla: processColor("hsla(0, 100%, 50%, 0.5)"),
      hybridRgba: processColor("rgba(255 0 0, 0.5)"),
      hybridRgbSlash: processColor("rgb(255 0 0, 50%)"),
      hybridHsla: processColor("hsla(0 100% 50%, 0.5)"),
    }).toStrictEqual({
      rgb: 4294901760,
      rgba: 2164195328,
      hsl: 4294901760,
      hsla: 2164195328,
      hybridRgba: undefined,
      hybridRgbSlash: undefined,
      hybridHsla: undefined,
    });
  });
});

describe("alpha across every notation", () => {
  test("50% alpha is identical however it is spelled", () => {
    registerCSS(`
      .alpha-rgb-percent { background-color: rgb(255 0 0 / 50%); }
      .alpha-rgb-number { background-color: rgb(255 0 0 / 0.5); }
      .alpha-rgba-legacy { background-color: rgba(255, 0, 0, 50%); }
      .alpha-hsl { background-color: hsl(0 100% 50% / 0.5); }
      .alpha-oklch { background-color: oklch(0.628 0.2577 29.23 / 0.5); }
      .alpha-color-fn { background-color: color(srgb 1 0 0 / 50%); }
      .alpha-hex { background-color: #ff000080; }
    `);

    expect({
      rgbPercent: styleOf("alpha-rgb-percent"),
      rgbNumber: styleOf("alpha-rgb-number"),
      rgbaLegacy: styleOf("alpha-rgba-legacy"),
      hsl: styleOf("alpha-hsl"),
      oklch: styleOf("alpha-oklch"),
      colorFn: styleOf("alpha-color-fn"),
      hex: styleOf("alpha-hex"),
    }).toStrictEqual({
      rgbPercent: { backgroundColor: "#ff000080" },
      rgbNumber: { backgroundColor: "#ff000080" },
      rgbaLegacy: { backgroundColor: "#ff000080" },
      hsl: { backgroundColor: "#ff000080" },
      oklch: { backgroundColor: "#ff000080" },
      colorFn: { backgroundColor: "#ff000080" },
      hex: { backgroundColor: "#ff000080" },
    });
  });
});

describe("compiler colour output options", () => {
  test("`hexColors: false` emits CSS syntax React Native cannot parse", () => {
    // GAP: with hex output disabled, colours serialise in their authored space
    // — `oklch(…)`, percentage rgb channels, `color(display-p3 …)` — none of
    // which appear in `@react-native/normalize-colors`' grammar (asserted at the
    // top of this file). The option is only usable for colours that happen to
    // round-trip through legacy syntax; React Native could have taken the same
    // sRGB conversion the default path already performs.
    registerCSS(
      `.opt-oklch { background-color: oklch(0.628 0.2577 29.23); }
       .opt-rgb-alpha { background-color: rgb(255 0 0 / 50%); }
       .opt-p3 { background-color: color(display-p3 1 0 0); }`,
      { hexColors: false },
    );

    expect({
      oklch: styleOf("opt-oklch"),
      rgbAlpha: styleOf("opt-rgb-alpha"),
      p3: styleOf("opt-p3"),
    }).toStrictEqual({
      oklch: { backgroundColor: "oklch(62.8% 0.258 29.2)" },
      rgbAlpha: { backgroundColor: "rgb(100% 0% 0% / 0.502)" },
      p3: { backgroundColor: "color(display-p3 1 0 0)" },
    });

    expect({
      oklch: processColor("oklch(62.8% 0.258 29.2)"),
      rgbAlpha: processColor("rgb(100% 0% 0% / 0.502)"),
      p3: processColor("color(display-p3 1 0 0)"),
    }).toStrictEqual({
      oklch: undefined,
      rgbAlpha: undefined,
      p3: undefined,
    });
  });
});

describe("colours on other colour properties", () => {
  test("border-color longhands and the four-value shorthand", () => {
    registerCSS(`
      .bc-single { border-color: oklch(0.628 0.2577 29.23); }
      .bc-four { border-color: red green blue yellow; }
      .bc-top { border-top-color: color-mix(in srgb, red, blue); }
    `);

    expect({
      single: styleOf("bc-single"),
      four: styleOf("bc-four"),
      top: styleOf("bc-top"),
    }).toStrictEqual({
      single: { borderColor: "#f00" },
      four: {
        borderTopColor: "#f00",
        borderRightColor: "#008000",
        borderBottomColor: "#00f",
        borderLeftColor: "#ff0",
      },
      top: { borderTopColor: "#800080" },
    });
  });

  test("modern colour syntax inside gradients and shadows", () => {
    registerCSS(`
      .fx-gradient { background-image: linear-gradient(oklch(0.628 0.2577 29.23), blue); }
      .fx-shadow { box-shadow: 0 0 4px oklch(0.628 0.2577 29.23); }
    `);

    const gradient = styleOf("fx-gradient");

    expect({
      gradient,
      shadow: styleOf("fx-shadow"),
    }).toStrictEqual({
      gradient: {
        experimental_backgroundImage: "linear-gradient(to bottom, #f00, #00f)",
      },
      shadow: {
        boxShadow: [
          {
            blurRadius: 4,
            color: "#f00",
            offsetX: 0,
            offsetY: 0,
            spreadDistance: 0,
          },
        ],
      },
    });

    // A gradient colour has to be inside React Native's own grammar by the time
    // the string reaches `processBackgroundImage`: an unreadable stop drops the
    // whole declaration to `[]`, which renders as no background rather than as
    // an error. The `oklch()` above is outside that grammar, so this is the
    // assertion that proves the compiler resolved it rather than forwarding it.
    expect(
      processBackgroundImage(gradient?.experimental_backgroundImage),
    ).toStrictEqual([
      {
        type: "linear-gradient",
        direction: { type: "angle", value: 180 },
        colorStops: [
          { color: processColor("#f00"), position: null },
          { color: processColor("blue"), position: null },
        ],
      },
    ]);
  });
});
