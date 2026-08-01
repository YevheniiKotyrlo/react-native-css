import type { ViewStyle } from "react-native";

import { act, render } from "@testing-library/react-native";
import type { StyleRule } from "react-native-css/compiler";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { colorScheme } from "react-native-css/runtime";

/**
 * Defects found reviewing `src/compiler/`, each pinned by the reproduction that
 * failed before its fix.
 *
 * The theme running through them is a key: a declaration is only rendered if
 * the compiler writes it under a name React Native knows, and several parsers
 * chose that name from information they did not have yet — or chose one React
 * Native has never had.
 */

function styleOf(className: string): Record<string, unknown> | undefined {
  return render(<View testID={testID} className={className} />).getByTestId(
    testID,
  ).props.style as Record<string, unknown> | undefined;
}

afterEach(() => {
  act(() => {
    colorScheme.set("light");
  });
});

/*****************************************************************************
 * 1. `border-color: light-dark(…)` — the collapse chose the key after the
 *    parse that needed it
 ****************************************************************************/

test("a border-color whose four sides are one light-dark() flips in dark mode", () => {
  // Each side registers its dark value under its own LONGHAND key while
  // parsing, and the four light values then agree — so the collapse moved them
  // to `borderColor`, a key no dark descriptor targets. Both values survived
  // side by side and the light one was never overwritten:
  //   { borderColor: "#333", borderTopColor: "#eee", … }
  registerCSS(`.ld-collapse { border-color: light-dark(#333, #eee); }`);

  expect(styleOf("ld-collapse")).toStrictEqual({ borderColor: "#333" });

  act(() => {
    colorScheme.set("dark");
  });

  expect(styleOf("ld-collapse")).toStrictEqual({ borderColor: "#eee" });
});

test("four light-dark() sides that agree only in light mode do not collapse", () => {
  // The case only a SOURCE comparison can decide: all four light halves are
  // `#333`, so collapsing on the parsed values would put one `borderColor` on
  // the rule and four different dark longhands beside it.
  registerCSS(`
    .ld-split {
      border-color: light-dark(#333, #001) light-dark(#333, #002)
                    light-dark(#333, #003) light-dark(#333, #004);
    }
  `);

  expect(styleOf("ld-split")).toStrictEqual({
    borderTopColor: "#333",
    borderRightColor: "#333",
    borderBottomColor: "#333",
    borderLeftColor: "#333",
  });

  act(() => {
    colorScheme.set("dark");
  });

  expect(styleOf("ld-split")).toStrictEqual({
    borderTopColor: "#001",
    borderRightColor: "#002",
    borderBottomColor: "#003",
    borderLeftColor: "#004",
  });
});

/*****************************************************************************
 * 2. The logical sizing properties named keys React Native does not have
 ****************************************************************************/

test("the logical sizes compile to the physical keys React Native renders", () => {
  // `blockSize`, `inlineSize`, `maxBlockSize` and friends appear nowhere in
  // React Native, so each of these was a style object asserting a key nothing
  // reads — the declaration was spelled correctly and sized nothing.
  registerCSS(`
    .logical-size {
      block-size: 10px;
      inline-size: 20px;
      min-block-size: 1px;
      max-block-size: 100px;
      min-inline-size: 2px;
      max-inline-size: 200px;
    }
  `);

  // Typed as `ViewStyle`, so React Native's own types are what say these keys
  // exist: `blockSize` in this literal is a compile error, which is the half
  // of the claim a runtime assertion cannot make.
  const expected: ViewStyle = {
    height: 10,
    width: 20,
    minHeight: 1,
    maxHeight: 100,
    minWidth: 2,
    maxWidth: 200,
  };

  expect(styleOf("logical-size")).toStrictEqual(expected);
});

test("the logical sizes take the same key when the value is deferred", () => {
  // `propertyRename` is read by both declaration routes, so a `var()` lands on
  // the same key a literal does.
  registerCSS(`
    .logical-deferred {
      --size: 10px;
      block-size: var(--size);
      inline-size: var(--size);
    }
  `);

  expect(styleOf("logical-deferred")).toStrictEqual({ height: 10, width: 10 });
});

test("block-size accepts auto, because height does", () => {
  registerCSS(`
    .bs-auto { block-size: auto; }
    .h-auto { height: auto; }
  `);

  expect(styleOf("bs-auto")).toStrictEqual({ height: "auto" });
  expect(styleOf("h-auto")).toStrictEqual({ height: "auto" });
});

test("transition-property names the key the declaration writes to", () => {
  // The list is read back against the style keys a rule produced. Spelled from
  // the CSS name it named `blockSize` and `backgroundImage`, neither of which
  // any rule ever writes.
  const compiled = registerCSS(`
    .transition-renamed {
      transition-property: block-size, background-image, width;
    }
  `);

  const ruleSets = compiled.stylesheet().s ?? [];
  const rules: StyleRule[] = ruleSets[0]?.[1] ?? [];
  const rule = rules[0];

  expect(rule?.d).toStrictEqual([
    {
      transitionProperty: ["height", "experimental_backgroundImage", "width"],
    },
  ]);
});

/*****************************************************************************
 * 3. The `font-size` keywords, which have a normative scale
 ****************************************************************************/

test("the absolute font-size keywords compile to their css-fonts-4 factors", () => {
  // css-fonts-4 §3.5 Table 1 gives each keyword an exact multiple of the
  // user's default size, which is what `rem` measures here. They were warned
  // about and dropped.
  const compiled = registerCSS(
    `
    .fs-xx-small { font-size: xx-small; }
    .fs-medium { font-size: medium; }
    .fs-large { font-size: large; }
    .fs-xxx-large { font-size: xxx-large; }
  `,
    { inlineRem: 16 },
  );

  expect(styleOf("fs-xx-small")).toStrictEqual({ fontSize: 16 * (3 / 5) });
  expect(styleOf("fs-medium")).toStrictEqual({ fontSize: 16 });
  expect(styleOf("fs-large")).toStrictEqual({ fontSize: 16 * (6 / 5) });
  expect(styleOf("fs-xxx-large")).toStrictEqual({ fontSize: 48 });
  expect(compiled.warnings()).toStrictEqual({});
});

test("the relative font-size keywords scale the inherited size", () => {
  registerCSS(`
    .fs-parent { font-size: 20px; }
    .fs-larger { font-size: larger; }
    .fs-smaller { font-size: smaller; }
  `);

  const larger = render(
    <View className="fs-parent">
      <Text testID={testID} className="fs-larger" />
    </View>,
  ).getByTestId(testID).props.style as Record<string, unknown>[];

  expect(larger.at(-1)).toStrictEqual({ fontSize: 24 });

  const smaller = render(
    <View className="fs-parent">
      <Text testID={testID} className="fs-smaller" />
    </View>,
  ).getByTestId(testID).props.style as Record<string, unknown>[];

  // `20 / 1.2` through the compiler's 4-decimal rounding of the ratio and the
  // runtime's 2-decimal rounding of the product.
  expect(smaller.at(-1)).toStrictEqual({ fontSize: 16.67 });
});
