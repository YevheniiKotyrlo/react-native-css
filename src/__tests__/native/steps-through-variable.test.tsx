// Run from a react-native-css checkout: copy to src/__tests__/native/steps-through-variable.test.tsx, then
// `yarn jest src/__tests__/native/steps-through-variable.test.tsx`.
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
  return style;
};

test.each([
  ["transition-timing-function", "steps(4)"],
  ["animation-timing-function", "steps(4)"],
  ["transition", "width 1s steps(4)"],
])("%s: %s written and through a variable", (property, value) => {
  console.log(
    `${property}: ${value}\n  written: ${JSON.stringify(styleOf(`.a { ${property}: ${value}; }`, true))}\n  kept:    ${JSON.stringify(styleOf(`.a { --v: ${value}; ${property}: var(--v); }`, false))}`,
  );
});
