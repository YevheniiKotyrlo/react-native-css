import { act, render, screen } from "@testing-library/react-native";
import { Pressable } from "react-native-css/components/Pressable";
import { ScrollView } from "react-native-css/components/ScrollView";
import { Text } from "react-native-css/components/Text";
import { TextInput } from "react-native-css/components/TextInput";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { colorScheme } from "react-native-css/runtime";

/**
 * Edge cases for CSS property inheritance across a <View> → <Text> boundary.
 *
 * `inheritance.test.tsx` pins the mechanism. This file pins its BOUNDARIES:
 * where the published set stops, where the Text-ancestor guard stops, how two
 * publishing ancestors compose, and what a `var()` reference does once it has
 * crossed the boundary and is re-resolved in a different variable scope.
 */

/* Composition of ancestors *************************************************/

test("an intermediate element that publishes nothing does not break the chain", () => {
  // The value rides the VariableContext, and each styled element re-provides
  // only what it declares. A middle layer that declares only box properties
  // must therefore leave the inherited text properties intact rather than
  // shadowing them with an empty scope.
  registerCSS(`
    .deep-red { color: red; }
    .boxed { margin: 10px; padding: 4px; }
  `);

  const component = render(
    <View className="deep-red">
      <View>
        <View className="boxed">
          <Text testID={testID} />
        </View>
      </View>
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "#f00" });
});

test("two ancestors publishing different properties both reach the descendant", () => {
  // Inheritance is per-property, not per-element: a nearer ancestor that
  // declares `color` must not blank out a farther one's `font-size`. If the
  // publish were a single object the nearer scope would replace the whole set.
  registerCSS(`
    .sized { font-size: 24px; }
    .colored { color: red; }
  `);

  const component = render(
    <View className="sized">
      <View className="colored">
        <Text testID={testID} />
      </View>
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    color: "#f00",
    fontSize: 24,
  });
});

test("the nearer ancestor overrides only the property it declares", () => {
  // The sharp version of the case above: the outer element declares BOTH
  // properties and the inner overrides one. Shadowing must happen key by key.
  registerCSS(`
    .outer-type { color: red; font-size: 24px; letter-spacing: 2px; }
    .inner-color { color: blue; }
  `);

  const component = render(
    <View className="outer-type">
      <View className="inner-color">
        <Text testID={testID} />
      </View>
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({
    color: "#00f",
    fontSize: 24,
    letterSpacing: 2,
  });
});

test("two classes on one ancestor resolve by source order before publishing", () => {
  // Equal specificity, so the later rule wins — and the publish must reflect
  // the RESOLVED value, not the first declaration seen.
  registerCSS(`
    .first-color { color: red; }
    .second-color { color: blue; }
  `);

  const component = render(
    <View className="first-color second-color">
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "#00f" });
});

test("a sibling outside the styled subtree is untouched", () => {
  // Guards against the publish leaking through a shared module-level scope
  // rather than through the React tree.
  registerCSS(`.scoped-red { color: red; }`);

  render(
    <View>
      <View className="scoped-red">
        <Text testID="inside" />
      </View>
      <Text testID="outside" />
    </View>,
  );

  expect(screen.getByTestId("inside").props.style).toStrictEqual({
    color: "#f00",
  });
  expect(screen.getByTestId("outside").props.style).toBeUndefined();
});

/* The published property set ***********************************************/

test("font-variant crosses the boundary as the array React Native wants", () => {
  // The one property in the published set the mechanism test does not
  // exercise, and the only one whose published value is not a scalar.
  registerCSS(`.small-caps { font-variant: small-caps; }`);

  const component = render(
    <View className="small-caps">
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ fontVariant: ["small-caps"] });
});

test("cursor and writing-direction are in the published set in name only", () => {
  // SUSPECTED DEFECT: `cursor` and `writingDirection` are two of the twelve
  // entries in `INHERITED_TEXT_PROPERTIES` (`src/compiler/stylesheet.ts`), and
  // the comment above that map defends keeping `writingDirection` while
  // excluding its Yoga cousin `direction`. I expected both to cross the
  // boundary. Neither can: those two names appear nowhere else in the
  // compiler, so `parseDeclaration` rejects the declarations outright as
  // unsupported properties and `addDescriptor` is never reached. The ancestor
  // itself gets no style either, so nothing is published and nothing crosses.
  //
  // Measured: warnings `{ properties: ["cursor", "writing-direction"] }`; both
  // the View's and the Text's style `undefined`.
  const compiled = registerCSS(`
    .rest {
      cursor: pointer;
      writing-direction: rtl;
    }
  `);

  expect(compiled.warnings()).toStrictEqual({
    properties: ["cursor", "writing-direction"],
  });

  render(
    <View testID="ancestor" className="rest">
      <Text testID={testID} />
    </View>,
  );

  expect(screen.getByTestId("ancestor").props.style).toBeUndefined();
  expect(screen.getByTestId(testID).props.style).toBeUndefined();
});

