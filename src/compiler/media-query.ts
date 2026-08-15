/* eslint-disable */
import type {
  CalcFor_Length,
  MediaCondition as CSSMediaCondition,
  MediaFeatureComparison as CSSMediaFeatureComparison,
  MediaFeatureValue as CSSMediaFeatureValue,
  MediaQuery as CSSMediaQuery,
  QueryFeatureFor_MediaFeatureId,
} from "lightningcss";

import type { CompiledCondition } from "./compiled-condition";
import type {
  MediaCondition,
  MediaFeatureComparison,
  MediaFeatureOperand,
  StyleDescriptor,
} from "./compiler.types";
import { parseLength } from "./declarations";
import type { StylesheetBuilder } from "./stylesheet";

/**
 * Parses a single media query out of a comma-separated list.
 *
 * Returns `undefined` when the query cannot apply on native, which the caller
 * treats the way CSS treats an unmatchable query in a list: it contributes
 * nothing, and the remaining queries still decide the block.
 */
export function parseMediaQuery(
  query: CSSMediaQuery,
  builder: StylesheetBuilder,
): CompiledCondition {
  let platformCondition: MediaCondition | undefined;
  let condition: MediaCondition | undefined;

  if (query.mediaType) {
    // Print is for printing documents. A bare `@media print` is dropped before
    // it reaches here, so what arrives is `@media not print ...` — which reads
    // `not (print and ...)` and is therefore true on every non-print device,
    // whatever the rest of the query says.
    if (query.mediaType === "print") {
      return { type: "always" };
    }

    // These all/screen are not conditions, they always apply
    if (query.mediaType !== "all" && query.mediaType !== "screen") {
      platformCondition = ["=", "platform", query.mediaType];
    }
  }

  if (query.condition) {
    condition = parseMediaQueryCondition(query.condition, builder);

    // An unrepresentable condition becomes UNREPRESENTABLE, never absent.
    // Returning here left the rule with no condition at all, so a query written
    // to apply in one situation applied in every one of them — the styles did
    // not go missing, they went everywhere.
    if (!condition || condition.some((value) => value === undefined)) {
      condition = ["?"];
    }
  }

  let mediaQuery: MediaCondition | undefined =
    platformCondition && condition
      ? ["&", [platformCondition, condition]]
      : platformCondition || condition;

  if (!mediaQuery) {
    return { type: "always" };
  }

  if (query.qualifier === "not") {
    mediaQuery = ["!", mediaQuery];
  }

  return { type: "condition", condition: mediaQuery };
}

function parseMediaQueryCondition(
  query: CSSMediaCondition,
  builder: StylesheetBuilder,
): MediaCondition | undefined {
  switch (query.type) {
    case "feature":
      return parseFeature(query.value, builder);
    case "not":
      // MQ5 § 3.1: the negation of unknown is unknown, so an uncompilable term
      // has to survive negation as a term rather than vanish. The fallback is
      // unreachable today - every `<media-condition>` form below compiles to a
      // term - and is kept because what makes it so is the set of forms this
      // function handles, which the next feature type added to lightningcss
      // changes.
      const mediaQuery = parseMediaQueryCondition(query.value, builder);
      return ["!", mediaQuery ?? ["?"]];
    case "operation":
      // An unrepresentable child is KEPT as unrepresentable rather than
      // filtered out. Dropping it rewrote the query: `(unknown) and (width >
      // 100px)` became `(width > 100px)`, which matches strictly more often
      // than what was written.
      const mediaQueries = query.conditions.map(
        (condition): MediaCondition =>
          parseMediaQueryCondition(condition, builder) ?? ["?"],
      );

      if (mediaQueries.length === 0) {
        return;
      }

      switch (query.operator) {
        case "and":
          return ["&", mediaQueries];
        case "or":
          return ["|", mediaQueries];
        default:
          query.operator satisfies never;
          return;
      }
    default:
      query satisfies never;
  }

  return;
}

function parseFeature(
  feature: QueryFeatureFor_MediaFeatureId,
  builder: StylesheetBuilder,
): MediaCondition | undefined {
  switch (feature.type) {
    case "boolean":
      return ["!!", feature.name];
    case "plain":
      return [
        "=",
        feature.name,
        parseMediaFeatureOperand(feature.value, builder),
      ];
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
  }
  return;
}

/**
 * A feature value in the one shape an operand slot can hold.
 *
 * `parseMediaFeatureValue` answers `undefined` for a value with no compile-time
 * answer - `env()`, a ratio, an unsupported `calc()`. That marker cannot cross
 * into a native bundle, which receives the stylesheet as JSON, so it is written
 * here as `null` and every operand slot is filled through this function.
 */
export function parseMediaFeatureOperand(
  value: CSSMediaFeatureValue,
  builder: StylesheetBuilder,
): MediaFeatureOperand {
  return parseMediaFeatureValue(value, builder) ?? null;
}

function parseMediaFeatureValue(
  value: CSSMediaFeatureValue,
  builder: StylesheetBuilder,
): StyleDescriptor {
  switch (value.type) {
    case "boolean":
    case "ident":
    case "integer":
    case "number":
      return value.value;
    case "length":
      switch (value.value.type) {
        case "value":
          return parseLength(value.value.value, builder);
        case "calc":
          return parseCalcFn(value.value.value, builder);
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
    case "ratio": {
      // `<ratio>` is `<number> / <number>`, and lightningcss normalises the
      // single-number form to `[n, 1]`. Comparing it as a plain number is exact:
      // the runtime computes the viewport's ratio the same way.
      const [numerator, denominator] = value.value;
      return denominator === 0 ? undefined : numerator / denominator;
    }
    case "env":
  }

  return;
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
      throw new Error(`Unknown MediaFeatureComparison operator ${operator}`);
  }
}

function parseCalcFn(
  calc: CalcFor_Length,
  builder: StylesheetBuilder,
): StyleDescriptor {
  switch (calc.type) {
    case "number":
      return calc.value;
    case "value":
      return parseLength(calc.value, builder);
    case "sum":
      return [{}, "sum", calc.value.map((c) => parseCalcFn(c, builder))];
    case "product":
      return [
        {},
        "product",
        [calc.value[0], parseCalcFn(calc.value[1], builder)],
      ];
    case "function":
      switch (calc.value.type) {
        case "calc":
          return parseCalcFn(calc.value.value, builder);
        case "min":
        case "max":
        case "clamp":
        case "rem":
        case "mod":
        case "hypot":
          return [
            {},
            calc.value.type,
            calc.value.value.map((c) => parseCalcFn(c, builder)),
          ];
        case "abs":
        case "sign":
          return [
            {},
            calc.value.type,
            [parseCalcFn(calc.value.value, builder)],
          ];
        case "round":
          return [
            {},
            calc.value.type,
            [
              calc.value.value[0],
              parseCalcFn(calc.value.value[1], builder),
              parseCalcFn(calc.value.value[2], builder),
            ],
          ];
        default:
          calc.value satisfies never;
          return;
      }
    default:
      calc satisfies never;
  }

  return;
}
