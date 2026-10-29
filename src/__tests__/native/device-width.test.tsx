// device-width and device-height are the screen's (MQ4 Appendix A), which Dimensions.get("screen") reports
import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

test.each([
  ["(device-width)", true],
  ["(min-device-width: 1px)", true],
  ["not (max-device-width: 1px)", true],
  ["(min-device-height: 1px)", true],
])("@media %s matches: %s", (condition, expected) => {
  registerCSS(`
    .child { width: 10px; }
    @media ${condition} { .child { width: 37px; } }
  `);
  render(<View testID="child" className="child" />);
  expect(screen.getByTestId("child").props.style.width === 37).toBe(expected);
});
