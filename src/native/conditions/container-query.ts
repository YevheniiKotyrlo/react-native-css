/* eslint-disable */
import type { MediaFeatureNameFor_ContainerSizeFeatureId } from "lightningcss";
import type {
  ContainerQuery,
  MediaCondition,
  PseudoClassesQuery,
  StyleDescriptor,
} from "react-native-css/compiler";

import {
  activeFamily,
  containerHeightFamily,
  containerWidthFamily,
  focusFamily,
  hoverFamily,
  type ContainerContextValue,
  type Getter,
} from "../reactivity";
// import { testAttributes } from "./attributes";
import type { RenderGuard } from "./guards";
import {
  conjoin,
  disjoin,
  matches,
  negate,
  UNKNOWN,
  type Truth,
} from "./kleene";

export const DEFAULT_CONTAINER_NAME = "c:___default___";

export function testContainerQueries(
  queries: ContainerQuery[],
  inheritedContainers: ContainerContextValue,
  guards: RenderGuard[],
  get: Getter,
) {
  return queries.every((query) => {
    return testContainerQuery(query, inheritedContainers, guards, get);
  });
}

export function testContainerQuery(
  query: ContainerQuery,
  inheritedContainers: ContainerContextValue,
  guards: RenderGuard[],
  get: Getter,
): boolean {
  const name = query.n ?? DEFAULT_CONTAINER_NAME;
  const container = inheritedContainers[name]!;

  guards.push(["c", name, container]);

  if (!container) {
    return false;
  }

  // if (query.a && !testAttributes(query.a, container.props, guards)) {
  //   return false;
  // }

  // Only a definite `true` matches — see the three-valued logic below.
  if (
    query.m &&
    !matches(testContainerMediaCondition(query.m, container, get))
  ) {
    return false;
  }

  if (query.p && !testContainerPseudoCondition(query.p, container, get)) {
    return false;
  }

  return true;
}

function testContainerPseudoCondition(
  query: PseudoClassesQuery,
  containerKey: WeakKey,
  get: Getter,
): boolean {
  if (query.h && !get(hoverFamily(containerKey))) {
    return false;
  }
  if (query.a && !get(activeFamily(containerKey))) {
    return false;
  }
  if (query.f && !get(focusFamily(containerKey))) {
    return false;
  }
  return true;
}

/**
 * `undefined` means UNKNOWN — a feature or form this evaluator does not
 * implement — which is a different answer from `false` and behaves differently
 * under negation. The reasoning, and the CSS reference, is in
 * `./media-query.ts`; `@container` uses the same condition language and gets the
 * same logic so the two cannot disagree about a shared operator again.
 */
type ContainerVerdict = Truth;

function testContainerMediaCondition(
  condition: MediaCondition,
  containerKey: WeakKey,
  get: Getter,
): ContainerVerdict {
  switch (condition[0]) {
    case "?":
      return UNKNOWN;
    case "!":
      return negate(
        testContainerMediaCondition(condition[1], containerKey, get),
      );
    case "&":
      return conjoin(condition[1], (query) =>
        testContainerMediaCondition(query, containerKey, get),
      );
    case "|":
      return disjoin(condition[1], (query) =>
        testContainerMediaCondition(query, containerKey, get),
      );
    case "!!": {
      // MQ5 §2.4.3 boolean context. A container's size features are all
      // numeric, so the "false" value is zero — a container with no width does
      // not satisfy `@container (width)`.
      const value = getContainerFeatureValue(condition[1], containerKey, get);
      return value === undefined ? UNKNOWN : value !== 0;
    }
    case "[]": {
      // `(400px < width < 800px)`. The START comparison reads with the feature
      // on the RIGHT.
      const [, name, start, startOperator, end, endOperator] = condition;
      const value = getContainerFeatureValue(name, containerKey, get);

      if (value === undefined) {
        return UNKNOWN;
      }

      // A bound the runtime cannot order is unknown, never false — false is
      // what a negation turns into a match.
      if (typeof start !== "number" || typeof end !== "number") {
        return UNKNOWN;
      }

      if (typeof value !== "number") {
        return false;
      }

      return (
        compareContainer(startOperator, start, value) &&
        compareContainer(endOperator, value, end)
      );
    }
    case ">":
    case ">=":
    case "<":
    case "<=":
    case "=": {
      const left = getContainerFeatureValue(condition[1], containerKey, get);
      const right = condition[2];

      if (left === undefined) {
        return UNKNOWN;
      }

      // Before the equality shortcut: `null` is the compiler's marker for an
      // operand it could not resolve, and comparing it for equality would
      // answer a definite `false` that a negation turns into a match.
      if (right === null) {
        return UNKNOWN;
      }

      if (condition[0] === "=") {
        return left === right;
      }

      // An operand that is a length the compiler could not fold reaches here as
      // a descriptor rather than a number: `(width > 10em)` compiles to
      // `[{}, "em", 10, 1]`, because `em` is relative to the element's own font
      // size. `px` folds to a number and `rem` folds against `inlineRem`, so
      // this arm carries ordinary CSS rather than a malformed prelude.
      // Ordering an operand the runtime cannot resolve gives `NaN`, which is
      // false for every operator - and false is the one answer a negation turns
      // into a match.
      if (typeof left !== "number" || typeof right !== "number") {
        return UNKNOWN;
      }

      // Each operator compares in its OWN direction. All four used to return
      // `left > right`, so `@container (width <= 400px)` matched when the
      // container was WIDER, and only `>` was ever right.
      return compareContainer(condition[0], left, right);
    }
    default:
      condition satisfies never;
      return UNKNOWN;
  }
}

function compareContainer(
  operator: ">" | ">=" | "<" | "<=" | "=",
  left: number,
  right: number,
): boolean {
  switch (operator) {
    case "=":
      return left === right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    default:
      operator satisfies never;
      return false;
  }
}

function getContainerFeatureValue(
  name: MediaFeatureNameFor_ContainerSizeFeatureId,
  containerKey: WeakKey,
  get: Getter,
): StyleDescriptor {
  switch (name) {
    case "width":
      return get(containerWidthFamily(containerKey));
    case "height":
      return get(containerHeightFamily(containerKey));
    case "aspect-ratio": {
      const width = get(containerWidthFamily(containerKey));
      const height = get(containerHeightFamily(containerKey));
      return width / height;
    }
    case "orientation":
      const width = get(containerWidthFamily(containerKey));
      const height = get(containerHeightFamily(containerKey));
      return width > height ? "landscape" : "portrait";
    // React Native lays out in one writing mode, so the logical axes are the
    // physical ones: inline is horizontal and block is vertical. `inline-size`
    // is also the axis `container-type: inline-size` names, which makes it the
    // feature most container queries are written against.
    case "inline-size":
      return get(containerWidthFamily(containerKey));
    case "block-size":
      return get(containerHeightFamily(containerKey));
    default:
      return;
  }
}
