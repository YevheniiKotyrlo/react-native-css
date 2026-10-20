import type {
  CalcFor_Length,
  MediaCondition as CSSMediaCondition,
  MediaFeatureComparison as CSSMediaFeatureComparison,
  MediaFeatureValue as CSSMediaFeatureValue,
  MediaQuery as CSSMediaQuery,
  Length,
  LengthValue,
  MathFunctionFor_Length,
  QueryFeatureFor_MediaFeatureId,
  RoundingStrategy,
} from "lightningcss";

import { asciiLowerCase } from "../utilities/ascii-case";
import type {
  MediaCondition,
  MediaFeatureComparison,
  MediaFeatureOperand,
  StyleDescriptor,
} from "./compiler.types";
import { parseLength } from "./declarations";
import type { StylesheetBuilder } from "./stylesheet";

export function parseMediaQuery(
  query: CSSMediaQuery,
  builder: StylesheetBuilder,
) {
  let platformCondition: MediaCondition | undefined;
  let condition: MediaCondition | undefined;

  if (query.mediaType) {
    // Native screens never match print. Negating that media type matches
    // regardless of the remaining feature tests in the same conjunction.
    if (query.mediaType === "print") {
      return query.qualifier === "not";
    }

    // These all/screen are not conditions, they always apply
    if (query.mediaType !== "all" && query.mediaType !== "screen") {
      platformCondition = ["=", "platform", query.mediaType];
    }
  }

  if (query.condition) {
    condition = parseMediaQueryCondition(query.condition, builder);
  }

  let mediaQuery: MediaCondition | undefined =
    platformCondition && condition
      ? ["&", [platformCondition, condition]]
      : (platformCondition ?? condition);

  if (!mediaQuery) {
    // Unqualified all/screen apply; not all and not screen do not.
    return query.qualifier !== "not";
  }

  if (query.qualifier === "not") {
    mediaQuery = ["!", mediaQuery];
  }

  if (!canMatch(mediaQuery)) {
    return false;
  }

  builder.addMediaQuery(mediaQuery);
  return true;
}

// A condition that no device can make true, as an unknown keeps an `and` or a `not` unknown (MQ5 §3.2), compiles to no rule
export function canMatch(condition: MediaCondition): boolean {
  return canEvaluateTo(condition, true);
}

function canEvaluateTo(condition: MediaCondition, truth: boolean): boolean {
  switch (condition[0]) {
    case "?":
      return false;
    case "!":
      return canEvaluateTo(condition[1], !truth);
    case "&":
      return truth
        ? condition[1].every((child) => canEvaluateTo(child, true))
        : condition[1].some((child) => canEvaluateTo(child, false));
    case "|":
      return truth
        ? condition[1].some((child) => canEvaluateTo(child, true))
        : condition[1].every((child) => canEvaluateTo(child, false));
    case "!!":
      return true;
    case "[]": {
      const [, , start, , end] = condition;
      return truth
        ? start !== null && end !== null
        : start !== null || end !== null;
    }
    case "=":
    case ">":
    case ">=":
    case "<":
    case "<=":
      return condition[2] !== null;
    default:
      condition satisfies never;
      return true;
  }
}

function parseMediaQueryCondition(
  query: CSSMediaCondition,
  builder: StylesheetBuilder,
): MediaCondition {
  switch (query.type) {
    case "feature":
      return parseFeature(query.value, builder);
    case "not":
      return ["!", parseMediaQueryCondition(query.value, builder)];
    case "operation": {
      const mediaQueries = query.conditions.map((condition) =>
        parseMediaQueryCondition(condition, builder),
      );

      switch (query.operator) {
        case "and":
          return ["&", mediaQueries];
        case "or":
          return ["|", mediaQueries];
        default:
          query.operator satisfies never;
          throw new Error(
            `Unknown media condition operator ${JSON.stringify(query)}`,
          );
      }
    }
    default:
      query satisfies never;
      throw new Error(`Unknown media condition ${JSON.stringify(query)}`);
  }
}

// The keywords Media Queries 4 and 5 give each discrete feature the runtime answers; any other keyword leaves the feature unknown (MQ5 §3.1)
const FEATURE_KEYWORDS: ReadonlyMap<string, readonly string[]> = new Map([
  ["hover", ["none", "hover"]],
  ["any-hover", ["none", "hover"]],
  ["orientation", ["portrait", "landscape"]],
  ["prefers-color-scheme", ["light", "dark"]],
  ["prefers-reduced-motion", ["no-preference", "reduce"]],
  ["scripting", ["none", "initial-only", "enabled"]],
  ["update", ["none", "slow", "fast"]],
]);

