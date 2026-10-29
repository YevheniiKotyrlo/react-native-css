// A math function in a media or container feature is its value (css-values-4 §10); a vw is one lightningcss cannot fold, and #426 resolves a bare vw in a condition against the 750x1334 jest window
import { fireEvent, render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

test.each([
  ["(min-width: 50vw)", true],
  ["(min-width: calc(50vw + 10px))", true],
  ["(min-width: calc(100vw + 10px))", false],
  ["not (min-width: calc(100vw + 10px))", true],
  ["(min-width: min(50vw, 400px))", true],
  ["(width > clamp(100px, 50vw, 800px))", true],
])("@media %s on the 750px jest window matches: %s", (condition, expected) => {
  registerCSS(`
    .child { width: 10px; }
    @media ${condition} { .child { width: 37px; } }
  `);
  render(<View testID="child" className="child" />);
  expect(screen.getByTestId("child").props.style.width === 37).toBe(expected);
});

test.each([
  ["(width > calc(50vw - 100px))", true],
  ["not (width > calc(50vw - 100px))", false],
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