test("the Yoga `direction` property is deliberately not published", () => {
  // React Native cascades `direction` to descendants itself, so publishing it
  // would double-apply. It travels the `__rn-css-direction` channel instead —
  // this pins that the two channels stay separate, since routing it through the
  // inherit prefix would land `direction` in a Text's style.
  //
  // The declaration writes both React Native keys, because they are different
  // properties and the compiler does not know which component will carry the
  // class: `direction` is Yoga's layout direction and `writingDirection` is the
  // Text-side bidi setting. A key the component cannot use is inert, exactly as
  // `fontSize` is on a View, and both are in React Native's own style whitelist
  // (`ReactNativeStyleAttributes.js`).
  registerCSS(`.rtl { direction: rtl; }`);

  render(
    <View testID="ancestor" className="rtl">
      <Text testID={testID} />
    </View>,
  );

  expect(screen.getByTestId("ancestor").props.style).toStrictEqual({
    direction: "rtl",
    writingDirection: "rtl",
  });
  expect(screen.getByTestId(testID).props.style).toBeUndefined();
});

test("text-shadow does not cross the boundary in pieces", () => {
  // Inherited in CSS, but its offset compiles to a nested path a flat variable
  // cannot carry. Publishing colour and radius alone would draw a descendant's
  // shadow at offset 0,0 — a WRONG shadow rather than a missing one — so the
  // whole property is excluded.
  registerCSS(`.shadowed { text-shadow: 2px 4px 6px red; }`);

  render(
    <View testID="ancestor" className="shadowed">
      <Text testID={testID} />
    </View>,
  );

  expect(screen.getByTestId("ancestor").props.style).toStrictEqual({
    textShadowColor: "#f00",
    textShadowOffset: { height: 4, width: 2 },
    textShadowRadius: 6,
  });
  expect(screen.getByTestId(testID).props.style).toBeUndefined();
});

test("a text-decoration declared on an ancestor stays put", () => {
  // Not an inherited property in CSS — it propagates by being drawn across
  // descendants, which React Native already does. Publishing it would paint a
  // second underline that no ancestor asked for.
  registerCSS(`
    .decorated { text-decoration-line: underline; text-decoration-color: red; }
  `);

  const component = render(
    <View className="decorated">
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toBeUndefined();
});

/* Conditional rules ********************************************************/

test("a rule whose media query does not match publishes nothing", () => {
  // Publishing happens per-rule, so an unmatched rule must contribute no
  // variable at all — not a variable holding the unmatched value.
  registerCSS(`
    @media (prefers-color-scheme: dark) {
      .dark-only { color: red; }
    }
  `);

  const component = render(
    <View className="dark-only">
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toBeUndefined();
});

test("switching colour scheme re-publishes and the descendant follows", () => {
  // The `dark:` case. The descendant never re-renders on its own — it is the
  // ancestor's re-render swapping the VariableContext value that must carry
  // through, so this pins the reactive edge rather than the static one.
  registerCSS(`
    .themed-text { color: blue; }
    @media (prefers-color-scheme: dark) {
      .themed-text { color: red; }
    }
  `);

  render(
    <View className="themed-text">
      <Text testID={testID} />
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#00f",
  });

  act(() => {
    colorScheme.set("dark");
  });

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });
});

test("a property that exists only under `dark:` starts crossing when the scheme flips", () => {
  // Sharper than the colour case, because `color` already travelled a variable
  // channel of its own, for currentcolor, before this
  // feature. `font-weight` had none, so this is a rule whose match toggles the
  // EXISTENCE of the published variable rather than its value.
  registerCSS(`
    @media (prefers-color-scheme: dark) {
      .dark-bold { font-weight: 700; }
    }
  `);

  render(
    <View className="dark-bold">
      <Text testID={testID} />
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toBeUndefined();

  act(() => {
    colorScheme.set("dark");
  });

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    fontWeight: 700,
  });
});

