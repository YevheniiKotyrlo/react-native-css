import { processColor } from "react-native";

import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import processBackgroundImage from "react-native/Libraries/StyleSheet/processBackgroundImage";

/**
 * Web vs native parity.
 *
 * `src/web/` is four files and ~150 lines. It never interprets CSS: `styled` /
 * `useCssElement` hand the class name straight through as
 * `{ $$css: true, className: "..." }` and react-native-web resolves it against
 * the real stylesheet the bundler emitted. So on web the *browser* implements
 * every CSS feature, and web support is whatever the browser supports.
 *
 * Native has no CSS engine. Everything the compiler does not translate into a
 * React Native style key, and everything the native runtime does not evaluate,
 * is simply absent — the app renders, nothing throws, and the difference only
 * shows on a device.
 *
 * That asymmetry makes every gap below one-directional: the feature works on
 * web because the browser does it, and does not work on native because nobody
 * reimplemented it. Each test pins the *native* behaviour and states what a
 * browser does with the same CSS.
 *
 * Two failure modes appear repeatedly and are worth distinguishing:
 *
 *   - **Warned drops** — the declaration reaches `compiled.warnings()`. Still
 *     invisible at runtime, but a build-time report can surface it.
 *   - **Silent drops** — no style and no warning. Nothing anywhere records
 *     that the author wrote something. These are the expensive ones.
 */

const children = undefined;

/* -------------------------------------------------------------------------
 * Positioning
 * ---------------------------------------------------------------------- */

test("position: fixed is dropped, and the offsets it was paired with are kept", () => {
  // A browser takes the element out of flow and pins it to the viewport.
  // Native keeps `top` but drops `position`, so the element stays in flow and
  // `top` is reinterpreted as a relative offset — a sticky header renders as a
  // normal, scrolling block nudged down the page.
  const compiled = registerCSS(`.fixed-header { position: fixed; top: 0; }`);

  render(<View testID={testID} className="fixed-header" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ top: 0 });
  expect(compiled.warnings()).toStrictEqual({
    values: { position: ["fixed"] },
  });
});

test("position: sticky is dropped the same way", () => {
  // A browser scrolls the element until it hits the offset, then pins it.
  // Native has no equivalent at all.
  const compiled = registerCSS(`.sticky-bar { position: sticky; top: 10px; }`);

  render(<View testID={testID} className="sticky-bar" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ top: 10 });
  expect(compiled.warnings()).toStrictEqual({
    values: { position: ["sticky"] },
  });
});

test("position: absolute and relative are the only two that survive", () => {
  const compiled = registerCSS(`
    .abs { position: absolute; }
    .rel { position: relative; }
  `);

  render(<View testID={testID} className="abs" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    position: "absolute",
  });

  expect(compiled.warnings()).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * Display / layout model
 * ---------------------------------------------------------------------- */

test("display: block is dropped — native has no block formatting context", () => {
  // A browser stacks children vertically at full width. Native has no `block`,
  // so the element keeps React Native's default `flex` column layout. The two
  // agree often enough that the drop goes unnoticed, and then disagree on
  // width, on wrapping, and on how `margin: auto` centres.
  const compiled = registerCSS(`.block-el { display: block; }`);

  render(<View testID={testID} className="block-el" />);

  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });
  expect(compiled.warnings()).toStrictEqual({ values: { display: ["block"] } });
});

test("display: grid, inline and inline-block are all dropped", () => {
  // Every one of these is a distinct layout algorithm in a browser. Native
  // implements exactly three display values: `flex`, `none` and `contents`.
  const grid = registerCSS(`.grid-el { display: grid; }`);
  const inline = registerCSS(`.inline-el { display: inline; }`);
  const inlineBlock = registerCSS(
    `.inline-block-el { display: inline-block; }`,
  );

  render(<View testID={testID} className="grid-el" />);
  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });

  expect(grid.warnings()).toStrictEqual({ values: { display: ["grid"] } });
  expect(inline.warnings()).toStrictEqual({ values: { display: ["inline"] } });
  expect(inlineBlock.warnings()).toStrictEqual({
    values: { display: ["inline-block"] },
  });
});

test("float, order and grid-template-columns are unknown properties", () => {
  // All three lay out content in a browser. On native the whole declaration
  // never reaches a style object.
  const float = registerCSS(`.float-el { float: left; }`);
  const order = registerCSS(`.order-el { order: 2; }`);
  const grid = registerCSS(`.tracks { grid-template-columns: 1fr 1fr; }`);

  render(<View testID={testID} className="order-el" />);
  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });

  expect(float.warnings()).toStrictEqual({ properties: ["float"] });
  expect(order.warnings()).toStrictEqual({ properties: ["order"] });
  expect(grid.warnings()).toStrictEqual({
    properties: ["grid-template-columns"],
  });
});

/* -------------------------------------------------------------------------
 * Overflow
 * ---------------------------------------------------------------------- */

test("overflow: auto and overflow: clip are dropped; visible/hidden/scroll survive", () => {
  // `overflow: auto` is the ordinary web way to make a box scrollable, and a
  // browser treats it as "scroll only when needed". Native emits nothing at
  // all — not even a fallback to `hidden` — so the content overflows its box
  // instead. The value React Native does model is `scroll`, which passes
  // through; `auto` and `clip` have no equivalent.
  const auto = registerCSS(`.auto-box { overflow: auto; }`);
  const clip = registerCSS(`.clip-box { overflow: clip; }`);
  const scroll = registerCSS(`.scroll-box { overflow: scroll; }`);

  render(<View testID={testID} className="auto-box" />);
  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });
  screen.unmount();

  render(<View testID={testID} className="scroll-box" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    overflow: "scroll",
  });

  expect(auto.warnings()).toStrictEqual({ values: { overflow: ["auto"] } });
  expect(clip.warnings()).toStrictEqual({ values: { overflow: ["clip"] } });
  expect(scroll.warnings()).toStrictEqual({});
});

