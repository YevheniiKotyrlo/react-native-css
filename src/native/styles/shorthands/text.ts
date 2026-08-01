import { CURRENT_COLOR, ShortHandSymbol } from "../constants";
import type { StyleResolver } from "../resolve";
import { resolveShorthandArguments } from "./_expand";

/**
 * `text-decoration`, expanded from the values a `var()` supplied.
 *
 * `textDecoration` is not a React Native style key, so a value left on it loses
 * the line and the colour together.
 *
 * The shorthand is `<line> || <style> || <color>` in any order, and React Native
 * carries the line and the colour. `textDecorationStyle` exists, but the
 * compile-time parser does not write it, so neither does this.
 */

/** The lines React Native renders, in the spelling it reads them. */
const LINES = new Set(["none", "underline", "line-through"]);

/** Lines CSS defines and React Native has no rendering for. */
const IGNORED_LINES = new Set(["overline", "blink"]);

const STYLES = new Set(["solid", "double", "dotted", "dashed", "wavy"]);

export const textDecoration: StyleResolver = (resolve, value) => {
  const values = resolveShorthandArguments(resolve, value);

  if (values === undefined) {
    return undefined;
  }

  const lines: string[] = [];
  let color: unknown;

  for (const token of values) {
    if (typeof token === "string" && IGNORED_LINES.has(token)) {
      continue;
    } else if (typeof token === "string" && LINES.has(token)) {
      lines.push(token);
    } else if (typeof token === "string" && STYLES.has(token)) {
      continue;
    } else if (color === undefined) {
      color = token;
    } else {
      // A second value that is neither a line nor a style is not this
      // shorthand's grammar.
      return undefined;
    }
  }

  // The compile-time parser writes both keys for every valid declaration, so a
  // list with no line at all is not one.
  if (lines.length === 0) {
    return undefined;
  }

  return {
    [ShortHandSymbol]: true,
    textDecorationLine: lines.includes("none") ? "none" : lines.join(" "),
    textDecorationColor: color ?? resolve(CURRENT_COLOR),
  };
};

/**
 * `text-decoration-line` from a value only known at runtime.
 *
 * React Native does not take a list here — `TextStyle.textDecorationLine` is
 * the union `'none' | 'underline' | 'line-through' | 'underline line-through'`,
 * so the two-line form is ONE member spelled with a space, and the array a
 * `var()` resolves to is not any of them.
 *
 * The order is fixed rather than preserved, because only one of the two
 * orderings is in that union. CSS accepts either, and the compile-time parser
 * already normalises — `line-through underline` compiles to
 * `"underline line-through"` — so this is the same normalisation on the route
 * that reaches it later.
 */
export const textDecorationLine: StyleResolver = (resolve, value) => {
  const values = resolveShorthandArguments(resolve, value);

  if (values === undefined) {
    return undefined;
  }

  const keywords = new Set(
    values.filter((token): token is string => typeof token === "string"),
  );

  if (keywords.has("none")) {
    // Exclusive: `none` beside a line is not this property's grammar.
    return keywords.size === 1 ? "none" : undefined;
  }

  const lines = ["underline", "line-through"].filter((line) =>
    keywords.has(line),
  );

  return lines.length > 0 ? lines.join(" ") : undefined;
};

/**
 * `font-family` from a value only known at runtime.
 *
 * CSS writes a fallback STACK and React Native takes one name
 * (`TextStyle.fontFamily` is `string`), so the first family is as much of the
 * declaration as it can hold — which is what the compile-time parser already
 * keeps. Handing over the whole stack instead names a font that does not exist.
 */
export const fontFamily: StyleResolver = (resolve, value) => {
  const values = resolveShorthandArguments(resolve, value);
  const [first] = values ?? [];

  return typeof first === "string" ? first : undefined;
};
