/* eslint-disable */
import {
  createElement,
  Fragment,
  useContext,
  useEffect,
  useState,
  type ComponentType,
} from "react";
import { Pressable, View } from "react-native";

import { VariableContext } from "react-native-css/native-internal";

import type { StyleDescriptor } from "react-native-css/compiler";
import { INHERIT_VARIABLE_PREFIX } from "react-native-css/utilities";

import { calculateProps } from "../styles/calculate-props";
import { resolveValue } from "../styles/resolve";

import type { StyledConfiguration } from "../../runtime.types";
import { testGuards, type RenderGuard } from "../conditions/guards";
import {
  cleanupEffect,
  ContainerContext,
  TextAncestorContext,
  weakFamily,
  type ContainerContextValue,
  type Effect,
  type Getter,
  type VariableContextValue,
} from "../reactivity";
import { animatedComponentFamily } from "../reanimated";
import { getStyledProps, stylesFamily } from "../styles";
import { updateRules } from "./rules";

export type Config = {
  source: string;
  target: string[] | string | false;
  nativeStyleMapping?: Record<string, string>;
  /**
   * Apply CSS inherited text properties published by ancestors to this
   * config's target. Declared per component in its mapping — see
   * `StyledConfigurationObject.inheritsTextStyle`.
   */
  inheritsTextStyle?: boolean;
  /**
   * Clear the text-ancestor signal for this component's subtree, mirroring
   * React Native's own `View`. See `StyledConfigurationObject`.
   */
  resetsTextAncestor?: boolean;
};

export type ComponentState = {
  /** The source/target for classNames */
  configs: Config[];

  /** Reactive tracking */
  ruleEffect: Effect;
  ruleEffectGetter: Getter;
  styleEffect: Effect;

  /** The components props */
  currentProps?: Record<string, any> | undefined | null;

  /** An observable of the normal/important props */
  stylesObs?: ReturnType<typeof stylesFamily>;
  guards?: RenderGuard[];

  variables?: VariableContextValue;
  containers?: ContainerContextValue;

  inheritedVariables: VariableContextValue;
  inheritedContainers: ContainerContextValue;

  animated?: boolean;
  pressable?: undefined | boolean;
};

/**
 * useNativeCss is the native implementation of the useCssElement hook.
 */
