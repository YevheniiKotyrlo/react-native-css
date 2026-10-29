// Run from a react-native-css checkout: copy to src/__tests__/native/keyword-case.test.tsx, then `yarn jest` it.
import { StyleSheet } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

jest.mock("../../native/reanimated", () => ({
  animatedComponentFamily: (component: unknown) => component,
}));

const styleOf = (css: string, inlineVariables: boolean) => {
  registerCSS(css, inlineVariables ? {} : { inlineVariables: false });
  render(<View testID={testID} className="a" />);
  const style = StyleSheet.flatten(screen.getByTestId(testID).props.style);
  screen.unmount();
  return JSON.stringify(style);
};

test.each([
  ["position", "ABSOLUTE"],
  ["display", "NONE"],
  ["flex-direction", "Row"],
  ["transition-timing-function", "EASE-IN"],
  ["animation-direction", "ALTERNATE"],
])("%s: %s written and through a variable", (property, value) => {
  console.log(
    `${property}: ${value}\n  written: ${styleOf(`.a { ${property}: ${value}; }`, true)}\n  kept:    ${styleOf(`.a { --v: ${value}; ${property}: var(--v); }`, false)}`,
  );
});
