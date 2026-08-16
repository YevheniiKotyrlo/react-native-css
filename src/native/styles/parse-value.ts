import type { StyleDescriptor } from "react-native-css/compiler";

import { CURRENT_COLOR } from "./constants";
import { GRADIENT_FUNCTION_NAMES } from "./functions/gradient-functions";

/**
 * A variable value authored in JavaScript, read as the CSS source text it is.
 *
 * A custom property written in a stylesheet never reaches the runtime as text.
 * lightningcss tokenises it and `parseUnparsed` / `reduceParseUnparsed`
 * (`src/compiler/declarations.ts`) lower every token, so `--x: 10px 20px`
 * arrives as the list `[10, 20]`, `--x: 2` as the number `2`, and
 * `--x: cubic-bezier(.25,.5,.75,1)` as a style function. Everything downstream —
 * the shorthand expanders, the transform resolvers, `resolveDimension`, the
 * animation config reanimated consumes — is written against that shape.
 *
 * `VariableContextProvider` and the deprecated `vars()` accept the same
 * declaration written as a JavaScript string, and no compiler runs on it. This
 * module is that missing pass: it takes CSS source and produces the descriptor
 * the compiler produces for the same declaration, so a value supplied from
 * JavaScript is indistinguishable downstream from one supplied by a stylesheet.
 *
 * It is deliberately the ONLY place this conversion happens. Doing it per
 * consumer would be the same fix written twenty times, and incomplete the moment
 * a twenty-first consumer appears.
 *
 * The compiler stays out of reach here: `react-native-css/compiler` pulls in
 * lightningcss, a build-time native dependency that cannot exist in an app
 * bundle. So this module mirrors the compiler's behaviour rather than calling
 * it, and every case below names the compile-time function it mirrors.
 *
 * Two cases deliberately do not mirror it, and `classifyNumeric` says why: a
 * `px` length keeps its unit, and `rem` stays a function. Both resolve to the
 * number the compiler would have folded, and both carry information the fold
 * destroys.
 */

/**
 * The absolute length units, in CSS pixels.
 *
 * A deliberate copy of the compiler's `ABSOLUTE_UNIT_PIXELS`
 * (`src/compiler/declarations.ts`) — the tier boundary above is what stops it
 * being an import. The values are fixed by css-values-4 §6.2 and cannot drift.
 */
const ABSOLUTE_UNIT_PIXELS: Record<string, number | undefined> = {
  cm: 96 / 2.54,
  in: 96,
  mm: 96 / 25.4,
  pc: 16,
  pt: 96 / 72,
  q: 96 / 101.6,
};

/** The compiler's `round`, so both routes produce the same decimals. */
function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

/**
 * A whole token that is a number with an optional unit — `10px`, `.5`, `-2.5em`,
 * `1e3`.
 *
 * `src/native/styles/dimension.ts`'s `PIXEL_LENGTH` asks a narrower question of
 * the same shape (is this string entirely a pixel length), because it is a
 * classifier rather than a parser; this one has to hand back the magnitude and
 * the unit separately.
 */
const NUMERIC_TOKEN = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/iu;

/** Characters that end a token wherever they appear. */
const DELIMITERS = new Set([",", "/", '"', "'", "(", ")", "[", "]", "{", "}"]);

const WHITESPACE = new Set([" ", "\t", "\n", "\r", "\f"]);

/**
 * How a token list is read.
 *
 * Three positions, and each keeps a different set of the tokens between the
 * values:
 *
 * - a whole declaration VALUE is where a `<ratio>` lives — numbers around a
 *   solidus are one value there, and `reduceParseUnparsed` writes them back as
 *   one string (`aspect-ratio: 16 / 9`);
 * - a function's ARGUMENTS keep the solidus as its own token, because inside a
 *   function it separates arguments rather than joining them: css-color-4 §4
 *   puts the alpha after one, so `rgb(255 0 0 / 0.5)` is a channel list and a
 *   separator. Joining it produced a string where `./functions/color-functions.ts`
 *   reads a list, and the declaration was dropped;
 * - `calc()` and its comparison siblings additionally keep the arithmetic tokens
 *   between their terms — `parseCalcArguments` pushes `+`, `-`, `*`, `/` and the
 *   parentheses, while `parseUnparsed`'s `delim` case keeps only `/`.
 */
type ReadMode = "value" | "arguments" | "calc";

/** The functions whose arguments are an arithmetic expression. */
const CALC_FUNCTIONS = new Set(["calc", "min", "max", "clamp"]);

/** Arithmetic tokens `calc()` carries and every other position discards. */
const CALC_PUNCTUATION = new Set(["+", "-", "*", "(", ")"]);

/** Bracket tokens that are never part of a value. */
const DISCARDED_PUNCTUATION = new Set(["[", "]", "{", "}"]);

