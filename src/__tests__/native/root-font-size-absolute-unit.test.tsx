import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { registerCSS, testID } from "react-native-css/jest";

test.each([
  ["16px", 16],
  ["12pt", 16],
])(":root { font-size: %s } makes 1rem %p", (rootSize, expected) => {
  registerCSS(`:root { font-size: ${rootSize}; } .a { font-size: 1rem; }`);
  render(<Text testID={testID} className="a" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({ fontSize: expected });
});
