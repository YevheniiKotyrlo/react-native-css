/* eslint-disable */
import { createContext } from "react";
import {
  AccessibilityInfo,
  Appearance,
  Dimensions,
  type ColorSchemeName,
  type LayoutRectangle,
} from "react-native";

import type { StyleDescriptor } from "react-native-css/compiler";

export type Effect = {
  observers: Set<Effect>;
  run(): void;
};

export type Observable<Value, Arg = Value> = {
  observers: Set<Effect>;
  get: (effect?: Effect) => Value;
  set: (arg: Arg) => void;
  run: () => void;
};
type Read<Value, Arg> = (get: Getter, arg?: Arg) => Value;
export type Getter = <Value>(observable: Observable<Value, any>) => Value;

export const observableBatch: {
  current?: Set<Effect>;
} = {};

export function observable<Value, Arg = Value>(
  init: Value | Read<Value, Arg>,
  equality: (value1: Value, value2: Value) => boolean = Object.is,
) {
  let value: Value;
  let isStatic = typeof init !== "function";
  let didInit: boolean | undefined;
  let lastArg: Arg | undefined;

  if (typeof init !== "function") {
    value = init;
    didInit = true;
  }

  const observers = new Set<Effect>();
  const effect: Effect = {
    observers,
    run: () => {
      if (!isStatic) {
        const nextValue = (init as Read<Value, Arg>)(getter, lastArg);
        if (equality(value, nextValue)) {
          return;
        }
        value = nextValue;
      }

      notify();
    },
  };

  const getter: Getter = (observable) => observable.get(effect);

  function get(effect?: Effect) {
    if (effect) {
      observers.add(effect);
    }
    if (!didInit) {
      value = (init as Read<Value, Arg>)(getter, undefined);
    }

    return value;
  }

  function set(arg: Arg) {
    if (isStatic) {
      if (equality(value, arg as unknown as Value)) {
        return;
      }
      value = arg as unknown as Value;
    } else {
      const nextValue = (init as Read<Value, Arg>)(getter, arg);

      didInit = true;
      lastArg = arg;

      if (equality(value, nextValue)) {
        return;
      }
      value = nextValue;
    }

    notify();

    return obs;
  }

  function notify() {
    Array.from(observers).forEach((observer) => {
      if (observableBatch.current) {
        observableBatch.current.add(observer);
      } else {
        observer.run();
      }
    });
  }

  const obs: Observable<Value, Arg> = {
    observers,
    get,
    set,
    run: effect.run,
  };

  return obs;
}

export function cleanupEffect(effect: Effect) {
  if (!effect) return;
  for (const dep of effect.observers) {
    dep.observers.delete(effect);
  }
  effect.observers.clear();
}

/** Family Helpers ************************************************************/

export function family<Key, Result = Key, Args extends any = void>(
  fn: (key: Key, args: Args) => Result,
) {
  const map = new Map<Key, Result>();
  return Object.assign(
    (key: Key, args: Args) => {
      let value = map.get(key);
      if (!value) {
        value = fn(key, args);
        map.set(key, value);
      }
      return value;
    },
    {
      delete(key: Key) {
        return map.delete(key);
      },
      clear() {
        return map.clear();
      },
    },
  );
}

type WeakFamilyFn<Key, Args = undefined, Result = Key> = ((
  key: Key,
  args: Args,
) => Result) & {
  has(key: Key): boolean;
};

export function weakFamily<Key extends WeakKey, Result = Key>(
  fn: (key: Key) => Result,
): WeakFamilyFn<Key, void, Result>;
export function weakFamily<Key extends WeakKey, Args = undefined, Result = Key>(
  fn: (key: Key, args: Args) => Result,
): WeakFamilyFn<Key, Args, Result>;
export function weakFamily<Key extends WeakKey, Args = undefined, Result = Key>(
  fn: (key: Key, args: Args) => Result,
): WeakFamilyFn<Key, Args, Result> {
  const map = new WeakMap<Key, Result>();
  return Object.assign(
    (key: Key, args: Args) => {
      let value = map.get(key);
      if (!value) {
        value = fn(key, args);
        map.set(key, value);
      }
      return value;
    },
    {
      has: (key: Key) => map.has(key),
    },
  );
}

/********************************* Variables **********************************/

export const VAR_SYMBOL = Symbol.for("react-native-css.var");
export type VariableContextValue = Record<string, StyleDescriptor> & {
  [VAR_SYMBOL]: true;
};

/** Pseudo Classes ************************************************************/

export const hoverFamily = weakFamily(() => observable(false));
export const activeFamily = weakFamily(() => observable<boolean>(false));
export const focusFamily = weakFamily(() => observable<boolean>(false));

/** Dimensions ****************************************************************/

export const dimensions = observable(Dimensions.get("window"));
export const vw = observable<number>(
  (read, value) => value ?? read(dimensions)?.width,
);
export const vh = observable<number>(
  (read, value) => value ?? read(dimensions)?.height,
);

Dimensions.addEventListener("change", ({ window }) => {
  observableBatch.current = new Set();
  vw.set(window.width);
  vh.set(window.height);

  for (const effect of observableBatch.current) {
    effect.run();
  }

  observableBatch.current = undefined;
});

/** Color Scheme **************************************************************/