test("overflow-x and overflow-y are unknown properties", () => {
  // A browser scrolls one axis and clips the other. Native has no per-axis
  // overflow at all, so `overflow-x: hidden` — the standard way to stop
  // horizontal bleed — does nothing.
  const x = registerCSS(`.ox { overflow-x: hidden; }`);
  const y = registerCSS(`.oy { overflow-y: scroll; }`);

  render(<View testID={testID} className="ox" />);
  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });

  expect(x.warnings()).toStrictEqual({ properties: ["overflow-x"] });
  expect(y.warnings()).toStrictEqual({ properties: ["overflow-y"] });
});

test("clip-path is an unknown property", () => {
  // A browser clips the element to the shape. Native renders the full box.
  const compiled = registerCSS(`.clipped { clip-path: circle(50%); }`);

  render(<View testID={testID} className="clipped" />);

  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });
  expect(compiled.warnings()).toStrictEqual({ properties: ["clip-path"] });
});

/* -------------------------------------------------------------------------
 * Visibility
 * ---------------------------------------------------------------------- */

test("visibility: hidden removes the element from hit testing", () => {
  // A browser removes a `visibility: hidden` element from hit testing entirely:
  // it cannot be clicked, and it is hidden from assistive tech. `opacity: 0`
  // alone only makes it transparent — the element still occupies space (as on
  // web) AND still receives touches, so a hidden button can be pressed by
  // accident. `pointerEvents` is a real React Native style key, so the second
  // half composes through the cascade like any other declaration.
  //
  // `visibility` itself rides along. React Native carries no such key today —
  // it is in neither `StyleSheetTypes` nor `ReactNativeStyleAttributes` — so it
  // is inert, and dropping a CSS property because the target has not
  // implemented it hides the gap and forfeits the day it does.
  registerCSS(`.invisible { visibility: hidden; }`);

  const onTouchEnd = jest.fn();
  render(
    <View testID={testID} className="invisible" onTouchEnd={onTouchEnd} />,
  );
  const component = screen.getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    visibility: "hidden",
    opacity: 0,
    pointerEvents: "none",
  });
});

test("visibility: collapse behaves as hidden", () => {
  // A browser collapses the row/column of a table, or — outside a table, which
  // is every case React Native has — falls back to `hidden`. The approximation
  // is therefore the same pair `hidden` gets, while the passed-through
  // `visibility` keeps the keyword the author wrote.
  const compiled = registerCSS(`.collapsed { visibility: collapse; }`);

  render(<View testID={testID} className="collapsed" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    visibility: "collapse",
    opacity: 0,
    pointerEvents: "none",
  });
  expect(compiled.warnings()).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * Stacking
 * ---------------------------------------------------------------------- */

test("z-index applies without a position — a browser would ignore it", () => {
  // In CSS, `z-index` only affects a positioned element (or a flex/grid item).
  // On a statically positioned box a browser ignores it outright. Native
  // forwards it to React Native, which honours `zIndex` on any view, so the
  // same stylesheet produces a different paint order per platform.
  const compiled = registerCSS(`.raised { z-index: 5; }`);

  render(<View testID={testID} className="raised" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({ zIndex: 5 });
  expect(compiled.warnings()).toStrictEqual({});
});

test("z-index: auto is dropped rather than treated as the initial value", () => {
  // `z-index: auto` is the CSS initial value and is how a stylesheet undoes an
  // earlier `z-index`. On native it warns and emits nothing, so the earlier
  // value keeps winning.
  const compiled = registerCSS(`.unraised { z-index: auto; }`);

  render(<View testID={testID} className="unraised" />);

  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });
  expect(compiled.warnings()).toStrictEqual({
    values: { "z-index": ["auto"] },
  });
});

/* -------------------------------------------------------------------------
 * Paint — shadow, filter, gradient
 * ---------------------------------------------------------------------- */

test("box-shadow compiles to React Native's boxShadow object, inset included", () => {
  // Parity holds here: the compiler expands the shorthand into the structured
  // form React Native 0.76+ accepts, rather than the legacy
  // shadowColor/shadowOffset keys.
  registerCSS(
    `.shadowed { box-shadow: 1px 2px 3px 4px red, inset 0 0 2px blue; }`,
  );

  render(<View testID={testID} className="shadowed" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    boxShadow: [
      {
        color: "#f00",
        offsetX: 1,
        offsetY: 2,
        blurRadius: 3,
        spreadDistance: 4,
      },
      {
        color: "#00f",
        offsetX: 0,
        offsetY: 0,
        blurRadius: 2,
        spreadDistance: 0,
        inset: true,
      },
    ],
  });
});

test("filter functions compile, but filter: url() silently produces an empty list", () => {
  // A browser applies the referenced SVG filter. Native drops the `url()`
  // entry and emits `filter: []` — an empty array, with no warning, so a
  // stylesheet that filters only through `url()` reports nothing at all.
  const blur = registerCSS(`.blurred { filter: blur(4px); }`);
  const url = registerCSS(`.svg-filtered { filter: url(#duotone); }`);

  render(<View testID={testID} className="blurred" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    filter: [{ blur: 4 }],
  });
  screen.unmount();

  render(<View testID={testID} className="svg-filtered" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({ filter: [] });

  expect(blur.warnings()).toStrictEqual({});
  expect(url.warnings()).toStrictEqual({});
});

