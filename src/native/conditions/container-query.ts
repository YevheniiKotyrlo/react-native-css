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

export const DEFAULT_CONTAINER_NAME = "c:___default___";

/**
 * The ancestor compounds of one selector, outermost first, walked INNERMOST first.
 *
 * Each compound is resolved in the scope of the one inside it, so `.a .b .x` asks for a `.b`
 * ancestor that itself has an `.a` ancestor — Selectors 4 §16.1. Resolving every compound in the
 * element's own scope asks only "are both names somewhere above", which is also true when the
 * nesting is reversed.
 */
export function testContainerQueries(
  queries: ContainerQuery[],
  inheritedContainers: ContainerContextValue,
  guards: RenderGuard[],
  get: Getter,
) {
  // Every name the walk can reach is also inherited by this element, so the element's own scope is
  // where a change to any of them is observable — and it is the only scope this element can re-read.
  // Keyed on the element rather than on the registration, which is minted per update.
  for (const query of queries) {
    const name = query.n ?? DEFAULT_CONTAINER_NAME;
    guards.push(["c", name, inheritedContainers[name]?.key]);
  }

  let scope = inheritedContainers;

  for (let index = queries.length - 1; index >= 0; index--) {
    const query = queries[index]!;
    const registration = scope[query.n ?? DEFAULT_CONTAINER_NAME];

    if (!registration || !testContainerQuery(query, registration.key, get)) {
      return false;
    }

    scope = registration.scope;
  }

  return true;
}

export function testContainerQuery(
  query: ContainerQuery,
  containerKey: WeakKey,
  get: Getter,
): boolean {
  // if (query.a && !testAttributes(query.a, container.props, guards)) {
  //   return false;
  // }

  if (query.m && !testContainerMediaCondition(query.m, containerKey, get)) {
    return false;
  }

  if (query.p && !testContainerPseudoCondition(query.p, containerKey, get)) {
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

function testContainerMediaCondition(
  condition: MediaCondition,
  containerKey: WeakKey,
  get: Getter,
): boolean {
  switch (condition[0]) {
    case "!":
      return !testContainerMediaCondition(condition[1], containerKey, get);
    case "&":
      return condition[1].every((query) => {
        return testContainerMediaCondition(query, containerKey, get);
      });
    case "|":
      return condition[1].some((query) => {
        return testContainerMediaCondition(query, containerKey, get);
      });
    case "!!":
      return false;
    case "[]":
      return false;
    case ">":
    case ">=":
    case "<":
    case "<=":
    case "=": {
      const left = getContainerFeatureValue(condition[1], containerKey, get);
      const right = condition[2];

      if (condition[0] === "=") {
        return left === right;
      }

      if (typeof left !== "number" || typeof right !== "number") {
        return false;
      }

      switch (condition[0]) {
        case ">":
          return left > right;
        case ">=":
          return left > right;
        case "<":
          return left > right;
        case "<=":
          return left > right;
        default:
          condition[0] satisfies never;
          return false;
      }
    }
    default:
      condition satisfies never;
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
    case "inline-size":
    case "block-size":
    default:
      return;
  }
}
