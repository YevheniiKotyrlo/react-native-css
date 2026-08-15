import type { StyleFunctionResolver } from "../resolve";

/**
 * `linear-gradient()` and `radial-gradient()` when a `var()` inside one forces
 * the declaration to be resolved at runtime.
 *
 * A gradient's arguments are a PRELUDE — a line direction, or a radial shape,
 * size and position — followed by a COMMA-SEPARATED list of colour stops. Every
 * other CSS function this library serialises has one argument per comma, which
 * is why joining arguments with `", "` serialises them and cannot serialise a
 * gradient: one `var()` may stand in for the whole stop list, and by the time it
 * resolves the commas inside it are gone.
 *
 * They are gone because a custom property's value is stored as comma groups of
 * space-separated tokens with a SINGLETON COLLAPSED AT EACH LEVEL
 * (`reduceParseUnparsed`, `compiler/declarations.ts`). That collapse is what
 * makes `rgb(255 0 0)`'s arguments `[255, 0, 0]` rather than `[[255, 0, 0]]`, so
 * every positional resolver depends on it — and it also makes
 * `--stops: red, blue` (two one-token groups) and `--stop: red 10%` (one
 * two-token group) the same two-string array.
 *
 * So the stop boundaries are recovered from THE GRAMMAR rather than from a
 * separator the descriptor no longer carries. Read as CSS defines a stop list, a
 * member is a POSITION if it is a number or a percentage and a COLOUR otherwise,
 * and a new stop begins at every colour: `red 10%` is one stop and `red, blue`
 * is two, from the same pair of strings.
 *
 * The grammar cannot separate a TRANSITION HINT from a stop position on its own
 * — `red, 20%, blue` and `red 20%, blue` are the same three tokens — so that one
 * decision is made on the ARGUMENT boundary, which does survive. Each of the
 * gradient's own comma-separated arguments arrives as its own descriptor
 * argument, so a position that OPENS an argument stands alone between two stops
 * and is a hint, while one that follows a colour INSIDE an argument is that
 * colour's position.
 *
 * That boundary is lost inside a single variable, and only there: `--x: red,
 * 20%, blue` collapses to one argument holding all three tokens, so the hint
 * reads as a position. Written out in the gradient the hint survives, because
 * the compiler emits every stop as its own argument and a positioned stop as
 * the pair `[<color>, <position>]`.
 *
 * A stop is written as plain CSS, `<color> <position>` — the spelling React
 * Native's `processBackgroundImage` parses. Its `getPositionFromCSSValue` reads
 * a position only when it ends in `px` or `%`, and answers `[]` for the WHOLE
 * gradient otherwise, so a position that arrives as a number — a pixel length
 * whose unit the compiler folded away — is written back with its `px`.
 */

/**
 * The words a PRELUDE can start with — a closed set, because everything else in
 * argument position is a colour stop. `to` opens a line direction; the rest open
 * a radial shape, size or position.
 */
const PRELUDE_KEYWORDS = new Set([
  "to",
  "circle",
  "ellipse",
  "at",
  "closest-side",
  "closest-corner",
  "farthest-side",
  "farthest-corner",
]);

/** The other prelude a `linear-gradient()` takes: a bare angle, e.g. `45deg`. */
const ANGLE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:deg|grad|rad|turn)$/u;

/**
 * One comma-separated member of the stop list.
 *
 * A gradient needs at least one `stop`: a member list holding only hints names
 * no colour, and a gradient with no colour is not one React Native can read.
 */
type GradientMember =
  | { readonly kind: "stop"; readonly text: string }
  | { readonly kind: "hint"; readonly text: string };

