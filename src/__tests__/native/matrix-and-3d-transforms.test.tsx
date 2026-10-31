import { StyleSheet } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

const processTransform = jest.requireActual<{
  default: (transform: unknown) => unknown;
}>("react-native/Libraries/StyleSheet/processTransform");

jest.mock("../../native/reanimated", () => ({
  animatedComponentFamily: (component: unknown) => component,
}));

function readByReactNative(transform: unknown): string {
  try {
    processTransform.default(transform);
    return "takes it";
  } catch (error) {
    return `throws ${(error as Error).message.split("\n")[0]}`;
  }
}

test.each([
  "matrix(1, 0, 0, 1, 5, 6)",
  "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1)",
  "translate3d(1px, 2px, 3px)",
  "translateZ(10px)",
  "translate3d(1px, 2px, 3px) rotate(45deg)",
  "scale3d(1, 2, 3) rotate(45deg)",
  "scaleZ(2) rotate(45deg)",
  "rotate3d(0, 0, 1, 45deg) rotate(45deg)",
])("transform: %s", (transform) => {
  registerCSS(`.a { transform: ${transform}; }`);
  render(<View testID={testID} className="a" />);
  const style = StyleSheet.flatten(screen.getByTestId(testID).props.style);
  console.log(
    `transform: ${transform}\n   => ${JSON.stringify(style)}\n   processTransform: ${readByReactNative(style.transform)}`,
  );
  screen.unmount();
});

test.each([
  [[{ matrix: [1, 0, 0, 0, 1, 0, 5, 6, 1] }]],
  [[{ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1] }]],
  [[{ translate: [1, 2, 3] }]],
  [[{ translate: [0, 0, 10] }]],
  [[{ translate: [1, 2, 3] }, { rotate: "45deg" }]],
  [[{ rotate: "45deg" }]],
])("React Native's form %j", (transform) => {
  console.log(
    `${JSON.stringify(transform)}\n   processTransform: ${readByReactNative(transform)}`,
  );
});