test("backdrop-filter is an unknown property", () => {
  // A browser blurs whatever is painted behind the element — the standard
  // frosted-glass overlay. Native drops it, so the overlay renders flat.
  const compiled = registerCSS(`.frosted { backdrop-filter: blur(10px); }`);

  render(<View testID={testID} className="frosted" />);

  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });
  expect(compiled.warnings()).toStrictEqual({
    properties: ["backdrop-filter"],
  });
});

test("linear and radial gradients compile; conic and repeating drop, loudly", () => {
  // A browser paints all four. React Native implements `linear-gradient` and
  // `radial-gradient` and neither of the other two, so those two compile to the
  // CSS string `processBackgroundImage` reads and the other two to no style at
  // all — with a warning, so a build-time report can tell "no gradient was
  // written" from "the gradient was discarded".
  const linear = registerCSS(
    `.lin { background-image: linear-gradient(red, blue); }`,
  );
  const radial = registerCSS(
    `.rad { background-image: radial-gradient(red, blue); }`,
  );
  const conic = registerCSS(
    `.con { background-image: conic-gradient(red, blue); }`,
  );
  const repeating = registerCSS(
    `.rep { background-image: repeating-linear-gradient(red, blue 20px); }`,
  );

  render(<View testID={testID} className="lin" />);
  const linearStyle = screen.getByTestId(testID).props.style as Record<
    string,
    unknown
  >;
  expect(linearStyle).toStrictEqual({
    experimental_backgroundImage: "linear-gradient(to bottom, #f00, #00f)",
  });
  expect(
    processBackgroundImage(linearStyle.experimental_backgroundImage),
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
  screen.unmount();

  render(<View testID={testID} className="rad" />);
  const radialStyle = screen.getByTestId(testID).props.style as Record<
    string,
    unknown
  >;
  expect(radialStyle).toStrictEqual({
    experimental_backgroundImage:
      "radial-gradient(ellipse farthest-corner at center center, #f00, #00f)",
  });
  expect(
    processBackgroundImage(radialStyle.experimental_backgroundImage),
  ).toStrictEqual([
    {
      type: "radial-gradient",
      shape: "ellipse",
      size: "farthest-corner",
      position: { top: "50%", left: "50%" },
      colorStops: [
        { color: processColor("red"), position: null },
        { color: processColor("blue"), position: null },
      ],
    },
  ]);
  screen.unmount();

  // A browser paints both of these. React Native's parser does not know either
  // family and answers an empty list — so the divergence is real, and it is a
  // gap in the TARGET rather than in the compile: the CSS is emitted exactly as
  // written, and the empty answer below is what makes emitting it safe.
  for (const className of ["con", "rep"]) {
    render(<View testID={testID} className={className} />);
    const emitted = screen.getByTestId(testID).props.style as {
      experimental_backgroundImage: string;
    };

    expect(
      processBackgroundImage(emitted.experimental_backgroundImage),
    ).toStrictEqual([]);
    screen.unmount();
  }

  expect(linear.warnings()).toStrictEqual({});
  expect(radial.warnings()).toStrictEqual({});
  expect(conic.warnings()).toStrictEqual({
    values: { "background-image": ["conic-gradient()"] },
  });
  expect(repeating.warnings()).toStrictEqual({
    values: { "background-image": ["repeating-linear-gradient()"] },
  });
});

test("background-image: url() drops silently", () => {
  // A browser fetches and paints the image. Native compiles the declaration to
  // nothing and says nothing about it; a background image has to be a real
  // <Image> instead. `url()` is the one dropped `background-image` value with no
  // warning, because it is an image SOURCE rather than a gradient family.
  const compiled = registerCSS(`.bg-img { background-image: url(hero.png); }`);

  render(<View testID={testID} className="bg-img" />);

  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });
  expect(compiled.warnings()).toStrictEqual({});
});

test("the `background` shorthand is unknown even though `background-color` works", () => {
  // `background: #fff` is the single most ordinary way to set a background in
  // hand-written CSS, and a browser treats it as exactly equivalent to
  // `background-color: #fff`. Native only implements the longhand, so the
  // shorthand form paints nothing.
  const shorthand = registerCSS(`.bg-short { background: red; }`);
  const longhand = registerCSS(`.bg-long { background-color: red; }`);

  render(<View testID={testID} className="bg-short" />);
  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });
  screen.unmount();

  render(<View testID={testID} className="bg-long" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    backgroundColor: "#f00",
  });

  expect(shorthand.warnings()).toStrictEqual({ properties: ["background"] });
  expect(longhand.warnings()).toStrictEqual({});
});

test("background-position, -size and -repeat are unknown properties", () => {
  // These are the knobs that make a web background usable. None exist natively.
  const position = registerCSS(`.bp { background-position: center; }`);
  const size = registerCSS(`.bs { background-size: cover; }`);
  const repeat = registerCSS(`.br { background-repeat: no-repeat; }`);

  expect(position.warnings()).toStrictEqual({
    properties: ["background-position"],
  });
  expect(size.warnings()).toStrictEqual({ properties: ["background-size"] });
  expect(repeat.warnings()).toStrictEqual({
    properties: ["background-repeat"],
  });
});

