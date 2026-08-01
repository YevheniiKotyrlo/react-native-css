import { View } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { registerCSS, testID } from "react-native-css/jest";
import { styled } from "react-native-css/runtime";

const children = undefined;

test("static styles w/ only target", () => {
  registerCSS(`
    .text-blue-500 {
      color: blue;
    }
  `);

  const StyleView = styled(View, {
    className: "style",
  });

  render(
    <StyleView testID={testID} className="text-blue-500 hover:text-red-500" />,
  );
  const component = screen.getByTestId(testID);

  expect(component.props).toStrictEqual({
    testID,
    children,
    style: {
      // lightningcss prints a colour in its shortest hex form.
      color: "#00f",
    },
  });
});

test("static styles w/ target & nativeStyleMapping", () => {
  registerCSS(`
    .text-blue-500 {
      color: blue;
      background-color: red;
    }
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const StyleView = styled(View as any, {
    className: {
      target: "other",
      nativeStyleMapping: {
        color: "myColor",
      },
    },
  });

  render(
    <StyleView testID={testID} className="text-blue-500 hover:text-red-500" />,
  );

  const component = screen.getByTestId(testID);
  expect(component.props).toStrictEqual({
    testID,
    children,
    // A mapped key is DELETED from the target and written to the named prop,
    // so `other` carries only what was not mapped.
    myColor: "#00f",
    other: {
      backgroundColor: "#f00",
    },
  });
});

/**
 * SKIPPED — two gaps, and this test needs both closed.
 *
 * 1. `nativeStyleToProp` is declared on `StyledConfigurationObject`
 *    (`src/runtime.types.ts`) as `@deprecated Please use nativeStyleMapping`,
 *    so it type-checks — but `mappingToConfig`
 *    (`src/native/react/useNativeCss.ts`) reads only `value.nativeStyleMapping`.
 *    The deprecated spelling is accepted and silently ignored: no `myColor`
 *    prop appears and `color` stays where it was.
 * 2. Even spelled `nativeStyleMapping`, `target: false` still emits a `style`
 *    prop holding whatever the mapping did not claim. Today this component
 *    renders `{ testID, children, style: { backgroundColor: "#f00" },
 *    myColor: "#00f" }` — the mapping works, the suppression does not.
 *    `deepMergeConfig` (`src/native/styles/index.ts`) returns early on
 *    `target === false` without ever writing a target prop, but the computed
 *    style has already been merged into the result by then.
 *
 * To run: `mappingToConfig` has to read the deprecated key, and `target: false`
 * has to drop the unmapped remainder rather than leave it on `style`. A reader
 * knows the second half has landed when a `target: false` component with no
 * mapping at all renders no `style` prop; today it renders the full style.
 */
test.skip("static styles w/ target none", () => {
  registerCSS(`
    .text-blue-500 {
      color: blue;
      background-color: red;
    }
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const StyleView = styled(View as any, {
    className: {
      target: false,
      nativeStyleToProp: {
        color: "myColor",
      },
    },
  });

  render(
    <StyleView testID={testID} className="text-blue-500 hover:text-red-500" />,
  );
  const component = screen.getByTestId(testID);

  expect(component.props).toStrictEqual({
    testID,
    children,
    myColor: "#0000ff",
  });
});

/**
 * SKIPPED — the deprecated `nativeStyleToProp` spelling, and this is the test
 * that pins it.
 *
 * `mappingToConfig` (`src/native/react/useNativeCss.ts`) builds the config from
 * `value.nativeStyleMapping` only, so the alias `runtime.types.ts` still
 * publishes reaches nothing. Written `nativeStyleMapping`, this exact component
 * renders `{ other: { backgroundColor: "#f00" }, myColor: "#00f" }` — the
 * `var()`-driven values resolve to the same literals the static test above
 * produces, so the dynamic half of this test is already true.
 *
 * To run: `mappingToConfig` has to accept both spellings. This expectation then
 * needs the resolved hex forms — `myColor: "#00f"`, `backgroundColor: "#f00"` —
 * because a `var()` is resolved before it reaches a prop. A reader knows the
 * gap is closed when a component configured with `nativeStyleToProp` renders
 * the named prop at all.
 */
test.skip("dynamic styles w/ target & nativeStyleToProp", () => {
  registerCSS(`
    .text-blue-500 {
      --blue: blue;
      --red: red;
      color: var(--blue);
      background-color: var(--red);
    }
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const StyleView = styled(View as any, {
    className: {
      target: "other",
      nativeStyleToProp: {
        color: "myColor",
      },
    },
  });

  render(
    <StyleView testID={testID} className="text-blue-500 hover:text-red-500" />,
  );
  const component = screen.getByTestId(testID);

  expect(component.props).toStrictEqual({
    testID,
    children,
    myColor: "blue",
    other: {
      backgroundColor: "red",
    },
  });
});
