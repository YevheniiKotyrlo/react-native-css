import { StrictMode, Suspense, use, useLayoutEffect } from "react";
import { Text } from "react-native";

import { act, render } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";
import { useNativeVariable } from "react-native-css/native";
import {
  rootVariables,
  StyleCollection,
} from "react-native-css/native-internal";

import { cleanupEffect, observable, vw } from "../../native/reactivity";

test("cleaned observers receive no later notifications", () => {
  const value = observable(0);
  const effect = {
    observers: new Set<import("../../native/reactivity").Observable<unknown>>(),
    run: jest.fn(),
  };
  value.get(effect);
  value.set(1);
  expect(effect.run).toHaveBeenCalledTimes(1);
  cleanupEffect(effect);
  value.set(2);
  expect(effect.run).toHaveBeenCalledTimes(1);
  expect(value.observers.size).toBe(0);
});

test("native variable hook releases its subscription on unmount", () => {
  const value = rootVariables("audit-hook-lifecycle");
  value.set([[10]]);
  const before = value.observers.size;
  function Sample() {
    const current = useNativeVariable("--audit-hook-lifecycle");
    return <Text testID="value">{String(current)}</Text>;
  }
  const screen = render(<Sample />);
  expect(screen.getByTestId("value").props.children).toBe("10");
  act(() => {
    value.set([[20]]);
  });
  expect(screen.getByTestId("value").props.children).toBe("20");
  screen.unmount();
  expect(value.observers.size).toBe(before);
});

test("viewport styles release their subscription on unmount", () => {
  registerCSS(".audit-lifecycle { width: 10vw; }");
  const before = vw.observers.size;
  const screen = render(<View testID="sample" className="audit-lifecycle" />);
  expect(screen.getByTestId("sample").props.style.width).toBeGreaterThan(0);
  expect(vw.observers.size).toBeGreaterThan(before);
  screen.unmount();
  expect(vw.observers.size).toBe(before);
});

test("variable subscriptions follow a changed variable name", () => {
  const first = rootVariables("audit-first");
  const second = rootVariables("audit-second");
  first.set([[10]]);
  second.set([[30]]);
  function Sample({ name }: { name: string }) {
    return <Text testID="value">{String(useNativeVariable(name))}</Text>;
  }
  const screen = render(<Sample name="audit-first" />);
  expect(first.observers.size).toBe(1);
  screen.rerender(<Sample name="audit-second" />);
  expect(screen.getByTestId("value").props.children).toBe("30");
  expect(first.observers.size).toBe(0);
  act(() => {
    second.set([[40]]);
  });
  expect(screen.getByTestId("value").props.children).toBe("40");
  screen.unmount();
  expect(second.observers.size).toBe(0);
});

test("a shared stylesheet remains reactive until its final consumer unmounts", () => {
  registerCSS(".audit-shared { width: 10vw; }");
  const original = vw.get();
  const before = vw.observers.size;
  const first = render(<View testID="first" className="audit-shared" />);
  const second = render(<View testID="second" className="audit-shared" />);
  first.unmount();
  act(() => {
    vw.set(500);
  });
  expect(second.getByTestId("second").props.style.width).toBe(50);
  second.unmount();
  expect(vw.observers.size).toBe(before);
  act(() => {
    vw.set(original);
  });
});

test("a remounted viewport consumer reads changes made while unmounted", () => {
  registerCSS(".audit-remount { width: 10vw; }");
  const original = vw.get();
  const first = render(<View testID="sample" className="audit-remount" />);
  first.unmount();
  act(() => {
    vw.set(600);
  });
  const second = render(<View testID="sample" className="audit-remount" />);
  expect(second.getByTestId("sample").props.style.width).toBe(60);
  second.unmount();
  act(() => {
    vw.set(original);
  });
});

test("StrictMode variable consumers remain reactive and release subscriptions", () => {
  const value = rootVariables("audit-strict-variable");
  value.set([[10]]);
  function Sample() {
    return (
      <Text testID="value">
        {String(useNativeVariable("audit-strict-variable"))}
      </Text>
    );
  }
  const screen = render(
    <StrictMode>
      <Sample />
    </StrictMode>,
  );
  act(() => {
    value.set([[20]]);
  });
  expect(screen.getByTestId("value").props.children).toBe("20");
  screen.unmount();
  expect(value.observers.size).toBe(0);
});

