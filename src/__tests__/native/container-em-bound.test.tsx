// A container query's em is the container's font size (CSS Conditional 5 §6.1), so 10em is 160px in a container that sets none
import { fireEvent, render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

test.each([
  ["(width > 10em)", true],
  ["(width > 30em)", false],
  ["not (width > 30em)", true],
])("@container %s in a 400px container matches: %s", (condition, expected) => {
  registerCSS(`
    .parent { container-type: size; }
    .child { width: 10px; }
    @container ${condition} { .child { width: 37px; } }
  `);
  render(
    <View testID="parent" className="parent">
      <View testID="child" className="child" />
    </View>,
  );
  fireEvent(screen.getByTestId("parent"), "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 200 } },
  });
  expect(screen.getByTestId("child").props.style.width === 37).toBe(expected);
});