export function isUnknownKeyword(name: string, operand: MediaFeatureOperand) {
  const keywords = FEATURE_KEYWORDS.get(name);
  return (
    keywords !== undefined &&
    typeof operand === "string" &&
    !keywords.includes(operand)
  );
}

function parseFeature(
  feature: QueryFeatureFor_MediaFeatureId,
  builder: StylesheetBuilder,
): MediaCondition {
  switch (feature.type) {
    case "boolean":
      return ["!!", feature.name];
    case "plain": {
      const operand = parseMediaFeatureOperand(feature.value, builder);
      return isUnknownKeyword(feature.name, operand)
        ? ["?"]
        : ["=", feature.name, operand];
    }
    case "range":
      return [
        parseMediaFeatureOperator(feature.operator),
        feature.name,
        parseMediaFeatureOperand(feature.value, builder),
      ];
    case "interval":
      return [
        "[]",
        feature.name,
        parseMediaFeatureOperand(feature.start, builder),
        parseMediaFeatureOperator(feature.startOperator),
        parseMediaFeatureOperand(feature.end, builder),
        parseMediaFeatureOperator(feature.endOperator),
      ];
    default:
      feature satisfies never;
      throw new Error(`Unknown media feature ${JSON.stringify(feature)}`);
  }
}

function parseMediaFeatureOperand(
  value: CSSMediaFeatureValue,
  builder: StylesheetBuilder,
): MediaFeatureOperand {
  return (
    parseMediaFeatureValue(value, builder, (length) =>
      parseMediaLength(length, builder),
    ) ?? null
  );
}

function parseMediaLength(
  length: Length | LengthValue,
  builder: StylesheetBuilder,
): StyleDescriptor {
  if (!("unit" in length)) {
    return length.type === "value"
      ? parseMediaLength(length.value, builder)
      : parseMathLength(length.value, (inner) =>
          parseMediaLength(inner, builder),
        );
  }

  // An em in a media query is relative to the initial font size, as a rem is (MQ5 §1.3)
  return parseLength(
    length.unit === "em" ? { ...length, unit: "rem" } : length,
    builder,
  );
}

export function parseMediaFeatureValue(
  value: CSSMediaFeatureValue,
  builder: StylesheetBuilder,
  parseLengthValue: (length: Length | LengthValue) => StyleDescriptor = (
    length,
  ) => parseLength(length, builder),
): StyleDescriptor {
  switch (value.type) {
    // <mq-boolean> is the integer 0 or 1 (MQ4 §5.3)
    case "boolean":
      return value.value ? 1 : 0;
    case "ident":
      // Keywords are ASCII case-insensitive (css-values-4 §4.1)
      return asciiLowerCase(value.value);
    case "integer":
    case "number":
      return value.value;
    case "length":
      switch (value.value.type) {
        case "value":
          return parseLengthValue(value.value.value);
        case "calc":
          return parseMathLength(value.value.value, parseLengthValue);
        default:
          value.value satisfies never;
          return;
      }
    case "resolution":
      switch (value.value.type) {
        case "dpi":
          // Mobile devices use 160 as a standard
          return value.value.value / 160;
        case "dpcm":
          // There are 1in = ~2.54cm
          return value.value.value / (160 * 2.54);
        case "dppx":
          return value.value.value;
        default:
          value.value satisfies never;
          return undefined;
      }
    // A ratio compares as its quotient (MQ4 §4.2); one with a zero term is degenerate and stays unresolved
    case "ratio": {
      const [numerator, denominator] = value.value;
      return numerator === 0 || denominator === 0
        ? undefined
        : numerator / denominator;
    }
    case "env":
      return undefined;
    default:
      value satisfies never;
      return undefined;
  }
}

export function parseMediaFeatureOperator(
  operator: CSSMediaFeatureComparison,
): MediaFeatureComparison {
  switch (operator) {
    case "equal":
      return "=";
    case "greater-than":
      return ">";
    case "greater-than-equal":
      return ">=";
    case "less-than":
      return "<";
    case "less-than-equal":
      return "<=";
    default:
      operator satisfies never;
      throw new Error(
        `Unknown MediaFeatureComparison operator ${JSON.stringify(operator)}`,
      );
  }
}

