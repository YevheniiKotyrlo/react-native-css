import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

test.each([
  ["margin", { marginTop: 1, marginBottom: 1, marginLeft: 2, marginRight: 2 }],
  [
    "padding",
    { paddingTop: 1, paddingBottom: 1, paddingLeft: 2, paddingRight: 2 },
  ],
])(
  "%s: 1px 2px read through a kept variable reaches native as its sides",
  (property, sides) => {
    registerCSS(`.a { --v: 1px 2px; ${property}: var(--v); }`, {
      inlineVariables: false,
    });
    render(<View testID={testID} className="a" />);
    expect(screen.getByTestId(testID).props.style).toStrictEqual(sides);
  },
);

test("margin: 1px 2px written out reaches native as its sides", () => {
  registerCSS(`.a { margin: 1px 2px; }`);
  render(<View testID={testID} className="a" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    marginTop: 1,
    marginBottom: 1,
    marginLeft: 2,
    marginRight: 2,
  });
});
