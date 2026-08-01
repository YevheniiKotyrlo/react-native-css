import { act, render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { colorScheme } from "react-native-css/runtime";

/**
 * `light-dark()` inside a property whose parser maps to a SHORTHAND.
 *
 * `light-dark()` compiles to two rules: a base rule holding the light value and
 * an extra rule gated on `prefers-color-scheme: dark`. The dark value used to be
 * written through `addUnnamedDescriptor`, which reads the ambient
 * `descriptorProperty` — and for a colour inside a shorthand that names the
 * SHORTHAND, not the key the light value landed on. So in dark mode:
 *
 * ```
 * box-shadow: 0 4px 6px light-dark(#333, #eee)
 *   light -> { boxShadow: [{ color: "#333", offsetX: 0, … }] }
 *   dark  -> { boxShadow: "#eee" }        the whole shadow replaced by a colour
 * ```
 *
 * `text-shadow` and `border` failed the same way, keeping the LIGHT colour and
 * adding a junk key beside it. The longhands (`color`, `background-color`,
 * `border-color`) were always correct, which is what hid it.
 *
 * `parseColor` now takes the key it is writing to, and `addColorDescriptor`
 * passes the same string to both `addDescriptor` and `parseColor`, so the two
 * cannot disagree.
 */

const LIGHT = "#333";
const DARK = "#eee";

function styleOf(className: string): Record<string, unknown> | undefined {
  return render(<View testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style as Record<string, unknown> | undefined;
}

function textStyleOf(className: string): Record<string, unknown> | undefined {
  return render(<Text testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style as Record<string, unknown> | undefined;
}

afterEach(() => {
  act(() => {
    colorScheme.set("light");
  });
});

test("box-shadow keeps its whole shadow in dark mode", () => {
  registerCSS(
    `.ld-shadow { box-shadow: 0 4px 6px light-dark(${LIGHT}, ${DARK}); }`,
  );

  expect(styleOf("ld-shadow")).toStrictEqual({
    boxShadow: [
      {
        color: LIGHT,
        offsetX: 0,
        offsetY: 4,
        blurRadius: 6,
        spreadDistance: 0,
      },
    ],
  });

  act(() => {
    colorScheme.set("dark");
  });

  expect(styleOf("ld-shadow")).toStrictEqual({
    boxShadow: [
      {
        color: DARK,
        offsetX: 0,
        offsetY: 4,
        blurRadius: 6,
        spreadDistance: 0,
      },
    ],
  });
});

test("text-shadow swaps its colour without adding a junk key", () => {
  registerCSS(
    `.ld-text { text-shadow: 1px 2px 3px light-dark(${LIGHT}, ${DARK}); }`,
  );

  const light = {
    textShadowColor: LIGHT,
    textShadowOffset: { width: 1, height: 2 },
    textShadowRadius: 3,
  };

  expect(textStyleOf("ld-text")).toStrictEqual(light);

  act(() => {
    colorScheme.set("dark");
  });

  expect(textStyleOf("ld-text")).toStrictEqual({
    ...light,
    textShadowColor: DARK,
  });
});

test("the border shorthand swaps its colour without adding a junk key", () => {
  registerCSS(
    `.ld-border { border: 1px solid light-dark(${LIGHT}, ${DARK}); }`,
  );

  const light = {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: LIGHT,
  };

  expect(styleOf("ld-border")).toStrictEqual(light);

  act(() => {
    colorScheme.set("dark");
  });

  expect(styleOf("ld-border")).toStrictEqual({ ...light, borderColor: DARK });
});

test("a per-side border shorthand targets that side's colour key", () => {
  registerCSS(
    `.ld-side { border-top: 2px dashed light-dark(${LIGHT}, ${DARK}); }`,
  );

  // No `borderTopStyle`: React Native has one `borderStyle` for the whole box,
  // so the per-side style component has nowhere to land and is dropped.
  expect(styleOf("ld-side")).toStrictEqual({
    borderTopWidth: 2,
    borderTopColor: LIGHT,
  });

  act(() => {
    colorScheme.set("dark");
  });

  expect(styleOf("ld-side")).toStrictEqual({
    borderTopWidth: 2,
    borderTopColor: DARK,
  });
});

test("the outline shorthand swaps its colour", () => {
  registerCSS(
    `.ld-outline { outline: 2px solid light-dark(${LIGHT}, ${DARK}); }`,
  );

  expect(styleOf("ld-outline")).toStrictEqual({
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineColor: LIGHT,
  });

  act(() => {
    colorScheme.set("dark");
  });

  expect(styleOf("ld-outline")).toStrictEqual({
    outlineWidth: 2,
    outlineStyle: "solid",
    outlineColor: DARK,
  });
});

test("the four-sided border-color shorthand targets each side", () => {
  registerCSS(
    `.ld-bc { border-color: light-dark(${LIGHT}, ${DARK}) blue red green; }`,
  );

  expect(styleOf("ld-bc")).toStrictEqual({
    borderTopColor: LIGHT,
    borderRightColor: "#00f",
    borderBottomColor: "#f00",
    borderLeftColor: "#008000",
  });

  act(() => {
    colorScheme.set("dark");
  });

  expect(styleOf("ld-bc")).toStrictEqual({
    borderTopColor: DARK,
    borderRightColor: "#00f",
    borderBottomColor: "#f00",
    borderLeftColor: "#008000",
  });
});

test("the longhands, which always worked, still do", () => {
  registerCSS(`
    .ld-color { color: light-dark(${LIGHT}, ${DARK}); }
    .ld-bg { background-color: light-dark(${LIGHT}, ${DARK}); }
  `);

  expect(textStyleOf("ld-color")).toStrictEqual({ color: LIGHT });
  expect(styleOf("ld-bg")).toStrictEqual({ backgroundColor: LIGHT });

  act(() => {
    colorScheme.set("dark");
  });

  expect(textStyleOf("ld-color")).toStrictEqual({ color: DARK });
  expect(styleOf("ld-bg")).toStrictEqual({ backgroundColor: DARK });
});
