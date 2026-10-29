import { render, screen } from "@testing-library/react-native";
import { compile } from "react-native-css/compiler";
import { Text } from "react-native-css/components/Text";
import { registerCSS, testID } from "react-native-css/jest";

// Whether `.a` is red in Chromium 156, Firefox 157 and WebKit 27.2: browser-readings.json beside this file
const cases = [
  { selector: ".a, .b::wat", browsersStyleA: false },
  { selector: ".a, .b:wat", browsersStyleA: false },
  { selector: ".a, .b::before", browsersStyleA: true },
];

test.each(cases)(
  "$selector { color: red } styles .a as the browsers do: $browsersStyleA",
  ({ selector, browsersStyleA }) => {
    const css = `${selector} { color: red; }`;
    const compiled = compile(css);
    console.log(
      JSON.stringify({
        selector,
        rules: compiled.stylesheet().s?.map(([name]) => name),
        warnings: compiled.warnings(),
      }),
    );

    registerCSS(css);
    render(<Text testID={testID} className="a" />);

    const { style } = screen.getByTestId(testID).props;
    console.log(JSON.stringify({ selector, style }));

    expect(style !== undefined).toBe(browsersStyleA);
  },
);
