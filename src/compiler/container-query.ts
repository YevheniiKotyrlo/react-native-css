/* eslint-disable */
import type {
  ContainerCondition as CSSContainerCondition,
  QueryFeatureFor_ContainerSizeFeatureId,
} from "lightningcss";

import { neverMatches, type CompiledContainerCondition } from "./compiled-condition";
import type { MediaCondition } from "./compiler.types";
import {
  parseMediaFeatureOperator,
  parseMediaFeatureValue,
} from "./media-query";
import type { StylesheetBuilder } from "./stylesheet";

export function parseContainerCondition(
  condition: CSSContainerCondition,
  builder: StylesheetBuilder,
): CompiledContainerCondition {
  const containerQuery = parseContainerQueryCondition(condition, builder);

  // A condition that did not compile cannot be shown to match, so the BLOCK is
  // dropped — emitting its rules with no condition left them matching under
  // ANY container, which is the opposite of what the author wrote. Nested
  // positions cannot drop a whole block, so they carry UNREPRESENTABLE instead
  // and the runtime's three-valued logic settles them.
  if (
    !containerQuery ||
    containerQuery.some((value) => value === undefined) ||
    neverMatches(containerQuery)
  ) {
    return { type: "never" };
  }

  return { type: "condition", condition: containerQuery };
}

function parseContainerQueryCondition(
  condition: CSSContainerCondition,
  builder: StylesheetBuilder,
): MediaCondition | undefined {
  switch (condition.type) {
    case "feature":
      return parseFeature(condition.value, builder);
    case "not":
      // An unrepresentable operand is NEGATED as unknown rather than dropped:
      // `not (unrepresentable)` is not a query that always matches.
      const query = parseContainerCondition(condition.value, builder);
      return [
        "!",
        query.type === "condition" ? query.condition : (["?"] as MediaCondition),
      ];
    case "operation":
      // An unrepresentable child is KEPT rather than filtered out — dropping it
      // rewrote the query into one that matches strictly more often.
      const conditions = condition.conditions.map(
        (child): MediaCondition =>
          parseContainerQueryCondition(child, builder) ?? ["?"],
      );

      if (conditions.length === 0) {
        return;
      }

      switch (condition.operator) {
        case "and":
          return ["&", conditions];
        case "or":
          return ["|", conditions];
        default:
          condition.operator satisfies never;
          return;
      }
    case "style":
      // `@container style(--x: 1)` needs the declaring container's computed
      // value, which this runtime does not track. Unrepresentable, so the rule
      // never applies — it used to apply under every container.
      return ["?"];
    default:
      condition satisfies never;
      return ["?"];
  }
}

function parseFeature(
  feature: QueryFeatureFor_ContainerSizeFeatureId,
  builder: StylesheetBuilder,
): MediaCondition | undefined {
  switch (feature.type) {
    case "boolean":
      return ["!!", feature.name];
    case "plain":
      return [
        "=",
        feature.name,
        parseMediaFeatureValue(feature.value, builder),
      ];
    case "range":
      return [
        parseMediaFeatureOperator(feature.operator),
        feature.name,
        parseMediaFeatureValue(feature.value, builder),
      ];
    case "interval":
      return [
        "[]",
        feature.name,
        parseMediaFeatureValue(feature.start, builder),
        parseMediaFeatureOperator(feature.startOperator),
        parseMediaFeatureValue(feature.end, builder),
        parseMediaFeatureOperator(feature.endOperator),
      ];
    default:
      feature satisfies never;
      return;
  }
}
