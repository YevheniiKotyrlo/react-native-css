import { ShortHandSymbol } from "../constants";
import type { StyleResolver } from "../resolve";
import { lookupVariable } from "../variables";
import { resolveShorthandArguments } from "./_expand";

/**
 * The `font` shorthand when the declaration still holds a `var()` at runtime.
 *
 * The compile-time twin is `parseFont` (`compiler/declarations.ts`), which
 * expands the shorthand into six longhands from a value lightningcss has
 * already typed. This resolver reaches the same six from a flat token list,
 * because a `var()` is only a token list until it resolves.
 *
 * ## Reading the grammar backwards
 *
 * css-fonts-4 §15.1 is
 * `[ style || variant || weight || stretch ]? <size> [ / <line-height> ]? <family>`,
 * and the reliable landmark in it is the SOLIDUS rather than the size. A size
 * and a weight are both "a number, possibly with a unit" once the types are
 * gone — `font: 700 16px Arial` and `font: 16px/700 Arial` tokenise into the
 * same three kinds of thing — so scanning left to right and guessing which
 * number is which is exactly the mistake `line-height`'s own resolver was
 * written to stop making.
 *
 * The solidus cannot be anything else, so it anchors the parse: the size is the
 * token before it and the line-height the token after. Without one, the family
 * is the last token and the size the one before it. Everything to the left of
 * the size is the style/variant/weight prefix, in any order, which is what `||`
 * means.
 *
 * ## What is deliberately not carried
 *
 * `font-stretch` has no React Native key, so a `condensed` in the prefix is
 * parsed and dropped rather than mistaken for a weight. The family narrows to
 * its first entry, as every other route does — React Native's `fontFamily` is
 * one family, not a stack.
 */
export const font: StyleResolver = (resolve, value, get, options) => {
  const tokens = resolveShorthandArguments(resolve, value);
  // The tokens as DECLARED, which still carry their units. Read in parallel
  // with the resolved ones — same length, same positions — so the line-height
  // slot can be told apart from a ratio.
  const declared = readDeclaredTokens(value, resolve, get, options);

  if (tokens === undefined || tokens.length < 2) {
    return undefined;
  }

  const solidus = tokens.indexOf("/");
  const sizeIndex =
    solidus === -1 ? findSizeIndex(tokens, declared) : solidus - 1;

  if (sizeIndex === undefined || sizeIndex < 0) {
    return undefined;
  }

  // The family RUN starts immediately after the size and its optional
  // `/ <line-height>`, and its first entry is the one React Native can take.
  const familyIndex = solidus === -1 ? sizeIndex + 1 : solidus + 2;

  if (familyIndex >= tokens.length) {
    return undefined;
  }

  const fontSize = toPixels(tokens[sizeIndex]);
  const fontFamily = tokens[familyIndex];

  if (fontSize === undefined || typeof fontFamily !== "string") {
    return undefined;
  }

  const style = readPrefix(tokens.slice(0, sizeIndex));

  // The shorthand RESETS every longhand it does not name (css-fonts-4 §15.1),
  // so the defaults below are part of the declaration rather than a fallback —
  // `font:` is how an author cancels an inherited `small-caps` or a bold.
  const resolved: Record<string, unknown> = {
    [ShortHandSymbol]: true,
    fontFamily,
    fontSize,
    fontStyle: style.fontStyle,
    fontVariant: style.fontVariant,
    fontWeight: style.fontWeight,
  };

  if (solidus !== -1) {
    const lineHeight = toLineHeight(
      tokens[solidus + 1],
      declared?.[solidus + 1],
      fontSize,
    );

    // A line-height that cannot be read drops the KEY rather than the whole
    // declaration: the other five longhands are still what the author wrote,
    // and an element with no `lineHeight` renders at the platform's own
    // leading — close to the CSS default and never absurd.
    if (lineHeight !== undefined) {
      resolved.lineHeight = lineHeight;
    }
  }

  return resolved;
};

interface FontPrefix {
  readonly fontStyle: string;
  readonly fontVariant: readonly string[];
  readonly fontWeight: string | number;
}

const STYLE_KEYWORDS = new Set(["italic", "oblique"]);
const WEIGHT_KEYWORDS = new Set(["bold", "bolder", "lighter"]);

/** The `[ style || variant || weight || stretch ]?` head, in any order. */
function readPrefix(tokens: readonly unknown[]): FontPrefix {
  let fontStyle = "normal";
  let fontWeight: string | number = "normal";
  const fontVariant: string[] = [];

  for (const token of tokens) {
    // A bare number here is a weight: the grammar puts nothing else numeric
    // before the size, and the size itself was already taken.
    if (typeof token === "number") {
      fontWeight = token;
      continue;
    }

    if (typeof token !== "string") {
      continue;
    }

    if (STYLE_KEYWORDS.has(token)) {
      fontStyle = token;
    } else if (WEIGHT_KEYWORDS.has(token)) {
      fontWeight = token;
    } else if (token === "small-caps") {
      fontVariant.push(token);
    }
    // `normal` names the default of whichever slot it fills, which is already
    // the value here — and `condensed` and its siblings are `font-stretch`,
    // which React Native has no key for. Both fall through on purpose.
  }

  return { fontStyle, fontVariant, fontWeight };
}

/**
 * The declared tokens as ONE flat list, matching what resolution produces.
 *
 * A comma groups its operands, so `font: 16px 'Helvetica Neue', Arial` is
 * declared as `[["16px", "Helvetica Neue"], "Arial"]` while the resolved list
 * is flat. The two are read in parallel by INDEX, so a nested declaration puts
 * every position out by one and the size is looked for in the wrong place.
 */
