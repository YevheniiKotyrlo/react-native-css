import { fireEvent, render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

const parentID = "parent";
const childID = "child";

jest.useFakeTimers();

test("groups", () => {
  registerCSS(`
    .group\\/item .my-class {
      color: red;
    }
  `);

  render(
    <View testID={parentID} className="group/item will-change-container">
      <View testID={childID} className="my-class" />
    </View>,
  );

  const component = screen.getByTestId(childID);

  expect(component.props.style).toStrictEqual({ color: "#f00" });

  screen.rerender(
    <View testID={parentID} className="will-change-container">
      <View testID={childID} className="my-class" />
    </View>,
  );

  expect(component.props.style).toStrictEqual(undefined);
});

test("group - active", () => {
  registerCSS(
    `.group\\/item:active .my-class {
      background-color: red;
    }`,
  );

  render(
    <View testID={parentID} className="group/item">
      <View testID={childID} className="my-class" />
    </View>,
  );

  const parent = screen.getByTestId(parentID);
  const child = screen.getByTestId(childID);

  expect(child.props.style).toStrictEqual(undefined);

  fireEvent(parent, "pressIn");

  expect(child.props.style).toStrictEqual({ backgroundColor: "#f00" });
});

/**
 * The animated twin of the test above, asserted as far as jest can see it.
 *
 * The interpolated frames — `rgba(151, 0, 0, 1)` half way through a 1s colour
 * transition — belong to `react-native-reanimated`, whose CSS manager is
 * disabled under jest (`if (!IS_JEST)` in reanimated's `AnimatedComponent`).
 * `src/__tests__/native/animation-transition-state.test.tsx` carries the full
 * argument and pins the two hops react-native-css does own. What is left here,
 * and is this test's subject, is that an ANCESTOR-driven rule reaches the child
 * the same way a rule on the child's own class does: pre-wrapped, then handed
 * the target value.
 */
test("group - active (animated)", () => {
  registerCSS(`
    .group\\/item:active .my-class {
      color: red;
      transition: color 1s;
    }`);

  render(
    <View testID={parentID} className="group/item">
      <View testID={childID} className="my-class" />
    </View>,
  );

  const parent = screen.getByTestId(parentID);
  const child = screen.getByTestId(childID);

  expect(child.props.style).toStrictEqual(undefined);
  // The transition declaration wraps the child in reanimated's Animated
  // component up front, before the group is ever active — which is what lets
  // the style change without remounting.
  expect(child.props.collapsable).toBe(false);

  fireEvent(parent, "pressIn");

  jest.advanceTimersByTime(0);

  // The target value, in full, on the first frame. Interpolating between the
  // element's current colour and this one is reanimated's job.
  expect(child.props.style).toStrictEqual({ color: "#f00" });

  jest.advanceTimersByTime(500);
  expect(child.props.style).toStrictEqual({ color: "#f00" });

  jest.advanceTimersByTime(500);
  expect(child.props.style).toStrictEqual({ color: "#f00" });
});

test("group selector", () => {
  registerCSS(
    `.my-a.my-b .my-class {
      color: red;
    }`,
  );

  const { rerender } = render(
    <View className="my-a my-b">
      <View testID={childID} className="my-class" />
    </View>,
  );

  const child = screen.getByTestId(childID);

  expect(child.props.style).toStrictEqual({ color: "#f00" });

  rerender(
    <View className="my-b">
      <View testID={childID} className="my-class" />
    </View>,
  );

  expect(child.props.style).toStrictEqual(undefined);
});