type RawToken =
  /** A top-level `,`, which starts a new group. */
  | { readonly kind: "comma" }
  /** A quoted string, already unescaped and without its quotes. */
  | { readonly kind: "string"; readonly value: string }
  /** `name( … )`, with the parentheses balanced. */
  | { readonly kind: "function"; readonly name: string; readonly body: string }
  /** Anything else that is not whitespace: an ident, a number, a delimiter. */
  | { readonly kind: "word"; readonly value: string };

/**
 * Tokenise a JavaScript-supplied variable value.
 *
 * Only a STRING is CSS source. Every other `StyleDescriptor` — a number, a
 * boolean, a list, a style function — is already the compiler's output shape and
 * is handed back untouched, which is what lets a caller pass either spelling.
 *
 * A list is not walked either: its members are component values already, and
 * re-reading them would split a quoted family name that a caller deliberately
 * kept whole.
 */
export function parseVariableValue(value: StyleDescriptor): StyleDescriptor {
  return typeof value === "string" ? readComponentValues(value) : value;
}

/** The compiler's `parseUnparsed` over a whole declaration value. */
function readComponentValues(source: string): StyleDescriptor {
  return reduceTokens(scan(source), "value");
}

function scan(source: string): RawToken[] {
  const tokens: RawToken[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source.charAt(index);

    if (WHITESPACE.has(character)) {
      index += 1;
      continue;
    }

    if (character === ",") {
      tokens.push({ kind: "comma" });
      index += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      const end = findStringEnd(source, character, index + 1);
      tokens.push({
        kind: "string",
        value: unescapeString(source.slice(index + 1, end)),
      });
      index = end + 1;
      continue;
    }

    const wordEnd = findWordEnd(source, index);

    // A delimiter sits at the cursor, so the word is empty and the delimiter
    // stands for itself. A `(` here opened no function — it is the grouping
    // parenthesis of an arithmetic sub-expression — so scanning continues
    // INSIDE it and its contents become tokens of this same list, which is the
    // flat shape `parseCalcArguments` builds.
    if (wordEnd === index) {
      tokens.push({ kind: "word", value: character });
      index += 1;
      continue;
    }

    if (source.charAt(wordEnd) === "(") {
      const close = findClosingParenthesis(source, wordEnd);

      tokens.push({
        kind: "function",
        name: source.slice(index, wordEnd),
        body: source.slice(wordEnd + 1, close),
      });
      index = close + 1;
      continue;
    }

    tokens.push({ kind: "word", value: source.slice(index, wordEnd) });
    index = wordEnd;
  }

  return tokens;
}

function findWordEnd(source: string, from: number): number {
  let index = from;

  while (index < source.length) {
    const character = source.charAt(index);

    if (WHITESPACE.has(character) || DELIMITERS.has(character)) {
      return index;
    }

    index += 1;
  }

  return index;
}

function findStringEnd(source: string, quote: string, from: number): number {
  let index = from;

  while (index < source.length) {
    const character = source.charAt(index);

    if (character === "\\") {
      index += 2;
      continue;
    }

    if (character === quote) {
      return index;
    }

    index += 1;
  }

  // An unterminated string runs to the end of the value, which is what the CSS
  // tokenizer does with one too (css-syntax-3 §4.3.5).
  return source.length;
}

/** The index of the `)` matching the `(` at `from`, or the end of the source. */
function findClosingParenthesis(source: string, from: number): number {
  let depth = 0;
  let index = from;

  while (index < source.length) {
    const character = source.charAt(index);

    if (character === '"' || character === "'") {
      index = findStringEnd(source, character, index + 1) + 1;
      continue;
    }

    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }

    index += 1;
  }

  return source.length;
}

/**
 * A CSS string escape stands for the character after the backslash.
 *
 * The numeric form (`\41`) is not decoded: it cannot appear in a value written
 * as a JavaScript string literal without the author having already chosen to
 * escape something, and decoding it wrongly is worse than passing it on.
 */
function unescapeString(value: string): string {
  return value.replace(/\\(.)/gsu, "$1");
}

/**
 * The compiler's `reduceParseUnparsed`.
 *
 * Commas separate groups; a group of one collapses to that value; a group of
 * numbers around a `/` is a `<ratio>` and is written back as one string; and a
 * single group collapses to itself, so a one-token declaration is that token and
 * a two-token one is a list.
 */
