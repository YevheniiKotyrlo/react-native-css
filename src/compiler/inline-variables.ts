import type {
  Declaration,
  DeclarationBlock,
  Rule,
  Selector,
  StyleSheet,
  TokenOrValue,
} from "lightningcss";

import type { UniqueVarInfo } from "./compiler.types";
import { LAYER_MARKER_PROPERTY } from "./stylesheet";

/**
 * The first of the compiler's two lightningcss passes, and the only place a
 * rule's STRUCTURE is still visible — which at-rules enclose it, which selector
 * it was written under. The second pass parses whatever this one serialised, by
 * which time `extractRule` has flattened `@layer` into its children and a
 * declaration no longer knows where it came from.
 *
 * Two things depend on that structure, so both happen here:
 *
 * 1. **Folding a single-declaration custom property into its consumers.**
 *    Folding a value into a rule asserts that every element the rule matches
 *    has that value, which is only provable in the two cases `canFold` names.
 * 2. **Recording each rule's cascade layer**, as a marker declaration the second
 *    pass reads back (`LAYER_MARKER_PROPERTY`).
 *
 * One walk does both, because both ask the same question of the same tree.
 */
export function inlineVariables(
  stylesheet: StyleSheet,
  vars: Map<string, UniqueVarInfo>,
) {
  const annotation = annotateRules(stylesheet.rules, ROOT_SCOPE, {
    universalNames: new Set<string>(),
    declaringBlocks: new Map<string, DeclarationBlock>(),
    layerIds: new Map<string, number>(),
  });

  for (const [name, info] of [...vars]) {
    // A second declaration is a cascade this pass cannot resolve — which of
    // the two wins depends on the element — so only a property declared
    // exactly once is ever a candidate. WHERE each candidate may then be
    // folded is `canFold`'s question, asked per reference below.
    if (info.count !== 1) {
      vars.delete(name);
    } else {
      flattenVar(name, vars, annotation);
    }
  }

  if (vars.size === 0) {
    // Nothing left to fold, so the replacement walk below would rewrite every
    // declaration in the stylesheet into an identical copy of itself. The
    // annotation above has already run, which is what makes this pass safe to
    // install unconditionally.
    return stylesheet;
  }

  stylesheet.rules = stylesheet.rules.map(function checkRule(rule) {
    switch (rule.type) {
      case "custom":
      case "font-face":
      case "font-palette-values":
      case "font-feature-values":
      case "namespace":
      case "layer-statement":
      case "property":
      case "view-transition":
      case "ignored":
      case "unknown":
      case "import":
      case "page":
      case "counter-style":
      case "moz-document":
      case "nesting":
      case "viewport":
      case "custom-media":
      case "scope":
      case "starting-style":
        return rule;

      case "media":
        rule.value.rules = rule.value.rules.map((rule) => checkRule(rule));
        return rule;
      case "keyframes":
        rule.value.keyframes = rule.value.keyframes.map((keyframe) => {
          keyframe.declarations =
            replaceDeclarationBlock(keyframe.declarations, vars, annotation) ??
            keyframe.declarations;

          return keyframe;
        });
        return rule;
      case "style":
        rule.value.declarations = replaceDeclarationBlock(
          rule.value.declarations,
          vars,
          annotation,
        );

        rule.value.rules = rule.value.rules?.flatMap((rule) => checkRule(rule));

        return rule;
      case "nested-declarations":
        rule.value.declarations =
          replaceDeclarationBlock(rule.value.declarations, vars, annotation) ??
          {};
        return rule;
      case "supports":
        rule.value.rules = rule.value.rules.flatMap((rule) => checkRule(rule));
        return rule;
      case "layer-block":
        rule.value.rules = rule.value.rules.flatMap((rule) => checkRule(rule));
        return rule;
      case "container":
        rule.value.rules = rule.value.rules.flatMap((rule) => checkRule(rule));
        return rule;
    }
  });

  return stylesheet;
}

/**
 * Where a declaration sits, as the annotating walk descends.
 */
interface Scope {
  /**
   * Whether every element in the document is guaranteed to inherit from at
   * least one of the enclosing selectors.
   */
  readonly universal: boolean;
  /**
   * Whether an enclosing at-rule can switch the declarations off. `@layer` is
   * NOT one — a layer changes a rule's priority, never whether it applies.
   */
  readonly conditional: boolean;
  /** The innermost enclosing cascade layer, `undefined` outside every layer. */
  readonly layer: number | undefined;
}

