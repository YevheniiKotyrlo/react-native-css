import type { StyleDescriptor } from "react-native-css/compiler";
import { isStyleDescriptorArray } from "react-native-css/utilities";

import type { StyleFunctionResolver } from "../resolve";

/**
 * `none` is the IDENTITY, not a value React Native can hold. Forwarding the
 * literal string produced `{scale: "none"}` / `{rotate: "none"}`, which React
 * Native either ignores or rejects — and on the compile-time route the same
 * declaration already became an identity transform, so the two routes rendered
 * differently.
 */
const isNoneKeyword = (value: unknown): boolean =>
  typeof value === "string" && value.toLowerCase() === "none";

/**
 * A transform function's arguments, resolved, however the author spelled them.
 *
 * A CSS transform takes a LIST — `translate: 10px 20px` — and the compiler emits
 * that list as a descriptor array whose entries these resolvers read one by one.
 * A single `var()` standing in for the whole list is not a descriptor array: it
 * is one descriptor that RESOLVES to the list, and reading `args[1]` off it
 * finds nothing.
 *
 * Resolving first and inspecting after is what makes the two spellings the same
 * declaration. `translate: var(--offset)` with `--offset: 10px 20px` resolved to
 * `[10, 20]`, failed the "is this a single component" check, and returned
 * `undefined` — which then left the deferred-resolution placeholder in the
 * transform array as the rendered style.
 */
type TransformArguments =
  /** Several components, whether written out or supplied by one variable. */
  | { readonly kind: "list"; readonly components: unknown[] }
  /** One component, which each function completes with its own CSS default. */
  | { readonly kind: "single"; readonly value: unknown };

function resolveComponents(
  resolveValue: (value: StyleDescriptor) => unknown,
  args: StyleDescriptor,
): TransformArguments {
  if (isStyleDescriptorArray(args)) {
    return { kind: "list", components: args.map((arg) => resolveValue(arg)) };
  }

  const value = resolveValue(args);

  return Array.isArray(value)
    ? { kind: "list", components: value }
    : { kind: "single", value };
}

/** The axis keywords the standalone `rotate` property accepts, and their keys. */
const AXIS_KEYS = {
  x: "rotateX",
  y: "rotateY",
  z: "rotateZ",
} as const;

const isAxisKeyword = (value: unknown): value is keyof typeof AXIS_KEYS =>
  value === "x" || value === "y" || value === "z";

export const scale: StyleFunctionResolver = (resolveValue, descriptor) => {
  const args = resolveComponents(resolveValue, descriptor[2]);

  if (args.kind === "single") {
    return isNoneKeyword(args.value) ? { scale: 1 } : { scale: args.value };
  }

  const [x, y] = args.components;

  const isXValid = typeof x === "string" || typeof x === "number";
  const isYValid = typeof y === "string" || typeof y === "number";

  if (isXValid && isYValid) {
    return x === y ? { scale: x } : [{ scaleX: x }, { scaleY: y }];
  } else if (isXValid) {
    return { scaleX: x };
  } else if (isYValid) {
    return { scaleY: y };
  }

  return;
};

