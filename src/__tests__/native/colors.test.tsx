import { processColor, StyleSheet } from "react-native";

import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { colorScheme } from "react-native-css/runtime";

describe("hsl", () => {
  test("inline", () => {
    registerCSS(`.my-class { color: hsl(0 84.2% 60.2%); }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.type).toBe("View");
    expect(component.props).toStrictEqual({
      children: undefined,
      style: { color: "#ef4444" },
      testID,
    });
  });

  test("inline with comma", () => {
    registerCSS(`.my-class {
      color: hsl(0, 84.2%, 60.2%);
    }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.type).toBe("View");
    expect(component.props).toStrictEqual({
      children: undefined,
      style: { color: "#ef4444" },
      testID,
    });
  });

  test("var with spaces", () => {
    registerCSS(`.my-class {
      --primary: 0 84.2% 60.2%;
      color: hsl(var(--primary));
    }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.type).toBe("View");
    expect(component.props).toStrictEqual({
      children: undefined,
      style: { color: "#ef4444" },
      testID,
    });
  });

  test("var with comma", () => {
    registerCSS(`.my-class {
        --primary: 0, 84.2%, 60.2%;
        color: hsl(var(--primary));
      }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.type).toBe("View");
    expect(component.props).toStrictEqual({
      children: undefined,
      style: { color: "#ef4444" },
      testID,
    });
  });
});

describe("hsla", () => {
  test("inline with slash", () => {
    registerCSS(`.my-class {
      color: hsla(0 84.2% 60.2% / 60%);
    }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.type).toBe("View");
    expect(component.props).toStrictEqual({
      children: undefined,
      style: { color: "#ef444499" },
      testID,
    });
  });

  test("inline with comma", () => {
    registerCSS(`.my-class {
      color: hsla(0, 84.2%, 60.2%, 60%);
    }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.type).toBe("View");
    expect(component.props).toStrictEqual({
      children: undefined,
      style: { color: "#ef444499" },
      testID,
    });
  });

  test("function with slash", () => {
    registerCSS(`.my-class {
      --primary: 0 84.2% 60.2% / 60%;
      color: hsla(var(--primary));
    }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.type).toBe("View");
    expect(component.props).toStrictEqual({
      children: undefined,
      style: { color: "#ef444499" },
      testID,
    });
  });

  test("function with comma", () => {
    registerCSS(`.my-class {
      --primary: 0, 84.2%, 60.2%, 60%;
      color: hsla(var(--primary));
    }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.type).toBe("View");
    expect(component.props).toStrictEqual({
      children: undefined,
      style: { color: "#ef444499" },
      testID,
    });
  });
});