const ROOT_SCOPE: Scope = {
  universal: false,
  conditional: false,
  layer: undefined,
};

interface Annotation {
  /**
   * Custom properties declared in a scope every element inherits, with nothing
   * conditioning them — the ones it is sound to fold into ANY consumer.
   */
  readonly universalNames: Set<string>;
  /**
   * Every custom property to the declaration block that declares it, which is
   * the other scope a fold can be proved in. Only meaningful for a property
   * declared once, which is the only kind `vars` carries.
   */
  readonly declaringBlocks: Map<string, DeclarationBlock>;
  /** Layer path to the id written into `LAYER_MARKER_PROPERTY`. */
  readonly layerIds: Map<string, number>;
}

function annotateRules(
  rules: Rule[],
  scope: Scope,
  annotation: Annotation,
): Annotation {
  for (const rule of rules) {
    switch (rule.type) {
      case "style": {
        const universal = isUniversalScope(rule.value.selectors, scope);
        const nested: Scope = { ...scope, universal };

        annotateDeclarationBlock(rule.value.declarations, nested, annotation);

        if (rule.value.rules) {
          annotateRules(rule.value.rules, nested, annotation);
        }
        break;
      }

      case "nested-declarations":
        // The declarations of the enclosing style rule, so they carry its
        // scope unchanged.
        annotateDeclarationBlock(rule.value.declarations, scope, annotation);
        break;

      case "layer-block": {
        const path = layerPath(scope, rule.value.name, annotation);

        rule.value.rules = hoistNestedLayers(rule.value.rules);

        annotateRules(
          rule.value.rules,
          { ...scope, universal: false, layer: layerId(path, annotation) },
          annotation,
        );
        break;
      }

      case "media":
      case "supports":
      case "container":
        // Conditional: whether these rules apply at all is decided elsewhere —
        // at runtime for a media or container query, at compile time for
        // `@supports` — so a declaration inside one is never unconditional,
        // however universal its selector.
        annotateRules(
          rule.value.rules,
          { ...scope, universal: false, conditional: true },
          annotation,
        );
        break;

      default:
        // `@keyframes` declares animation values, not a scope; `@scope` and
        // `@starting-style` are dropped whole by `extractRule`. Nothing inside
        // any of them is a scope another rule can rely on, and nothing inside
        // them becomes a rule to rank.
        break;
    }
  }

  return annotation;
}

function annotateDeclarationBlock(
  block: DeclarationBlock | undefined,
  scope: Scope,
  annotation: Annotation,
) {
  if (!block) {
    return;
  }

  const universal = scope.universal && !scope.conditional;

  recordDeclaredNames(block, block.declarations, universal, annotation);
  recordDeclaredNames(
    block,
    block.importantDeclarations,
    universal,
    annotation,
  );

  if (scope.layer !== undefined) {
    // Only the NORMAL declarations. `extractRule` builds a separate rule from
    // each list, and CSS Cascade 5 §6.4.4 REVERSES layer order for important
    // declarations — an important declaration in an earlier layer outranks one
    // in a later layer, and important unlayered ranks BELOW important layered.
    // Marking the important list would apply the normal-direction rank to it
    // and get that backwards; leaving it unmarked keeps the coarser rule this
    // library already applies, that important beats normal.
    if (block.declarations?.length) {
      block.declarations.unshift(layerMarkerDeclaration(scope.layer));
    }
  }
}

function recordDeclaredNames(
  block: DeclarationBlock,
  declarations: Declaration[] | undefined,
  universal: boolean,
  annotation: Annotation,
) {
  for (const declaration of declarations ?? []) {
    if (declaration.property !== "custom") {
      continue;
    }

    annotation.declaringBlocks.set(declaration.value.name, block);

    if (universal) {
      annotation.universalNames.add(declaration.value.name);
    }
  }
}

