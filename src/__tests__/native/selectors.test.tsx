import { act, render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { colorScheme } from "react-native-css/runtime";

/**
 * All three tests below are the same feature: Tailwind's class-based dark mode
 * (`darkMode: 'class'` / `'selector'`), where `colorScheme` drives a class on a
 * notional root element and selectors test for it. None of the halves of that
 * feature exists.
 *
 * What DOES exist, and is what a reader should reach for meanwhile, is the
 * media-query route: `colorScheme.set("dark")` switches
 * `@media (prefers-color-scheme: dark)`, including for `:root` variables.
 * `src/__tests__/native/media-query.test.tsx` and
 * `src/__tests__/native/variables.test.tsx` pin that.
 */

/**
 * SKIPPED — the selector half of this works; the dark-class half does not
 * exist.
 *
 * `.my-class:is(.dark *)` compiles to exactly what `.dark .my-class` compiles
 * to: `.dark` registers the container group `g:dark` and the rule carries
 * `cq: [{ n: "g:dark" }]`. `selector-gaps.test.tsx`'s ":where() keeps the
 * descendant form as an ancestor container query" pins both the compiled shape
 * and that it matches at runtime under a real ancestor.
 *
 * So the rule matches when an ANCESTOR ELEMENT carries `className="dark"`.
 * This test has no such ancestor: it renders the element alone and expects
 * `colorScheme.set("dark")` to satisfy the ancestor. Nothing connects those —
 * `CompilerCollection.darkMode` (`compiler/compiler.types.ts`) is declared and
 * never assigned or read, and `@cssInterop set darkMode class dark;` is not
 * parsed at all: it compiles with the warning
 * `{ syntax: ["Unknown at rule: @cssInterop"] }`.
 *
 * To run: a `darkMode` compile option, plus a runtime notion of a root element
 * whose class list `colorScheme` drives. A reader knows it has landed when
 * compiling a stylesheet that configures dark mode stops warning about an
 * unknown at-rule.
 */
test.skip(":is(.dark *)", () => {
  registerCSS(`@cssInterop set darkMode class dark;
.my-class:is(.dark *) { color: red; }`);

  render(<View testID={testID} className="my-class" />);

  const component = screen.getByTestId(testID);

  expect(component.props.style).toStrictEqual(undefined);

  act(() => {
    colorScheme.set("dark");
  });

  expect(component.props.style).toStrictEqual({ color: "#f00" });
});

/**
 * SKIPPED — the `:root[class="dark"]` rule is dropped whole, silently.
 *
 * `getClassNameSelectors` (`compiler/selector-builder.ts`) routes a selector to
 * the root-variable branch only when `isRootVariableSelector` holds, and that
 * requires the selector to be nothing but `:root`. With an attribute attached,
 * the selector goes to `parseComponents` instead, where `:root` reaches the
 * `pseudo-class` `default` branch, `formStatePropQuery("root")` yields nothing
 * and the selector returns `[]`.
 *
 * The whole rule therefore disappears — the compiled stylesheet has neither a
 * `vr` entry nor a rule — so `--my-var` is never declared and
 * `color: var(--my-var)` resolves to `{}` in BOTH colour schemes. Nothing
 * warns, so the rule reads as supported.
 *
 * To run: `:root` has to survive as a compound so an attribute selector can
 * qualify it, and the root element's `class` attribute has to be something the
 * runtime can test — which is the same missing piece as the test above. A
 * reader knows the first half has landed when compiling
 * `:root[class="dark"] { --my-var: red }` produces any output at all, whether a
 * rule or a warning.
 */
test.skip(':root[class="dark"]', () => {
  registerCSS(`@cssInterop set darkMode class dark;
:root[class="dark"] {
  --my-var: red;
}
.my-class {
  color: var(--my-var);
}`);

  render(<View testID={testID} className="my-class" />);

  const component = screen.getByTestId(testID);

  expect(component.props.style).toStrictEqual({});

  act(() => {
    colorScheme.set("dark");
  });

  expect(component.props.style).toStrictEqual({ color: "red" });
});

/**
 * SKIPPED — the same dropped selector as the test above, written with the
 * spec's token operator and the `@react-native` at-rule.
 *
 * `[class~="dark"]` is the form Selectors 4 §6.1 defines a class selector as,
 * and it is what the compiler's own class handling uses. It changes nothing
 * here: `:root[class~="dark"]` is dropped for the same reason
 * `:root[class="dark"]` is, and `color: var(--my-var)` resolves to `{}` in both
 * schemes.
 *
 * `@react-native { darkMode: dark; }` is at least recognised as an at-rule —
 * this CSS compiles with no warnings, unlike the `@cssInterop` spelling — but
 * `maybeMutateReactNativeOptions` (`compiler/atRules.ts`) returns without
 * reading the body, so the option reaches nothing.
 *
 * To run: the same two halves as the test above, plus a parsed `@react-native`
 * body. A reader knows the last of those has landed when an unknown key inside
 * `@react-native` produces a warning instead of nothing.
 */
test.skip(':root[class~="dark"]', () => {
  registerCSS(`
    @react-native {
      darkMode: dark;
    }

    :root[class~="dark"] {
      --my-var: red;
    }
    .my-class {
      color: var(--my-var);
    }
  `);

  render(<View testID={testID} className="my-class" />);

  const component = screen.getByTestId(testID);

  expect(component.props.style).toStrictEqual({});

  act(() => {
    colorScheme.set("dark");
  });

  expect(component.props.style).toStrictEqual({ color: "red" });
});