const gradient: StyleFunctionResolver = (resolveValue, value) => {
  const name = value[1];
  const resolved = resolveValue(value[2]);

  if (resolved === undefined || resolved === null) {
    return;
  }

  // One `var()` may stand in for the whole argument list, and then the list IS
  // what it resolved to; several arguments arrive as an array either way. So a
  // scalar is the only shape that has to be lifted.
  const resolvedArguments: unknown[] = Array.isArray(resolved)
    ? resolved
    : [resolved];

  const args = dropInterpolationMethod(name, resolvedArguments);

  const preludeTokens = flattenArgument(args[0]);
  const hasPrelude = startsPrelude(preludeTokens[0]);
  const prelude = hasPrelude ? joinTokens(preludeTokens) : undefined;

  if (hasPrelude && prelude === undefined) {
    return;
  }

  const members = readStopList(
    (hasPrelude ? args.slice(1) : args).map(flattenArgument),
  );

  if (members === undefined) {
    return;
  }

  // A prelude with nothing after it is what a `var()` resolving to nothing
  // leaves behind, and `linear-gradient(to right)` is a string React Native's
  // parser can only reject. Dropping the declaration is the honest outcome.
  if (!members.some((member) => member.kind === "stop")) {
    return;
  }

  const texts = members.map((member) => member.text);

  return `${name}(${(prelude === undefined ? texts : [prelude, ...texts]).join(", ")})`;
};

/**
 * The six CSS gradient functions, and the census every other name-keyed site
 * derives from.
 *
 * A closed set fixed by css-images-3 §4 and css-images-4 §3 — CSS defines these
 * six and no more — so this is a constant, not a snapshot of what is supported
 * today. Every family is listed whether or not React Native paints it: the
 * question here is whether the value survives the pipeline, and an unpainted
 * gradient and a dropped one are the same empty picture until the parser learns
 * the function, at which point only one of them starts working.
 *
 * It is exported because the name is load-bearing in more than one place. These
 * are the only functions whose name reaches React Native VERBATIM — every other
 * one is camelCased — so any site that decides "is this a gradient?" by name
 * must answer with exactly this set, and a site that answers with a subset drops
 * the difference silently.
 */
export const GRADIENT_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  "conic-gradient",
  "linear-gradient",
  "radial-gradient",
  "repeating-conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
]);

// One resolver for all six families. It rebuilds `name(prelude, stops…)` from
// the descriptor, and the family only decides the name — so the four React
// Native does not paint today resolve exactly as the two it does, and start
// working the day its parser learns them.
export {
  gradient as "conic-gradient",
  gradient as "linear-gradient",
  gradient as "radial-gradient",
  gradient as "repeating-conic-gradient",
  gradient as "repeating-linear-gradient",
  gradient as "repeating-radial-gradient",
};

/**
 * The stop list, as the members that go between the commas.
 *
 * Takes ONE token list per argument rather than one flat list, because the
 * argument boundary is what tells a transition hint from a stop position.
 *
 * `undefined` means a token that cannot be written into a CSS string reached the
 * list — a resolved `platformColor()` object, say. The gradient is then not
 * expressible at all, and dropping the declaration is what stops
 * `[object Object]` from being handed to React Native's parser as a colour.
 */
function readStopList(
  argumentTokens: unknown[][],
): GradientMember[] | undefined {
  const members: GradientMember[] = [];

  let color: string | undefined;
  let positions: string[] = [];

  /**
   * One member per position, so a double-position stop (`red 0% 20%`) becomes
   * the two stops it is shorthand for — the same expansion the compiler performs
   * on a gradient written out in full.
   */
  const flush = (): void => {
    if (color === undefined) {
      return;
    }

    if (positions.length === 0) {
      members.push({ kind: "stop", text: color });
    } else {
      for (const position of positions) {
        members.push({ kind: "stop", text: `${color} ${position}` });
      }
    }

    color = undefined;
    positions = [];
  };

  for (const tokens of argumentTokens) {
    for (const [index, token] of tokens.entries()) {
      if (isPosition(token)) {
        // A position that OPENS its argument stands alone between two stops,
        // which is what a transition hint is; one that follows a colour inside
        // the same argument is that colour's position. A position with no
        // colour open at all is a hint wherever it sits.
        if (index === 0 || color === undefined) {
          flush();
          members.push({ kind: "hint", text: positionText(token) });
        } else {
          positions.push(positionText(token));
        }

        continue;
      }

      const text = toText(token);

      if (text === undefined) {
        return undefined;
      }

      flush();
      color = text;
    }
  }

  flush();

  return members;
}

