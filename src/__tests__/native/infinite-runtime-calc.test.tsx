import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

test.each([true, false])(
  "width: var(--r) over --r: calc(infinity * 1px) is the clamped length (inlineVariables: %s)",
  (inlineVariables) => {
    registerCSS(".a { --r: calc(infinity * 1px); width: var(--r); }", inlineVariables ? {} : { inlineVariables: false });
    render(<View testID={testID} className="a" />);
    const { style } = screen.getByTestId(testID).props;
    console.log(`inlineVariables=${inlineVariables}: ${JSON.stringify(style)}`);
    expect(Number.isFinite(style?.width)).toBe(true);
  },
);
