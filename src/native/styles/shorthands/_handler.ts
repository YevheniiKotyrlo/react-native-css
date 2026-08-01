/* eslint-disable */
import type { StyleDescriptor } from "react-native-css/compiler";
import { isStyleFunction } from "react-native-css/utilities";

import { setDeepPath } from "../../objects";
import { ShortHandSymbol } from "../constants";
import { defaultValues } from "../defaults";
import type { StyleResolver } from "../resolve";
import { resolveShorthandArguments } from "./_expand";

type ShorthandType =
  | "string"
  | "number"
  | "length"
  | "color"
  | Readonly<(string | Function)[]>;

/**
 * The React Native key a matched component is written to, or `undefined` for a
 * component CSS defines and React Native has no key for — `border-top`'s style,
 * which React Native carries only as the whole-box `borderStyle`. The component
 * still has to be in the mapping, because it occupies a position the values are
 * matched against; it simply writes nothing.
 */
type ShorthandTarget = string | readonly string[] | undefined;

type ShorthandRequiredValue =
  | readonly [ShorthandTarget, ShorthandType]
  | ShorthandDefaultValue;

/**
 * A component with a value for when the declaration omits it — either the NAME
 * of an entry in `defaultValues`, or the value itself. `currentcolor` is written
 * as the descriptor it is, because it names a variable rather than a colour.
 */
type ShorthandDefaultValue = readonly [
  ShorthandTarget,
  ShorthandType,
  StyleDescriptor,
];

export function shorthandHandler(
  mappings: ShorthandRequiredValue[][],
  defaults: ShorthandDefaultValue[],
  returnType: "shorthandObject" | "tuples" | "object" = "shorthandObject",
): StyleResolver {
  return (resolve, value, __, { castToArray }) => {
    // A shorthand given ONE value is a complete declaration — `border: solid`
    // names a line style and takes CSS's initial width and colour — and a
    // variable holding one token resolves to that token rather than to a list
    // of one. Read through the same reader as the repeat shorthands
    // (`./_expand.ts`), which makes a one-value list of it, so the one-value
    // rows in the mapping tables below are reachable at all.
    const args = resolveShorthandArguments(resolve, value);

    if (args === undefined) {
      return;
    }

    const match = mappings.find((mapping) => {
      return (
        args.length === mapping.length &&
        mapping.every((map, index) => {
          const type = map[1];
          const value = args[index];

          if (Array.isArray(type)) {
            return type.some(
              (member) => member === value || member === typeof value,
            );
          }

          // Style functions (var, calc, env, etc.) are unresolved at pattern-match
          // time — their actual values won't be known until runtime variable
          // resolution. Accepting them in any type slot makes pattern matching
          // less strict when variables are involved, but rejecting them would
          // break variable-based shadows entirely (e.g. box-shadow: var(--shadow)
          // where --shadow resolves to "0 4px 6px -1px #000").
          if (Array.isArray(value) && isStyleFunction(value)) {
            return true;
          }

          switch (type) {
            case "string":
            case "number":
              return typeof value === type;
            case "color":
              return typeof value === "string" || typeof value === "object";
            case "length":
              return typeof value === "string"
                ? value.endsWith("%")
                : typeof value === "number";
          }

          return;
        })
      );
    });

    if (!match) return;

    const seenDefaults = new Set(defaults);

    const tuples = [
      ...match.map((map, index): [unknown, ShorthandRequiredValue[0]] => {
        if (map.length === 3) {
          seenDefaults.delete(map);
        }

        let value = args[index];
        if (castToArray && value && !Array.isArray(value)) {
          value = [value];
        }

        return [value, map[0]];
      }),
      ...Array.from(seenDefaults).map(
        (map): [unknown, ShorthandRequiredValue[0]] => {
          // A default is written either as the NAME of an entry in
          // `defaultValues` or as the value itself, and the value itself may be
          // a descriptor rather than a literal — `currentcolor` is a read of the
          // element's own colour, so it is only a colour once it is resolved.
          let value: unknown = resolve(
            typeof map[2] === "string" ? (defaultValues[map[2]] ?? map[2]) : map[2],
          );

          if (castToArray && value && !Array.isArray(value)) {
            value = [value];
          }

          return [value, map[0]];
        },
      ),
    ];

    if (returnType === "shorthandObject" || returnType === "object") {
      const target: Record<string, unknown> =
        returnType === "shorthandObject" ? { [ShortHandSymbol]: true } : {};

      for (const [value, prop] of tuples) {
        if (prop === undefined) {
          continue;
        } else if (typeof prop === "string") {
          target[prop] = value;
        } else {
          setDeepPath(target, prop, value);
        }
      }

      return target;
    } else {
      return tuples;
    }
  };
}
