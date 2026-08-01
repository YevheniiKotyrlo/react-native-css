/**
 * The accessibility observables must not take the module down at import.
 *
 * `reactivity.ts` seeds four flags from `AccessibilityInfo` at MODULE SCOPE —
 * `prefers-reduced-motion`, `inverted-colors`, `prefers-reduced-transparency`
 * and `prefers-contrast` all read their getter as the module is evaluated. That
 * is the right shape (a flag has to have a value before the first query reads
 * it) and it is also the fragile one: an uncaught throw there is not a broken
 * media feature, it is a module that never finishes loading — which takes EVERY
 * media feature down with it, and `colorScheme`, and the variable registries
 * that live in the same file.
 *
 * "Not detectable" arrives by two routes, and only one of them is a promise:
 *
 *   - React Native REJECTS these getters, with `null`, when the platform has no
 *     such native module — `isReduceTransparencyEnabled` wherever
 *     `NativeAccessibilityManagerIOS` is absent, which is every out-of-tree
 *     platform.
 *   - The getter can be ABSENT ENTIRELY: a stub `AccessibilityInfo` under a
 *     bare test runner, or a build predating the method. Then the call throws
 *     SYNCHRONOUSLY, before there is a promise to reject, and a `.catch()`
 *     never runs.
 *
 * The second is not hypothetical. It is what a consuming repo hit running its
 * own unit tests against the installed package: `AccessibilityInfo` was a stub
 * without `isInvertColorsEnabled`, and importing this module threw
 * `TypeError: AccessibilityInfo.isInvertColorsEnabled is not a function` before
 * a single test ran.
 *
 * Both mean the same thing — the preference is not detectable — and the answer
 * to both is the `false` seed already in place.
 *
 * ## Why the SUBMODULE is mocked
 *
 * Two nearer approaches do not work, and both fail QUIETLY, which is the reason
 * to write down why:
 *
 *   - `jest.doMock("react-native", …)` has to spread the real module to keep
 *     the rest of it, and that spread evaluates React Native's TurboModule
 *     getters — which throw for `DevMenu` outside an app.
 *   - Mutating the `AccessibilityInfo` object the test imported does nothing.
 *     `jest.resetModules()` is required to re-evaluate the module under test,
 *     and it re-evaluates React Native too — handing it a fresh, intact
 *     `AccessibilityInfo`. A guard written that way PASSES with the fix removed,
 *     which is worse than no guard at all.
 *
 * Mocking the one submodule React Native's index lazily requires survives the
 * reset, because the reset is what makes the index require it again.
 *
 * The imports of the module under test are DYNAMIC for the same reason: a
 * static import is hoisted above `jest.doMock` and would be evaluated first.
 */

const ACCESSIBILITY_MODULE =
  "react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo";

interface Flag {
  readonly get: () => unknown;
}

interface ReactivityModule {
  readonly reduceMotion: Flag;
  readonly invertedColors: Flag;
  readonly reducedTransparency: Flag;
  readonly highContrast: Flag;
}

/** The four getters `accessibilityFlag` reads, and the event each pairs with. */
const GETTERS = [
  "isReduceMotionEnabled",
  "isInvertColorsEnabled",
  "isReduceTransparencyEnabled",
  "isHighTextContrastEnabled",
] as const;

const noSubscription = (): { remove: () => void } => ({
  remove: () => undefined,
});

/** Installs an `AccessibilityInfo` with exactly the members given. */
function mockAccessibilityInfo(members: Record<string, unknown>): void {
  jest.doMock(ACCESSIBILITY_MODULE, () => ({
    __esModule: true,
    default: members,
  }));
}

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  jest.dontMock(ACCESSIBILITY_MODULE);
  jest.resetModules();
});

test("importing the module survives an AccessibilityInfo with no getters", async () => {
  // Every `is*Enabled` absent, so each call throws SYNCHRONOUSLY.
  mockAccessibilityInfo({ addEventListener: noSubscription });

  await expect(import("../../native/reactivity")).resolves.toBeDefined();
});

test("the flags answer their default when the getter is absent", async () => {
  mockAccessibilityInfo({ addEventListener: noSubscription });

  const reactivity = (await import(
    "../../native/reactivity"
  )) as ReactivityModule;

  // `false` is the seed, and it is the right answer: a preference that cannot
  // be detected is reported as not set, which is what a browser does on an OS
  // without the setting. The media feature then answers its "no preference"
  // value rather than refusing to answer.
  for (const flag of [
    reactivity.reduceMotion,
    reactivity.invertedColors,
    reactivity.reducedTransparency,
    reactivity.highContrast,
  ]) {
    expect(flag.get()).toBe(false);
  }
});

test("a getter that REJECTS is handled too", async () => {
  // The other route to "not detectable", and the one React Native documents.
  // Without the catch this prints "Possible Unhandled Promise Rejection" at
  // every app start, whether or not the app uses these media features.
  const reject = (): Promise<boolean> =>
    Promise.reject(new Error("no such native module"));

  mockAccessibilityInfo({
    addEventListener: noSubscription,
    ...Object.fromEntries(GETTERS.map((name) => [name, reject])),
  });

  await expect(import("../../native/reactivity")).resolves.toBeDefined();
});

test("an AccessibilityInfo with no change event is survivable as well", async () => {
  // The subscription half of the same seam. A platform that can report a value
  // once but has no change event should still give that value, rather than
  // losing the module on the way to subscribing.
  mockAccessibilityInfo({
    isReduceMotionEnabled: () => Promise.resolve(true),
    // `addEventListener` deliberately absent.
  });

  await expect(import("../../native/reactivity")).resolves.toBeDefined();
});
