import { render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

/**
 * CSS *inherited* properties across a <View> → <Text> boundary.
 *
 * `color`, `font-*`, `letter-spacing`, `line-height`, `text-align` and
 * `text-transform` are inherited properties in CSS, but React Native inherits
 * none of them across a View — only Text → Text, natively. Without the
 * publish/consume pair these tests cover, `<View className="text-red-500">`
 * wrapping a bare `<Text>` renders red on web and React Native's default black
 * on native, from identical markup.
 */

test("a Text inherits color from a View ancestor", () => {
  registerCSS(`.text-red { color: red; }`);

  const component = render(
    <View className="text-red">
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "#f00" });
});

test("the Text's own class beats the inherited value", () => {
  registerCSS(`
    .text-red { color: red; }
    .text-blue { color: blue; }
  `);

  const component = render(
    <View className="text-red">
      <Text testID={testID} className="text-blue" />
    </View>,
  ).getByTestId(testID);

  // Inherited is PREPENDED, so the element's own resolved style wins under
  // React Native's last-one-wins array precedence.
  expect(component.props.style).toStrictEqual([
    { color: "#f00" },
    { color: "#00f" },
  ]);
});

test("an inline style prop beats the inherited value", () => {
  registerCSS(`.text-red { color: red; }`);

  const component = render(
    <View className="text-red">
      <Text testID={testID} style={{ color: "green" }} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual([
    { color: "#f00" },
    { color: "green" },
  ]);
});

test("the nearest ancestor wins over a farther one", () => {
  registerCSS(`
    .text-red { color: red; }
    .text-blue { color: blue; }
  `);

  const component = render(
    <View className="text-red">
      <View className="text-blue">
        <Text testID={testID} />
      </View>
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "#00f" });
});

test("every inherited property crosses the boundary, not just color", () => {
  registerCSS(`
    .typography {
      color: red;
      font-family: Arial;
      font-size: 24px;
      font-style: italic;
      font-weight: 700;
      letter-spacing: 2px;
      text-align: center;
      text-transform: uppercase;
    }
  `);

  const component = render(
    <View className="typography">
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    color: "#f00",
    fontFamily: "Arial",
    fontSize: 24,
    fontStyle: "italic",
    fontWeight: 700,
    letterSpacing: 2,
    textAlign: "center",
    textTransform: "uppercase",
  });
});

test("an inherited line-height resolves against the inherited font size", () => {
  // The interesting case, because `line-height` is the one inherited property
  // whose value DEPENDS on another inherited property: a unitless multiplier
  // resolves against `em`. Both cross the boundary, so the descendant computes
  // 1.5 x 24 rather than 1.5 x the root rem.
  registerCSS(`.lh { font-size: 24px; line-height: 1.5; }`);

  const component = render(
    <View className="lh">
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    fontSize: 24,
    lineHeight: 36,
  });
});

test("the `font` shorthand inherits through its longhands", () => {
  // The shorthand is expanded before the descriptor is published, so it needs
  // no special handling — this pins that, since a future change to `parseFont`
  // emitting a single `font` descriptor would silently stop it inheriting.
  registerCSS(`.font-shorthand { font: italic 700 24px/32px Arial; }`);

  const component = render(
    <View className="font-shorthand">
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    fontFamily: "Arial",
    fontSize: 24,
    fontStyle: "italic",
    // The shorthand RESETS `font-variant` to `normal` (css-fonts-4 §15.1), and
    // `normal` means "no variants", which React Native spells as the empty
    // list. It is not noise: it is what lets `font:` cancel a `small-caps` the
    // element would otherwise inherit.
    fontVariant: [],
    // A number here, where the `font-weight` longhand yields the string "700"
    // (see the property-coverage test above). That difference is the
    // shorthand parser's, not this feature's — pinned so it is visible rather
    // than surprising.
    fontWeight: 700,
    lineHeight: 32,
  });
});

test("NON-inherited properties do not cross the boundary", () => {
  // The whole point of the property set: a box property declared on an
  // ancestor must not land on a descendant's text style. If this fails, the
  // publish set has been widened past the CSS inherited set.
  registerCSS(`
    .box {
      background-color: red;
      margin: 10px;
      border-width: 2px;
      text-decoration-line: underline;
    }
  `);

  const component = render(
    <View className="box">
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toBeUndefined();
});

test("a nested Text is left to React Native's own Text-in-Text inheritance", () => {
  // React Native already inherits Text → Text natively, and does it BETTER:
  // that path carries `style`-prop values, which never appear as CSS
  // variables. Applying the inherited style here as well would override a
  // working mechanism with a worse one, so a Text with a Text ancestor is
  // deliberately untouched.
  registerCSS(`.text-red { color: red; }`);

  const screen = render(
    <View className="text-red">
      <Text>
        <Text testID={testID} />
      </Text>
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toBeUndefined();
});

test("a View does not receive inherited text style", () => {
  // Only components that render text opt in, via `inheritsTextStyle` on their
  // mapping. A View carrying these would be dead weight on every styled
  // element in the tree.
  registerCSS(`.text-red { color: red; }`);

  const component = render(
    <View className="text-red">
      <View testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toBeUndefined();
});

test("a Text with no styled ancestor is unchanged", () => {
  // The common case: nothing published, so nothing is applied and no style
  // object is fabricated.
  registerCSS(`.text-red { color: red; }`);

  const component = render(
    <View>
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toBeUndefined();
});

test("inherited values resolve through CSS variables", () => {
  // The published value is whatever the declaration held, including a `var()`
  // reference — so a themed ancestor inherits the resolved theme value, not
  // the literal `var(--brand)` string.
  registerCSS(`
    :root { --brand: rebeccapurple; }
    .themed { color: var(--brand); }
  `);

  const component = render(
    <View className="themed">
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "#639" });
});
