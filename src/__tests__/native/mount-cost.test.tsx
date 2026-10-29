import { View as RNView, type ViewProps } from "react-native";

import { performance } from "node:perf_hooks";

import { render } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

import * as rules from "../../native/react/rules";

const ELEMENTS = 500;
const WARM_UP_RUNS = 1;
const RUNS = 25;

const ARMS = [
  "react-native View",
  "react-native View in a function component",
  "css View, no className",
  "css View, className",
] as const;

type Arm = (typeof ARMS)[number];

const STYLE = { backgroundColor: "red", padding: 8 } as const;

function WrappedView(props: ViewProps) {
  return <RNView {...props} />;
}

function renderArm(arm: Arm) {
  const children = Array.from({ length: ELEMENTS }, (_, index) => {
    switch (arm) {
      case "react-native View":
        return <RNView key={index} style={STYLE} />;
      case "react-native View in a function component":
        return <WrappedView key={index} style={STYLE} />;
      case "css View, no className":
        return <View key={index} style={STYLE} />;
      case "css View, className":
        return <View key={index} className="box" />;
    }
  });
  return render(<RNView>{children}</RNView>);
}

/** react-test-renderer's instance tree holds composite and host components alike. */
interface ComponentInstance {
  readonly children: readonly (string | ComponentInstance)[];
}

function countComponentInstances(instance: ComponentInstance): number {
  return instance.children.reduce<number>(
    (count, child) =>
      typeof child === "string"
        ? count
        : count + countComponentInstances(child),
    1,
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

beforeEach(() => {
  registerCSS(`.box { background-color: red; padding: 8px; }`);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("a css View mounts one more component instance than a react-native View", () => {
  const instancesOf = (arm: Arm): number => {
    const result = renderArm(arm);
    const count = countComponentInstances(result.UNSAFE_root);
    result.unmount();
    return count;
  };

  const reactNative = instancesOf("react-native View");
  const wrapped = instancesOf("react-native View in a function component");
  const cssWithoutClassName = instancesOf("css View, no className");
  const cssWithClassName = instancesOf("css View, className");
  console.log(
    [
      `react-native View: ${String(reactNative)} instances for ${String(ELEMENTS)} elements`,
      `react-native View in a function component: ${String(wrapped)}`,
      `css View, no className: ${String(cssWithoutClassName)}`,
      `css View, className: ${String(cssWithClassName)}`,
    ].join("\n"),
  );

  expect(wrapped).toBe(reactNative + ELEMENTS);
  expect(cssWithoutClassName).toBe(reactNative + ELEMENTS);
  expect(cssWithClassName).toBe(reactNative + ELEMENTS);
});

test("every css View runs the rule pass when it mounts, className or not", () => {
  const updateRules = jest.spyOn(rules, "updateRules");
  const rulePassesOf = (arm: Arm): number => {
    updateRules.mockClear();
    renderArm(arm).unmount();
    return updateRules.mock.calls.length;
  };

  const withoutClassName = rulePassesOf("css View, no className");
  const withClassName = rulePassesOf("css View, className");
  console.log(
    [
      `css View, no className: ${String(withoutClassName)} rule passes for ${String(ELEMENTS)} elements`,
      `css View, className: ${String(withClassName)} rule passes for ${String(ELEMENTS)} elements`,
    ].join("\n"),
  );

  expect(withoutClassName).toBe(ELEMENTS);
  expect(withClassName).toBe(ELEMENTS);
});

test("the mount cost per element, react-native View against css View", () => {
  const samples: Record<Arm, number[]> = {
    "react-native View": [],
    "react-native View in a function component": [],
    "css View, no className": [],
    "css View, className": [],
  };

  for (let run = 0; run < WARM_UP_RUNS + RUNS; run += 1) {
    const rotation = run % ARMS.length;
    for (const arm of [...ARMS.slice(rotation), ...ARMS.slice(0, rotation)]) {
      const start = performance.now();
      const result = renderArm(arm);
      const elapsed = performance.now() - start;
      result.unmount();
      if (run >= WARM_UP_RUNS) {
        samples[arm].push(elapsed);
      }
    }
  }

  const baseline = median(samples["react-native View"]);
  console.log(
    [
      `mounting ${String(ELEMENTS)} elements, median of ${String(RUNS)} runs (Node ${process.version}, NODE_ENV=${process.env.NODE_ENV}, arm order rotated per run):`,
      ...ARMS.map((arm) => {
        const milliseconds = median(samples[arm]);
        const perElement = (milliseconds * 1000) / ELEMENTS;
        const spread = `${Math.min(...samples[arm]).toFixed(1)}-${Math.max(...samples[arm]).toFixed(1)} ms`;
        return `  ${arm}: ${milliseconds.toFixed(1)} ms (${spread}), ${perElement.toFixed(1)} µs per element, ${(milliseconds / baseline).toFixed(2)}x`;
      }),
    ].join("\n"),
  );

  for (const arm of ARMS) {
    expect(samples[arm]).toHaveLength(RUNS);
  }
});