test("the outline shorthand agrees with its longhands, as on web", () => {
  // The trap this used to be: `outline-color` on its own compiled, but
  // lightningcss merges a complete set of longhands back into the `outline`
  // shorthand, which had no parser — so spelling out all three lost ALL of
  // them while spelling out one kept it. A browser sees no difference between
  // the two forms, and now neither does this.
  const one = registerCSS(`.outline-one { outline-color: red; }`);
  const all = registerCSS(`
    .outline-all {
      outline-width: 1px;
      outline-style: solid;
      outline-color: red;
    }
  `);

  render(<View testID={testID} className="outline-one" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    outlineColor: "#f00",
  });
  screen.unmount();

  render(<View testID={testID} className="outline-all" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    outlineColor: "#f00",
    outlineStyle: "solid",
    outlineWidth: 1,
  });

  expect(one.warnings()).toStrictEqual({});
  expect(all.warnings()).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * Text
 * ---------------------------------------------------------------------- */

test("white-space and text-overflow are unknown properties", () => {
  // `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` is THE
  // web truncation idiom. On native only the `overflow: hidden` survives, so
  // the text wraps instead of being truncated. React Native expresses this
  // through the `numberOfLines` prop, reachable via `-webkit-line-clamp`.
  const compiled = registerCSS(`
    .truncate {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `);

  render(
    <Text testID={testID} className="truncate">
      hello
    </Text>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    overflow: "hidden",
  });
  expect(compiled.warnings()).toStrictEqual({
    properties: ["white-space", "text-overflow"],
  });
});

test("-webkit-line-clamp is the native truncation route and becomes a prop", () => {
  // The one place native goes further than the CSS: `-webkit-line-clamp` maps
  // onto React Native's `numberOfLines` prop rather than a style key.
  registerCSS(`.clamped { -webkit-line-clamp: 2; }`);

  render(
    <Text testID={testID} className="clamped">
      hello
    </Text>,
  );

  expect(screen.getByTestId(testID).props.numberOfLines).toBe(2);
});

test("word-break, overflow-wrap, hyphens and text-indent are unknown properties", () => {
  // Everything a browser uses to control how a long word breaks. None reach
  // native, so an unbreakable string overflows its container instead.
  const wordBreak = registerCSS(`.wb { word-break: break-all; }`);
  const overflowWrap = registerCSS(`.ow { overflow-wrap: break-word; }`);
  const hyphens = registerCSS(`.hy { hyphens: auto; }`);
  const textIndent = registerCSS(`.ti { text-indent: 2em; }`);

  expect(wordBreak.warnings()).toStrictEqual({ properties: ["word-break"] });
  expect(overflowWrap.warnings()).toStrictEqual({
    properties: ["overflow-wrap"],
  });
  expect(hyphens.warnings()).toStrictEqual({ properties: ["hyphens"] });
  expect(textIndent.warnings()).toStrictEqual({ properties: ["text-indent"] });
});

test("text-align: start and end map onto React Native's own logical pair", () => {
  // A browser resolves `start`/`end` against the writing direction. React
  // Native's allow-list is spelled with the physical words, but `left` and
  // `right` are ALREADY logical there — Android resolves `right` to
  // `ALIGN_OPPOSITE` and iOS swaps the pair when the layout direction is RTL —
  // so this is an exact mapping rather than an LTR-only approximation, and it
  // needs no `I18nManager` swap on top (which would double-flip).
  const start = registerCSS(`.align-start { text-align: start; }`);
  const end = registerCSS(`.align-end { text-align: end; }`);

  render(
    <Text testID={testID} className="align-start">
      hi
    </Text>,
  );
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    textAlign: "left",
  });

  // A logical value that maps exactly is not a narrowing, so neither warns.
  expect(start.warnings()).toStrictEqual({});
  expect(end.warnings()).toStrictEqual({});
});

test("a font-family fallback list collapses to its first entry", () => {
  // A browser walks the list until it finds an installed face. Native keeps
  // only the first name and passes it to the platform, so the carefully
  // ordered fallback stack is not a fallback at all — if that one face is
  // missing the platform substitutes its own default.
  registerCSS(`.stack { font-family: Inter, Helvetica, Arial, sans-serif; }`);

  render(
    <Text testID={testID} className="stack">
      hi
    </Text>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    fontFamily: "Inter",
  });
});

test("text-decoration-thickness and text-underline-offset are unknown properties", () => {
  // The line itself compiles; how thick it is and where it sits do not.
  const thickness = registerCSS(`.tdt { text-decoration-thickness: 2px; }`);
  const offset = registerCSS(`.tuo { text-underline-offset: 3px; }`);
  const line = registerCSS(`.tdl { text-decoration-line: underline; }`);

  render(
    <Text testID={testID} className="tdl">
      hi
    </Text>,
  );
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    textDecorationLine: "underline",
  });

  expect(thickness.warnings()).toStrictEqual({
    properties: ["text-decoration-thickness"],
  });
  expect(offset.warnings()).toStrictEqual({
    properties: ["text-underline-offset"],
  });
  expect(line.warnings()).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * Interaction
 * ---------------------------------------------------------------------- */

test(":hover attaches hover handlers rather than being resolved by the platform", () => {
  // In a browser `:hover` costs nothing — the engine tracks the pointer. On
  // native the runtime has to synthesise it, so the element grows
  // `onHoverIn`/`onHoverOut` props. Those only fire where React Native reports
  // hover (web, desktop, a mouse-attached tablet); on a touch handset the
  // branch is unreachable and the hover style never applies.
  registerCSS(`
    .hoverable { color: red; }
    .hoverable:hover { color: blue; }
  `);

  render(<View testID={testID} className="hoverable" />);
  const component = screen.getByTestId(testID);

  expect(component.props).toStrictEqual({
    testID,
    children,
    onHoverIn: expect.any(Function),
    onHoverOut: expect.any(Function),
    style: { color: "#f00" },
  });
});

