import type { StyleDescriptor, StyleFunction } from "react-native-css/compiler";
import {
  rootVariables,
  universalVariables,
} from "react-native-css/native-internal";
import { isStyleDescriptorArray } from "react-native-css/utilities";

import { VAR_SYMBOL, type Getter } from "../reactivity";
import type { ResolveValueOptions, SimpleResolveValue } from "./resolve";

/**
 * A name's resolved value, and the declaration that produced it.
 *
 * Both halves are needed, and they answer different questions. `value` is what
 * the variable is WORTH, which is what a style key receives. `descriptor` is
 * what it IS — `1.5em` rather than `24` — which is the only thing that can say
 * whether a `line-height` is a length or a ratio (`./dimension.ts`).
 */
export interface ResolvedVariable {
  readonly descriptor: StyleDescriptor;
  readonly value: unknown;
}

/**
 * The outcome of looking one custom property up, as a value the caller can
 * switch on.
 *
 * The three are genuinely different answers and each has its own handling: a
 * DECLARED name resolves to what its declaration says even when that is nothing;
 * an UNDECLARED one is what a `var()` fallback exists for; and a name already
 * being resolved further up the same chain is a reference cycle, which css-
 * variables-1 §3 makes invalid at computed-value time — the fallback does not
 * rescue it.
 */
export type VariableLookup =
  | ({ readonly kind: "declared" } & ResolvedVariable)
  | { readonly kind: "cycle" }
  | { readonly kind: "undeclared" };

/**
 * The four variable sources, consulted in CASCADE order, nearest first.
 *
 * CSS Variables Level 1 §2: a custom property cascades like any other property,
 * so an element's computed value for `--x` is its OWN declaration whenever it
 * has one, and the value it would inherit only otherwise. `inlineVariables`
 * holds the element's own — every `rule.v` its matched classes published, plus
 * any `vars()` passed through the style prop — so it is consulted before the
 * inherited `VariableContext`.
 *
 * Both are keyed on PRESENCE rather than on resolving to something: a name the
 * element declares shadows an ancestor's even when the declared value computes
 * to nothing, exactly as an invalid `color` does not silently fall back to the
 * inherited colour. Each branch also recurses, so both sit inside the
 * `variableHistory` guard.
 *
 * Separate from `varResolver` because the two callers want different halves of
 * the same walk: a style value wants what the name is worth, and a dimension
 * wants the declaration that answered. Reading the second off a side effect of
 * the first is what this replaces — the recording seam it used could not see a
 * memo hit, so an element whose rule read a variable twice classified it
 * differently the second time.
 */
export function lookupVariable(
  resolve: SimpleResolveValue,
  name: string,
  get: Getter,
  options: ResolveValueOptions,
): VariableLookup {
  const {
    renderGuards,
    inheritedVariables: variables = { [VAR_SYMBOL]: true },
    inlineVariables,
  } = options;

  // Assigned back onto `options`, because the recursive `resolve` calls below
  // read it from there. Destructuring it with a `new Set()` default gave every
  // call a fresh, empty set, so the guard below never saw a repeat and a
  // reference cycle recursed until the JS stack overflowed — a `RangeError`
  // thrown out of render, reachable from ordinary CSS whenever a custom
  // property is declared more than once (the compiler's inlining pass, which
  // has a working guard of its own, only folds single-declaration properties).
  const variableHistory = (options.variableHistory ??= new Set<string>());

  // The names on the CURRENT resolution path, not every name already seen.
  // `finally` removes this one again, so a variable used by two different
  // declarations still resolves the second time — only re-entering a name
  // while it is still being resolved is a cycle.
  if (variableHistory.has(name)) {
    return { kind: "cycle" };
  }

  // Resolving a variable is deterministic within one element's pass, so the
  // answer is worth keeping — but it is kept BESIDE the declarations rather
  // than on top of them.
  //
  // Memoising into `inlineVariables` wrote a resolved VALUE over the
  // declaration it came from, which cost two things. A name resolved from
  // `:root` afterwards read as one the element declared ITSELF, so on a second
  // lookup it shadowed an inherited value it had not shadowed on the first; and
  // anything that needs to know what a variable IS rather than what it is worth
  // found a bare number where `1.5em` had been declared. Keeping the descriptor
  // in the memo beside the value is what lets a repeat lookup answer both
  // questions as fully as the first one did.
  //
  // Read BEFORE the history is marked, so a memo hit cannot leave this name on
  // the resolution path: an early return past the `finally` below would strand
  // it there, and every later use of that variable in the same pass would be
  // read as a reference cycle and resolve to nothing.
  const resolved = (options.resolvedVariables ??= {});
  const memoised = resolved[name];

  if (memoised !== undefined) {
    return { kind: "declared", ...memoised };
  }

  variableHistory.add(name);

  try {
    if (inlineVariables && name in inlineVariables) {
      const descriptor = inlineVariables[name] as StyleDescriptor;
      const value = resolve(descriptor);

      if (value !== undefined) {
        resolved[name] = { descriptor, value };
      }

      return { kind: "declared", descriptor, value };
    }

    if (name in variables) {
      const descriptor = variables[name];

      // The RAW inherited value, which is what `testGuards` compares against
      // the next render's context — a resolved one would never match.
      renderGuards?.push(["v", name, descriptor]);

      return { kind: "declared", descriptor, value: resolve(descriptor) };
    }

    const universal = get(universalVariables(name));
    const universalValue = resolve(universal);

    if (universalValue !== undefined) {
      resolved[name] = { descriptor: universal, value: universalValue };
      return { kind: "declared", descriptor: universal, value: universalValue };
    }

    const root = get(rootVariables(name));
    const rootValue = resolve(root);

    if (rootValue !== undefined) {
      resolved[name] = { descriptor: root, value: rootValue };
      return { kind: "declared", descriptor: root, value: rootValue };
    }

    return { kind: "undeclared" };
  } finally {
    variableHistory.delete(name);
  }
}

