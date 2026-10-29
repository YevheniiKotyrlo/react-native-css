import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

test.each(["1px", "1rem", "1em", "1vw"])(
  "border-radius: var(--r) over an inlined --r: calc(infinity * %s) is a finite length",
  (unit) => {
    registerCSS(`.a { --r: calc(infinity * ${unit}); border-radius: var(--r); }`);
    render(<View testID={testID} className="a" />);
    const { style } = screen.getByTestId(testID).props;
    console.log(`calc(infinity * ${unit}): ${JSON.stringify(style)}`);
    expect(Number.isFinite(style?.borderRadius)).toBe(true);
  },
);
