import { to as convert, parse } from "colorjs.io/fn";

import type { StyleFunctionResolver } from "../resolve";

import "./color-spaces";

/**
 * `rgb()` / `rgba()` / `hsl()` / `hsla()` when a `var()` inside them forced the
 * declaration to be resolved at runtime.
 *
 * These used to fall through `resolveValue`'s generic stringifier, which joins
 * every argument with `", "`. That is a GUESS about a grammar, and CSS colour
 * functions have two: the legacy comma-separated form, and the modern form
 * whose channels are space-separated with a `/` before the alpha. Joining a
 * modern argument list with commas produces neither —
 * `rgba(var(--channels), 0.5)` with `--channels: 255 0 0` became
 * `"rgba(255 0 0, 0.5)"`, which matches none of the three alternatives in
 * `@react-native/normalize-colors`'s `rgb` pattern and so parses to `null`: the
 * colour is silently absent rather than merely wrong.
 *
 * Each function therefore gets a resolver that knows its own grammar, reads its
 * arguments in either spelling, and emits the one legacy form React Native
 * parses unambiguously.
 */

type ChannelKind = "byte" | "angle" | "percentage";

type Channels = readonly [number, number, number];

/** The channel meanings of each function this module serialises. */
interface ColorGrammar {
  /** How a channel token is read, per position. */
  readonly channels: readonly [ChannelKind, ChannelKind, ChannelKind];
  /** The names a relative-colour channel expression may refer to. */
  readonly components: readonly [string, string, string];
  /** The colour space a relative-colour origin is converted into. */
  readonly originSpace: string;
  /** How the result is written, once every channel is a number. */
  readonly serialize: (channels: Channels, alpha: number | undefined) => string;
}

const RGB_GRAMMAR: ColorGrammar = {
  channels: ["byte", "byte", "byte"],
  components: ["r", "g", "b"],
  originSpace: "srgb",
  serialize: ([red, green, blue], alpha) => {
    // React Native reads these back with `parseInt`, so a fractional channel is
    // TRUNCATED rather than rounded — 127.5 becomes 0x7f where the compile-time
    // route gives 0x80. Rounding here is what makes the two routes agree.
    const byte = (channel: number) => Math.round(clamp(channel, 0, 255));

    return alpha === undefined
      ? `rgb(${byte(red)}, ${byte(green)}, ${byte(blue)})`
      : `rgba(${byte(red)}, ${byte(green)}, ${byte(blue)}, ${round(clamp(alpha, 0, 1))})`;
  },
};

const HSL_GRAMMAR: ColorGrammar = {
  channels: ["angle", "percentage", "percentage"],
  components: ["h", "s", "l"],
  originSpace: "hsl",
  serialize: ([hue, saturation, lightness], alpha) => {
    const parts = `${round(hue)}, ${round(saturation)}%, ${round(lightness)}%`;

    return alpha === undefined
      ? `hsl(${parts})`
      : `hsla(${parts}, ${round(clamp(alpha, 0, 1))})`;
  },
};

export const rgb: StyleFunctionResolver = (resolve, value) => {
  return serializeColor(resolve(value[2]), RGB_GRAMMAR);
};

export const rgba = rgb;

export const hsl: StyleFunctionResolver = (resolve, value) => {
  return serializeColor(resolve(value[2]), HSL_GRAMMAR);
};

export const hsla = hsl;

interface Components {
  readonly channels: Channels;
  readonly alpha: number | undefined;
}

function serializeColor(
  args: unknown,
  grammar: ColorGrammar,
): string | undefined {
  const tokens = flattenArguments(args);

  if (tokens === undefined) {
    return;
  }

  const components =
    tokens[0] === "from"
      ? relativeComponents(tokens, grammar)
      : literalComponents(tokens, grammar);

  return components && grammar.serialize(components.channels, components.alpha);
}

function literalComponents(
  tokens: unknown[],
  grammar: ColorGrammar,
): Components | undefined {
  const slash = tokens.indexOf("/");

  // Modern (`rgb(R G B / A)`) puts the alpha after a slash; legacy
  // (`rgba(R, G, B, A)`) makes it the fourth argument. A variable can supply the
  // channels as one group, so the two spellings mix freely in practice and both
  // have to be read here.
  const channelTokens = slash === -1 ? tokens.slice(0, 3) : tokens.slice(0, slash); // prettier-ignore
  const alphaToken = slash === -1 ? tokens[3] : tokens[slash + 1];

  const channels = toChannels(channelTokens, grammar);

  if (channels === undefined) {
    return;
  }

  const alpha = alphaToken === undefined ? undefined : toAlpha(alphaToken);

  if (alphaToken !== undefined && alpha === undefined) {
    return;
  }

  return { channels, alpha };
}