test(":active turns a plain View into a press responder and an accessibility target", () => {
  // In a browser `:active` is purely visual and changes nothing about the
  // element's semantics. On native the runtime has to observe presses, so it
  // installs the whole responder chain AND marks the View `accessible` and
  // `focusable`. A decorative `<View>` that only wanted an active-state colour
  // becomes a focus stop for a screen reader and starts capturing touches that
  // would otherwise reach whatever is underneath.
  registerCSS(`
    .pressable { color: red; }
    .pressable:active { color: blue; }
  `);

  render(<View testID={testID} className="pressable" />);
  const component = screen.getByTestId(testID);

  expect(component.props.accessible).toBe(true);
  expect(component.props.focusable).toBe(true);
  expect(component.props.onStartShouldSetResponder).toEqual(
    expect.any(Function),
  );
  expect(component.props.onResponderGrant).toEqual(expect.any(Function));
  expect(component.props.style).toStrictEqual({ color: "#f00" });
});

test(":focus attaches focus handlers", () => {
  // Parity is reasonable here — the handlers exist, and blur/focus are real
  // React Native events.
  registerCSS(`
    .focusable { color: red; }
    .focusable:focus { color: blue; }
  `);

  render(<View testID={testID} className="focusable" />);
  const component = screen.getByTestId(testID);

  expect(component.props).toStrictEqual({
    testID,
    children,
    onBlur: expect.any(Function),
    onFocus: expect.any(Function),
    style: { color: "#f00" },
  });

  act(() => {
    fireEvent(component, "focus");
  });

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#00f",
  });
});

test(":focus-visible and :focus-within are dropped silently", () => {
  // `:focus-visible` is how a browser shows a focus ring to keyboard users
  // without flashing it on every mouse click, and `:focus-within` is how a
  // form field highlights its wrapper. Neither is implemented: the rule is
  // discarded during selector parsing, so there is no style AND no warning.
  const compiled = registerCSS(`
    .fv { color: red; }
    .fv:focus-visible { color: blue; }
    .fv:focus-within { color: green; }
  `);

  render(<View testID={testID} className="fv" />);

  expect(screen.getByTestId(testID).props).toStrictEqual({
    testID,
    children,
    style: { color: "#f00" },
  });
  expect(compiled.warnings()).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * Selectors
 * ---------------------------------------------------------------------- */

test("structural pseudo-classes are dropped silently", () => {
  // `:first-child`, `:last-child` and `:nth-child()` are how a browser styles
  // list separators and zebra striping. The whole rule is discarded — no
  // style, and `warnings()` is empty, so nothing at build time records it.
  const compiled = registerCSS(`
    .row { color: red; }
    .row:first-child { color: blue; }
    .row:last-child { color: green; }
    .row:nth-child(2n) { color: yellow; }
  `);

  render(<View testID={testID} className="row" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });
  expect(compiled.warnings()).toStrictEqual({});
});

test(":not() and :checked resolve from props; :has() is dropped silently", () => {
  // `:not()` and `:checked` each reduce to a question about the element's own
  // props — the class list and the `checked` prop — which the runtime answers,
  // so both agree with a browser. `:has()` is an upward query, a parent styled
  // from its descendants, while styles here resolve from each component's own
  // props plus context flowing DOWN; the rule is discarded during selector
  // parsing with no style and no warning to record that it was written.
  const compiled = registerCSS(`
    .item { color: red; }
    .item:not(.selected) { color: blue; }
    .item:has(.badge) { color: green; }
    .item:checked { color: yellow; }
  `);

  render(<View testID={testID} className="item" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#00f",
  });
  screen.unmount();

  // Adding the class the negation excludes falls back to the base rule.
  render(<View testID={testID} className="item selected" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });
  screen.unmount();

  render(<View testID={testID} className="item" {...{ checked: true }} />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#ff0",
  });

  // The `:has()` rule contributes to none of the three, and reaches no warning.
  expect(compiled.warnings()).toStrictEqual({});
});

test("child and sibling combinators are dropped; only descendant survives", () => {
  // `.parent .child` compiles into a container query and works. `>`, `+` and
  // `~` do not — the rules are discarded with no warning, so a stylesheet that
  // tightened a descendant rule into a child rule loses it entirely.
  const compiled = registerCSS(`
    .parent .descendant-child { color: red; }
    .parent > .direct-child { color: blue; }
    .sibling + .adjacent-child { color: green; }
    .sibling ~ .general-child { color: yellow; }
  `);

  render(
    <View testID="parent" className="parent">
      <View testID={testID} className="descendant-child direct-child" />
    </View>,
  );

  // The descendant rule applied; the child-combinator rule did not.
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });
  expect(compiled.warnings()).toStrictEqual({});
});

test("id and type selectors are dropped silently", () => {
  // react-native-web renders a `View` as a `div`, so `div.card` and `#main`
  // both match in a browser — which is why a global reset stylesheet works on
  // web. On native there are no element names and no ids to match, and the
  // rules vanish without a warning.
  const compiled = registerCSS(`
    .card { color: red; }
    div.card { color: blue; }
    #main.card { color: green; }
  `);

  render(<View testID={testID} className="card" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });
  expect(compiled.warnings()).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * Pseudo-elements
 * ---------------------------------------------------------------------- */

test("::before and ::after are dropped — there is no generated content on native", () => {
  // A browser inserts a generated box. Native has no such concept, so the
  // whole rule is discarded at selector parsing. `content` warns because the
  // declaration is parsed before the selector is rejected; the colour beside
  // it does NOT leak onto the host element.
  const compiled = registerCSS(`
    .badged { color: red; }
    .badged::before { content: "•"; color: blue; }
    .badged::after { content: "›"; }
  `);

  render(<View testID={testID} className="badged" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });
  expect(compiled.warnings()).toStrictEqual({
    properties: ["content", "content"],
  });
});

