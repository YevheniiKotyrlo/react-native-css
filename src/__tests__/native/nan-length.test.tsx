import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

test.each([true, false])(
  "width: var(--n) over --n: calc(NaN * 1px) is 0 (inlineVariables: %s)",
  (inlineVariables) => {
    registerCSS(".a { --n: calc(NaN * 1px); width: var(--n); }", inlineVariables ? {} : { inlineVariables: false });
    render(<View testID={testID} className="a" />);
    const { style } = screen.getByTestId(testID).props;
    console.log(`inlineVariables=${inlineVariables}: ${JSON.stringify(style)}`);
    expect(style).toStrictEqual({ width: 0 });
  },
);
