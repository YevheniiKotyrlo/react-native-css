import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { compile } from "react-native-css/compiler";
import { registerCSS, testID } from "react-native-css/jest";

test.each(["visible", "hidden", "scroll"])("overflow: %s reaches React Native", (value) => {
  console.log(`overflow: ${value} -> warnings ${JSON.stringify(compile(`.a { overflow: ${value}; }`).warnings())}`);
  registerCSS(`.a { overflow: ${value}; }`);
  render(<View testID={testID} className="a" />);
  expect(screen.getByTestId(testID).props.style).toStrictEqual({ overflow: value });
});