test("::first-line, ::first-letter and ::marker are dropped silently", () => {
  // A browser styles the fragment. Native discards the rule with no warning at
  // all — not even the `content`-style diagnostic ::before gets.
  const compiled = registerCSS(`
    .prose::first-line { color: blue; }
    .prose::first-letter { color: green; }
    .prose::marker { color: yellow; }
  `);

  render(<View testID={testID} className="prose" />);

  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });
  expect(compiled.warnings()).toStrictEqual({});
});

test("::placeholder and ::selection are re-routed onto React Native props", () => {
  // The two pseudo-elements native DOES model. Rather than a style key, the
  // colour becomes a component prop — `placeholderTextColor` and
  // `selectionColor`. Note the rewrite is unconditional: it lands on a plain
  // `View`, which has no use for either.
  registerCSS(`.field::placeholder { color: blue; }`);
  registerCSS(`.selectable::selection { color: green; }`);

  render(<View testID={testID} className="field" />);
  expect(screen.getByTestId(testID).props.placeholderTextColor).toBe("#00f");
  screen.unmount();

  render(<View testID={testID} className="selectable" />);
  expect(screen.getByTestId(testID).props.selectionColor).toBe("#008000");
});

/* -------------------------------------------------------------------------
 * At-rules
 * ---------------------------------------------------------------------- */

test("@media (hover: hover) and @media (hover: none) are mutually exclusive", () => {
  // PARITY GAP, deliberate: a mobile browser answers `hover: none`, so a
  // `hover:`-prefixed utility is dead CSS there. React Native synthesises hover
  // through Pressability on every platform, so this answers `hover` and those
  // utilities work — see `hover` in src/native/conditions/media-query.ts.
  //
  // What IS shared with the browser is that the two are complements. They used
  // to both match, because the feature ignored the value asked for, and a
  // stylesheet written as "hover-capable gets X, touch-only gets Y" collapsed
  // into "everything gets Y".
  registerCSS(`@media (hover: hover) { .hover-capable { color: red; } }`);
  registerCSS(`@media (hover: none) { .touch-only { color: blue; } }`);

  render(<View testID={testID} className="hover-capable" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });
  screen.unmount();

  render(<View testID={testID} className="touch-only" />);
  expect(screen.getByTestId(testID).props.style).toBeUndefined();
});

test("@media (prefers-reduced-motion) answers the OS setting", () => {
  // The accessibility escape hatch, and the feature behind every
  // `motion-reduce:` / `motion-safe:` utility. Both directions are live: the
  // preference is off in this environment, so the `no-preference` block
  // applies and the `reduce` block does not. Evaluating false in BOTH
  // directions — which is what an unimplemented feature does — is worse than
  // an error, because the utilities compile cleanly and simply never fire.
  registerCSS(
    `@media (prefers-reduced-motion: reduce) { .rm-reduce { color: red; } }`,
  );
  registerCSS(
    `@media (prefers-reduced-motion: no-preference) { .rm-none { color: blue; } }`,
  );

  render(<View testID={testID} className="rm-reduce rm-none" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#00f",
  });
});

test("the input-capability features answer; prefers-contrast and forced-colors still do not", () => {
  // `pointer` and `any-hover` describe the input mechanism, which native knows:
  // a touch screen is coarse, and hover is synthesised (above), so `any-hover`
  // agrees with `hover`. Both used to match nothing at all, which contradicted
  // the `hover` feature sitting beside them.
  registerCSS(`@media (pointer: coarse) { .pt-coarse { color: red; } }`);
  registerCSS(`@media (any-hover: hover) { .any-hover { color: blue; } }`);

  render(<View testID={testID} className="pt-coarse" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });
  screen.unmount();

  render(<View testID={testID} className="any-hover" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#00f",
  });
  screen.unmount();

  // GAP: these two remain dead — silently, with no warning. `prefers-contrast`
  // is answerable from `AccessibilityInfo` (Android's
  // `isHighTextContrastEnabled`, iOS's `isDarkerSystemColorsEnabled`);
  // `forced-colors` has no React Native equivalent, so `active` never matching
  // is correct and only `none` is wrong.
  registerCSS(
    `@media (prefers-contrast: more) { .contrast { color: green; } }`,
  );
  registerCSS(`@media (forced-colors: active) { .forced { color: yellow; } }`);

  render(<View testID={testID} className="contrast forced" />);
  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });
});

test("aspect-ratio agrees with web", () => {
  // `aspect-ratio` was not implemented, and unlike `pointer` above it did not
  // fail closed — the condition disappeared and the block applied always. Both
  // of these are impossible at the test viewport (375x667) and a browser
  // applies neither; native applied both. The failure DIRECTION differing
  // between unknown features was worse than either direction on its own.
  registerCSS(`@media (min-aspect-ratio: 100/1) { .ar-tall { color: red; } }`);
  registerCSS(`@media (max-aspect-ratio: 1/100) { .ar-wide { color: blue; } }`);

  render(<View testID={testID} className="ar-tall" />);
  expect(screen.getByTestId(testID).props.style).toBeUndefined();
  screen.unmount();

  render(<View testID={testID} className="ar-wide" />);
  expect(screen.getByTestId(testID).props.style).toBeUndefined();
  screen.unmount();

  // ...and a ratio the viewport DOES satisfy applies, so this is measuring the
  // feature rather than a blanket refusal.
  registerCSS(`@media (min-aspect-ratio: 1/100) { .ar-ok { color: red; } }`);
  render(<View testID={testID} className="ar-ok" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });
});

