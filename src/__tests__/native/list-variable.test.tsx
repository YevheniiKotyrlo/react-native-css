// Run from a react-native-css checkout: copy to src/__tests__/native/list-variable.test.tsx, then `yarn jest src/__tests__/native/list-variable.test.tsx`.
import { StyleSheet } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { compile } from "react-native-css/compiler";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

jest.mock("../../native/reanimated", () => ({
  animatedComponentFamily: (component: unknown) => component,
}));

const cases: readonly (readonly [string, string, string])[] = [
  ["transition-duration", "3s", "var(--x), 2s"],
  ["transition-duration", "3s", "var(--x)"],
  ["transition-delay", "3s", "var(--x), 2s"],
  ["transition-timing-function", "linear", "var(--x), ease-in"],
  ["transition-property", "width", "var(--x), height"],
  ["animation-duration", "3s", "var(--x), 2s"],
  ["margin", "4px", "var(--x) 2px"],
  ["padding", "4px", "var(--x) 2px"],
  ["border-width", "4px", "var(--x) 2px"],
  ["font-family", "Inter", "var(--x), sans-serif"],
  ["transform", "10px", "translateX(var(--x)) rotate(5deg)"],
  ["box-shadow", "4px", "var(--x) 1px red"],
  ["width", "4px", "var(--x)"],
];

test.each(cases)("%s: %s through %s from an ancestor", (property, held, value) => {
  const css = `.parent { --x: ${held}; } .child { ${property}: ${value}; }`;
  for (const inlineVariables of [false] as const) {
    registerCSS(css, { inlineVariables });
    const rule = compile(css, { inlineVariables })
      .stylesheet()
      .s?.find(([name]) => name === "child")?.[1][0];
    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );
    console.log(
      `${property}: ${value} over --x: ${held}\n  dv=${String(rule?.dv)} d=${JSON.stringify(rule?.d)}\n  rendered=${JSON.stringify(StyleSheet.flatten(screen.getByTestId("child").props.style))}`,
    );
    screen.unmount();
  }
});
