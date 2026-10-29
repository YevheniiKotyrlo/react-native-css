// A style() container query compares the container's computed custom property (CSS Conditional 5 §7.3); --theme is dark on the parent and unset on the other
import { fireEvent, render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

test.each([
  ["dark-parent", "style(--theme: dark)", true],
  ["dark-parent", "not style(--theme: dark)", false],
  ["plain-parent", "style(--theme: dark)", false],
  ["plain-parent", "not style(--theme: dark)", true],
])("in a %s, @container %s matches: %s", (parent, condition, expected) => {
  registerCSS(
    `
    .dark-parent { container-type: size; --theme: dark; }
    .plain-parent { container-type: size; }
    .child { width: 10px; }
    @container ${condition} { .child { width: 37px; } }
  `,
    { inlineVariables: false },
  );
  render(
    <View testID="parent" className={parent}>
      <View testID="child" className="child" />
    </View>,
  );
  fireEvent(screen.getByTestId("parent"), "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 200 } },
  });
  expect(screen.getByTestId("child").props.style.width === 37).toBe(expected);
});