test("@supports agrees with web where React Native has the feature", () => {
  // `@supports (display: flex)` is true in every browser shipped this decade,
  // so on web the block applies and the `not` form does not. Native used to
  // invert BOTH — the feature test answered false for everything except one
  // hard-coded `color-mix` probe — so progressive enhancement written this way
  // landed on the fallback branch, and any `@supports not (…)` guard, dead code
  // on web, became live.
  //
  // The remaining divergence is real rather than accidental: `display: grid` IS
  // supported on web and is not here, so the `not (display: grid)` branch is
  // live on native and dead on web. That is `@supports` doing its job.
  const positive = registerCSS(
    `@supports (display: flex) { .sup-yes { color: red; } }`,
  );
  const negative = registerCSS(
    `@supports not (display: grid) { .sup-no { color: blue; } }`,
  );
  const colorMix = registerCSS(
    `@supports (color: color-mix(in lab, red, red)) { .sup-mix { color: green; } }`,
  );

  render(<View testID={testID} className="sup-yes" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });
  screen.unmount();

  render(<View testID={testID} className="sup-no" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#00f",
  });
  screen.unmount();

  render(<View testID={testID} className="sup-mix" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#008000",
  });

  expect(positive.warnings()).toStrictEqual({});
  expect(negative.warnings()).toStrictEqual({});
  expect(colorMix.warnings()).toStrictEqual({});
});

/* -------------------------------------------------------------------------
 * Transitions & animations
 * ---------------------------------------------------------------------- */

test("a transition on a discrete property compiles but has nothing to interpolate", () => {
  // `transition: visibility 1s` is how a browser delays a hide so a fade can
  // finish. Native has already rewritten `visibility` to `opacity` PLUS
  // `pointerEvents`, so what actually transitions is the opacity — a different
  // property than the one written, which happens to look similar here and will
  // not for `transition: display`. The `pointerEvents` half is discrete and
  // flips at once, which is what a browser does with `visibility` too. The
  // passed-through `visibility` key is inert in React Native, so it is not what
  // interpolates either.
  registerCSS(`.fade-out { transition: visibility 1s; visibility: hidden; }`);

  render(<View testID={testID} className="fade-out" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    visibility: "hidden",
    opacity: 0,
    pointerEvents: "none",
  });
});

test("transition-behavior is an unknown property", () => {
  // `allow-discrete` is how a browser transitions `display`/`overlay` for
  // entry and exit animations. Native drops it.
  const compiled = registerCSS(
    `.discrete { transition-behavior: allow-discrete; }`,
  );

  render(<View testID={testID} className="discrete" />);

  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });
  expect(compiled.warnings()).toStrictEqual({
    properties: ["transition-behavior"],
  });
});

test("a transitioned element opts out of view flattening", () => {
  // Parity note rather than a gap: transitions and animations run through
  // Reanimated, which needs a real host view, so the runtime sets
  // `collapsable: false`. A browser needs no equivalent — and the extra view
  // is a native-only cost that a `transition` on a large list pays per row.
  registerCSS(`.tinted { transition: color 1s; color: red; }`);

  render(<View testID={testID} className="tinted" />);

  expect(screen.getByTestId(testID).props.collapsable).toBe(false);
});

/* -------------------------------------------------------------------------
 * Values, units and functions
 * ---------------------------------------------------------------------- */

test("calc() mixing a percentage with a length drops silently", () => {
  // `calc(100% - 32px)` is the standard "full width minus the gutter" and a
  // browser resolves it at layout. React Native cannot express it, so the
  // declaration produces no style — and, unlike an unsupported property, no
  // warning either. Pure-length calc still works.
  const percent = registerCSS(`.calc-percent { width: calc(100% - 32px); }`);
  const length = registerCSS(`.calc-length { width: calc(10px + 5px); }`);

  render(<View testID={testID} className="calc-percent" />);
  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });
  screen.unmount();

  render(<View testID={testID} className="calc-length" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 15 });

  expect(percent.warnings()).toStrictEqual({});
  expect(length.warnings()).toStrictEqual({});
});

test("color: inherit resolves through the inherited-colour variable; initial is dropped", () => {
  // `color: inherit` takes the parent's colour, and there is a mechanism for
  // exactly that: every colour rule publishes `--__rn-css-color` for its
  // subtree, which is the same variable `currentcolor` reads. css-color-4
  // makes the two identical on `color`, so `inherit` resolves through it
  // rather than being dropped.
  //
  // `initial` has no such answer — it resets to the UA value, and React Native
  // has no UA stylesheet to reset to — so it stays a reported drop.
  const inherit = registerCSS(
    `.inherit-color { color: inherit; } .current-color { color: currentcolor; }`,
  );
  const initial = registerCSS(`.initial-color { color: initial; }`);

  // Compared against `currentcolor` rather than a literal, because the literal
  // is whatever the root seed seeds — a PlatformColor on iOS, a hex on Android.
  // The claim is the identity, and asserting the identity is what makes this
  // test say the same thing on both platforms.
  render(<View testID={testID} className="inherit-color" />);
  const inherited = screen.getByTestId(testID).props.style;
  screen.unmount();

  render(<View testID={testID} className="current-color" />);
  expect(inherited).toStrictEqual(screen.getByTestId(testID).props.style);

  expect(inherit.warnings()).toStrictEqual({});
  expect(initial.warnings()).toStrictEqual({ values: { color: ["initial"] } });
});

