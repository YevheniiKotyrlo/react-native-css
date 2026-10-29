import { render, screen } from "@testing-library/react-native";
import processBackgroundImage from "react-native/Libraries/StyleSheet/processBackgroundImage";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

test.each([
  "linear-gradient(to right in oklab, red, blue)",
  "radial-gradient(in oklab, red, blue)",
  "linear-gradient(to right, red, blue)",
])("background-image: %s reaches React Native as a gradient it reads", (gradient) => {
  registerCSS(`.a { background-image: ${gradient}; }`);
  render(<View testID={testID} className="a" />);
  const { experimental_backgroundImage } = screen.getByTestId(testID).props.style;
  const processed = processBackgroundImage(experimental_backgroundImage);
  console.log(`${gradient}\n  style: ${JSON.stringify(experimental_backgroundImage)}\n  React Native reads ${processed.length} gradient(s)`);
  expect(processed).toHaveLength(1);
});