export const rotate: StyleFunctionResolver = (resolveValue, descriptor) => {
  const args = resolveComponents(resolveValue, descriptor[2]);

  if (args.kind === "single") {
    return isNoneKeyword(args.value)
      ? { rotate: "0deg" }
      : { rotate: args.value };
  }

  // css-transforms-2 §3.3: the standalone `rotate` PROPERTY names its axis
  // before (or after) the angle — `rotate: x 45deg` is a rotation about x, not
  // two rotations. The components are `&&`-combined, so either order is valid.
  const axis = args.components.find(isAxisKeyword);

  if (axis !== undefined && args.components.length === 2) {
    const angle = args.components.find((component) => component !== axis);

    return isRenderable(angle) ? { [AXIS_KEYS[axis]]: angle } : undefined;
  }

  const [x, y, z] = args.components;

  const isXValid = typeof x === "string" || typeof x === "number";
  const isYValid = typeof y === "string" || typeof y === "number";
  const isZValid = typeof z === "string" || typeof z === "number";

  if (isXValid && isYValid && isZValid) {
    return [{ rotateX: x }, { rotateY: y }, { rotateZ: z }];
  } else if (isXValid && isYValid) {
    return [{ rotateX: x }, { rotateY: y }];
  } else if (isXValid && isZValid) {
    return [{ rotateX: x }, { rotateZ: z }];
  } else if (isYValid && isZValid) {
    return [{ rotateY: y }, { rotateZ: z }];
  } else if (isXValid) {
    return { rotateX: x };
  } else if (isYValid) {
    return { rotateY: y };
  } else if (isZValid) {
    return { rotateZ: z };
  }

  return;
};

export const translate: StyleFunctionResolver = (resolveValue, descriptor) => {
  const args = resolveComponents(resolveValue, descriptor[2]);

  if (args.kind === "single") {
    // `translate(10px)` — CSS defaults the omitted y to 0, so a single
    // component is a complete declaration. Reading `args[1]` off a non-array
    // descriptor failed the validity check for BOTH components and dropped the
    // whole translation.
    if (isNoneKeyword(args.value)) {
      return [{ translateX: 0 }, { translateY: 0 }];
    }

    return typeof args.value === "string" || typeof args.value === "number"
      ? [{ translateX: args.value }, { translateY: 0 }]
      : undefined;
  }

  const [x, y] = args.components;

  const isXValid = typeof x === "string" || typeof x === "number";
  const isYValid = typeof y === "string" || typeof y === "number";

  if (isXValid && isYValid) {
    return [{ translateX: x }, { translateY: y }];
  } else if (isXValid) {
    return [{ translateX: x }, { translateY: 0 }];
  } else if (isYValid) {
    return [{ translateX: 0 }, { translateY: y }];
  }

  return;
};

/** A resolved transform argument React Native can hold. */
const isRenderable = (value: unknown): value is string | number =>
  typeof value === "string" || typeof value === "number";

/**
 * The 3D transform functions, whose x/y half React Native can render and whose
 * z half it cannot.
 *
 * `parseTransform` expands all three at compile time. Without these resolvers
 * the runtime route warned and dropped the whole function, so
 * `transform: translate3d(var(--x), 2px, 0)` lost the translation that
 * `transform: translate3d(1px, 2px, 0)` rendered — the exact drift between the
 * compiler's exhaustive switch and this hand-maintained registry that the
 * `transform-path-equivalence` suite exists to catch.
 *
 * The z is dropped rather than approximated: React Native has no `translateZ`
 * or `scaleZ` key. The compile-time route warns about a non-identity z; the
 * runtime route cannot, because it has no builder to warn through.
 */
export const translate3d: StyleFunctionResolver = (
  resolveValue,
  descriptor,
) => {
  const args = descriptor[2];

  if (!isStyleDescriptorArray(args)) {
    return;
  }

  const x = resolveValue(args[0]);
  const y = resolveValue(args[1]);

  return isRenderable(x) && isRenderable(y)
    ? [{ translateX: x }, { translateY: y }]
    : undefined;
};

export const scale3d: StyleFunctionResolver = (resolveValue, descriptor) => {
  const args = descriptor[2];

  if (!isStyleDescriptorArray(args)) {
    return;
  }

  const x = resolveValue(args[0]);
  const y = resolveValue(args[1]);

  return isRenderable(x) && isRenderable(y)
    ? [{ scaleX: x }, { scaleY: y }]
    : undefined;
};

/**
 * `rotate3d(x, y, z, angle)` is an axis-angle rotation, and React Native has
 * only the three Euler rotations — exact for a unit axis, undecomposable
 * otherwise. The SIGN matters: rotating about −Z by 45° is rotating about +Z by
 * −45°.
 */