export const colorScheme = observable<ColorSchemeName>(
  Appearance.getColorScheme(),
);
Appearance.addChangeListener((event) => colorScheme.set(event.colorScheme));

/** Accessibility preferences *************************************************/

/**
 * An `AccessibilityInfo` flag as an observable, seeded from its getter and kept
 * current by its change event — the same shape `colorScheme` uses one line up,
 * so a style recomputes in place when the user changes the setting.
 *
 * The getters are asynchronous, so the flag reads `false` for the first frame
 * and settles immediately after. That is the same answer the platform gives
 * when it cannot detect the preference at all (each of these events is
 * single-platform), and it is the answer a browser gives on an OS without the
 * setting: the media feature reports its "no preference" value rather than
 * refusing to answer.
 */
function accessibilityFlag(
  read: () => Promise<boolean>,
  event:
    | "invertColorsChanged"
    | "reduceMotionChanged"
    | "reduceTransparencyChanged"
    | "highTextContrastChanged",
): Observable<boolean> {
  const flag = observable(false);

  // "Not detectable" arrives by two routes, and both mean the same thing.
  //
  // React Native REJECTS these getters — with `null` — when the platform has no
  // such native module: `isInvertColorsEnabled` on an Android build without the
  // method, `isReduceTransparencyEnabled` wherever `NativeAccessibilityManagerIOS`
  // is absent, which is every out-of-tree platform. Without the catch, importing
  // this module prints "Possible Unhandled Promise Rejection" at every app start,
  // whether or not the app uses these media features.
  //
  // It can also be ABSENT — a stub `AccessibilityInfo` under a bare test runner,
  // or a build predating the getter. Then the call throws SYNCHRONOUSLY, before
  // there is a promise to reject, and an uncaught throw at module scope takes
  // the whole module down at import: every media feature stops working, not
  // just this one. So the invocation is guarded rather than only its promise.
  //
  // Either way the preference is not detectable, which is the `false` seed
  // already in place.
  try {
    read()
      .then((enabled) => flag.set(enabled))
      .catch(() => undefined);
  } catch {
    // Not detectable on this platform; the seed stands.
  }

  try {
    AccessibilityInfo.addEventListener(event, (enabled) => flag.set(enabled));
  } catch {
    // No event to subscribe to, so the flag stays at whatever the read gave.
  }

  return flag;
}

/** iOS "Invert Colors". Backs `@media (inverted-colors)`. */
export const invertedColors = accessibilityFlag(
  () => AccessibilityInfo.isInvertColorsEnabled(),
  "invertColorsChanged",
);

/**
 * The OS reduce-motion preference. Backs `@media (prefers-reduced-motion)`, and
 * therefore every `motion-reduce:` / `motion-safe:` utility.
 *
 * It is an observable rather than a boot-time read because the preference is
 * changed while the app is running — the user goes to Settings to turn it on,
 * comes back, and expects the animations to stop. A snapshot taken at import
 * would leave them running until the next cold start.
 */
export const reduceMotion = accessibilityFlag(
  () => AccessibilityInfo.isReduceMotionEnabled(),
  "reduceMotionChanged",
);

/** iOS "Reduce Transparency". Backs `@media (prefers-reduced-transparency)`. */
export const reducedTransparency = accessibilityFlag(
  () => AccessibilityInfo.isReduceTransparencyEnabled(),
  "reduceTransparencyChanged",
);

/** Android "High contrast text". Backs `@media (prefers-contrast)`. */
export const highContrast = accessibilityFlag(
  () => AccessibilityInfo.isHighTextContrastEnabled(),
  "highTextContrastChanged",
);

/** Text ancestry *************************************************************/

/**
 * Whether a text-rendering component encloses this subtree.
 *
 * Used to decide whether CSS inherited text properties should be applied: a
 * `<Text>` nested inside another `<Text>` is left alone, because React Native
 * already inherits Text → Text natively — and does it better, since that path
 * carries `style`-prop values which never appear as CSS variables.
 *
 * This library publishes its own signal rather than reading React Native's
 * `unstable_TextAncestorContext`. That context is not provided in every
 * environment (under the `jest-expo` preset a descendant of a real `<Text>`
 * reads `false`), so depending on it would make the guard silently inert
 * exactly where it is load-bearing. Every `<Text>` in an app already renders
 * through this library's own component, so this signal is always present.
 */
export const TextAncestorContext = createContext(false);

/** Containers ****************************************************************/

export type ContainerContextValue = Record<string, WeakKey>;
export const ContainerContext = createContext<ContainerContextValue>({});

export const containerLayoutFamily = weakFamily(() => {
  return observable<LayoutRectangle>({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
});

export const containerWidthFamily = weakFamily((key) => {
  return observable((read) => {
    return read(containerLayoutFamily(key))?.width || 0;
  });
});

export const containerHeightFamily = weakFamily((key) => {
  return observable((read) => {
    // `.height`. Reading `.width` here made every height-based container query
    // answer with the width: `@container (min-height: 400px)` matched a 500x100
    // container and missed a 100x500 one, and `aspect-ratio` and `orientation`
    // — both computed from this pair — were wrong for any non-square container.
    // Every existing container test uses a square layout, which is why nothing
    // caught it.
    return read(containerLayoutFamily(key))?.height || 0;
  });
});