function flattenTokens(tokens: readonly unknown[]): unknown[] {
  return tokens.flat(Number.POSITIVE_INFINITY);
}

/**
 * Where the `<font-size>` sits when no solidus anchors the parse.
 *
 * Not "the second-to-last token", which is only true of a single-family
 * declaration: `font: 16px 'Helvetica Neue', Arial, sans-serif` ends in a
 * family RUN, and taking the last two tokens reads `Arial` as the size.
 *
 * The DECLARED tokens answer it, because there a length still carries its unit
 * and a weight is a bare number — the very distinction resolution destroys. The
 * first unit-bearing token is the size; everything before it is the prefix and
 * everything after is the family.
 *
 * Without a declaration to read — a partially-variable shorthand — the
 * second-to-last position is the fallback, which is right for the single-family
 * form and is the only form that shape can be written in anyway.
 */
function findSizeIndex(
  tokens: readonly unknown[],
  declared: readonly unknown[] | undefined,
): number | undefined {
  if (declared === undefined || declared.length !== tokens.length) {
    return tokens.length - 2;
  }

  const index = declared.findIndex(
    (token) => typeof token === "string" && LENGTH_UNIT.test(token),
  );

  return index === -1 ? tokens.length - 2 : index;
}

/** The units a `<font-size>` can carry. A weight never carries one. */
const LENGTH_UNIT =
  /\d(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|vw|vh|vmin|vmax|%)$/iu;

/** A `<length>` token as a number of pixels. */
function toPixels(token: unknown): number | undefined {
  if (typeof token === "number") {
    return token;
  }

  if (typeof token !== "string") {
    return undefined;
  }

  const pixels = token.endsWith("px") ? Number(token.slice(0, -2)) : Number.NaN;

  return Number.isFinite(pixels) ? pixels : undefined;
}

/**
 * The `/ <line-height>` slot, read from the DECLARED token beside the resolved
 * one.
 *
 * CSS gives a bare `<number>` here a different meaning from a `<length>` —
 * `1.5` is one and a half font sizes, `30px` is thirty pixels — and resolving a
 * `var()` folds the unit away, so both arrive as the same bare number. That is
 * the loss `line-height.ts` documents, and it is not guessable from the
 * resolved value alone: `font: 12px/30px` and `font: 12px/2.5` are the same
 * shape once the units are gone, and multiplying the wrong one renders a 360px
 * line box for a 30px declaration.
 *
 * The declared token is what settles it. `lookupVariable` hands back the
 * variable's declaration alongside its resolved value, so `"30px"` and `2.5`
 * are still distinguishable at exactly the position the resolved list has the
 * number. Where no declaration is reachable the slot is REFUSED rather than
 * guessed, which leaves the platform's own leading instead of an invented one.
 */
function toLineHeight(
  resolved: unknown,
  declared: unknown,
  fontSize: number,
): number | undefined {
  // A declared bare number is a RATIO — the one reading the resolved value can
  // never establish on its own.
  if (typeof declared === "number") {
    return typeof resolved === "number"
      ? round(resolved * fontSize)
      : round(declared * fontSize);
  }

  if (typeof declared === "string") {
    if (declared.endsWith("%")) {
      const percentage = Number.parseFloat(declared);

      return Number.isFinite(percentage)
        ? round((percentage / 100) * fontSize)
        : undefined;
    }

    // A declared length. The resolved number is the one already converted to
    // pixels — `2rem` and `1.5em` resolved against their own base on the way
    // here — so it is preferred over re-parsing the declaration.
    if (typeof resolved === "number") {
      return round(resolved);
    }

    return toPixels(declared);
  }

  // No declaration to read: the value did not come through a variable this
  // resolver can look up. A percentage still carries its unit in the resolved
  // token and is safe; a bare number is the ambiguous case and is refused.
  if (typeof resolved === "string" && resolved.endsWith("%")) {
    const percentage = Number.parseFloat(resolved);

    return Number.isFinite(percentage)
      ? round((percentage / 100) * fontSize)
      : undefined;
  }

  return typeof resolved === "number" ? undefined : toPixels(resolved);
}

/**
 * The shorthand's tokens as they were DECLARED, when the whole value is a
 * single `var()` this resolver can look up.
 *
 * Only that shape is handled, and deliberately: a partially-variable shorthand
 * (`font: italic var(--size)/var(--leading) Arial`) has no single declaration
 * to read, and inventing one would be the guess this function exists to avoid.
 * Returning nothing there falls back to refusing the ambiguous slot.
 */
function readDeclaredTokens(
  value: unknown,
  resolve: Parameters<StyleResolver>[0],
  get: Parameters<StyleResolver>[2],
  options: Parameters<StyleResolver>[3],
): unknown[] | undefined {
  const args: unknown = Array.isArray(value)
    ? (value as unknown[])[2]
    : undefined;

  if (!Array.isArray(args) || args[1] !== "var") {
    return undefined;
  }

  const reference: unknown = args[2];

  // `var(--name)` — read the declaration.
  if (typeof reference === "string") {
    const lookup = lookupVariable(resolve, reference, get, options);

    return lookup.kind === "declared" && Array.isArray(lookup.descriptor)
      ? flattenTokens(lookup.descriptor as unknown[])
      : undefined;
  }

  // `var(--name, <fallback>)` — the fallback's tokens sit in the descriptor
  // already, units intact, and are what renders when the name is undeclared.
  if (Array.isArray(reference) && typeof reference[0] === "string") {
    const lookup = lookupVariable(resolve, reference[0], get, options);

    if (lookup.kind === "declared" && Array.isArray(lookup.descriptor)) {
      return lookup.descriptor as unknown[];
    }

    return Array.isArray(reference[1])
      ? (reference[1] as unknown[])
      : undefined;
  }

  return undefined;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
