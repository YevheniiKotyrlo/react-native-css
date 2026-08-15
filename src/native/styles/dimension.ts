import type { StyleDescriptor, StyleFunction } from "react-native-css/compiler";
import {
  isStyleDescriptorArray,
  isStyleFunction,
} from "react-native-css/utilities";

import type { Getter } from "../reactivity";
import type { ResolveValueOptions, SimpleResolveValue } from "./resolve";
import { lookupVariable, readVariableReference } from "./variables";

/**
 * A string that is entirely one pixel length, e.g. `-1.5px`.
 *
 * Two consumers, and they are two halves of one idea. `resolveValue` uses it to
 * turn such a string back into the number React Native wants; this module uses
 * it to remember, before that happens, that the number HAD a unit.
 */
export const PIXEL_LENGTH = /^[+-]?(?:\d+\.?\d*|\.\d+)px$/u;

/** A string that is entirely a percentage, e.g. `-12.5%`. */
const PERCENTAGE = /^[+-]?(?:\d+\.?\d*|\.\d+)%$/u;

/**
 * What a resolved number MEANS, which is not the same question as what it is
 * worth.
 *
 * `resolveValue` answers "what is this worth" — it flattens a descriptor tree
 * down to the primitive React Native consumes, and a unit is exactly the thing
 * flattening throws away. For nearly every property that is the whole job:
 * `width` wants a number of pixels and does not care whether the author wrote
 * `10px`, `2em` or `1.4vw`.
 *
 * `line-height` is the property where it is not, because CSS gives a BARE
 * NUMBER there a different meaning from a length — `1.5` is one and a half font
 * sizes, `22px` is twenty-two pixels — and both arrive at the runtime resolver
 * as the JavaScript number they resolved to. Asking the resolved value which one
 * it was is asking a question the value cannot answer. The DESCRIPTOR can, and
 * this module is where it is asked.
 */
export type DimensionKind =
  /**
   * Provably a `<length>`: the descriptor still carries a unit, either as a
   * length function (`em`, `rem`, `vw`, `vh`, …) or as a `px`-suffixed string.
   */
  | "length"
  /** Provably a `<percentage>` — a `%`-suffixed string. */
  | "percentage"
  /**
   * A bare JavaScript number, whose unit — if it ever had one — the COMPILER
   * erased.
   *
   * `parseDimension` (`compiler/declarations.ts`) lowers a `px` dimension to its
   * numeric value, and the first lightningcss pass rewrites `rem` to `px` ahead
   * of it. So a custom property declared `--x: 22px` and one declared
   * `--x: 1.375` reach the runtime as the identical descriptors `22` and
   * `1.375`, and nothing downstream can separate them.
   *
   * CSS says a bare number in `line-height` position is a RATIO, so that is the
   * reading this kind carries — right for the unitless author, wrong for the
   * `px` one. Closing that last hole needs the compiler to keep the unit on a
   * custom property's value; `PIXEL_LENGTH` above is the representation this
   * module already classifies correctly the moment it does.
   */
  | "number"
  /** Not numeric at all — a keyword, a colour, a var that resolved to nothing. */
  | "unknown";

export interface Dimension {
  readonly kind: DimensionKind;
  /** The resolved magnitude, or `undefined` when nothing numeric resolved. */
  readonly value: number | undefined;
}

const UNKNOWN: Dimension = { kind: "unknown", value: undefined };

/**
 * The functions the compiler emits for a value that is still a LENGTH at
 * runtime.
 *
 * Every one of them is a unit the compiler could not fold away at build time
 * because its base is only known once the element renders — the font size for
 * `em`/`rem`, the window for `vw`/`vh`/`rnw`/`rnh`, the display density for
 * `hairlineWidth`. That is exactly why they survive as functions, and why they
 * are the units this module can still see.
 */
const LENGTH_FUNCTIONS = new Set([
  "em",
  "rem",
  "vw",
  "vh",
  "rnw",
  "rnh",
  "hairlineWidth",
]);

/**
 * The functions whose result takes its type from its arguments: a `calc()` over
 * a length is a length, a `calc()` over bare numbers is a bare number.
 */
const COMPOSITE_FUNCTIONS = new Set(["calc", "min", "max", "clamp"]);

/** The arithmetic tokens `calc()` carries inline between its terms. */
const CALC_OPERATORS = new Set(["+", "-", "*", "/", "(", ")"]);

/**
 * Resolve a descriptor to its value AND to what that value means.
 *
 * The kind is read off the descriptor tree before it is flattened; the value is
 * whatever `resolve` makes of the same tree — so the two always describe one
 * resolution rather than two.
 */
