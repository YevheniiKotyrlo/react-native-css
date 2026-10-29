// Run from a react-native-css checkout: copy to src/__tests__/native/delayed-shorthand-cascade.test.tsx, then `yarn jest` it.
import { StyleSheet } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

jest.mock("../../native/reanimated", () => ({
  animatedComponentFamily: (component: unknown) => component,
}));

test.each([
  ["border", "1px solid blue", ".b { border-color: red; }"],
  ["border", "1px solid blue", ""],
  ["transition", "width 1s", ".b { transition-property: opacity; }"],
])("%s: var(--v) over %s, then %s", (property, value, later) => {
  for (const inlineVariables of [true, false]) {
    registerCSS(`.a { --v: ${value}; ${property}: var(--v); } ${later}`, inlineVariables ? {} : { inlineVariables: false });
    render(<View testID={testID} className="a b" />);
    console.log(`${property} over ${value} then ${later || "nothing"} (${inlineVariables ? "folded" : "kept"}): ${JSON.stringify(StyleSheet.flatten(screen.getByTestId(testID).props.style))}`);
    screen.unmount();
  }
});