test("StrictMode viewport consumers remain reactive and release subscriptions", () => {
  registerCSS(".audit-strict-width { width: 10vw; }");
  const rules = StyleCollection.styles("audit-strict-width");
  const ruleCount = rules.observers.size;
  const original = vw.get();
  const before = vw.observers.size;
  const screen = render(
    <StrictMode>
      <View testID="sample" className="audit-strict-width" />
    </StrictMode>,
  );
  act(() => {
    vw.set(700);
  });
  expect(screen.getByTestId("sample").props.style.width).toBe(70);
  screen.unmount();
  expect(rules.observers.size).toBe(ruleCount);
  expect(vw.observers.size).toBe(before);
  act(() => {
    vw.set(original);
  });
});

function captureConsoleErrors() {
  const error = jest.spyOn(console, "error").mockImplementation(jest.fn());
  return {
    messages: () => error.mock.calls.map(([message]) => String(message)),
    restore: () => {
      error.mockRestore();
    },
  };
}

const neverResolves = new Promise<never>(jest.fn());

test("a viewport change between render and commit reaches the element once it commits", () => {
  registerCSS(".audit-render-window { width: 10vw; }");
  const original = vw.get();
  const errors = captureConsoleErrors();
  function ResizeDuringRender() {
    vw.set(800);
    return null;
  }
  try {
    const screen = render(
      <>
        <View testID="sample" className="audit-render-window" />
        <ResizeDuringRender />
      </>,
    );
    expect(errors.messages()).toEqual([]);
    expect(screen.getByTestId("sample").props.style.width).toBe(80);
    screen.unmount();
  } finally {
    errors.restore();
    act(() => {
      vw.set(original);
    });
  }
});

test("a render React discards leaves no subscription and takes no later update", async () => {
  registerCSS(".audit-discarded-render { width: 10vw; }");
  const original = vw.get();
  const before = vw.observers.size;
  const errors = captureConsoleErrors();
  function NeverResolves() {
    return use(neverResolves);
  }
  try {
    const screen = render(
      <Suspense fallback={<Text testID="fallback">loading</Text>}>
        <View testID="sample" className="audit-discarded-render" />
        <NeverResolves />
      </Suspense>,
    );
    expect(screen.getByTestId("fallback")).toBeTruthy();
    expect(screen.queryByTestId("sample")).toBeNull();
    await Promise.resolve();
    expect(vw.observers.size).toBe(before);
    act(() => {
      vw.set(900);
    });
    expect(
      errors
        .messages()
        .filter((message) => message.includes("hasn't mounted yet")),
    ).toEqual([]);
    screen.unmount();
  } finally {
    errors.restore();
    act(() => {
      vw.set(original);
    });
  }
});

test("committing an element computes none of the styles its render read", () => {
  registerCSS(".audit-commit-read { width: 10vw; }");
  const reads = jest.spyOn(vw, "get");
  const counted: { rendered?: number; committed?: number } = {};
  function CountReads() {
    counted.rendered = reads.mock.calls.length;
    useLayoutEffect(() => {
      counted.committed = reads.mock.calls.length;
    }, []);
    return null;
  }
  try {
    const screen = render(
      <>
        {Array.from({ length: 10 }, (_, index) => (
          <View key={index} className="audit-commit-read" />
        ))}
        <CountReads />
      </>,
    );
    expect(counted.rendered).toBeGreaterThan(0);
    expect(counted.committed).toBe(counted.rendered);
    screen.unmount();
  } finally {
    reads.mockRestore();
  }
});

test("class changes detach the old rule subscription", () => {
  registerCSS(
    ".audit-rule-first { width: 10px; } .audit-rule-second { width: 20px; }",
  );
  const first = StyleCollection.styles("audit-rule-first");
  const second = StyleCollection.styles("audit-rule-second");
  const screen = render(<View testID="sample" className="audit-rule-first" />);
  expect(first.observers.size).toBe(1);
  screen.rerender(<View testID="sample" className="audit-rule-second" />);
  expect(screen.getByTestId("sample").props.style.width).toBe(20);
  expect(first.observers.size).toBe(0);
  screen.unmount();
  expect(second.observers.size).toBe(0);
});