export function resolveDimension(
  descriptor: StyleDescriptor,
  resolve: SimpleResolveValue,
  get: Getter,
  options: ResolveValueOptions,
): Dimension {
  switch (typeof descriptor) {
    case "number":
      return { kind: "number", value: descriptor };
    case "string": {
      if (PIXEL_LENGTH.test(descriptor)) {
        return { kind: "length", value: Number.parseFloat(descriptor) };
      }

      if (PERCENTAGE.test(descriptor)) {
        return { kind: "percentage", value: Number.parseFloat(descriptor) };
      }

      return UNKNOWN;
    }
    case "object": {
      // A LIST of descriptors (`translate: 10px 20px`) is an array too, and is
      // several values rather than one dimension.
      return isStyleFunction(descriptor)
        ? resolveFunctionDimension(descriptor, resolve, get, options)
        : UNKNOWN;
    }
    default:
      return UNKNOWN;
  }
}

function resolveFunctionDimension(
  descriptor: StyleFunction,
  resolve: SimpleResolveValue,
  get: Getter,
  options: ResolveValueOptions,
): Dimension {
  const name = descriptor[1];

  if (name === "var") {
    return resolveVariableDimension(descriptor, resolve, get, options);
  }

  if (LENGTH_FUNCTIONS.has(name)) {
    return asDimension("length", resolve(descriptor));
  }

  if (COMPOSITE_FUNCTIONS.has(name)) {
    const terms = descriptor[2];
    const kind = isStyleDescriptorArray(terms)
      ? combineKinds(
          terms
            // An arithmetic token is punctuation, not a term. Classifying `"+"`
            // as a value would make every `calc()` unknown.
            .filter((term) => !CALC_OPERATORS.has(term as string))
            .map((term) => resolveDimension(term, resolve, get, options).kind),
        )
      : resolveDimension(terms, resolve, get, options).kind;

    return asDimension(kind, resolve(descriptor));
  }

  return UNKNOWN;
}

/**
 * A `var()`'s kind is the kind of the DECLARATION it resolves to, so the source
 * that answered has to be identified — not merely the value it produced.
 *
 * `lookupVariable` walks the variable sources in cascade order and hands back
 * both halves: the value, and the declaration that produced it. Classifying that
 * declaration keeps the chain intact through any number of links — `--a: var(--b)`
 * with `--b: 1.5em` classifies as the length `--b` declares, because `--a`'s
 * declaration is a `var()` and lands back here.
 *
 * The FALLBACK is this function's business rather than the resolver's: it is
 * only reached when no declaration answered, and it has to stay a descriptor
 * until it is classified — `var(--missing, 1.5em)` would otherwise arrive as
 * the bare number 25.5 rather than as the length it is.
 */
function resolveVariableDimension(
  descriptor: StyleFunction,
  resolve: SimpleResolveValue,
  get: Getter,
  options: ResolveValueOptions,
): Dimension {
  const { name, fallback } = readVariableReference(descriptor);

  if (name === undefined) {
    return UNKNOWN;
  }

  const lookup = lookupVariable(resolve, name, get, options);

  if (lookup.kind === "cycle") {
    return UNKNOWN;
  }

  if (lookup.kind === "undeclared" || lookup.value === undefined) {
    return fallback === undefined
      ? UNKNOWN
      : resolveDimension(fallback, resolve, get, options);
  }

  const source = classifySource(name, lookup.descriptor, resolve, get, options);

  // The variable's own resolution wins when it produced a number, because a
  // length function resolves against state the descriptor alone cannot see —
  // `1.5em` is 25.5 only once the font size is known. A PERCENTAGE resolves to
  // the string `"150%"` and keeps its magnitude in the classification instead.
  return typeof lookup.value === "number"
    ? { kind: source.kind, value: lookup.value }
    : source;
}

/**
 * The kind of the declaration that answered for `name`.
 *
 * Classifying it walks the same chain the lookup just walked, and a declaration
 * may name itself somewhere along it — `--x: calc(var(--x) + 1)` resolves to a
 * value (the cyclic term drops out) and then classifies forever. So the name
 * goes back on the resolution path for the walk, which is the guard the resolver
 * itself uses. It is provably not on the path already: a name that was would
 * have been answered as a cycle rather than as a declaration.
 */
function classifySource(
  name: string,
  descriptor: StyleDescriptor,
  resolve: SimpleResolveValue,
  get: Getter,
  options: ResolveValueOptions,
): Dimension {
  const history = (options.variableHistory ??= new Set<string>());

  history.add(name);

  try {
    return resolveDimension(descriptor, resolve, get, options);
  } finally {
    history.delete(name);
  }
}

function asDimension(kind: DimensionKind, value: unknown): Dimension {
  return typeof value === "number" ? { kind, value } : UNKNOWN;
}

/**
 * css-values-4 §10: a sum or comparison is a length as soon as ONE of its terms
 * is, and a percentage only when no term is a length. A term that is not numeric
 * at all makes the whole expression unusable.
 *
 * Multiplication and division are approximated by the same rule. Exactly, a
 * length divided by a length is a plain number — but that expression is not
 * something React Native can consume in a `line-height` anyway, so the
 * distinction buys nothing here.
 */
function combineKinds(kinds: DimensionKind[]): DimensionKind {
  if (kinds.length === 0 || kinds.includes("unknown")) {
    return "unknown";
  }

  if (kinds.includes("length")) {
    return "length";
  }

  if (kinds.includes("percentage")) {
    return "percentage";
  }

  return "number";
}
