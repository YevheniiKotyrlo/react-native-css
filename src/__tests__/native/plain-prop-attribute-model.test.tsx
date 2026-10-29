import { TextInput } from "react-native-css/components/TextInput";
import { render, screen } from "@testing-library/react-native";
import { registerCSS, testID } from "react-native-css/jest";

test.each([
  ["[disabled]", false, false],
  ['[disabled="false"]', false, false],
  ['[disabled="true"]', true, false],
  ['[disabled=""]', true, true],
])(".a%s with disabled={%s} matches: %s", (attribute, disabled, expected) => {
  registerCSS(`.a${attribute} { width: 37px; }`);
  render(<TextInput testID={testID} className="a" disabled={disabled} />);
  expect(screen.getByTestId(testID).props.style?.width === 37).toBe(expected);
});
