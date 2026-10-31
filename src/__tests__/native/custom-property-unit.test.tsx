import { StyleSheet } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { compile } from "react-native-css/compiler";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

jest.mock("../../native/reanimated", () => ({
  animatedComponentFamily: (component: unknown) => component,
}));

test.each(["5ms", "5", "5px", "5s", "5em", "5deg"])(
  "the stored value of --v: %s",
  (value) => {
    const sheet = compile(`.a { --v: ${value}; }`, {
      inlineVariables: false,
    }).stylesheet();
    console.log(`--v: ${value} -> ${JSON.stringify(sheet.s?.[0]?.[1][0]?.v)}`);
  },
);

test.each([
  ["5px", "transition-duration"],
  ["5ms", "transition-duration"],
  ["2px", "animation-iteration-count"],
  ["2", "animation-iteration-count"],
])("--v: %s read by %s: var(--v)", (value, property) => {
  registerCSS(`.a { --v: ${value}; ${property}: var(--v); }`, {
    inlineVariables: false,
  });
  render(<View testID={testID} className="a" />);
  console.log(
    `.a { --v: ${value}; ${property}: var(--v); } -> ${JSON.stringify(StyleSheet.flatten(screen.getByTestId(testID).props.style))}`,
  );
  screen.unmount();
});
