import { StyleSheet } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

jest.mock("../../native/reanimated", () => ({
  animatedComponentFamily: (component: unknown) => component,
}));

test.each([true, false])(
  "transition-property: var(--missing), height is invalid as a whole (inlineVariables: %s)",
  (inlineVariables) => {
    registerCSS(`.a { transition-property: var(--missing), height; transition-duration: 1s, 2s; }`, {
      inlineVariables,
    });
    render(<View testID={testID} className="a" />);
    const style = StyleSheet.flatten(screen.getByTestId(testID).props.style) as Record<string, unknown>;
    console.log(JSON.stringify(style));
    expect(style.transitionProperty).toBeUndefined();
  },
);
