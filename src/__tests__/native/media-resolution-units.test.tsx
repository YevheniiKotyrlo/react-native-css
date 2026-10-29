import { PixelRatio } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

test.each([
  ["(min-resolution: 2dppx)", true],
  ["(min-resolution: 192dpi)", true],
  ["(min-resolution: 300dpi)", false],
  ["(min-resolution: 75dpcm)", true],
  ["(min-resolution: 100dpcm)", false],
])(`on a ${PixelRatio.get()}x screen, @media %s matches: %s`, (condition, expected) => {
  registerCSS(`.a { width: 10px; } @media ${condition} { .a { width: 37px; } }`);
  render(<View testID={testID} className="a" />);
  expect(screen.getByTestId(testID).props.style.width === 37).toBe(expected);
});
