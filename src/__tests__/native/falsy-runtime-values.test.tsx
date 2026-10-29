import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

test.each([
  ["width", "0px", { width: 0 }],
  ["margin-top", "0px", { marginTop: 0 }],
  ["flex-grow", "0", { flexGrow: 0 }],
  ["z-index", "0", { zIndex: 0 }],
  ["width", "0%", { width: "0%" }],
])("%s: var(--v) over --v: %s renders the value", (property, value, expected) => {
  registerCSS(`.a { --v: ${value}; ${property}: var(--v); }`, { inlineVariables: false });
  render(<View testID={testID} className="a" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual(expected);
});
