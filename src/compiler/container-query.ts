/* eslint-disable */
import type {
  ContainerCondition as CSSContainerCondition,
  QueryFeatureFor_ContainerSizeFeatureId,
} from "lightningcss";

import type { MediaCondition } from "./compiler.types";
import {
  parseMediaFeatureOperator,
  parseMediaFeatureValue,
} from "./media-query";
import type { StylesheetBuilder } from "./stylesheet";

export function parseContainerCondition(
  condition: CSSContainerCondition,
  builder: StylesheetBuilder,
): MediaCondition {
  const containerQuery = parseContainerQueryCondition(condition, builder);

  // An unrepresentable condition becomes UNREPRESENTABLE, never absent —
  // returning nothing here left the rule matching under ANY container.
  if (!containerQuery || containerQuery.some((value) => value === undefined)) {
    return ["?"];
  }

  return containerQuery;
}

function parseContainerQueryCondition(
  condition: CSSContainerCondition,
  builder: StylesheetBuilder,
): MediaCondition | undefined {
  switch (condition.type) {
    case "feature":
      return parseFeature(condition.value, builder);
    case "not":
      const query = parseContainerCondition(condition.value, builder);
      return ["!", query ?? ["?"]];
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
