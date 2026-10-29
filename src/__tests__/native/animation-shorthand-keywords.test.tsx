// Run from a react-native-css checkout: copy to src/__tests__/native/animation-shorthand-keywords.test.tsx, then `yarn jest` it.
import { StyleSheet } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

jest.mock("../../native/reanimated", () => ({
  animatedComponentFamily: (component: unknown) => component,
}));

const keyframes = `@keyframes spin { from { opacity: 0; } to { opacity: 1; } }`;

test.each(["spin 1s ease-in", "spin 1s EASE-IN", "spin 1s step-end", "spin 1s step-start", "spin 1s linear"])("animation: var(--a) over %s", (value) => {
  for (const inlineVariables of [true, false]) {
    registerCSS(`${keyframes} .a { --a: ${value}; animation: var(--a); }`, inlineVariables ? {} : { inlineVariables: false });
    render(<View testID={testID} className="a" />);
    const style = StyleSheet.flatten(screen.getByTestId(testID).props.style) as Record<string, unknown> | undefined;
    console.log(`${value} (${inlineVariables ? "folded" : "kept"}): name=${JSON.stringify(style?.animationName) !== undefined} timing=${JSON.stringify(style?.animationTimingFunction)} duration=${JSON.stringify(style?.animationDuration)}`);
    screen.unmount();
  }
});
