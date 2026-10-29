// Run from a react-native-css checkout: copy to src/__tests__/native/, then `yarn jest` it.
import { StyleSheet } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { compile } from "react-native-css/compiler";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

jest.mock("../../native/reanimated", () => ({
  animatedComponentFamily: (component: unknown) => component,
}));

test.each([
  [".a { transition-property: opacity, width; transition-duration: 1s; transition-timing-function: linear(0, 1), ease-in; }"],
  [".a { --e: ease-in; transition-property: opacity, width; transition-duration: 1s; transition-timing-function: linear(0, 1), var(--e); }"],
])("%s", (css) => {
  const compiled = compile(css, { inlineVariables: false });
  registerCSS(css, { inlineVariables: false });
  render(<View testID={testID} className="a" />);
  console.log(
    `${css} -> d ${JSON.stringify(compiled.stylesheet().s?.[0]?.[1][0]?.d)}; style ${JSON.stringify(StyleSheet.flatten(screen.getByTestId(testID).props.style))}; warnings ${JSON.stringify(compiled.warnings())}`,
  );
  screen.unmount();
});
