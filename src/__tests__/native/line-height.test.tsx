import { render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

/**
 * `line-height` resolution.
 *
 * The default rem in tests is 14, so a unitless line-height with no font-size
 * in scope resolves against that.
 */

test("line-height in px is absolute", () => {
  registerCSS(`.a { line-height: 32px; }`);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ lineHeight: 32 });
});

test("a unitless line-height multiplies the root font size", () => {
  registerCSS(`.a { line-height: 1.5; }`);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ lineHeight: 21 });
});

test("a unitless line-height multiplies an inherited font size", () => {
  // `--__rn-css-em` is published to the subtree, so a child resolves against
  // its ancestor's font size.
  registerCSS(`.p { font-size: 24px; } .c { line-height: 1.5; }`);

  const component = render(
    <View className="p">
      <Text testID={testID} className="c" />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual([
    { fontSize: 24 },
    { lineHeight: 36 },
  ]);
});

test("line-height in rem is absolute, not multiplied twice", () => {
  registerCSS(`.a { line-height: 2rem; }`);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toStrictEqual({ lineHeight: 28 });
});

test("the `font` shorthand's line-height resolves the same way", () => {
  registerCSS(`.a { font: 24px/1.5 Arial; }`);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  // 1.5 x the size declared in the SAME shorthand. `parseFont` publishes
  // `--__rn-css-em` alongside its font-size exactly as the longhand does, so
  // the two spellings of this declaration agree; the shorthand previously fell
  // back to the root rem and gave 21.
  expect(component.props.style).toStrictEqual(
    expect.objectContaining({ lineHeight: 36 }),
  );
});

test("line-height: normal produces no lineHeight", () => {
  registerCSS(`.a { line-height: normal; }`);

  const component = render(<Text testID={testID} className="a" />).getByTestId(
    testID,
  );

  expect(component.props.style).toBeUndefined();
});