test("the revert and revert-layer keywords are dropped with a warning", () => {
  // A browser rolls the property back to the previous cascade origin, or to the
  // previous layer. Native has neither to roll back to, so both are dropped and
  // reported exactly as `inherit` and `initial` are. Falling through as its own
  // text put the string `"revert"` on the element as if it were a colour — a
  // value React Native cannot parse, reaching the platform unannounced.
  const revert = registerCSS(`.reverted { color: revert; }`);

  render(<View testID={testID} className="reverted" />);
  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });
  expect(revert.warnings()).toStrictEqual({ values: { color: ["revert"] } });
  screen.unmount();

  const revertLayer = registerCSS(`.reverted-layer { color: revert-layer; }`);

  render(<View testID={testID} className="reverted-layer" />);
  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });
  expect(revertLayer.warnings()).toStrictEqual({
    values: { color: ["revert-layer"] },
  });
});

test("ch and vmin units are dropped while vw, vh, em and rem resolve", () => {
  // A browser computes all six. Native resolves the four it models against
  // the window and the font size, and warns on the other two.
  const ch = registerCSS(`.ch-width { width: 2ch; }`);
  const vmin = registerCSS(`.vmin-width { width: 50vmin; }`);
  const vw = registerCSS(`.vw-width { width: 50vw; }`);

  render(<View testID={testID} className="vw-width" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({ width: 375 });

  expect(ch.warnings()).toStrictEqual({ values: { width: ["2ch"] } });
  expect(vmin.warnings()).toStrictEqual({ values: { width: ["50vmin"] } });
  expect(vw.warnings()).toStrictEqual({});
});

test("intrinsic sizing keywords are dropped", () => {
  // `width: fit-content` and `min-content` are how a browser sizes a box to
  // its contents. Native drops them, so the element keeps its flex-derived
  // size instead.
  const fit = registerCSS(`.fit { width: fit-content; }`);
  const min = registerCSS(`.min-c { width: min-content; }`);

  render(<View testID={testID} className="fit" />);
  expect(screen.getByTestId(testID).props).toStrictEqual({ testID, children });

  expect(fit.warnings()).toStrictEqual({ values: { width: ["fit-content"] } });
  expect(min.warnings()).toStrictEqual({ values: { width: ["min-content"] } });
});

test("border styles beyond solid/dotted/dashed are dropped", () => {
  // A browser draws `double`, `groove`, `ridge`, `inset` and `outset`. Native
  // keeps the width and colour of the shorthand but discards the style, so a
  // `double` border silently renders as React Native's default solid line.
  const compiled = registerCSS(`.doubled { border: 1px double red; }`);

  render(<View testID={testID} className="doubled" />);

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    borderWidth: 1,
    borderColor: "#f00",
  });
  expect(compiled.warnings()).toStrictEqual({ values: { border: ["double"] } });
});

/* -------------------------------------------------------------------------
 * Properties with no native model at all
 * ---------------------------------------------------------------------- */

test("scroll and touch behaviour properties are all unknown", () => {
  // `touch-action`, `overscroll-behavior` and `scroll-behavior` are how a web
  // app stops pull-to-refresh, contains scroll chaining, and opts into smooth
  // scrolling. On native each of those is a component prop on ScrollView, not
  // a style, so none of the CSS reaches anything.
  const touch = registerCSS(`.ta { touch-action: none; }`);
  const overscroll = registerCSS(`.ob { overscroll-behavior: contain; }`);
  const scroll = registerCSS(`.sb { scroll-behavior: smooth; }`);

  expect(touch.warnings()).toStrictEqual({ properties: ["touch-action"] });
  expect(overscroll.warnings()).toStrictEqual({
    properties: ["overscroll-behavior"],
  });
  expect(scroll.warnings()).toStrictEqual({ properties: ["scroll-behavior"] });
});

test("appearance, resize, will-change and content are unknown properties", () => {
  const appearance = registerCSS(`.ap { appearance: none; }`);
  const resize = registerCSS(`.rs { resize: both; }`);
  const willChange = registerCSS(`.wc { will-change: transform; }`);
  const content = registerCSS(`.ct { content: "x"; }`);

  expect(appearance.warnings()).toStrictEqual({ properties: ["appearance"] });
  expect(resize.warnings()).toStrictEqual({ properties: ["resize"] });
  expect(willChange.warnings()).toStrictEqual({ properties: ["will-change"] });
  expect(content.warnings()).toStrictEqual({ properties: ["content"] });
});

test("transform-style and the standalone perspective property are dropped, but transform: perspective() works", () => {
  // `perspective` + `transform-style: preserve-3d` on a parent is how a
  // browser builds a 3D scene. Native models perspective only as a transform
  // FUNCTION on the transformed element itself, so the parent-driven form is
  // lost.
  const style = registerCSS(`.scene { transform-style: preserve-3d; }`);
  const property = registerCSS(`.depth { perspective: 100px; }`);
  const fn = registerCSS(`.card-3d { transform: perspective(100px); }`);

  render(<View testID={testID} className="card-3d" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    transform: [{ perspective: 100 }],
  });

  expect(style.warnings()).toStrictEqual({ properties: ["transform-style"] });
  expect(property.warnings()).toStrictEqual({ properties: ["perspective"] });
  expect(fn.warnings()).toStrictEqual({});
});

test("list-style, border-collapse and writing-mode are unknown properties", () => {
  // The document-layout family. A browser has lists, tables and vertical
  // writing modes; React Native has none of the three.
  const list = registerCSS(`.ls { list-style: none; }`);
  const table = registerCSS(`.bc { border-collapse: collapse; }`);
  const writing = registerCSS(`.wm { writing-mode: vertical-rl; }`);

  expect(list.warnings()).toStrictEqual({ properties: ["list-style"] });
  expect(table.warnings()).toStrictEqual({ properties: ["border-collapse"] });
  expect(writing.warnings()).toStrictEqual({ properties: ["writing-mode"] });
});
