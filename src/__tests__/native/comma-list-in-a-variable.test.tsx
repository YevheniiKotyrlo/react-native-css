import { StyleSheet } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

jest.mock("../../native/reanimated", () => ({
  animatedComponentFamily: (component: unknown) => component,
}));

test.each([
  ".a { --b: 1px, solid; border: var(--b); }",
  ".earlier { border-inline-width: 5px; } .a { --w: 1px, 2px; border-inline-width: var(--w); }",
  ".earlier { border-inline-width: 5px; } .a { --w: red; border-inline-width: var(--w); }",
  ".earlier { border-block-width: 5px; } .a { --w: red; border-block-width: var(--w); }",
])("%s", (css) => {
  for (const inlineVariables of [true, false]) {
    registerCSS(css, inlineVariables ? {} : { inlineVariables: false });
    render(<View testID={testID} className="earlier a" />);
    console.log(
      `${inlineVariables ? "folded" : "kept  "} ${css}\n   => ${JSON.stringify(StyleSheet.flatten(screen.getByTestId(testID).props.style))}`,
    );
    screen.unmount();
  }
});
