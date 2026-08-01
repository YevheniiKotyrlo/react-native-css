import { act, render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { colorScheme } from "react-native-css/runtime";

/**
 * The three routes a declaration can take, for the properties whose value is a
 * KEYWORD the compiler translates rather than a length it passes through.
 *
 * - **literal** — the value is known at compile time.
 * - **inlinable** — the value comes from a custom property with exactly ONE
 *   definition in a universal scope, which the compiler folds into the
 *   reference. From there it is a literal.
 * - **deferred** — the value comes from a custom property with more than one
 *   definition (a dark-mode override is the ordinary shape), so which one
 *   applies is only known at runtime.
 *
 * All three must produce the same style for the same value. A property that
 * validates its keyword at COMPILE time has nothing to validate on the deferred
 * route, and dropping the declaration there is what makes a theme variable
 * silently do nothing — the literal spelling works, so the fault reads as a
 * problem with the theme rather than with the property.
 *
 * `border-width` is the control in each case: a length passes straight through,
 * so it exercises the same three routes with no keyword translation.
 */

const viewStyleOf = (className: string): unknown =>
  render(<View testID={testID} className={className} />).getByTestId(testID)
    .props.style as unknown;

const textStyleOf = (className: string): unknown =>
  render(<Text testID={testID} className={className} />).getByTestId(testID)
    .props.style as unknown;

test("a keyword property compiles on the literal route", () => {
  registerCSS(`
    .kp-lit-i { isolation: auto; }
    .kp-lit-fv { font-variant: small-caps tabular-nums; }
    .kp-lit-fvl { font-variant-ligatures: no-common-ligatures; }
    .kp-lit-cs { corner-shape: squircle; }
    .kp-lit-bw { border-width: 3px; }
  `);

  expect(viewStyleOf("kp-lit-i")).toStrictEqual({ isolation: "auto" });
  expect(textStyleOf("kp-lit-fv")).toStrictEqual({
    fontVariant: ["small-caps", "tabular-nums"],
  });
  expect(textStyleOf("kp-lit-fvl")).toStrictEqual({
    fontVariant: ["no-common-ligatures"],
  });
  expect(viewStyleOf("kp-lit-cs")).toStrictEqual({ borderCurve: "continuous" });
  expect(viewStyleOf("kp-lit-bw")).toStrictEqual({ borderWidth: 3 });
});

test("a keyword property compiles on the inlinable route", () => {
  // `:root` is a universal unconditional scope and each name is declared once,
  // so the compiler can prove every element has the value and folds it in.
  registerCSS(`
    :root {
      --kp-i: auto;
      --kp-fv: small-caps tabular-nums;
      --kp-fvl: no-common-ligatures;
      --kp-cs: squircle;
      --kp-bw: 3px;
    }
    .kp-inl-i { isolation: var(--kp-i); }
    .kp-inl-fv { font-variant: var(--kp-fv); }
    .kp-inl-fvl { font-variant-ligatures: var(--kp-fvl); }
    .kp-inl-cs { corner-shape: var(--kp-cs); }
    .kp-inl-bw { border-width: var(--kp-bw); }
  `);

  expect(viewStyleOf("kp-inl-i")).toStrictEqual({ isolation: "auto" });
  expect(textStyleOf("kp-inl-fv")).toStrictEqual({
    fontVariant: ["small-caps", "tabular-nums"],
  });
  expect(textStyleOf("kp-inl-fvl")).toStrictEqual({
    fontVariant: ["no-common-ligatures"],
  });
  expect(viewStyleOf("kp-inl-cs")).toStrictEqual({ borderCurve: "continuous" });
  expect(viewStyleOf("kp-inl-bw")).toStrictEqual({ borderWidth: 3 });
});

test("a keyword property compiles on the deferred route", () => {
  // A second definition under `@media` is what makes the value runtime-only:
  // the compiler cannot know which of the two an element will see, so nothing
  // is folded and the reference reaches the runtime intact.
  registerCSS(`
    :root {
      --kp2-i: auto;
      --kp2-fv: small-caps;
      --kp2-fvl: no-common-ligatures;
      --kp2-cs: squircle;
      --kp2-bw: 3px;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --kp2-i: isolate;
        --kp2-fv: tabular-nums;
        --kp2-fvl: common-ligatures;
        --kp2-cs: round;
        --kp2-bw: 5px;
      }
    }
    .kp-def-i { isolation: var(--kp2-i); }
    .kp-def-fv { font-variant: var(--kp2-fv); }
    .kp-def-fvl { font-variant-ligatures: var(--kp2-fvl); }
    .kp-def-cs { corner-shape: var(--kp2-cs); }
    .kp-def-bw { border-width: var(--kp2-bw); }
  `);

  expect(viewStyleOf("kp-def-i")).toStrictEqual({ isolation: "auto" });
  expect(textStyleOf("kp-def-fv")).toStrictEqual({
    fontVariant: ["small-caps"],
  });
  expect(textStyleOf("kp-def-fvl")).toStrictEqual({
    fontVariant: ["no-common-ligatures"],
  });
  expect(viewStyleOf("kp-def-cs")).toStrictEqual({ borderCurve: "continuous" });
  expect(viewStyleOf("kp-def-bw")).toStrictEqual({ borderWidth: 3 });
});

test("the deferred route follows the value when the scheme changes", () => {
  // The point of the deferred route: the declaration re-resolves in place. A
  // keyword property that only compiles its literal spelling cannot do this at
  // all, which is what makes the gap invisible — the light value is written
  // literally somewhere and the dark override is the half that goes missing.
  registerCSS(`
    :root { --kp3-i: auto; --kp3-cs: squircle; }
    @media (prefers-color-scheme: dark) {
      :root { --kp3-i: isolate; --kp3-cs: round; }
    }
    .kp-sw-i { isolation: var(--kp3-i); }
    .kp-sw-cs { corner-shape: var(--kp3-cs); }
  `);

  const isolation = render(
    <View testID="kp-sw-i" className="kp-sw-i" />,
  ).getByTestId("kp-sw-i");
  const curve = render(
    <View testID="kp-sw-cs" className="kp-sw-cs" />,
  ).getByTestId("kp-sw-cs");

  expect(isolation.props.style as unknown).toStrictEqual({ isolation: "auto" });
  expect(curve.props.style as unknown).toStrictEqual({
    borderCurve: "continuous",
  });

  act(() => {
    colorScheme.set("dark");
  });

  expect(isolation.props.style as unknown).toStrictEqual({
    isolation: "isolate",
  });
  expect(curve.props.style as unknown).toStrictEqual({
    borderCurve: "circular",
  });
});

test("a value React Native cannot render is rejected on the deferred route too", () => {
  // Validation cannot happen at compile time when the value is not known then,
  // so it has to happen at runtime. Passing the keyword through unchecked would
  // ship `borderCurve: "bevel"` — a value React Native ignores — where the
  // literal spelling reports it and emits nothing.
  registerCSS(`
    :root { --kp4-i: bananas; --kp4-cs: bevel; }
    @media (prefers-color-scheme: dark) {
      :root { --kp4-i: isolate; --kp4-cs: round; }
    }
    .kp-bad-i { isolation: var(--kp4-i); }
    .kp-bad-cs { corner-shape: var(--kp4-cs); }
  `);

  expect(viewStyleOf("kp-bad-i")).toStrictEqual({});
  expect(viewStyleOf("kp-bad-cs")).toStrictEqual({});
});

test("a custom property keeps `auto`, whatever eventually consumes it", () => {
  // CSS Variables Level 1 §2: a custom property's value is an arbitrary token
  // stream that means nothing until it is substituted, so `auto` cannot be
  // judged where it is declared. Rejecting it there emptied the variable, and
  // the property that WOULD have accepted the keyword got nothing — the literal
  // spelling of the same declaration worked, which is what made it look like a
  // problem with the variable rather than with `auto`.
  registerCSS(`
    :root { --kp5-pe: auto; }
    @media (prefers-color-scheme: dark) { :root { --kp5-pe: none; } }
    .kp-pe-literal { pointer-events: auto; }
    .kp-pe-var { pointer-events: var(--kp5-pe); }
  `);

  expect(viewStyleOf("kp-pe-literal")).toStrictEqual({ pointerEvents: "auto" });
  expect(viewStyleOf("kp-pe-var")).toStrictEqual({ pointerEvents: "auto" });
});
