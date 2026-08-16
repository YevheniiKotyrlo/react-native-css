/* eslint-disable @typescript-eslint/no-deprecated */
import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { vars } from "react-native-css/runtime";

// `vars()` is platform-split and `react-native-css/runtime` is its web half to
// TypeScript. The case below is about what the native implementation stores, so
// it reaches that implementation directly, as units.test.tsx does.
import { vars as nativeVars } from "../../native/api";

test("vars", () => {
  registerCSS(
    `.my-class {
        color: var(--color);
      }`,
  );

  render(
    <View
      testID={testID}
      className="my-class"
      style={vars({ color: "red" })}
    />,
  );

  const element = screen.getByTestId(testID);
  expect(element.props.style).toMatchObject({
    color: "red",
  });

  screen.rerender(
    <View
      testID={testID}
      className="my-class"
      style={vars({ color: "blue" })}
    />,
  );

  expect(element.props.style).toMatchObject({
    color: "blue",
  });
});

test("vars: an array is a list the declaration consumes", () => {
  registerCSS(`.my-class { font-variant-caps: var(--font-variant); }`);

  render(
    <View
      testID={testID}
      className="my-class"
      style={vars({ "--font-variant": ["small-caps"] })}
    />,
  );

  // `fontVariant` is one of the React Native style properties that takes an
  // array, so the list has to survive the variable pipeline as a list.
  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    fontVariant: ["small-caps"],
  });
});

test("vars: undefined leaves the property unset", () => {
  registerCSS(`
    .my-class { color: var(--color); }
    .green { --color: green; }
  `);

  render(
    <>
      <View
        testID={testID}
        className="my-class green"
        style={vars({ color: undefined })}
      />
      <View testID="no-inline-vars" className="my-class green" />
    </>,
  );

  // The class still sets `--color`, so leaving the inline value unset lets it
  // through rather than blanking the property.
  //
  // Asserted against the element that carries no inline vars at all rather than
  // against a literal, because the literal would be a second claim: a named
  // colour reaches this property as the raw token `green` through a custom
  // property and as `#008000` when the declaration names it directly, and which
  // of those arrives is not what this test is about. The comparison is also the
  // stronger assertion — it fails if the class's value comes through CHANGED,
  // which a literal spelling of the expected value cannot see.
  expect(screen.getByTestId(testID).props.style).toStrictEqual(
    screen.getByTestId("no-inline-vars").props.style,
  );
  expect(screen.getByTestId(testID).props.style).toHaveProperty("color");
});

test("vars does not create a key for an undefined value", () => {
  const inline = nativeVars({ "--defined": "red", "--absent": undefined });

  expect(Object.keys(inline)).toStrictEqual(["defined"]);
  expect("absent" in inline).toBe(false);
});
