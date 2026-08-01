import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { getAnimatedStyle } from "react-native-reanimated";

jest.useFakeTimers();

/**
 * SKIPPED — jest cannot observe a CSS transition, so nothing in this file can
 * assert what it is written to assert.
 *
 * react-native-css computes the transition and hands it to
 * `react-native-reanimated` as CSS-animation style keys. Reanimated routes
 * those through its native `CSSManager`, and `AnimatedComponent` constructs
 * that manager only when `!IS_JEST`
 * (`node_modules/react-native-reanimated/lib/module/css/component/AnimatedComponent.js`,
 * where `IS_JEST = !!process.env.JEST_WORKER_ID` in
 * `.../lib/module/common/constants.js`). No manager, no interpolation.
 *
 * `getAnimatedStyle` cannot see one either, for a second reason: it reads
 * `props.jestAnimatedStyle?.value` (`.../lib/module/jestUtils.js`), which is
 * populated by `useAnimatedStyle` worklets — a different surface from the CSS
 * one this library targets. Driving the first test below with the real helper
 * returns `{}` at every point on the timeline, while `props.style` goes
 * straight to `{ width: 100 }` on the first frame and stays there.
 *
 * What DOES test this pipeline is
 * `src/__tests__/native/animation-transition-state.test.tsx`: it pins the
 * compile hop and the resolve hop exactly, and pins the third hop as far as it
 * is observable — the style object handed over, and that reanimated's wrapper
 * rendered. The frames themselves need a device, or a test double standing in
 * for `CSSManager`.
 *
 * To run: either reanimated grows a jest-visible CSS-animation surface, or this
 * file moves to a runtime that is not jest. A reader knows the first has
 * happened when `getAnimatedStyle` on a transitioning component returns
 * anything but `{}`.
 */
describe.skip("transitions", () => {
  test("basic transition", () => {
    registerCSS(`
    .transition-width {
      transition-property: width;
      transition-duration: 1s;
    }

    .width-1 {
      width: 100;
    }
  `);

    render(<View testID={testID} className="transition-width" />);

    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({});

    // Nothing should happen
    jest.advanceTimersByTime(500);
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({});

    screen.rerender(
      <View testID={testID} className="transition-width width-1" />,
    );

    // Transitions start once the useEffect() runs
    jest.advanceTimersToNextTimer();
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({ width: 0 });

    // Check progress of transition
    jest.advanceTimersByTime(500);
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({ width: 50 });

    // Check it ends
    jest.advanceTimersByTime(500);
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({
      width: 100,
    });

    // And doesn't continue
    jest.advanceTimersByTime(500);
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({
      width: 100,
    });
  });

  test("updating transition", () => {
    registerCSS(`
    .transition-width {
      transition-property: width;
      transition-duration: 1s;
    }

    .width-1 {
      width: 100;
    }

    .width-2 {
      width: 200;
    }
  `);

    render(<View testID={testID} className="transition-width" />);
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({});

    screen.rerender(
      <View testID={testID} className="transition-width width-1" />,
    );
    // Transitions start once the useEffect() runs
    jest.advanceTimersToNextTimer();
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({ width: 0 });

    // Check progress of transition
    jest.advanceTimersByTime(1000);
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({
      width: 100,
    });

    screen.rerender(
      <View testID={testID} className="transition-width width-2" />,
    );
    jest.advanceTimersToNextTimer();
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({
      width: 100,
    });

    jest.advanceTimersByTime(500);
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({
      width: 150,
    });
  });

  test("removing transition", () => {
    registerCSS(`
    .transition-width {
      transition-property: width;
      transition-duration: 1s;
    }

    .width-1 {
      width: 100;
    }

    .width-2 {
      width: 200;
    }
  `);

    render(<View testID={testID} className="transition-width" />);

    render(<View testID={testID} className="transition-width" />);
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({});

    screen.rerender(
      <View testID={testID} className="transition-width width-1" />,
    );
    // Transitions start once the useEffect() runs
    jest.advanceTimersToNextTimer();
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({ width: 0 });

    // Check progress of transition
    jest.advanceTimersByTime(1000);
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({
      width: 100,
    });

    screen.rerender(<View testID={testID} className="transition-width" />);
    jest.advanceTimersToNextTimer();
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({
      width: 100,
    });

    jest.advanceTimersByTime(500);
    expect(getAnimatedStyle(screen.getByTestId(testID))).toEqual({ width: 50 });
  });
});
