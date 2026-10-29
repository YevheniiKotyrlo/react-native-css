import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { registerCSS, testID } from "react-native-css/jest";

test.each([
  ["written", ":root { font-size: 16px; } .a { font-size: 1rem; }"],
  [
    "through a variable",
    ":root { --size: 16px; font-size: var(--size); } .a { font-size: 1rem; }",
  ],
])("with the root's font size %s, 1rem is 16", (_, css) => {
  registerCSS(css, { inlineVariables: false });
  render(<Text testID={testID} className="a" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    fontSize: 16,
  });
});
