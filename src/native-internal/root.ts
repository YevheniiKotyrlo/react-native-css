import { Platform, PlatformColor } from "react-native";

import type {
  RootVariables,
  StyleDescriptor,
  VariableValue,
} from "react-native-css/compiler";

import { testMediaQuery } from "../native/conditions/media-query";
import { family, observable, type Observable } from "../native/reactivity";

// The argument is nullable because a reload has to be able to RETRACT a name, and the read
// below already answers `undefined` for one — see replaceRegisteredInitialValues
type VariableArg = VariableValue[] | undefined;

const rootVariableFamily = () => {
  return family<string, Observable<StyleDescriptor, VariableArg>>(() => {
    const obs = observable<StyleDescriptor, VariableArg>(
      (read, variableValue) => {
        if (!variableValue) return undefined;

        for (const [value, mediaQuery] of variableValue) {
          if (!mediaQuery) {
            return value;
          }

          if (testMediaQuery(mediaQuery, read)) {
            return value;
          }
        }

        return undefined;
      },
    );

    return obs;
  });
};

/**
 * The `:root` registries are process-global and seeded EXACTLY ONCE.
 *
 * A bundle can hold two copies of this library — `dist/module` for ESM
 * importers and `dist/commonjs` for CommonJS ones — because the package
 * `exports` map splits on the import/require condition and Metro resolves that
 * per REQUESTING module. Compiled-CJS consumers bind the commonjs build while
 * first-party source binds the module build, and the stylesheet is injected
 * into only one of them. Give each copy its own registry and the other resolves
 * every `var(--…)` to undefined: a `className` colour silently falls back to
 * React Native's default black. `style-collection.ts` and `variables.ts` guard
 * the same way, for the same reason.
 *
 * The seeds live INSIDE the guard rather than beside it. `__rn-css-rem` is also
 * set by the injected stylesheet, so a second copy initialising afterwards would
 * re-run the seed and clobber the stylesheet's value back to 14 — silently
 * rescaling every rem-based utility. Creating and seeding have to be one atomic
 * once-only step.
 */
type RootVariableRegistry = ReturnType<typeof rootVariableFamily>;

interface RootVariableGlobals {
  __react_native_css_root_variables?: RootVariableRegistry;
  __react_native_css_universal_variables?: RootVariableRegistry;
}

// The registries hang off the global object precisely because a second copy of
// this module has no other way to find the first one's. `globalThis` is typed
// with no index signature, so naming the two slots takes a bridge; it is one
// cast at the boundary rather than a widened type every consumer inherits.
const registryHost = globalThis as unknown as RootVariableGlobals;

/**
 * The pair, created and seeded on first import and reused by every copy after.
 *
 * Returning them rather than reading the globals back is what keeps the exports
 * non-optional: the registries exist by the time this returns, whichever branch
 * ran.
 */
function resolveRootRegistries(): {
  root: RootVariableRegistry;
  universal: RootVariableRegistry;
} {
  const existingRoot = registryHost.__react_native_css_root_variables;
  const existingUniversal = registryHost.__react_native_css_universal_variables;

  if (existingRoot !== undefined && existingUniversal !== undefined) {
    return { root: existingRoot, universal: existingUniversal };
  }

  const root = rootVariableFamily();
  const universal = rootVariableFamily();

  seedRootRegistry(root);

  // Published only once both are built and seeded, so a second copy can never
  // observe a half-initialised registry.
  registryHost.__react_native_css_root_variables = root;
  registryHost.__react_native_css_universal_variables = universal;

  return { root, universal };
}

const rootRegistries = resolveRootRegistries();

export const rootVariables = rootRegistries.root;
export const universalVariables = rootRegistries.universal;

declare global {
  var __react_native_css_registered_initial_values:
    | ReturnType<typeof rootVariableFamily>
    | undefined;
  var __react_native_css_non_inherited_variables: Set<string> | undefined;
}

// Both pinned to globalThis like style-collection.ts and variables.tsx. The exports map
// splits import and require onto different builds and Metro resolves that per requesting
// module, so two copies of this file can load. StyleCollection is globalThis-pinned, so
// whichever copy wins it does all the injecting and fills ITS containers — the other copy
// reads a Set whose filter never fires, and a registry that answers undefined for every
// registration. Neither has a seed to protect, so the plain `??=` is the whole guard.
globalThis.__react_native_css_registered_initial_values ??=
  rootVariableFamily();
globalThis.__react_native_css_non_inherited_variables ??= new Set<string>();