/**
 * Whether an argument opens a prelude rather than the stop list.
 *
 * The prelude may arrive as ONE already-joined string (`to bottom`, written out
 * in the gradient) or as its separate tokens (`to`, `right`, supplied by a
 * variable), so the decision is made on its first word either way.
 */
function startsPrelude(token: unknown): boolean {
  if (typeof token !== "string") {
    return false;
  }

  const [first = ""] = token.split(" ");

  return PRELUDE_KEYWORDS.has(first) || ANGLE.test(first);
}

/** Space-join, not comma-join — a prelude is one comma-separated member. */
function joinTokens(tokens: unknown[]): string | undefined {
  const parts: string[] = [];

  for (const token of tokens) {
    const text = toText(token);

    if (text === undefined) {
      return undefined;
    }

    parts.push(text);
  }

  return parts.join(" ");
}

/**
 * Tailwind CSS emits `in oklab` as a gradient's first argument to force that
 * interpolation space. React Native's parser has no colour-space syntax, so the
 * argument is dropped rather than passed on as a prelude it cannot read.
 */
function dropInterpolationMethod(name: string, args: unknown[]): unknown[] {
  if (name !== "radial-gradient") {
    return args;
  }

  const tokens = flattenArgument(args[0]);

  return tokens.length === 2 && tokens[0] === "in" && tokens[1] === "oklab"
    ? args.slice(1)
    : args;
}

/**
 * One argument's tokens, flat.
 *
 * A variable holding several comma groups of several tokens each resolves to a
 * nested array (`--stops: red 10%, blue 90%` gives `[["red","10%"],["blue","90%"]]`),
 * and every level of that nesting is a boundary the grammar re-derives, so none
 * of it needs to survive the read.
 */
function flattenArgument(argument: unknown): unknown[] {
  const list: unknown[] = Array.isArray(argument) ? argument : [argument];

  return list.flat(Number.POSITIVE_INFINITY);
}

/** A stop position: a percentage as written, or a pixel length as a number. */
/** The units a stop position can carry, beyond the bare number and the `%`. */
const ANGLE_UNITS = ["deg", "grad", "rad", "turn"] as const;

function isPosition(token: unknown): token is string | number {
  if (typeof token === "number") {
    return true;
  }

  if (typeof token !== "string") {
    return false;
  }

  // An ANGLE is a position too, and only in a conic gradient — that family
  // measures its stops around the circle rather than along a line. Without
  // this, `conic-gradient(red 10deg, blue 90deg)` reads `10deg` as another
  // colour token and the stop list comes out comma-separated: `#f00, 10deg`
  // instead of `#f00 10deg`. No length-based family can produce an angle here,
  // so recognising one costs those families nothing.
  return (
    token.endsWith("%") || ANGLE_UNITS.some((unit) => token.endsWith(unit))
  );
}

/**
 * A position as the CSS text React Native's parser reads.
 *
 * `getPositionFromCSSValue` (`processBackgroundImage`) returns a position only
 * for a value ending in `px` or `%`, and one unreadable stop takes the whole
 * gradient with it — the declaration renders as nothing. A number here is a
 * pixel length whose unit `parseLength` folded away, so writing the `px` back is
 * what the declaration said in the first place.
 */
function positionText(token: string | number): string {
  return typeof token === "number" ? `${token}px` : token;
}

/** A token as CSS text, or nothing if it has no CSS text form. */
function toText(token: unknown): string | undefined {
  if (typeof token === "string") {
    return token;
  }

  return typeof token === "number" ? String(token) : undefined;
}
