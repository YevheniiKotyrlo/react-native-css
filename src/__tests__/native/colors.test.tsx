import { processColor } from "react-native";

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
  // is the only channel a non-finite `calc()` reaches the compiler through.
  test("hsl with a non-finite hue", () => {
    registerCSS(`.my-class {
      background-color: hsl(calc(NaN) 100% 50% / var(--a, 0.5));
    }`);

    render(<View testID={testID} className="my-class" />);
    const component = screen.getByTestId(testID);

    expect(component.props.style).toStrictEqual({
      backgroundColor: "rgba(255, 0, 0, 0.5)",
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
    "hsl(calc(NaN) 100% 50%)",
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

    expect(screen.getByTestId("label").props.style).toStrictEqual({
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

  test("color: inherit on ::placeholder and ::selection", () => {
    registerCSS(`
      .parent { color: red; }
      .child::placeholder { color: inherit; }
      .child::selection { color: inherit; }
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

  test("border-color: inherit is dropped, it does not read the color variable", () => {
    // Only `color` seeds --__rn-css-color, so only `color` can read it back.
    registerCSS(`
      .parent { color: red; }
      .child { border-color: inherit; }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toBeUndefined();
  });

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

  test("color: revert publishes nothing to descendants", () => {
    // React Native has no cascade origins, so `revert` has no computed value.
    // Emitting the literal handed every descendant `color: "revert"`.
    registerCSS(`
      .parent { color: red; }
      .mid { color: revert; }
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
  ["color-mix(in srgb, currentcolor, blue)", "rgba(127.5, 0, 127.5, 1)"],
  ["color-mix(in srgb, inherit, blue)", "rgba(127.5, 0, 127.5, 1)"],
  ["light-dark(currentcolor, blue)", "#f00"],
  // Relative colour syntax is not implemented, so the mid colour is the
  // stringified function rather than a colour. It is here for the crash, and it
  // pins the current output so that implementing `rgb(from …)` has to update it.
  ["rgb(from currentcolor r g b)", "rgb(from, #f00, r, g, b)"],
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
