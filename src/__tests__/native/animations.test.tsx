import { render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import { getAnimatedStyle } from "react-native-reanimated";

jest.useFakeTimers();

/**
 * SKIPPED — jest cannot observe a CSS animation, so neither describe below can
 * assert what it is written to assert.
 *
 * react-native-css computes the animation and hands it to
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
 * one this library targets. On a component carrying an animation it returns
 * `{}` at every point on the timeline.
 *
 * What DOES test this pipeline is
 * `src/__tests__/native/animation-transition-state.test.tsx`: it pins the
 * compile hop and the resolve hop exactly — including that a keyframe body
 * resolves `var()`, `em` and `transform` at render time — and pins the third
 * hop as far as it is observable. The frames themselves need a device, or a
 * test double standing in for `CSSManager`.
 *
 * To run: either reanimated grows a jest-visible CSS-animation surface, or this
 * file moves to a runtime that is not jest. A reader knows the first has
 * happened when `getAnimatedStyle` on an animating component returns anything
 * but `{}`.
 */
describe.skip("animations", () => {
  test("basic animation", () => {
    registerCSS(`
    .animation-slide-in {
      animation-name: slide-in;
      animation-duration: 1s;
    }

    @keyframes slide-in {
      from {
        margin-left: 100%;
      }

      to {
        margin-left: 0%;
      }
    }
  `);

    render(<View testID={testID} className="animation-slide-in" />);

    const element = screen.getByTestId(testID);
    expect(getAnimatedStyle(element)).toMatchObject({
      marginLeft: "100%",
    });
  });
});

/** SKIPPED for the same reason as the describe above. */
describe.skip("animation", () => {
  test("updating animation", () => {
    registerCSS(`
    .animation-slide-in {
      animation-name: slide-in;
      animation-duration: 1s;
    }

    .animation-slide-down {
      animation-name: slide-down;
      animation-duration: 1s;
    }

    @keyframes slide-in {
      from {
        margin-left: 100%;
      }

      to {
        margin-left: 0%;
      }
    }

    @keyframes slide-down {
      from {
        margin-top: 0%;
      }

      to {
        margin-top: 50%;
      }
    }
  `);

    render(<View testID={testID} className="animation-slide-in" />);

    expect(getAnimatedStyle(screen.getByTestId(testID))).toMatchObject({
      marginLeft: "100%",
    });

    screen.rerender(<View testID={testID} className="animation-slide-down" />);

    expect(getAnimatedStyle(screen.getByTestId(testID))).toMatchObject({
      marginTop: "0%",
    });

    jest.advanceTimersByTime(500);

    expect(getAnimatedStyle(screen.getByTestId(testID))).toMatchObject({
      marginTop: "25%",
    });
  });

  test("parsable shorthand animation", () => {
    registerCSS(`
    .animation-slide-in {
      animation: slide-in 1s;
    }

    @keyframes slide-in {
      from {
        margin-left: 100%;
      }

      to {
        margin-left: 0%;
      }
    }
  `);

    render(<View testID={testID} className="animation-slide-in" />);

    expect(getAnimatedStyle(screen.getByTestId(testID))).toMatchObject({
      marginLeft: "100%",
    });

    jest.advanceTimersByTime(1000);

    expect(getAnimatedStyle(screen.getByTestId(testID))).toMatchObject({
      marginLeft: "0%",
    });
  });

  test("unparsable shorthand animation", () => {
    registerCSS(`
    .animation-slide-in {
      --animation-name: slide-in;
      animation: var(--animation-name) 1s;
    }

    @keyframes slide-in {
      from {
        margin-left: 100%;
      }

      to {
        margin-left: 0%;
      }
    }
  `);

    render(<View testID={testID} className="animation-slide-in" />);

    expect(getAnimatedStyle(screen.getByTestId(testID))).toMatchObject({
      marginLeft: "100%",
    });

    jest.advanceTimersByTime(1000);

    expect(getAnimatedStyle(screen.getByTestId(testID))).toMatchObject({
      marginLeft: "0%",
    });
  });
});