function reduceTokens(tokens: RawToken[], mode: ReadMode): StyleDescriptor {
  const groups: StyleDescriptor[][] = [[]];
  let read = 0;

  for (const token of tokens) {
    if (token.kind === "comma") {
      groups.push([]);
      read += 1;
      continue;
    }

    const descriptor = classify(token, mode);

    if (descriptor !== undefined) {
      groups[groups.length - 1]?.push(descriptor);
      read += 1;
    }
  }

  // Nothing usable, which the compiler signals as exactly `undefined` — an
  // empty list would read as a value the declaration can be built from.
  if (read === 0) {
    return undefined;
  }

  const collapsed = groups.flatMap((group): StyleDescriptor[] => {
    if (group.length === 0) {
      return [];
    }

    const [first] = group;

    if (group.length === 1) {
      return first === undefined ? [] : [first];
    }

    if (mode === "value" && isRatio(group)) {
      return [ratioDescriptor(group)];
    }

    return [group];
  });

  return collapsed.length === 1 ? collapsed[0] : collapsed;
}

/**
 * `<ratio>` — numbers around a solidus, e.g. `16 / 9`.
 *
 * A predicate rather than a boolean, so the join above is over a group whose
 * members are provably printable.
 */
function isRatio(group: StyleDescriptor[]): group is (string | number)[] {
  return (
    group.includes("/") &&
    group.every((item) => item === "/" || typeof item === "number")
  );
}

/**
 * A `<ratio>` in the one spelling the compiler's `ratioDescriptor` produces —
 * no spaces around the solidus, and a square ratio collapsed to `1`.
 *
 * This module exists to hand the runtime what the compiler would have handed
 * it for the same declaration, so the two spellings have to be one spelling.
 * React Native trims around the solidus (`processAspectRatio`) and reads both
 * alike, which is exactly why a divergence here goes unnoticed: it is the
 * DESCRIPTORS that must agree, because a test comparing the two channels is
 * the only thing that ever looks at them side by side.
 */
function ratioDescriptor(group: (string | number)[]): StyleDescriptor {
  const [width, , height] = group;

  return width === height ? 1 : `${String(width)}/${String(height)}`;
}

function classify(
  token: Exclude<RawToken, { kind: "comma" }>,
  mode: ReadMode,
): StyleDescriptor {
  switch (token.kind) {
    case "string":
      return token.value;
    case "function":
      return classifyFunction(token.name, token.body);
    case "word":
      return classifyWord(token.value, mode);
  }
}

function classifyWord(word: string, mode: ReadMode): StyleDescriptor {
  // A solidus is a value separator CSS keeps — `font: 16px/1.5`, `<ratio>`,
  // the alpha slash in a modern colour — so it survives in every position.
  if (word === "/") {
    return "/";
  }

  if (CALC_PUNCTUATION.has(word)) {
    return mode === "calc" ? word : undefined;
  }

  if (DISCARDED_PUNCTUATION.has(word)) {
    return undefined;
  }

  // `parseUnparsed`'s ident cases. `inherit` and `initial` have no runtime
  // meaning here and are dropped; the other three are values in their own right.
  if (word === "true") {
    return true;
  }

  if (word === "false") {
    return false;
  }

  if (word === "infinity") {
    return Number.MAX_SAFE_INTEGER;
  }

  if (word === "inherit" || word === "initial") {
    return undefined;
  }

  // lightningcss lowercases this one before the compiler sees it, so the
  // spelling an author uses — `currentColor` is the common one — has to be
  // accepted here instead.
  if (word.toLowerCase() === "currentcolor") {
    return CURRENT_COLOR;
  }

  const numeric = NUMERIC_TOKEN.exec(word);

  return numeric
    ? classifyNumeric(Number.parseFloat(word), numeric[2] ?? "", word)
    : word;
}

/**
 * A number and its unit, lowered the way `parseLength`, `parseAngle`,
 * `parseTime` and `parseDimension` lower theirs.
 *
 * The units that survive as functions are the ones whose base is only known once
 * the element renders — the font size for `em`/`rem`, the window for `vw`/`vh`.
 * `rem` resolves against `--__rn-css-rem`, which `src/native-internal/root.ts`
 * seeds to the same 14 the compiler's default `inlineRem` uses, so both routes
 * agree and an app that sets a root font size moves both.
 *
 * A `px` LENGTH keeps its suffix, which is the one place this deliberately does
 * not follow the compiler. `parseLength` lowers `22px` to the number `22`, and
 * that erases the difference between a length and a bare number — the
 * distinction `line-height` turns on, where `1.375` is a ratio of the font size
 * and `22px` is twenty-two pixels. `src/native/styles/dimension.ts` names the
 * `px`-suffixed string as the representation it classifies correctly, and
 * `resolveValue` turns that same string into its number for every consumer that
 * only wants the magnitude — so keeping the suffix costs nothing and carries the
 * unit to the one reader that needs it. The absolute units fold into it for the
 * same reason.
 *
 * An unrecognised unit keeps its token rather than being dropped. The compiler
 * drops one, but it pairs the drop with a build-time warning; there is no
 * runtime equivalent, so a silent disappearance would be the harder failure of
 * the two to find.
 */