export const rotate3d: StyleFunctionResolver = (resolveValue, descriptor) => {
  const args = descriptor[2];

  if (!isStyleDescriptorArray(args)) {
    return;
  }

  const x = resolveValue(args[0]);
  const y = resolveValue(args[1]);
  const z = resolveValue(args[2]);
  const angle = resolveValue(args[3]);

  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof z !== "number" ||
    !isRenderable(angle)
  ) {
    return;
  }

  if (x !== 0 && y === 0 && z === 0) {
    return { rotateX: x < 0 ? negateAngle(angle) : angle };
  }
  if (x === 0 && y !== 0 && z === 0) {
    return { rotateY: y < 0 ? negateAngle(angle) : angle };
  }
  if (x === 0 && y === 0 && z !== 0) {
    return { rotateZ: z < 0 ? negateAngle(angle) : angle };
  }

  return;
};

/** Flip an angle's direction. Angles arrive as `"45deg"`-shaped strings. */
function negateAngle(angle: string | number): string | number {
  if (typeof angle === "number") {
    return -angle;
  }

  return angle.startsWith("-") ? angle.slice(1) : `-${angle}`;
}

/**
 * `matrix(a, b, c, d, e, f)` — React Native's `processTransform` accepts a
 * 9-element (2D) or 16-element (3D) COLUMN-MAJOR matrix and asserts that arity,
 * so CSS's six values have to be expanded into the 3x3: columns `(a b 0)`,
 * `(c d 0)`, `(e f 1)`. The compile-time route does the same expansion; without
 * this resolver the runtime route handed React Native six elements, which fails
 * `Matrix transform must have a length of 9 (2d) or 16 (3d)`.
 */
export const matrix: StyleFunctionResolver = (resolveValue, descriptor) => {
  const args = resolveValue(descriptor[2]);

  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "number")) {
    return;
  }

  const numbers = args as number[];

  // Both routes land here, and they arrive with different arities. The
  // COMPILE-TIME route has already expanded CSS's six values into the 3x3, so
  // it hands over 9; the RUNTIME route hands over the six raw arguments. 16 is
  // `matrix3d`'s output, which the compile-time route also produces.
  if (numbers.length === 9 || numbers.length === 16) {
    return { matrix: numbers };
  }

  if (numbers.length !== 6) {
    return;
  }

  const [a, b, c, d, e, f] = numbers;

  return { matrix: [a, b, 0, c, d, 0, e, f, 1] };
};

/**
 * `matrix3d(m11 … m44)` — CSS's argument order is already the column-major
 * layout React Native expects, so this is a straight copy. Without a resolver
 * the name fell through to the generic stringifier and reached the transform
 * array as the raw text `"matrix3d(1, 0, …)"`, which fails React Native's
 * "exactly one property per transform object".
 */
export const matrix3d: StyleFunctionResolver = matrix;

/**
 * `skew(<x-angle>, <y-angle>?)` — React Native has `skewX` and `skewY` but no
 * `skew`, and the compile-time switch already expands it. Without this the
 * runtime route warned and dropped the whole function.
 */
export const skew: StyleFunctionResolver = (resolveValue, descriptor) => {
  const args = resolveComponents(resolveValue, descriptor[2]);

  if (args.kind === "single") {
    return typeof args.value === "string" || typeof args.value === "number"
      ? [{ skewX: args.value }, { skewY: "0deg" }]
      : undefined;
  }

  const [x, y] = args.components;

  const isXValid = typeof x === "string" || typeof x === "number";
  const isYValid = typeof y === "string" || typeof y === "number";

  if (isXValid && isYValid) {
    return [{ skewX: x }, { skewY: y }];
  } else if (isXValid) {
    // CSS defaults the omitted y-angle to zero.
    return [{ skewX: x }, { skewY: "0deg" }];
  }

  return;
};
