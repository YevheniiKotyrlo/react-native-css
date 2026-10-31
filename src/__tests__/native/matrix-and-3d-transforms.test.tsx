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

test.each([
  "matrix(1, 0, 0, 1, 5, 6)",
  "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1)",
  "translate3d(1px, 2px, 3px)",
  "translateZ(10px)",
  "scale3d(1, 2, 3)",
  "scaleZ(2)",
  "rotate3d(0, 0, 1, 45deg)",
])("transform: %s rotate(45deg)", (transform) => {
  registerCSS(`.a { transform: ${transform} rotate(45deg); }`);
  render(<View testID={testID} className="a" />);
  const style = StyleSheet.flatten(screen.getByTestId(testID).props.style);
  let processed: string;
  try {
    processed = JSON.stringify(processTransform.default(style.transform));
  } catch (error) {
    processed = `throws ${(error as Error).message.split("\n")[0]}`;
  }
  console.log(
    `transform: ${transform} rotate(45deg)\n   => ${JSON.stringify(style)}\n   processTransform: ${processed}`,
  );
  screen.unmount();
});

test("the forms React Native's transform takes", () => {
  const transform = [
    { matrix: [1, 0, 0, 0, 1, 0, 5, 6, 1] },
    { translate: [1, 2, 3] },
    { translate: [0, 0, 10] },
  ];
  console.log(
    `${JSON.stringify(transform)}\n   processTransform: ${JSON.stringify(processTransform.default(transform))}`,
  );
});