/**
 * Whether the value of `name` can be folded into a `var()` written in `block`.
 *
 * The two cases the compiler can PROVE, and it needs only one of them:
 *
 * - the declaration is in a universal, unconditional scope, so every element
 *   has the property whatever else it matches; or
 * - the reference is in the same declaration block as the declaration, so any
 *   element the rule matches has the property by matching that rule. Whether
 *   the rule applies at all does not matter: if a media query switches it off,
 *   it switches off the reference as well.
 *
 * Neither holds for `.a { --x: red } .b { color: var(--x) }`, where an element
 * carrying only `.b` has no `--x`, which is why it is left to the runtime.
 *
 * Both cases still need the property to be declared EXACTLY ONCE in the
 * stylesheet — `vars` holds only those — because a second declaration means a
 * cascade the compiler cannot resolve: a higher-specificity rule elsewhere
 * would win over the block's own.
 */
function canFold(
  name: string,
  block: DeclarationBlock | undefined,
  annotation: Annotation,
): boolean {
  return (
    annotation.universalNames.has(name) ||
    annotation.declaringBlocks.get(name) === block
  );
}

/**
 * Whether a selector list names a scope every element inherits from.
 *
 * ONE such selector is enough, so the list is tested with `some`: `:root, :host`
 * — the shape Tailwind emits for its theme — is universal because `:root` is,
 * whatever `:host` matches.
 *
 * A nested rule is universal only if BOTH it and the rule it is nested in are,
 * because its selectors are relative to that parent. A nested selector that is
 * nothing but `&` adds no constraint of its own and takes the parent's answer.
 */
function isUniversalScope(selectors: Selector[], scope: Scope): boolean {
  return selectors.some((selector) => {
    const meaningful = selector.filter(
      (component) => component.type !== "nesting",
    );

    if (meaningful.length === 0) {
      return scope.universal;
    }

    if (meaningful.length !== 1) {
      // Anything compound or combined is narrower than the whole document:
      // `:root .theme` matches only descendants of an element with that class.
      return false;
    }

    const [component] = meaningful;

    switch (component?.type) {
      case "universal":
        return true;
      case "type":
        // Every element descends from `html`. No other element name can be
        // relied on, and none of them compile to a rule here anyway.
        return component.name === "html";
      case "pseudo-class":
        return component.kind === "root" || component.kind === "host";
      default:
        return false;
    }
  });
}

/**
 * Move a layer's NESTED layer blocks ahead of its own rules.
 *
 * Semantics-preserving, and it is what makes the second pass's document order
 * the priority order. CSS Cascade 5 §6.4.4 applies at every level: a layer's own
 * declarations outrank those of its sublayers wherever the sublayers are
 * written. The second pass ranks a layer by where it first appears, so a
 * sublayer declared AFTER its parent's rules would otherwise be read as the
 * higher-priority one.
 *
 * Relative order is preserved on both sides, so two sublayers keep their
 * declared order and the parent's own rules keep theirs.
 */
function hoistNestedLayers(rules: Rule[]): Rule[] {
  const nestedLayers = rules.filter((rule) => rule.type === "layer-block");

  if (nestedLayers.length === 0 || nestedLayers.length === rules.length) {
    return rules;
  }

  return [
    ...nestedLayers,
    ...rules.filter((rule) => rule.type !== "layer-block"),
  ];
}

/**
 * The dotted path of a layer block, which is what CSS calls it: a `@layer b`
 * inside `@layer a` is the layer `a.b`, distinct from `a`.
 *
 * An anonymous `@layer { … }` is a NEW layer every time it appears — two of
 * them never merge — so each gets a path nothing else can collide with.
 */
function layerPath(
  scope: Scope,
  name: string[] | null | undefined,
  annotation: Annotation,
): string {
  const prefix =
    scope.layer === undefined
      ? ""
      : `${findLayerPath(scope.layer, annotation)}.`;

  if (!name?.length) {
    return `${prefix}<anonymous ${annotation.layerIds.size}>`;
  }

  return `${prefix}${name.join(".")}`;
}

function findLayerPath(id: number, annotation: Annotation): string {
  for (const [path, candidate] of annotation.layerIds) {
    if (candidate === id) {
      return path;
    }
  }

  return "";
}

function layerId(path: string, annotation: Annotation): number {
  let id = annotation.layerIds.get(path);

  if (id === undefined) {
    id = annotation.layerIds.size;
    annotation.layerIds.set(path, id);
  }

  return id;
}

function layerMarkerDeclaration(id: number): Declaration {
  return {
    property: "custom",
    value: {
      name: LAYER_MARKER_PROPERTY,
      value: [{ type: "token", value: { type: "number", value: id } }],
    },
  };
}

