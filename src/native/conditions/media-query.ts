/* eslint-disable */
import { PixelRatio, Platform } from "react-native";

import type { MediaCondition } from "react-native-css/compiler";

import { colorScheme, vh, vw, type Getter } from "../reactivity";
import {
  resolveInitialDirectionality,
  type Directionality,
} from "./directionality";

/**
 * `directionality` is the ELEMENT's, resolved by `updateRules` from its `dir` prop and its
 * inherited scope: `:dir()` answers per element (Selectors 4 §7.1), never per process. Absent —
 * a `:root` declaration, a test over a global feature — the platform's root direction answers.
 */
export function testMediaQuery(
  mediaQueries: MediaCondition[],
  get: Getter,
  directionality?: Directionality,
) {
  return mediaQueries.every((query) => test(query, get, directionality));
}

function test(
  mediaQuery: MediaCondition,
  get: Getter,
  directionality: Directionality | undefined,
): Boolean {
  switch (mediaQuery[0]) {
    case "[]":
    case "!!":
      return false;
    case "!":
      return !test(mediaQuery[1], get, directionality);
    case "&":
      return mediaQuery[1].every((query) => {
        return test(query, get, directionality);
      });
    case "|":
      return mediaQuery[1].some((query) => {
        return test(query, get, directionality);
      });
    case ">":
    case ">=":
    case "<":
    case "<=":
    case "=": {
      return testComparison(mediaQuery, get, directionality);
    }
  }
}

function testComparison(
  mediaQuery: MediaCondition,
  get: Getter,
  directionality: Directionality | undefined,
): Boolean {
  const value = mediaQuery[2];

  switch (mediaQuery[1]) {
    case "dir":
      return value === (directionality ?? resolveInitialDirectionality());
    case "hover":
      return true;
    case "platform":
      return value === "native" || value === Platform.OS;
    case "prefers-color-scheme": {
      return value === get(colorScheme);
    }
    case "display-mode":
      return value === "native" || Platform.OS === value;
    case "min-width":
      return typeof value === "number" && get(vw) >= value;
    case "max-width":
      return typeof value === "number" && get(vw) <= value;
    case "min-height":
      return typeof value === "number" && get(vh) >= value;
    case "max-height":
      return typeof value === "number" && get(vh) <= value;
    case "orientation":
      return value === "landscape" ? get(vh) < get(vw) : get(vh) >= get(vw);
  }

  if (typeof value !== "number") {
    return false;
  }

  let left: number | undefined;
  const right = value;

  switch (mediaQuery[1]) {
    case "width":
      left = get(vw);
      break;
    case "height":
      left = get(vh);
      break;
    case "resolution":
      left = PixelRatio.get();
      break;
    default:
      return false;
  }

  switch (mediaQuery[0]) {
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
      return false;
  }
}