export function useNativeCss(
  type: ComponentType<any>,
  originalProps: Record<string, any> | undefined | null,
  configs: Config[] = [{ source: "className", target: "style" }],
) {
  const inheritedVariables = useContext(VariableContext);
  const inheritedContainers = useContext(ContainerContext);
  // Whether a text-rendering component encloses this element. Read
  // unconditionally (hooks are positional); consulted by the
  // inherited-property block below.
  const hasTextAncestor = useContext(TextAncestorContext);

  const [state, setState] = useState((): ComponentState => {
    // Both effects share the same observers to improve memory usage
    const observers = new Set<Effect>();

    /**
     * When fired, this effect will force the rules to be re-evaluated.
     * This will cause a re-render if there are different rules
     *
     * Use this when a rule condition changes, e.g FastRefresh or media queries
     */
    const ruleEffect: Effect = {
      observers,
      run: () => setState((state) => updateRules(state)),
    };

    /**
     * When fired, this effect will force a re-render of the component.
     * This will cause a re-fetch of the styles.
     *
     * Use this when a value changes, e.g vm units or light / dark mode
     */
    const styleEffect: Effect = {
      observers,
      run: () => setState((state) => ({ ...state })),
    };

    return updateRules(
      {
        ruleEffect,
        ruleEffectGetter: (observable) => observable.get(ruleEffect),
        styleEffect,
        configs,
        inheritedContainers,
        inheritedVariables,
        pressable: type === View ? false : undefined,
      },
      originalProps,
      inheritedVariables,
      inheritedContainers,
      false,
      false,
    );
  });

  // Both effects share the same observers, so we only need to cleanup one of them
  useEffect(() => () => cleanupEffect(state.ruleEffect), [state.ruleEffect]);

  // Check if our derived state has changed (e.g the className prop)
  if (
    testGuards(state, originalProps, inheritedVariables, inheritedContainers)
  ) {
    /**
     * Get the new state
     * Note, this might result in the same styles, but the guards will now be different
     */
    setState(
      updateRules(
        state,
        originalProps,
        inheritedVariables,
        inheritedContainers,
        true,
      ),
    );

    // We can bail on rendering as the result of this render will be discarded
    return createElement(Fragment);
  }

  let props = getStyledProps(state, originalProps);

  // Apply the CSS inherited text properties an ancestor published.
  //
  // WHICH components receive them is declared by the component, in its own
  // mapping (`inheritsTextStyle` — `components/Text` sets it), exactly as
  // `nativeStyleMapping` is declared by TextInput and Button. This hook stays
  // component-agnostic: it never names Text, so a custom `styled()` text
  // component opts in without a change here.
  //
  // `hasTextAncestor` is part of the option's meaning rather than a separate
  // condition: apply inherited properties UNLESS a <Text> ancestor already
  // supplies them natively. React Native's own Text-in-Text inheritance covers
  // that case and covers it better — it carries `style`-prop values, which
  // never appear as CSS variables — so overriding it would replace a working
  // mechanism with a worse one.
  //
  // Cost is proportional to what is actually inherited, not to the number of
  // inheritable properties: this walks the keys PRESENT in the inherited
  // variables rather than probing each name, so a tree that inherits nothing
  // pays one `for...in` over an empty object.
  const inheritConfig = state.configs.find((config) => config.inheritsTextStyle);

  if (inheritConfig && !hasTextAncestor && inheritedVariables) {
    let inheritedStyle: Record<string, StyleDescriptor> | undefined;

    for (const name in inheritedVariables) {
      if (!name.startsWith(INHERIT_VARIABLE_PREFIX)) {
        continue;
      }

      // The same option set the normal style pipeline passes
      // (`calculateProps`). `calculateProps` in particular is load-bearing:
      // a published value may be a StyleFunction rather than a literal —
      // `line-height: 32px` compiles to `[{}, "lineHeight", [32], 1]` — and
      // those resolvers recurse. Omitting it silently resolves such values to
      // `undefined`, so the property is dropped with no error and only
      // dynamic declarations are affected.
      const resolved = resolveValue(
        inheritedVariables[name],
        (observable) => observable.get(state.styleEffect),
        { inheritedVariables, calculateProps },
      );

      if (resolved !== undefined) {
        inheritedStyle ??= {};
        inheritedStyle[name.slice(INHERIT_VARIABLE_PREFIX.length)] = resolved;
      }
    }

    if (inheritedStyle) {
      const target = Array.isArray(inheritConfig.target)
        ? inheritConfig.target[0]
        : inheritConfig.target;
      const styleKey = typeof target === "string" ? target : "style";
      const ownStyle = props?.[styleKey];

      // PREPENDED, so anything the element resolves for itself still wins
      // under React Native's own last-one-wins style-array precedence — no
      // flattening and no precedence guessing. When the element has no style
      // of its own the inherited object is passed alone rather than wrapped,
      // matching this library's existing "only className should not create an
      // array" behaviour.
      props = {
        ...props,
        [styleKey]:
          ownStyle === undefined ? inheritedStyle : [inheritedStyle, ownStyle],
      };
    }
  }

  if (type === View && props?.onPress) {
    type = Pressable;
  }

  if (state.animated) {
    type = animatedComponentFamily(type);
  }

  if (state.variables) {
    props = {
      value: state.variables,
      children: createElement(type, props),
    };
    type = VariableContext.Provider;
  }

  if (state.containers) {
    props = {
      value: state.containers,
      children: createElement(type, props),
    };
    type = ContainerContext.Provider;
  }

  // Announce to descendants that a text-rendering component encloses them, so
  // a nested one defers to React Native's native Text-in-Text inheritance
  // instead of applying the CSS inherited properties a second time.
  //
  // Only published when this component inherits AND nothing above it already
  // said so — re-providing the same `true` would add a provider per nesting
  // level for no change in value.
  if (inheritConfig && !hasTextAncestor) {
    props = {
      value: true,
      children: createElement(type, props),
    };
    type = TextAncestorContext.Provider;
  } else if (hasTextAncestor && state.configs.some((c) => c.resetsTextAncestor)) {
    // ...and clear it again for a component that breaks the native chain.
    // React Native's own `View` resets `TextAncestorContext` to `false`, so a
    // View inside a Text ends the native Text -> Text inheritance. Without the
    // matching reset here the signal stayed `true` and the CSS path kept
    // deferring to an ancestor that could no longer reach the descendant —
    // `<Text><View className="text-red"><Text/></View></Text>` fell through
    // BOTH mechanisms and rendered no colour at all.
    //
    // Only when a Text ancestor is actually in scope: elsewhere the value is
    // already `false` and a provider would cost a component for nothing.
    props = {
      value: false,
      children: createElement(type, props),
    };
    type = TextAncestorContext.Provider;
  }

  return createElement(type, props);
}