describe("unresolved alpha", () => {
  test("rgb with number channels", () => {
    registerCSS(`.my-class {
      background-color: rgb(255 0 0 / var(--a, 0.5));
    }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.props.style).toStrictEqual({
      backgroundColor: "rgba(255, 0, 0, 0.5)",
    });
  });

  test("rgb with percentage channels", () => {
    registerCSS(`.my-class {
      background-color: rgb(50% 25% 10% / var(--a, 0.5));
    }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.props.style).toStrictEqual({
      backgroundColor: "rgba(128, 64, 26, 0.5)",
    });
  });

  // The resolved path compiles the same channels to `#ef4444`, and React Native
  // rejects both `hsl()` carrying an alpha and `hsla()` missing one.
  test("hsl resolves to the same channels as the resolved path", () => {
    registerCSS(`.my-class {
      background-color: hsl(0 84.2% 60.2% / var(--a, 0.5));
    }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.props.style).toStrictEqual({
      backgroundColor: "rgba(239, 68, 68, 0.5)",
    });
  });

  // lightningcss clamps saturation, lightness and every rgb channel, so the hue
  // is the only channel an out-of-range `calc()` reaches the compiler through.
  // It arrives as a 32-bit float, and past 2**32 one step of that grid covers
  // more than a turn, so the value no longer names an angle. Each row below is a
  // different way of landing past it and they all compile to one colour.
  test.each([
    "calc(NaN)", // serialized past the float range, reparses to Infinity
    "calc(infinity)", // reparses saturated, at 9223372036854776000
    "calc(-infinity)",
    "4294967296", // 2**32, where one step of the grid first covers a turn
    "1e20", // saturates too, arriving as 9223369837831520000
    "1e38", // the same value: past the ceiling the hue is no longer carried
  ])("hsl with a hue the float grid cannot name: %s", (hue) => {
    registerCSS(`.my-class {
      background-color: hsl(${hue} 100% 50% / var(--a, 0.5));
    }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.props.style).toStrictEqual({
      backgroundColor: "rgba(255, 0, 0, 0.5)",
    });
  });

  // The other side of that boundary: a hue far outside [0, 360) but still on a
  // part of the grid that resolves finer than a turn is reduced, never clamped.
  //
  // Every row has to land on a colour the clamp does NOT also produce, or it
  // cannot tell reduction from clamping — a hue that reduces to 0 agrees with
  // the clamp and passes either way. `3e9` is also what bounds the threshold
  // from below: it sits between 2**31 and 2**32, where the float32 ULP is 256
  // and so still finer than a turn, and it arrives exactly because one
  // significant digit survives any serializer. Together with the 2**32 row
  // above it brackets `SMALLEST_UNNAMEABLE_HUE` to within a factor of two.
  test.each([
    ["-600", "rgba(0, 255, 0, 0.5)"],
    ["3e9", "rgba(0, 255, 0, 0.5)"],
    ["1e7", "rgba(170, 0, 255, 0.5)"],
  ])("hsl reduces a large nameable hue: %s", (hue, expected) => {
    registerCSS(`.my-class {
      background-color: hsl(${hue} 100% 50% / var(--a, 0.5));
    }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.props.style).toStrictEqual({
      backgroundColor: expected,
    });
  });

  test("light-dark carries an unresolved alpha into both schemes", () => {
    registerCSS(`.my-class {
      background-color: light-dark(
        rgb(50% 25% 10% / var(--a, 0.5)),
        hsl(120 100% 50% / var(--a, 0.5))
      );
    }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.props.style).toStrictEqual({
      backgroundColor: "rgba(128, 64, 26, 0.5)",
    });

    act(() => {
      colorScheme.set("dark");
    });

    expect(component.props.style).toStrictEqual({
      backgroundColor: "rgba(0, 255, 0, 0.5)",
    });
  });

  afterEach(() => {
    act(() => {
      colorScheme.set("light");
    });
  });
});

// `parseColor` compiles a fully resolved colour and `parseUnresolvedColor`
// compiles the same channels with the alpha left open. An opaque fallback makes
// the two spellings the same colour, so React Native has to read one number
// from both.
describe("unresolved alpha matches the resolved spelling", () => {
  function renderedColor(id: string) {
    const style: unknown = screen.getByTestId(id).props.style;

    return typeof style === "object" &&
      style !== null &&
      "backgroundColor" in style &&
      typeof style.backgroundColor === "string"
      ? processColor(style.backgroundColor)
      : undefined;
  }

  const colors = [
    "rgb(255 0 0)",
    "rgb(100% 0% 0%)",
    "rgb(50% 25% 10%)",
    "hsl(0 84.2% 60.2%)",
    "hsl(120 100% 50%)",
    "hsl(-600 100% 50%)",
    "hsl(1e7 100% 50%)",
    "hsl(calc(NaN) 100% 50%)",
    "hsl(4294967296 100% 50%)",
    "hsl(1e20 100% 50%)",
    "hsl(1e38 100% 50%)",
  ] as const;

  test.each(colors)("%s", (color) => {
    registerCSS(`
      .resolved { background-color: ${color}; }
      .unresolved { background-color: ${color.slice(0, -1)} / var(--a, 1)); }
    `);

    render(
      <>
        <View testID="resolved" className="resolved" />
        <View testID="unresolved" className="unresolved" />
      </>,
    );

    const expected = renderedColor("resolved");

    // A colour React Native rejects reads as `undefined`, which would make the
    // comparison below pass while neither spelling renders anything.
    expect(typeof expected).toBe("number");

    expect(renderedColor("unresolved")).toBe(expected);
  });

  // `calc(infinity)` stands for a family, not a special case: sampling f32 hues
  // above 2**32, about one in seven resolves to something other than the red the
  // compiler emits, `5e10`, `1e12`, `1.44e38` and `calc(-infinity)` among them.
  //
  // What makes the family unmatchable is not that lightningcss is erratic — it
  // is that the distinguishing information never reaches this compiler.
  // Seventeen authored hues from `1e19` to `9223372036854775807` all arrive as
  // the single value `9223369837831520000`, and lightningcss's resolved path
  // splits that one arriving value twelve red to five black. No function of the
  // hue this compiler receives can separate inputs it receives as one number.
  //
  // So the compiler emits the answer that IS a function of the arriving hue and
  // the divergence is pinned here rather than reproduced. This goes red if
  // lightningcss stabilises, which is when the row belongs in the list above.
  test("a saturated hue diverges from lightningcss's own resolution", () => {
    registerCSS(`
      .resolved { background-color: hsl(calc(infinity) 100% 50%); }
      .unresolved { background-color: hsl(calc(infinity) 100% 50% / var(--a, 1)); }
    `);

    render(
      <>
        <View testID="resolved" className="resolved" />
        <View testID="unresolved" className="unresolved" />
      </>,
    );

    expect(renderedColor("resolved")).toBe(processColor("#000"));
    expect(renderedColor("unresolved")).toBe(processColor("rgb(255, 0, 0)"));
  });
});