/**
 * The name and fallback a `var()` was written with.
 *
 * The pair is read as DESCRIPTORS and only the branch that is taken resolves.
 * Resolving the whole argument list up front resolved the fallback as well, and
 * resolving a resolved value again is not idempotent: a `filter` fallback comes
 * back as `[{blur: 4}, {brightness: 0.5}]`, whose first entry is a non-empty
 * object, so the second pass reads it as a style function named
 * `{brightness: 0.5}` — a name no resolver answers, warned about and dropped. It
 * also cost a resolution of every fallback that was never used, and pushed the
 * render guards of variables the element does not depend on.
 */
export function readVariableReference(fn: StyleFunction): {
  readonly name: string | undefined;
  readonly fallback: StyleDescriptor | undefined;
} {
  const args = fn[2];

  if (typeof args === "string") {
    return { name: args, fallback: undefined };
  }

  if (isStyleDescriptorArray(args)) {
    const [declaredName, declaredFallback] = args;

    if (typeof declaredName === "string") {
      return { name: declaredName, fallback: declaredFallback };
    }
  }

  return { name: undefined, fallback: undefined };
}

export function varResolver(
  resolve: SimpleResolveValue,
  fn: StyleFunction,
  get: Getter,
  options: ResolveValueOptions,
) {
  const { name, fallback } = readVariableReference(fn);

  if (name === undefined) {
    return;
  }

  const lookup = lookupVariable(resolve, name, get, options);

  if (lookup.kind === "cycle") {
    return;
  }

  return lookup.kind === "declared" ? lookup.value : resolve(fallback);
}

/**
 * The element's resolution options, re-pointed at the scope an INHERITED value
 * was computed in.
 *
 * Dropping `inlineVariables` is not an approximation of the ancestor's scope,
 * it IS that scope: `rules.ts` hands each child `{ ...inheritedVariables }`
 * with the element's own `rule.v` assigned over it, so a child's inherited map
 * is exactly the map its parent resolved against. That matters beyond the name
 * being looked up, because what comes back is an UNRESOLVED descriptor — the
 * ancestor published `color: var(--brand)` as the lookup itself — and the
 * `var()`s inside it name the ancestor's variables, not the descendant's.
 * Resolving them in the descendant's scope is how `.parent { --brand: red;
 * color: var(--brand) } .child { --brand: blue; color: inherit }` gave the
 * child blue.
 *
 * The `var()` memo is NOT shared with the cascade scope. The same name
 * legitimately answers differently in the two — that is what the example above
 * is — so one memo would hand the second reader the first reader's answer.
 * `variableHistory` IS shared, because a cycle is a cycle whichever scope each
 * hop was read in, and materialised here so both objects hold the same set
 * rather than each lazily making its own.
 *
 * Cached on the options, and self-referential, so an `inheritedVar` reached
 * from inside an already-inherited value stays in the one scope instead of
 * building an equivalent copy of it at every hop.
 */
export function inheritedScopeOptions(
  options: ResolveValueOptions,
): ResolveValueOptions {
  const existing = options.inheritedScope;

  if (existing) {
    return existing;
  }

  const scoped: ResolveValueOptions = {
    ...options,
    inlineVariables: undefined,
    resolvedVariables: {},
    variableHistory: (options.variableHistory ??= new Set<string>()),
  };

  scoped.inheritedScope = scoped;
  options.inheritedScope = scoped;

  return scoped;
}
