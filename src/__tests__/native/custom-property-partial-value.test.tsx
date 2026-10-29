import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

test.each([
  ["translate", ".a { translate: 10px 1cap; }"],
  [
    "translate through a variable",
    ":root { --t: 10px 1cap; } .a { translate: var(--t); }",
  ],
])("%s holding 10px 1cap leaves the element untranslated", (_, css) => {
  registerCSS(css, { inlineVariables: false });
  render(<View testID={testID} className="a" />);
  expect(screen.getByTestId(testID).props.style).toBeUndefined();
});

test.each([
  ["font-family", ".a { font-family: Inter, Helvetica,; }"],
  [
    "font-family through a variable",
    ":root { --t: Inter, Helvetica,; } .a { font-family: var(--t); }",
  ],
])("%s holding Inter, Helvetica, sets no font", (_, css) => {
  registerCSS(css, { inlineVariables: false });
  render(<Text testID={testID} className="a" />);
  expect(screen.getByTestId(testID).props.style).toBeUndefined();
});
