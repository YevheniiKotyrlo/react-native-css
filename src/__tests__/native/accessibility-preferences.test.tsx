// With no accessibility preference set, Chromium, Firefox and WebKit answer prefers-contrast no-preference, and WebKit inverted-colors none
import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

test.each([
  ["(prefers-contrast: no-preference)", true],
  ["not (prefers-contrast: more)", true],
  ["(prefers-reduced-transparency: no-preference)", true],
  ["(inverted-colors: none)", true],
])("with no preference set, @media %s matches: %s", (condition, expected) => {
  registerCSS(`
    .child { width: 10px; }
    @media ${condition} { .child { width: 37px; } }
  `);
  render(<View testID="child" className="child" />);
  expect(screen.getByTestId("child").props.style.width === 37).toBe(expected);
});