test("changing the ancestor's className updates an already-mounted descendant", () => {
  registerCSS(`
    .was-red { color: red; }
    .now-blue { color: blue; }
  `);

  const { rerender } = render(
    <View className="was-red">
      <Text testID={testID} />
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#f00",
  });

  rerender(
    <View className="now-blue">
      <Text testID={testID} />
    </View>,
  );

  expect(screen.getByTestId(testID).props.style).toStrictEqual({
    color: "#00f",
  });
});

/* Variables ****************************************************************/

test("an unresolvable var() reference publishes nothing rather than a null style", () => {
  registerCSS(`
    :root { --defined: red; }
    @media (prefers-color-scheme: dark) { :root { --defined: blue; } }
    .missing-var { color: var(--not-defined); }
  `);

  const component = render(
    <View className="missing-var">
      <Text testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toBeUndefined();
});

test("an intermediate element redefining the variable changes the inherited value", () => {
  // SUSPECTED DEFECT: I expected `green` NOT to win here. In CSS a `var()` in
  // an inherited property is substituted at the element that DECLARES it, and
  // the computed value is what inherits — so `.brand-text` computes red and
  // every descendant gets red no matter what they do to `--brand`.
  //
  // A var() with two definitions defeats the compiler's single-definition
  // inliner, so the REFERENCE is what gets published, and `useNativeCss`
  // resolves it against the consuming element's own variable scope. The
  // intermediate redefinition therefore reaches back up and changes a value
  // computed above it. Measured: `{ color: "green" }`, where CSS gives red.
  //
  // Narrow in practice — a single-definition var is inlined at compile time
  // and immune — but it is exactly the shape a themed design system uses.
  //
  // The string `"green"` rather than `#008000` is the pre-existing var
  // pipeline, not this feature: a View resolving its OWN `color: var(--brand)`
  // through the same non-inlinable reference also yields `"green"`.
  registerCSS(`
    :root { --brand: red; }
    @media (prefers-color-scheme: dark) { :root { --brand: blue; } }
    .brand-text { color: var(--brand); }
    .rebrand { --brand: green; }
  `);

  const component = render(
    <View className="brand-text">
      <View className="rebrand">
        <Text testID={testID} />
      </View>
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "green" });
});

test("a variable redefined on the Text itself does not reach the inherited value", () => {
  // The boundary of the case above, and the one that lands on CSS's answer:
  // the consuming element resolves against its INHERITED variables, which do
  // not include the ones it declares for its own subtree. So an override on
  // the Text is invisible to the inherited colour — red, exactly as CSS
  // computes it at `.accent-text`.
  registerCSS(`
    :root { --accent: red; }
    @media (prefers-color-scheme: dark) { :root { --accent: blue; } }
    .accent-text { color: var(--accent); }
    .reaccent { --accent: green; }
  `);

  const component = render(
    <View className="accent-text">
      <Text testID={testID} className="reaccent" />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "red" });
});

test("an inherited font-size drives em units in the descendant's own declarations", () => {
  // `font-size` publishes twice — as an inherited property and as the `em`
  // basis — so a descendant sizing itself in `em` must land on the ancestor's
  // size, not the root font size.
  registerCSS(`
    .em-parent { font-size: 20px; }
    .em-child { letter-spacing: 2em; }
  `);

  const component = render(
    <View className="em-parent">
      <Text testID={testID} className="em-child" />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual([
    { fontSize: 20 },
    { letterSpacing: 40 },
  ]);
});

/* Which components publish, and which consume ******************************/

test("a Pressable publishes to its subtree even though it never consumes", () => {
  // Publishing is the compiler's, keyed on the declaration; consuming is the
  // component's, keyed on `inheritsTextStyle`. Any styled element is therefore
  // a valid source — inheritance is not a View-only path.
  registerCSS(`.pressable-type { color: red; font-size: 18px; }`);

  const component = render(
    <Pressable className="pressable-type">
      <Text testID={testID} />
    </Pressable>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "#f00", fontSize: 18 });
});

test("a ScrollView publishes from its own className", () => {
  registerCSS(`.scroll-type { color: red; }`);

  const component = render(
    <ScrollView className="scroll-type">
      <Text testID={testID} />
    </ScrollView>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "#f00" });
});

