import {
  createContext,
  useContext,
  useMemo,
  type PropsWithChildren,
} from "react";

import type { StyleDescriptor } from "react-native-css/compiler";

import { VAR_SYMBOL, type VariableContextValue } from "../native/reactivity";
import { parseVariableValue } from "../native/styles/parse-value";
import { assignInheritedVariables } from "./root";

globalThis.__react_native_css_variable_context ??=
  createContext<VariableContextValue>({
    [VAR_SYMBOL]: true,
  });

export const VariableContext = globalThis.__react_native_css_variable_context;

/**
 * Supply custom properties to a subtree from JavaScript.
 *
 * A value may be written either way round: as a `StyleDescriptor` in the shape
 * the compiler produces, or as the CSS source text of the same declaration.
 * `parseVariableValue` reads the second into the first, so `"10px 20px"` reaches
 * the subtree as the list `[10, 20]` that `margin: var(--x)` needs — the same
 * value a stylesheet's `--x: 10px 20px` delivers. It is a no-op on a value that
 * is already a descriptor.
 *
 * Read at the point the value is STORED rather than each time it is resolved.
 * The context is read once per element per render and written once per provider
 * render, and — the reason that matters — a value read out of the context is
 * ambiguous by then: `useNativeCss` publishes the compiler's own `rule.v`
 * descriptors into this same context, and a compiler-produced string such as a
 * quoted font family must not be tokenised a second time.
 */
export function VariableContextProvider(
  props: PropsWithChildren<{ value: Record<`--${string}`, StyleDescriptor> }>,
) {
  const inheritedVariables = useContext(VariableContext);

  const value: VariableContextValue = useMemo(() => {
    const published: VariableContextValue = {
      ...inheritedVariables,
      [VAR_SYMBOL]: true,
    };

    assignInheritedVariables(
      published,
      Object.entries(props.value).map(
        ([name, descriptor]) =>
          [name.replace(/^--/, ""), parseVariableValue(descriptor)] as const,
      ),
    );

    return published;
  }, [inheritedVariables, props.value]);

  return <VariableContext value={value}>{props.children}</VariableContext>;
}
