// A React Native window has no browser toolbar to show or hide, so its small, large and dynamic viewports are the window, and vmin and vmax its shorter and longer side
import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

test.each([
  ["10dvw", 75],
  ["10svw", 75],
  ["10lvw", 75],
  ["10vi", 75],
  ["10vmin", 75],
  ["10vmax", 133.4],
])("width: %s on the 750x1334 jest window is %p", (length, width) => {
  registerCSS(`.child { width: ${length}; }`);
  render(<View testID="child" className="child" />);
  expect(screen.getByTestId("child").props.style).toStrictEqual({ width });
});

test.each([
  ["(width > 50vw)", true],
  ["(width > 50dvw)", true],
  ["(width > 50vmin)", true],
])(
  "@media %s on the 750x1334 jest window matches: %s",
  (condition, expected) => {
    registerCSS(`
    .child { width: 10px; }
    @media ${condition} { .child { width: 37px; } }
  `);
    render(<View testID="child" className="child" />);
    expect(screen.getByTestId("child").props.style.width === 37).toBe(expected);
  },
);
