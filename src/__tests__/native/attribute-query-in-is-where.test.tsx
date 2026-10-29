import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

test.each([
  [".test:where([data-test='abc'])", "abc", true],
  [".test:where([data-test='abc'])", "xyz", false],
  [".test:is([data-test='abc'], [data-other='xyz'])", "abc", true],
  [".test:is([data-test='abc'])", "abc", true],
])("%s on data-test=%s matches: %s", (selector, value, expected) => {
  registerCSS(`${selector} { width: 37px; }`);
  render(<View testID={testID} className="test" dataSet={{ test: value }} />);
  expect(screen.getByTestId(testID).props.style?.width === 37).toBe(expected);
});