/**
 * css-color-5 §4: `rgb(from <color> <r> <g> <b> / <alpha>)` re-states a colour
 * in terms of its own channels, which is how a design token becomes "the same
 * hue at a different opacity" without a second token.
 *
 * The origin has to be resolved before the channel names mean anything, so this
 * shape is only reachable at runtime — the compile-time route hands the whole
 * declaration to lightningcss, which folds it away when the origin is a literal.
 * The channel expressions answered here are the ones a plain substitution can
 * answer: a component name, a number, a percentage, or `none`. An expression
 * that calculates over a component (`calc(r * 2)`) is not, because the compiler
 * has already lowered the `calc()` past the point where `r` is nameable.
 */
function relativeComponents(
  tokens: unknown[],
  grammar: ColorGrammar,
): Components | undefined {
  const origin = tokens[1];

  if (typeof origin !== "string") {
    return;
  }

  const scope = new Map<string, number>();
  let originAlpha: number;

  try {
    const parsed = convert(parse(origin), grammar.originSpace);

    grammar.components.forEach((name, index) => {
      // colorjs holds sRGB in 0..1 and HSL as degrees plus two 0..100
      // percentages, so only the byte channels need scaling back up.
      const coordinate = parsed.coords[index] ?? 0;

      scope.set(
        name,
        grammar.channels[index] === "byte" ? coordinate * 255 : coordinate,
      );
    });

    originAlpha = parsed.alpha ?? 1;
  } catch {
    return;
  }

  scope.set("alpha", originAlpha);

  const rest = tokens.slice(2);
  const slash = rest.indexOf("/");
  const channelTokens = slash === -1 ? rest.slice(0, 3) : rest.slice(0, slash);
  const alphaToken = slash === -1 ? undefined : rest[slash + 1];

  const channels = toChannels(channelTokens, grammar, scope);

  if (channels === undefined) {
    return;
  }

  const alpha =
    alphaToken === undefined
      ? originAlpha
      : (readScope(alphaToken, scope) ?? toAlpha(alphaToken));

  if (alpha === undefined) {
    return;
  }

  return { channels, alpha };
}

function toChannels(
  tokens: unknown[],
  grammar: ColorGrammar,
  scope?: Map<string, number>,
): Channels | undefined {
  if (tokens.length !== 3) {
    return;
  }

  const [first, second, third] = tokens.map(
    (token, index) =>
      readScope(token, scope) ?? toChannel(token, grammar.channels[index]),
  );

  return first === undefined || second === undefined || third === undefined
    ? undefined
    : [first, second, third];
}

function readScope(token: unknown, scope: Map<string, number> | undefined) {
  return typeof token === "string" ? scope?.get(token) : undefined;
}

function toChannel(token: unknown, kind: ChannelKind = "byte") {
  if (token === "none") {
    return 0;
  }

  if (typeof token === "number") {
    return token;
  }

  if (typeof token !== "string" || !token.endsWith("%")) {
    return undefined;
  }

  const percentage = Number.parseFloat(token);

  if (Number.isNaN(percentage)) {
    return undefined;
  }

  // A percentage means a fraction of the channel's own range: full scale for an
  // rgb byte, and its own value for a channel that is already a percentage.
  return kind === "byte" ? (percentage / 100) * 255 : percentage;
}

function toAlpha(token: unknown) {
  if (token === "none") {
    return 0;
  }

  if (typeof token === "number") {
    return token;
  }

  if (typeof token !== "string" || !token.endsWith("%")) {
    return undefined;
  }

  const percentage = Number.parseFloat(token);

  return Number.isNaN(percentage) ? undefined : percentage / 100;
}

/**
 * One flat argument list, whatever shape the arguments arrived in.
 *
 * A `var()` standing in for a whole channel group resolves to an ARRAY —
 * `rgba(var(--channels), 0.5)` gives `[[255, 0, 0], 0.5]` — while the same
 * colour written out gives four sibling arguments. Both describe the same
 * colour, so both are flattened to one list before anything positional reads
 * them.
 */
function flattenArguments(args: unknown): unknown[] | undefined {
  if (args === undefined || args === null) {
    return;
  }

  const list: unknown[] = Array.isArray(args) ? args : [args];

  return list.flat(Number.POSITIVE_INFINITY);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function round(number: number) {
  return Math.round((number + Number.EPSILON) * 10000) / 10000;
}
