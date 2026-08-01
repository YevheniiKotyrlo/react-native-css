/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type { PlainColorObject } from "colorjs.io";
import {
  to as convert,
  mix,
  parse,
  toGamut,
  type ColorConstructor,
} from "colorjs.io/fn";

import type { StyleFunctionResolver } from "../resolve";
import { SPACE_ID } from "./color-spaces";

/**
 * The hue-interpolation methods css-color-4 §12.4 defines, which `color-mix()`
 * carries after its colour space (`in oklch longer hue`).
 *
 * colorjs takes the same four names, so the modifier passes straight through
 * once the space has been separated from it.
 */
type HueMethod = "shorter" | "longer" | "increasing" | "decreasing";

const HUE_METHODS = new Set<string>([
  "shorter",
  "longer",
  "increasing",
  "decreasing",
]);

/**
 * A `color-mix()` percentage, as a fraction. `undefined` means the author
 * omitted it.
 */
function parsePercentage(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.endsWith("%")) {
    return undefined;
  }

  const percentage = Number.parseFloat(value);
  return Number.isFinite(percentage) ? percentage / 100 : undefined;
}

export const colorMix: StyleFunctionResolver = (resolveValue, value) => {
  const args = resolveValue(value[2]);

  // TWO, not three. The compiler folds a right-hand `transparent` away
  // (`parseColorMix`'s "treat as single color with alpha" branch), leaving
  // `[space, colour, weight]` — and when the author wrote no weight, that third
  // slot is a hole which `resolveValue` drops, so the commonest folded form
  // `color-mix(in srgb, var(--brand), transparent)` arrives as exactly two
  // arguments. Demanding three dropped it entirely.
  if (!Array.isArray(args) || args.length < 2) {
    return;
  }

  try {
    const { space, hue } = takeInterpolationMethod(args);

    if (space === undefined) {
      return;
    }

    const leftColor = args.shift();

    if (typeof leftColor !== "string") {
      return;
    }

    const left: ColorConstructor | PlainColorObject = parse(leftColor);

    let next = args.shift();

    // The percentage on a `color-mix()` operand is its MIXING WEIGHT, not its
    // alpha. Writing it to `left.alpha` produced a 50/50 mix with the weight
    // averaged into the transparency — so `color-mix(in oklab, red 30%, blue)`
    // rendered the same RGB as the unweighted mix at 65% opacity.
    let leftWeight = parsePercentage(next);
    if (leftWeight !== undefined) {
      next = args.shift();
    }

    if (next === undefined || next === null) {
      // No second operand means the compiler recognised `transparent` there and
      // folded it away. Mixing a colour with `transparent` at weight w IS that
      // colour at alpha w, so the weight becomes the alpha here — the one place
      // a `color-mix()` percentage legitimately lands on alpha. An omitted
      // weight is the even mix css-color-5 §3.2 specifies, so half.
      const singleOperand =
        left.spaceId === "srgb" ? left : convert(left, "srgb");
      return formatSrgb(singleOperand, 1, leftWeight ?? 0.5);
    }

    if (typeof next !== "string") {
      return;
    }

    const right = parse(next);

    const declaredRightWeight = parsePercentage(args.shift());

    // css-color-5 §3.2: an omitted percentage is 100% minus the other; with
    // both omitted the mix is even.
    const rightWeight =
      declaredRightWeight ?? (leftWeight === undefined ? 0.5 : 1 - leftWeight);
    leftWeight ??= 1 - rightWeight;

    const total = leftWeight + rightWeight;

    if (total === 0) {
      return;
    }

    // The weights are normalised to sum to 1, and when the author's own sum was
    // BELOW 100% the shortfall multiplies the result's alpha.
    const position = rightWeight / total;
    const alphaScale = total < 1 ? total : 1;

    const result = mix(left, right, position, {
      space,
      hue,
      outputSpace: "srgb",
      // css-color-5 §3.2 defers to css-color-4 §12.3, which interpolates with
      // PREMULTIPLIED alpha; colorjs defaults it off. Without it a transparent
      // operand drags its (meaningless) channel values into the result, so
      // `color-mix(in srgb, transparent, red)` mixed black into the red and gave
      // `rgba(127.5, 0, 0, 0.5)` where lightningcss gives `#ff000080`.
      premultiplied: true,
    });

    return formatSrgb(result, alphaScale);
  } catch {
    return;
  }
};

/**
 * `in <space> [<hue> hue]` — the colour space, and the optional
 * hue-interpolation method that follows it.
 *
 * Reading the leading argument as a bare space name is why
 * `color-mix(in oklch longer hue, …)` produced nothing: `"oklch longer hue"`
 * matches no registered space, so `mix()` threw and the `catch` dropped the
 * declaration.
 *
 * The modifier is consumed whether it arrives inside the space argument or as
 * arguments of its own, because which one it is is the COMPILER's choice of
 * tokenisation and not something this resolver should be coupled to. Both
 * spellings name the same CSS.
 */
function takeInterpolationMethod(args: unknown[]): {
  space: string | undefined;
  hue: HueMethod | undefined;
} {
  const method = args.shift();

  if (typeof method !== "string") {
    return { space: undefined, hue: undefined };
  }

  const [cssSpace, ...modifiers] = method.trim().split(/\s+/u);

  if (cssSpace === undefined) {
    return { space: undefined, hue: undefined };
  }

  let hue = modifiers.find((modifier) => HUE_METHODS.has(modifier)) as
    | HueMethod
    | undefined;

  // The same modifier, tokenised as separate arguments: `longer`, then the
  // literal `hue` that closes the phrase.
  while (hue === undefined && typeof args[0] === "string") {
    if (!HUE_METHODS.has(args[0])) {
      break;
    }

    hue = args.shift() as HueMethod;

    if (args[0] === "hue") {
      args.shift();
    }
  }

  return { space: SPACE_ID[cssSpace] ?? cssSpace, hue };
}

function formatSrgb(
  color: ColorConstructor | PlainColorObject,
  alphaScale = 1,
  alphaOverride?: number,
): string {
  // Every space css-color-5 permits is WIDER than sRGB, so a mix in `xyz`,
  // `lch` or `a98-rgb` routinely lands outside it — as a negative channel, as
  // one above 1, or as a value so near zero it serialises in exponent form
  // (`-2.286e-13`). `@react-native/normalize-colors` has no exponent in its
  // number pattern and returns `null` for the whole colour, so the declaration
  // disappears. Gamut-mapping first keeps the HUE the author asked for instead
  // of letting a per-channel clamp shift it; the clamp after is the floating
  // point backstop.
  const mapped = inGamut(color);

  const channel = (index: number) =>
    Math.round(clamp((mapped.coords[index] ?? 0) * 255, 0, 255));

  const alpha = clamp((alphaOverride ?? mapped.alpha ?? 1) * alphaScale, 0, 1);

  return `rgba(${channel(0)}, ${channel(1)}, ${channel(2)}, ${round(alpha)})`;
}

function inGamut(color: ColorConstructor | PlainColorObject) {
  try {
    return toGamut(color as PlainColorObject, { space: "srgb" });
  } catch {
    return color;
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function round(number: number) {
  return Math.round((number + Number.EPSILON) * 10000) / 10000;
}