/**
 * The `initial-value` of an `@property` rule: what a custom property resolves to on an
 * element that declares it nowhere. Separate from rootVariables because a `:root`
 * declaration is a value the root element HAS and descendants read by inheritance, which
 * is the one thing a non-inheriting property never does.
 *
 * A registration carries a single value, so each entry holds one — the family shape is
 * shared with the other two so a re-injected stylesheet notifies its readers.
 *
 * Losing this across a copy is not a missing fallback. Tailwind composes a registered
 * width into arithmetic on the element that DECLARES it — `calc(2px +
 * var(--tw-ring-offset-width))` — so an empty registry corrupts a length the declaring
 * element computes for itself, with no ancestor involved.
 */
export const registeredInitialValues =
  globalThis.__react_native_css_registered_initial_values;

export const nonInheritedVariables =
  globalThis.__react_native_css_non_inherited_variables;

/**
 * Copy the custom properties an element publishes to its descendants. A property
 * registered `inherits: false` is withheld, so the descendant resolves the registered
 * initial value rather than the ancestor's. Every channel that builds a VariableContext
 * goes through here — a stylesheet rule, an inline `vars()`, a VariableContextProvider —
 * because the inherit flag belongs to the registration, not to the declaration that set it
 */
export function assignInheritedVariables<TValue>(
  target: Record<string, TValue>,
  entries: Iterable<readonly [string, TValue]>,
) {
  for (const [name, value] of entries) {
    if (nonInheritedVariables.has(name)) {
      continue;
    }

    target[name] = value;
  }
}

/**
 * Replace every registered initial value with the ones a stylesheet carries.
 *
 * A reload has to be able to DELETE an `@property` rule, and this registry is observable,
 * so dropping the entry is not enough. `family.clear()` is a `Map.clear()`, which notifies
 * nobody: a mounted element keeps painting the deleted registration's value, and the next
 * registration of that name lands on a fresh observable that element never subscribed to.
 * Retracting through `set(undefined)` takes the same notification path a changed value
 * takes, and leaves the observable its readers already hold in place.
 *
 * `resetVariableRegistries` below still clears, because nothing is mounted across the test
 * boundary it serves — the mechanism differs where the readers do.
 */
export function replaceRegisteredInitialValues(entries: RootVariables = []) {
  const registered = new Set(entries.map(([name]) => name));

  // Snapshotted because the family creates an entry for every name the resolver LOOKS UP,
  // so a retraction outside a batch can notify a reader that resolves a new one mid-walk.
  // Retracting a name that carries no registration is already a no-op: the observable
  // recomputes to the `undefined` it holds, compares equal, and notifies nobody
  for (const name of Array.from(registeredInitialValues.keys())) {
    if (!registered.has(name)) {
      registeredInitialValues(name).set(undefined);
    }
  }

  for (const [name, value] of entries) {
    registeredInitialValues(name).set(value);
  }
}

function seedRootRegistry(root: RootVariableRegistry) {
  root("__rn-css-rem").set([[14]]);

  // `__rn-css-color` is the root default behind every `currentcolor`
  // resolution. On Android, `PlatformColor("?attr/textColorPrimary")` resolves
  // to a ColorStateList, which `ColorPropConverter` returns unchecked as though
  // it were an ARGB int — so it never reaches paint as a usable colour, and
  // `ring` / `inset-ring` render nothing while `text-current` is invisible. A
  // concrete colour is seeded instead, made scheme-aware through this same
  // observable's `prefers-color-scheme` evaluation rather than a second
  // Appearance listener. iOS resolves `PlatformColor` correctly and keeps it.
  if (Platform.OS === "ios") {
    // `PlatformColor` returns an `OpaqueColorValue` — a branded symbol React
    // Native accepts anywhere a colour is taken, and which `StyleDescriptor`
    // does not model. The bridge is isolated to this one seed rather than
    // widening the descriptor for every consumer of it.
    const platformLabelColour = [
      [PlatformColor("label", "labelColor")],
    ] as unknown as VariableValue[];

    root("__rn-css-color").set(platformLabelColour);
  } else {
    root("__rn-css-color").set([
      ["#FFFFFF", [["=", "prefers-color-scheme", "dark"]]],
      ["#000000"],
    ]);
  }
}

/**
 * Return every variable registry to its boot state, seeds included.
 *
 * A reload replaces the two registries an `@property` rule writes, but `:root` and `*`
 * declarations are overwrite-only — a name the new sheet drops keeps the value the previous
 * one gave it. That is what a reload should do to a running app and the opposite of what one
 * test should do to the next, and a test that injects no stylesheet at all needs the reset
 * either way.
 *
 * Clearing is enough here, where `inject` has to retract through `set(undefined)`: nothing
 * is mounted across the boundary this serves, so there is no reader to strand.
 */
export function resetVariableRegistries() {
  rootVariables.clear();
  universalVariables.clear();
  registeredInitialValues.clear();
  nonInheritedVariables.clear();

  seedRootRegistry(rootVariables);
}