describe("currentcolor", () => {
  test("currentcolor and global variables", () => {
    registerCSS(`
      @layer theme {
        :root {
          --color-red-500: red;
        }
      }
      @layer utilities {
        .bg-current {
          background-color: currentcolor;
        }
        .text-red-500 {
          color: var(--color-red-500);
        }
      }
    `);

    render(<View testID={testID} className="bg-current text-red-500" />);
    const component = screen.getByTestId(testID);

    expect(component.type).toBe("View");
    expect(component.props).toStrictEqual({
      children: undefined,
      style: { color: "#f00", backgroundColor: "#f00" },
      testID,
    });
  });
});

describe("inherit", () => {
  test("color: inherit resolves to the parent's color", () => {
    registerCSS(`
      .parent { color: red; }
      .child { color: inherit; }
    `);

    render(
      <View testID="parent" className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
    });
  });

  test("text-inherit: a child Text inherits its parent's color", () => {
    // The shape that surfaced the bug: a labelled button whose label renders
    // React Native's default color (black) on native instead of the button's
    // foreground color, while web inherits correctly.
    registerCSS(`
      .button { color: white; }
      .label { color: inherit; }
    `);

    render(
      <View testID="button" className="button">
        <Text testID="label" className="label" />
      </View>,
    );

    // Flattened, because the label is handed the colour on two channels and
    // React Native resolves the array to one value. `<Text>` sets
    // `inheritsTextStyle`, so `useNativeCss` PREPENDS what it read from the
    // inherited-property channel before the style the element resolved for
    // itself — the element's own always wins, and here the two agree. What this
    // test is about is which colour the label paints, not how many objects it
    // took to say so.
    expect(
      StyleSheet.flatten(screen.getByTestId("label").props.style),
    ).toStrictEqual({
      color: "#fff",
    });
  });

  test("inherit chains through an inheriting ancestor without breaking the chain", () => {
    // The middle node inherits and must NOT republish a circular
    // --__rn-css-color, or the grandchild would fail to resolve the color.
    registerCSS(`
      .parent { color: red; }
      .mid { color: inherit; }
      .child { color: inherit; }
    `);

    render(
      <View testID="parent" className="parent">
        <View testID="mid" className="mid">
          <View testID="child" className="child" />
        </View>
      </View>,
    );

    expect(screen.getByTestId("mid").props.style).toStrictEqual({
      color: "#f00",
    });
    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
    });
  });

  test("inherit follows the nearest colored ancestor", () => {
    registerCSS(`
      .outer { color: red; }
      .inner { color: blue; }
      .child { color: inherit; }
    `);

    render(
      <View className="outer">
        <View className="inner">
          <View testID="child" className="child" />
        </View>
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#00f",
    });
  });

  test("color: unset inherits the parent's color, same as inherit", () => {
    // `unset` computes to `inherit` on inherited properties, and color is one.
    registerCSS(`
      .parent { color: red; }
      .child { color: unset; }
    `);

    render(
      <View testID="parent" className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
    });
  });

  test.each(["UNSET", "INHERIT", "Inherit"])(
    "color: %s is case-folded and inherits",
    (spelling) => {
      registerCSS(`
        .parent { color: red; }
        .child { color: ${spelling}; }
      `);

      render(
        <View className="parent">
          <View testID="child" className="child" />
        </View>,
      );

      expect(screen.getByTestId("child").props.style).toStrictEqual({
        color: "#f00",
      });
    },
  );

  test("color: INITIAL is case-folded into the drop, not into the lookup", () => {
    registerCSS(`
      .parent { color: red; }
      .child { color: INITIAL; }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toBeUndefined();
  });

  test("a descendant override restarts the chain", () => {
    registerCSS(`
      .red { color: red; }
      .blue { color: blue; }
      .inherit { color: inherit; }
    `);

    render(
      <View className="red">
        <View testID="first" className="inherit">
          <View className="blue">
            <View testID="second" className="inherit" />
          </View>
        </View>
      </View>,
    );

    expect(screen.getByTestId("first").props.style).toStrictEqual({
      color: "#f00",
    });
    expect(screen.getByTestId("second").props.style).toStrictEqual({
      color: "#00f",
    });
  });

  test("color: inherit under a media query", () => {
    registerCSS(`
      .parent { color: red; }
      @media (min-width: 1px) { .child { color: inherit; } }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
    });
  });

  test("color: inherit under :hover", () => {
    registerCSS(`
      .parent { color: red; }
      .child { color: blue; }
      .child:hover { color: inherit; }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    const child = screen.getByTestId("child");
    expect(child.props.style).toStrictEqual({ color: "#00f" });

    fireEvent(child, "hoverIn", {});
    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
    });
  });

  test("color: inherit !important beats a normal color on the same element", () => {
    registerCSS(`
      .parent { color: red; }
      .child { color: inherit !important; }
      .override { color: blue; }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child override" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
    });
  });

  test("the inherited colour survives a pseudo-element's retarget", () => {
    // Each pseudo-element reads the inherited colour through the declaration it
    // can express: `::placeholder { color }` becomes `placeholderTextColor`,
    // and `::selection { background-color }` becomes `selectionColor`, the band
    // behind the selected text. `currentcolor` is the spelling that reaches the
    // variable from a non-`color` property — `inherit` is only the
    // inherited-colour lookup on `color` itself, which the two cases below pin.
    registerCSS(`
      .parent { color: red; }
      .child::placeholder { color: inherit; }
      .child::selection { background-color: currentcolor; }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("child").props).toStrictEqual({
      children: undefined,
      placeholderTextColor: "#f00",
      selectionColor: "#f00",
      style: {},
      testID: "child",
    });
  });

  test.each(["border-color", "background-color"])(
    "%s: inherit is dropped, it does not read the color variable",
    (property) => {
      // Only `color` seeds --__rn-css-color, so only `color` can read it back.
      // Neither of these inherits in CSS either, so there is nothing for them
      // to have inherited even if a per-property context existed.
      registerCSS(`
        .parent { color: red; }
        .child { ${property}: inherit; }
      `);

      render(
        <View className="parent">
          <View testID="child" className="child" />
        </View>,
      );

      expect(screen.getByTestId("child").props.style).toBeUndefined();
    },
  );

  test("background-color: unset still clears the color", () => {
    // The counterpart to the drop above. `unset` on a non-inherited property
    // means `initial`, and the literal the compiler leaves in place is what the
    // runtime clears the declared colour with — so adding `unset` to the
    // keyword drop would silently take away the only way to clear one. The
    // cleared element keeps the KEY and loses the value, which is how a later
    // rule overrides an earlier one here rather than merging with it.
    registerCSS(`
      .filled { background-color: red; }
      .cleared { background-color: unset; }
    `);

    render(
      <>
        <View testID="filled" className="filled" />
        <View testID="cleared" className="filled cleared" />
      </>,
    );

    expect(screen.getByTestId("filled").props.style).toStrictEqual({
      backgroundColor: "#f00",
    });
    expect(screen.getByTestId("cleared").props.style).toStrictEqual({
      backgroundColor: undefined,
    });
  });

  test("color: inherit with no colored ancestor falls back to the root seed", () => {
    // Nothing publishes --__rn-css-color above this element, so the read lands
    // on the value the root seeds it with: the platform's label colour. The
    // failure this guards is not a wrong colour but an UNRESOLVED one — the
    // pre-fix drop left `style` undefined and React Native painted its own
    // default, and a read that resolved to nothing would do the same.
    registerCSS(`.child { color: inherit; }`);

    render(<View testID="child" className="child" />);

    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: { semantic: ["label", "labelColor"] },
    });
  });

  test("inherit resolves an ancestor color that is itself a variable", () => {
    // `--brand` has a single definition, so the compiler inlines it and the
    // published inherited colour is already a resolved string.
    registerCSS(`
      .parent { --brand: #ff0000; color: var(--brand); }
      .child { color: inherit; }
    `);

    render(
      <View testID="parent" className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("parent").props.style).toStrictEqual({
      color: "#f00",
    });
    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
    });
  });

  test("inherit resolves an ancestor color from an UNINLINED variable", () => {
    // A second definition of `--brand` stops the compiler inlining it, so the
    // ancestor publishes the var() lookup itself rather than a resolved colour.
    // The descendant must still end up with the ancestor's COMPUTED colour —
    // which is what `readsInheritedColor` letting a non-inherited `var()`
    // through is for. Asserted as an equality against the ancestor rather than
    // a literal: the class is that the two agree, and the raw-token colour a
    // named-colour custom property currently produces is not this fix's to pin.
    registerCSS(`
      .parent { --brand: #ff0000; color: var(--brand); }
      .child { --brand: #0000ff; color: inherit; }
    `);

    render(
      <View testID="parent" className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    const parentColor = screen.getByTestId("parent").props.style.color;

    expect(parentColor).toBeDefined();
    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: parentColor,
    });
  });

  /**
   * `color: var(--brand)` where the KEYWORD is the custom property's value.
   *
   * The two tests below are the same CSS but for one extra declaration of
   * `--brand`, and they end at opposite outcomes, because `inlineVariables`
   * keys on a custom property's DECLARATION COUNT:
   *
   * - declared once, the value is folded into its consumer at compile time and
   *   the rule compiles as `color: <keyword>` — the property context exists and
   *   `inherit` resolves;
   * - declared twice or more, the fold is defeated, `var(--brand)` survives as
   *   a runtime lookup, and the compiler meets the keyword on a CUSTOM property
   *   instead, where there is no property to inherit from — so it drops and the
   *   lookup resolves to nothing.
   *
   * Mapping `color: inherit` to the inherited-color variable reaches the folded
   * route only: before it BOTH routes were broken, so pinning them together is
   * what records that the split between them is new.
   */
  test("color: var(--brand) with --brand: inherit resolves when the variable is inlined", () => {
    registerCSS(`
      .parent { color: red; }
      .child { --brand: inherit; color: var(--brand); }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
    });
  });

  test("color: var(--brand) with --brand: inherit drops when the variable is NOT inlined", () => {
    // The unfolded half of the pair, pinned at the current output rather than
    // at the CSS-correct one. Per CSS the child computes to red here too. The
    // keyword is not the only thing that would have to change to get there: a
    // custom property would need to carry the property context of whatever
    // consumes it, which is a resolver change, not a keyword-table one.
    registerCSS(`
      .parent { color: red; }
      .child { --brand: inherit; color: var(--brand); }
      .other { --brand: inherit; }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toStrictEqual({});
  });

  test.each([
    ["currentcolor", "inlined"],
    ["currentcolor", "uninlined"],
    ["currentColor", "inlined"],
    ["currentColor", "uninlined"],
  ] as const)(
    "color: var(--brand) with --brand: %s resolves on the %s route",
    (spelling, route) => {
      // The control for the pair above: `currentcolor` is resolved by a
      // keyword-only arm, so it never needs a property context and is symmetric
      // across the fold. The camelCase spelling is symmetric too only because
      // parseUnparsed folds case: lightningcss hands a custom property's tokens
      // through verbatim, so without that fold the uninlined route publishes
      // the literal string "currentColor" as the variable's value and this
      // element renders it as a colour.
      const secondDefinition =
        route === "uninlined" ? `.other { --brand: ${spelling}; }` : "";

      registerCSS(`
        .parent { color: red; }
        .child { --brand: ${spelling}; color: var(--brand); }
        ${secondDefinition}
      `);

      render(
        <View className="parent">
          <View testID="child" className="child" />
        </View>,
      );

      expect(screen.getByTestId("child").props.style).toStrictEqual({
        color: "#f00",
      });
    },
  );

  test("color: inherit alongside a box-shadow leaves no placeholder in the style", () => {
    // The delayed-value placeholder `{ color: true }` is internal bookkeeping.
    // A rule whose LAST declaration walks into a nested target (a shadow object)
    // must not strand the placeholder of an earlier delayed declaration.
    registerCSS(`
      .parent { color: red; }
      .child { color: inherit; box-shadow: 1px 1px blue; }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
      boxShadow: [
        {
          offsetX: 1,
          offsetY: 1,
          blurRadius: 0,
          spreadDistance: 0,
          color: "#00f",
        },
      ],
    });
  });

  test("color: currentcolor alongside a box-shadow leaves no placeholder either", () => {
    // The same runtime defect with no `inherit` anywhere in the input. The
    // stranded target is a property of how a rule's declarations are walked,
    // not of the keyword that made the colour delayed — so this is the pin that
    // survives if the calculate-props fix is split into its own change.
    registerCSS(`
      .parent { color: red; }
      .child { color: currentcolor; box-shadow: 1px 1px blue; }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
      boxShadow: [
        {
          offsetX: 1,
          offsetY: 1,
          blurRadius: 0,
          spreadDistance: 0,
          color: "#00f",
        },
      ],
    });
  });

  test("color: inherit alongside a text-shadow leaves no placeholder either", () => {
    registerCSS(`
      .parent { color: red; }
      .child { color: inherit; text-shadow: 1px 1px 2px blue; }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
      textShadowColor: "#00f",
      textShadowOffset: { width: 1, height: 1 },
      textShadowRadius: 2,
    });
  });

  test.each(["revert", "revert-layer"])(
    "color: %s publishes nothing to descendants",
    (keyword) => {
      // React Native has no cascade origins, so neither keyword has a computed
      // value. Emitting the literal handed every descendant `color: "revert"`.
      registerCSS(`
        .parent { color: red; }
        .mid { color: ${keyword}; }
        .child { color: inherit; }
      `);

      render(
        <View className="parent">
          <View testID="mid" className="mid">
            <View testID="child" className="child" />
          </View>
        </View>,
      );

      expect(screen.getByTestId("mid").props.style).toBeUndefined();
      expect(screen.getByTestId("child").props.style).toStrictEqual({
        color: "#f00",
      });
    },
  );

  test("a light-dark() ancestor is inherited by a descendant", () => {
    registerCSS(`
      .parent { color: light-dark(red, blue); }
      .child { color: inherit; }
    `);

    render(
      <View testID="parent" className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("parent").props.style).toStrictEqual({
      color: "#f00",
    });
    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
    });

    act(() => {
      colorScheme.set("dark");
    });

    // Both, because a `light-dark()` publishes --__rn-css-color from EACH
    // branch: the light rule from its own, the extra `prefers-color-scheme:
    // dark` rule from the dark one. Per CSS the descendant computes to the
    // ancestor's used colour, and the used colour in dark mode is the dark
    // branch — so the element and its descendant agree in both schemes, which
    // is the whole subject of this test.
    expect(screen.getByTestId("parent").props.style).toStrictEqual({
      color: "#00f",
    });
    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#00f",
    });
  });
});