/**
 * Convert the styled() mapping to a config array.
 *
 * Derived once per mapping. `generateStateHash` keys the resolved-style cache on `state.configs`
 * by object identity, so an equal-but-fresh array per consumer gives each of them its own cache
 * entry, its own sorted rules and its own observable. `styled()` already avoids that by deriving
 * at module scope; `useCssElement` derives per component instance, and every wrapper this library
 * ships passes it a module constant.
 *
 * Caching on the mapping's identity means a mapping MUTATED after its first use is not re-derived.
 * That is a narrowing of behaviour rather than a change of it: `useCssElement` already froze the
 * derivation per instance through `useState`, so a live element never saw a mutation either — only
 * a newly mounted one did, which made the same mapping mean two things at once. A caller that wants
 * a different mapping passes a different object, which is what every call site here already does.
 */
const configForMapping = weakFamily(function (
  mapping: StyledConfiguration<any>,
): Config[] {
  const configs = Object.entries(mapping).flatMap(([key, value]): Config => {
    if (value === true) {
      return {
        source: key,
        target: key,
      };
    } else if (value === false) {
      return { source: key, target: false };
    } else if (typeof value === "string") {
      return { source: key, target: value.split(".") };
    } else if (typeof value === "object") {
      const nativeStyleMapping = value.nativeStyleMapping
        ? Object.fromEntries(
            Object.entries(value.nativeStyleMapping).map(([k, v]) => [
              k,
              v === true ? k : v,
            ]),
          )
        : undefined;

      if (Array.isArray(value)) {
        return { source: key, target: value, nativeStyleMapping };
      }

      if ("target" in value) {
        if (value.target === false) {
          return { source: key, target: false, nativeStyleMapping };
        } else if (typeof value.target === "string") {
          // Always the split array, so `{ target: "style" }` and the `"style"`
          // shorthand produce the SAME config. They are two spellings of one
          // thing, but collapsing a single segment to a bare string here made
          // them diverge downstream: `deepMergeConfig` branches on
          // `Array.isArray(config.target)`, so the shorthand took the
          // style-aware merge path and the object form took the generic
          // prop-merge path. The visible symptom was that an inline style and
          // a className setting the SAME property stopped collapsing —
          // `<Text className="text-red" style={{ color: "blue" }} />` yielded
          // `[{color:"#f00"},{color:"blue"}]` instead of `{color:"blue"}`,
          // purely because of how the component spelled its mapping.
          return { source: key, target: value.target.split("."), nativeStyleMapping };
        } else if (Array.isArray(value.target)) {
          return { source: key, target: value.target, nativeStyleMapping };
        }
      }
    }

    throw new Error(`styled(): Invalid mapping for ${key}: ${value}`);
  });

  // Carry `inheritsTextStyle` onto the config in ONE place, rather than
  // threading it through each of the returns above — those already repeat
  // `nativeStyleMapping` per branch, and a second per-branch flag compounds
  // that.
  return configs.map((config): Config => {
    const source = mapping[config.source];
    if (typeof source !== "object" || source === null) {
      return config;
    }
    const next = { ...config };
    if ("inheritsTextStyle" in source && source.inheritsTextStyle === true) {
      next.inheritsTextStyle = true;
    }
    if ("resetsTextAncestor" in source && source.resetsTextAncestor === true) {
      next.resetsTextAncestor = true;
    }
    return next;
  });
});

/**
 * A mapping is a record of prop name to style target, and that is the only shape either entry point
 * is typed to accept. Anything else is refused here, by name.
 *
 * The predicate is deliberately NARROWER than what the `WeakMap` behind `configForMapping` would
 * take: a function and an unregistered symbol are both valid weak keys, and both are refused,
 * because neither is a mapping. What the guard buys is the message — without it a primitive reaches
 * that `WeakMap` and raises `Invalid value used as weak map key` from inside `reactivity`, naming
 * neither `styled()` nor the argument that was wrong.
 */
export function mappingToConfig(mapping: StyledConfiguration<any>): Config[] {
  if (typeof mapping !== "object" || mapping === null) {
    throw new Error(
      `styled(): mapping must be an object, received ${mapping === null ? "null" : typeof mapping}`,
    );
  }

  return configForMapping(mapping);
}
