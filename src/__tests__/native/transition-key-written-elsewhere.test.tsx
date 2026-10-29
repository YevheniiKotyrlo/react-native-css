import { StyleSheet } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

jest.mock("../../native/reanimated", () => ({
  animatedComponentFamily: (component: unknown) => component,
}));

test.each([
  ["scale", "scale: 2"],
  ["translate", "translate: 10px"],
  ["margin", "margin: 1px 2px"],
])("a transition on %s names a key the style holds", (property, declaration) => {
  registerCSS(`.a { transition-property: ${property}; transition-duration: 1s; ${declaration}; }`);
  render(<View testID={testID} className="a" />);
  const style = StyleSheet.flatten(screen.getByTestId(testID).props.style) as Record<string, unknown>;
  const keys = Object.keys(style).filter((key) => !key.startsWith("transition"));
  console.log(`${property}: transitionProperty ${JSON.stringify(style.transitionProperty)}, style keys ${JSON.stringify(keys)}`);
  expect(keys).toEqual(expect.arrayContaining(style.transitionProperty as string[]));
});