function classifyNumeric(
  value: number,
  unit: string,
  word: string,
): StyleDescriptor {
  switch (unit.toLowerCase()) {
    case "":
      return round(value);
    case "px":
      return `${round(value)}px`;
    case "%":
      return `${round(value)}%`;
    case "em":
    case "vw":
    case "vh":
      return [{}, unit.toLowerCase(), round(value), 1];
    // This library's own spelling of the viewport units.
    case "rnw":
      return [{}, "vw", round(value), 1];
    case "rnh":
      return [{}, "vh", round(value), 1];
    case "rem":
      return [{}, "rem", round(value)];
    case "deg":
    case "rad":
      return `${value}${unit.toLowerCase()}`;
    case "turn":
      return `${round(value * 360)}deg`;
    case "grad":
      return `${round(value * 0.9)}deg`;
    case "s":
      return round(value * 1000);
    case "ms":
      return round(value);
    default: {
      const pixels = ABSOLUTE_UNIT_PIXELS[unit.toLowerCase()];

      return pixels === undefined ? word : `${round(value * pixels)}px`;
    }
  }
}

/** The four `env()` names this library publishes as variables. */
const SAFE_AREA_INSETS = new Set([
  "safe-area-inset-top",
  "safe-area-inset-right",
  "safe-area-inset-bottom",
  "safe-area-inset-left",
]);

function classifyFunction(name: string, body: string): StyleDescriptor {
  if (name === "var") {
    return readVariableReference(body);
  }

  if (name === "env") {
    return readEnvironmentVariable(body);
  }

  // No arguments to read: the runtime resolver asks the platform.
  if (name === "hairlineWidth") {
    return [{}, "hairlineWidth", []];
  }

  // A gradient's name reaches React Native VERBATIM — it is the one family of
  // functions that is not camel-cased, because the hyphen is part of the name
  // its parser and this library's own resolvers are keyed on.
  //
  // Read from the resolver module's own census rather than spelled out again:
  // this list naming a SUBSET of the registered resolvers is a silent drop, not
  // a type error, and it was one. `linear` and `radial` were named here while
  // all six had resolvers, so a conic gradient handed in through
  // `VariableContextProvider` was camelCased to `conicGradient`, matched no
  // resolver, and vanished — on the one route where the compiler never sees the
  // value and cannot compensate.
  if (GRADIENT_FUNCTION_NAMES.has(name)) {
    return [{}, name, reduceTokens(scan(body), "arguments")];
  }

  const runtimeName = toRuntimeFunctionName(name);

  return [
    {},
    runtimeName,
    reduceTokens(
      scan(body),
      CALC_FUNCTIONS.has(runtimeName) ? "calc" : "arguments",
    ),
  ];
}

/**
 * `var(--name)` / `var(--name, <fallback>)`.
 *
 * The name loses its `--`, matching the compiler, and the fallback is everything
 * after the FIRST comma — a fallback may itself contain commas.
 */
function readVariableReference(body: string): StyleDescriptor {
  const tokens = scan(body);
  const separator = tokens.findIndex((token) => token.kind === "comma");
  const [reference] = separator === -1 ? tokens : tokens.slice(0, separator);

  if (reference?.kind !== "word" || !reference.value.startsWith("--")) {
    return undefined;
  }

  const name = reference.value.slice(2);

  if (separator === -1) {
    return [{}, "var", name, 1];
  }

  const fallback = reduceTokens(tokens.slice(separator + 1), "value");

  return fallback === undefined
    ? [{}, "var", name, 1]
    : [{}, "var", [name, fallback], 1];
}

/**
 * `env(safe-area-inset-*)`, which the compiler rewrites into a read of the
 * variable `SafeAreaProvider` publishes. Every other environment variable has no
 * runtime source and is dropped, exactly as `parseEnv` drops it.
 */
function readEnvironmentVariable(body: string): StyleDescriptor {
  const tokens = scan(body);
  const separator = tokens.findIndex((token) => token.kind === "comma");
  const [reference] = separator === -1 ? tokens : tokens.slice(0, separator);

  if (reference?.kind !== "word" || !SAFE_AREA_INSETS.has(reference.value)) {
    return undefined;
  }

  const name = `react-native-css-${reference.value}`;

  if (separator === -1) {
    return [{}, "var", [name], 1];
  }

  const fallback = reduceTokens(tokens.slice(separator + 1), "value");

  return fallback === undefined
    ? [{}, "var", [name], 1]
    : [{}, "var", [name, fallback], 1];
}

/** The compiler's `toRNProperty`, which names the runtime resolver to call. */
function toRuntimeFunctionName(name: string): string {
  return name
    .replace(/^-rn-/u, "")
    .replace(/-./gu, (match) => match[1]?.toUpperCase() ?? "");
}