test("a ScrollView's contentContainerClassName publishes to the same subtree", () => {
  // The variables are hoisted per COMPONENT, not per config, so a declaration
  // routed to `contentContainerStyle` still reaches the children — which are
  // the content container's children, so this is the right answer even though
  // the two configs target different props.
  registerCSS(`.scroll-content-type { color: red; }`);

  const component = render(
    <ScrollView contentContainerClassName="scroll-content-type">
      <Text testID={testID} />
    </ScrollView>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "#f00" });
});

test("a TextInput does not consume inherited text properties", () => {
  registerCSS(`.input-type { color: red; }`);

  const component = render(
    <View className="input-type">
      <TextInput testID={testID} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toBeUndefined();
});

/* The Text-ancestor guard **************************************************/

test("a Text nested three deep is still left to React Native", () => {
  // The guard is monotonic, so it must hold at every depth rather than only
  // for the first nested Text.
  registerCSS(`.deep-text { color: red; }`);

  render(
    <View className="deep-text">
      <Text testID="depth-1">
        <Text testID="depth-2">
          <Text testID="depth-3" />
        </Text>
      </Text>
    </View>,
  );

  expect(screen.getByTestId("depth-1").props.style).toStrictEqual({
    color: "#f00",
  });
  expect(screen.getByTestId("depth-2").props.style).toBeUndefined();
  expect(screen.getByTestId("depth-3").props.style).toBeUndefined();
});

test("a View between two Texts restores inheritance", () => {
  // React Native's own `View` RESETS `TextAncestorContext` to `false`
  // (`react-native/Libraries/Components/View/View.js`), so an inline View
  // breaks the native Text-in-Text chain. This library mirrors that reset via
  // `resetsTextAncestor` on the View mapping, so the CSS path takes over again
  // below it. Without the mirror BOTH mechanisms stood down and the Text
  // rendered React Native's default black.
  registerCSS(`.broken-chain { color: red; }`);

  const component = render(
    <View className="broken-chain">
      <Text>
        <View>
          <Text testID={testID} />
        </View>
      </Text>
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "#f00" });
});

test("a colour published BELOW a Text ancestor still reaches the Text", () => {
  // The sharper shape of the same fix: the colour is declared on the Text's
  // IMMEDIATE parent, below the only Text ancestor. There is nothing for the
  // native path to have carried down, so deferring to it dropped the colour
  // entirely. The View's reset makes the CSS path responsible again.
  registerCSS(`.below-text { color: red; }`);

  const component = render(
    <Text>
      <View className="below-text">
        <Text testID={testID} />
      </View>
    </Text>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ color: "#f00" });
});

/* Merging with the element's own style *************************************/

test("an element that inherits nothing keeps a plain object, not an array", () => {
  // The "only className should not create an array" behaviour has to survive
  // the inherited-style branch: fabricating `[undefined, own]` would change
  // the shape of every styled Text in an app that inherits nothing.
  registerCSS(`
    .box-only { margin: 10px; background-color: red; }
    .own-size { font-size: 12px; }
  `);

  const component = render(
    <View className="box-only">
      <Text testID={testID} className="own-size" />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual({ fontSize: 12 });
});

test("a partial override leaves the untouched inherited properties in the first slot", () => {
  // React Native flattens the array last-one-wins, so the inherited object has
  // to keep the properties the element does NOT redeclare — the element's own
  // object is not a replacement for the whole inherited set.
  registerCSS(`
    .full-type { color: red; font-size: 24px; text-align: center; }
    .just-color { color: blue; }
  `);

  const component = render(
    <View className="full-type">
      <Text testID={testID} className="just-color" />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual([
    { color: "#f00", fontSize: 24, textAlign: "center" },
    { color: "#00f" },
  ]);
});

test("an inline style prop overriding one inherited property keeps the rest", () => {
  registerCSS(`.inline-type { color: red; font-size: 24px; }`);

  const component = render(
    <View className="inline-type">
      <Text testID={testID} style={{ fontSize: 10 }} />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual([
    { color: "#f00", fontSize: 24 },
    { fontSize: 10 },
  ]);
});

test("a className and an inline style both compose after the inherited object", () => {
  registerCSS(`
    .compose-type { color: red; font-size: 24px; }
    .compose-own { color: blue; }
  `);

  const component = render(
    <View className="compose-type">
      <Text
        testID={testID}
        className="compose-own"
        style={{ letterSpacing: 3 }}
      />
    </View>,
  ).getByTestId(testID);

  expect(component.props.style).toStrictEqual([
    { color: "#f00", fontSize: 24 },
    [{ color: "#00f" }, { letterSpacing: 3 }],
  ]);
});
