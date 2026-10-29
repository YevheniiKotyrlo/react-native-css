import { processColor } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

test("an hsla() alpha read through a theme variable keeps its colour", () => {
  registerCSS(`
    :root { --primary: 0 84.2% 60.2% / 60%; }
    .dark { --primary: 0 72.2% 50.6% / 60%; }
    .a { color: hsla(var(--primary)); }
  `);

  render(<View testID={testID} className="a" />);
  const { color } = screen.getByTestId(testID).props.style;

  expect({ color, processed: processColor(color) }).toEqual({
    color: "#ef444499",
    processed: expect.any(Number),
  });
});

test("the same colour written directly", () => {
  registerCSS(`.a { color: hsla(0 84.2% 60.2% / 60%); }`);

  render(<View testID={testID} className="a" />);
  const { color } = screen.getByTestId(testID).props.style;

  expect({ color, processed: processColor(color) }).toEqual({
    color: "#ef444499",
    processed: expect.any(Number),
  });
});