function replaceDeclarationBlock(
  block: DeclarationBlock | undefined,
  vars: Map<string, UniqueVarInfo>,
  annotation: Annotation,
) {
  if (!block) return;

  block.declarations = block.declarations
    ?.map((decl) => {
      return replaceDeclaration(decl, vars, block, annotation);
    })
    .filter((d) => !!d);

  block.importantDeclarations = block.importantDeclarations
    ?.map((decl) => {
      return replaceDeclaration(decl, vars, block, annotation);
    })
    .filter((d) => !!d);

  return block;
}

function replaceDeclaration(
  declaration: Declaration,
  vars: Map<string, UniqueVarInfo>,
  block: DeclarationBlock | undefined,
  annotation: Annotation,
) {
  if (
    declaration.property !== "unparsed" &&
    declaration.property !== "custom"
  ) {
    return declaration;
  }

  if (
    declaration.property === "custom" &&
    vars.has(declaration.value.name) &&
    annotation.universalNames.has(declaration.value.name)
  ) {
    // A universal declaration has been folded into every reference there is,
    // so nothing is left to read it. A block-scoped one is KEPT: it was folded
    // only into its own block, and a descendant still inherits it — dropping it
    // is what made `.a { --x: red }` invisible to a nested `.b { color:
    // var(--x) }` once the fold stopped reaching across rules.
    return;
  }

  declaration.value.value = declaration.value.value.flatMap((part) => {
    return flattenPart(part, vars, block, annotation);
  });

  return declaration;
}

function flattenPart(
  part: TokenOrValue,
  vars: Map<string, UniqueVarInfo>,
  block: DeclarationBlock | undefined,
  annotation: Annotation,
): TokenOrValue | TokenOrValue[] {
  if (part.type === "var") {
    const name = part.value.name.ident;
    const varInfo = vars.get(name);

    if (!varInfo || !canFold(name, block, annotation)) {
      part.value.fallback = part.value.fallback?.flatMap((arg) => {
        return flattenPart(arg, vars, block, annotation);
      });

      return part;
    } else if (varInfo.value === undefined) {
      const fallback = part.value.fallback?.flatMap((arg) => {
        return flattenPart(arg, vars, block, annotation);
      });

      return fallback ?? [];
    }

    return varInfo.value;
  } else if (part.type === "function") {
    part.value.arguments = part.value.arguments.flatMap((arg) => {
      return flattenPart(arg, vars, block, annotation);
    });
  }

  return part;
}

function flattenVar(
  name: string,
  vars: Map<string, UniqueVarInfo>,
  annotation: Annotation,
  seen: Set<string> = new Set<string>(),
) {
  if (seen.has(name)) {
    vars.delete(name);
  }

  seen.add(name);

  let varInfo = vars.get(name);

  if (!varInfo || varInfo.flat) {
    return;
  }

  // A value is flattened for the block that declares it, because that is the
  // only block it will be substituted into. A `var()` inside it is therefore
  // held to the same terms every other reference from that block is held to —
  // otherwise `.a { --x: var(--y) }` would quietly take `.b`'s `--y`.
  const declaringBlock = annotation.declaringBlocks.get(name);

  let varInfoValue = varInfo.value?.flatMap((part) => {
    if (part.type === "var") {
      const nestedName = part.value.name.ident;

      flattenVar(nestedName, vars, annotation, seen);

      const nestedVarInfo = vars.get(nestedName);
      if (
        nestedVarInfo?.value &&
        canFold(nestedName, declaringBlock, annotation)
      ) {
        return nestedVarInfo.value;
      }
    }
    return flattenPart(part, vars, declaringBlock, annotation);
  });

  // If the variable is shorthand for "initial", substitute it for undefined
  if (
    varInfoValue?.length === 2 &&
    varInfoValue[0]?.type === "token" &&
    varInfoValue[0].value.type === "ident" &&
    varInfoValue[0].value.value === "initial" &&
    varInfoValue[1]?.type === "token" &&
    varInfoValue[1].value.type === "white-space"
  ) {
    varInfoValue = undefined;
  }

  varInfo = {
    count: 1,
    flat: true,
    value: varInfoValue,
  };

  vars.set(name, varInfo);
}
