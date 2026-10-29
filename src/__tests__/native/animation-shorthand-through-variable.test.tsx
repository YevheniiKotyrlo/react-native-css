import { StyleSheet } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

jest.mock("../../native/reanimated", () => ({
  animatedComponentFamily: (component: unknown) => component,
}));

const keyframes =
  "@keyframes slide-in { from { margin-left: 100%; } to { margin-left: 0%; } }";

test.each([
  [
    "written",
    ".motion { animation: slide-in 1s linear 250ms 2 alternate both; }",
  ],
  [
    "through a variable",
    ":root { --a: slide-in 1s linear 250ms 2 alternate both; } .motion { animation: var(--a); }",
  ],
])(
  "animation: slide-in 1s linear 250ms 2 alternate both %s reaches Reanimated as its longhands",
  (_, css) => {
    registerCSS(`${keyframes} ${css}`, { inlineVariables: false });
    render(<View testID={testID} className="motion" />);
    expect(
      StyleSheet.flatten(screen.getByTestId(testID).props.style),
    ).toMatchObject({
      animationDuration: [1000],
      animationDelay: [250],
      animationIterationCount: [2],
      animationDirection: ["alternate"],
      animationFillMode: ["both"],
    });
  },
);
