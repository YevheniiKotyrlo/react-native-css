import { rootVariables, universalVariables } from "../../native-internal/root";

test("the module's exports are the registries published on globalThis", () => {
  // The two slots are named individually rather than held in one record — see
  // `RootVariableGlobals` in `native-internal/root.ts`. `globalThis` carries no
  // index signature, so reading them from a test takes the same bridge the
  // module itself uses.
  const registryHost = globalThis as unknown as {
    __react_native_css_root_variables?: typeof rootVariables;
    __react_native_css_universal_variables?: typeof universalVariables;
  };

  expect(registryHost.__react_native_css_root_variables).toBeDefined();
  expect(rootVariables).toBe(registryHost.__react_native_css_root_variables);
  expect(universalVariables).toBe(
    registryHost.__react_native_css_universal_variables,
  );
});

test("a second copy of the module shares the registries and does not re-seed", async () => {
  // jest.resetModules() gives a fresh module registry against the same globalThis, which
  // is exactly the dual-package case: the exports map splits import and require onto
  // different builds, so two copies of this file evaluate in one bundle
  const firstCopy = await import("../../native-internal/root");

  expect(firstCopy.rootVariables("__rn-css-rem").get()).toBe(14);
  firstCopy.rootVariables("__rn-css-rem").set([[16]]);

  jest.resetModules();
  const secondCopy = await import("../../native-internal/root");

  // The module body really re-ran, so the assertions below are about two copies
  expect(secondCopy).not.toBe(firstCopy);

  expect(secondCopy.rootVariables).toBe(firstCopy.rootVariables);
  expect(secondCopy.rootVariables("__rn-css-rem").get()).toBe(16);
});