/**
 * Each of these makes the middle element's `color` READ the inherited-color
 * variable from below the top level of its descriptor. Publishing such a value
 * as --__rn-css-color hands the child a value that resolves back into the same
 * variable, and resolution recurses until the stack is exhausted.
 *
 * The middle element resolves against ITS parent, so the child sees the nearest
 * ancestor that published a colour of its own — the red parent.
 */
const selfReferentialMiddleColors: [css: string, midColor: string][] = [
  ["inherit", "#f00"],
  ["unset", "#f00"],
  ["currentcolor", "#f00"],
  ["var(--missing, inherit)", "#f00"],
  ["var(--missing, unset)", "#f00"],
  ["var(--missing, currentcolor)", "#f00"],
  // The channels are ROUNDED to integers. React Native reads an `rgba()` string
  // back with `parseInt`, which TRUNCATES — `127.5` would arrive as `0x7f`
  // where the compile-time route for the same mix gives `0x80`. Rounding here
  // is what makes the two routes name one colour.
  ["color-mix(in srgb, currentcolor, blue)", "rgba(128, 0, 128, 1)"],
  ["color-mix(in srgb, inherit, blue)", "rgba(128, 0, 128, 1)"],
  ["light-dark(currentcolor, blue)", "#f00"],
  // Relative colour syntax restates the origin unchanged when every channel is
  // named as itself, so `rgb(from currentcolor r g b)` over red is red.
  ["rgb(from currentcolor r g b)", "rgba(255, 0, 0, 1)"],
];

describe("a color that reads the inherited color never publishes itself", () => {
  test("the census is not empty", () => {
    expect(selfReferentialMiddleColors.length).toBeGreaterThan(0);
  });

  test.each(selfReferentialMiddleColors)(
    "mid { color: %s } renders, and its child inherits the grandparent's color",
    (midColorValue, expectedMidColor) => {
      registerCSS(`
        .parent { color: red; }
        .mid { color: ${midColorValue}; }
        .child { color: inherit; }
      `);

      render(
        <View className="parent">
          <View testID="mid" className="mid">
            <View testID="child" className="child" />
          </View>
        </View>,
      );

      expect(screen.getByTestId("mid").props.style).toStrictEqual({
        color: expectedMidColor,
      });
      expect(screen.getByTestId("child").props.style).toStrictEqual({
        color: "#f00",
      });
    },
  );
});
