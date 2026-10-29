import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

test.each([
  ["0 / 0", undefined],
  ["16 / 0", undefined],
  ["0 / 9", undefined],
  ["3 / 3", 1],
  ["16 / 9", "16/9"],
])("aspect-ratio: %s reaches native as %p", (value, expected) => {
  registerCSS(`.a { aspect-ratio: ${value}; }`);
  render(<View testID={testID} className="a" />);
  expect(screen.getByTestId(testID).props.style?.aspectRatio).toBe(expected);
});