// A math function folds to its value when every length in it resolves at compile time, a NaN result counting as 0 (css-values-4 §10.9)
function parseMathLength(
  calc: CalcFor_Length,
  parseLengthValue: (length: Length | LengthValue) => StyleDescriptor,
): StyleDescriptor {
  const value = evaluateCalc(calc, parseLengthValue);
  return value === undefined
    ? undefined
    : parseLengthValue({ unit: "px", value: Number.isNaN(value) ? 0 : value });
}

function evaluateCalc(
  calc: CalcFor_Length,
  parseLengthValue: (length: Length | LengthValue) => StyleDescriptor,
): number | undefined {
  const evaluate = (node: CalcFor_Length) =>
    evaluateCalc(node, parseLengthValue);

  switch (calc.type) {
    case "value": {
      const length = parseLengthValue(calc.value);
      return typeof length === "number" ? length : undefined;
    }
    case "number":
      return calc.value;
    case "sum":
      return foldPair(
        evaluate(calc.value[0]),
        evaluate(calc.value[1]),
        (left, right) => left + right,
      );
    case "product":
      return foldPair(
        calc.value[0],
        evaluate(calc.value[1]),
        (factor, value) => factor * value,
      );
    case "function":
      return evaluateMathFunction(calc.value, evaluate);
    default:
      calc satisfies never;
      return undefined;
  }
}

function evaluateMathFunction(
  math: MathFunctionFor_Length,
  evaluate: (calc: CalcFor_Length) => number | undefined,
): number | undefined {
  switch (math.type) {
    case "calc":
      return evaluate(math.value);
    case "min":
      return foldList(math.value.map(evaluate), (values) =>
        Math.min(...values),
      );
    case "max":
      return foldList(math.value.map(evaluate), (values) =>
        Math.max(...values),
      );
    case "hypot":
      return foldList(math.value.map(evaluate), (values) =>
        Math.hypot(...values),
      );
    // clamp(MIN, VAL, MAX) is max(MIN, min(VAL, MAX)) (css-values-4 §10.2)
    case "clamp":
      return foldPair(
        evaluate(math.value[0]),
        foldPair(evaluate(math.value[1]), evaluate(math.value[2]), Math.min),
        Math.max,
      );
    case "round":
      return foldPair(
        evaluate(math.value[1]),
        evaluate(math.value[2]),
        (value, step) => roundToStep(math.value[0], value, step),
      );
    // rem() takes the dividend's sign and mod() the divisor's (css-values-4 §10.4)
    case "rem":
      return foldPair(
        evaluate(math.value[0]),
        evaluate(math.value[1]),
        (dividend, divisor) => dividend % divisor,
      );
    case "mod":
      return foldPair(
        evaluate(math.value[0]),
        evaluate(math.value[1]),
        (dividend, divisor) =>
          dividend - divisor * Math.floor(dividend / divisor),
      );
    case "abs":
      return foldOne(evaluate(math.value), Math.abs);
    case "sign":
      return foldOne(evaluate(math.value), Math.sign);
    default:
      math satisfies never;
      return undefined;
  }
}

// The multiples of a step either side of a value, picked by the strategy; a zero step gives NaN (css-values-4 §10.3)
function roundToStep(
  strategy: RoundingStrategy,
  value: number,
  step: number,
): number {
  const size = Math.abs(step);
  const lower = Math.floor(value / size) * size;
  const upper = Math.ceil(value / size) * size;

  switch (strategy) {
    case "nearest":
      return value - lower < upper - value ? lower : upper;
    case "up":
      return upper;
    case "down":
      return lower;
    case "to-zero":
      return Math.abs(lower) < Math.abs(upper) ? lower : upper;
    default:
      strategy satisfies never;
      return Number.NaN;
  }
}

function foldOne(
  value: number | undefined,
  operation: (value: number) => number,
): number | undefined {
  return value === undefined ? undefined : operation(value);
}

function foldPair(
  left: number | undefined,
  right: number | undefined,
  operation: (left: number, right: number) => number,
): number | undefined {
  return left === undefined || right === undefined
    ? undefined
    : operation(left, right);
}

function foldList(
  values: readonly (number | undefined)[],
  operation: (values: readonly number[]) => number,
): number | undefined {
  return values.every((value): value is number => value !== undefined)
    ? operation(values)
    : undefined;
}
