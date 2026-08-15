import type { SelectorList } from "lightningcss";

import {
  containsStyleFunction,
  INHERIT_VARIABLE_PREFIX,
  postProcessStyleFunction,
  Specificity,
  specificityCompareFn,
} from "../utilities";
import type {
  AnimationKeyframes,
  AnimationRecord,
  CompilerOptions,
  CompilerWarnings,
  ContainerQuery,
  MediaCondition,
  ReactNativeCssStyleSheet,
  StyleDeclaration,
  StyleDescriptor,
  StyleFunction,
  StyleRule,
  StyleRuleMapping,
  StyleRuleSet,
  VariableRecord,
  VariableValue,
} from "./compiler.types";
import {
  getPseudoElement,
  scopeRuleToPseudoElement,
  type PseudoElement,
} from "./pseudo-elements";
import { getClassNameSelectors, toRNProperty } from "./selector-builder";

type BuilderMode = "style" | "media" | "container" | "keyframes";

const staticDeclarations = new WeakMap<
  WeakKey,
  Record<string, StyleDescriptor>
>();

const extraRules = new WeakMap<StyleRule, StyleRule[]>();

/**
 * The properties whose React Native style key is not the camelCase of their CSS
 * name.
 *
 * Consulted by `addDescriptor`, which every declaration goes through — a parser
 * that returns a value, a parser that writes its own longhands, a shorthand's
 * collapse, a `light-dark()`'s extra rule and the deferred route alike. Asked
 * anywhere narrower it covered some spellings of a property and not others:
 * `border-inline-start-color: red` renamed while
 * `border-inline-start: 1px solid red` did not, from the same table.
 *
 * The `*-block-*` / `*-inline-*` SIZES are here because React Native has no
 * logical sizing keys at all: `blockSize`, `inlineSize`, `maxBlockSize` and
 * friends appear nowhere in the runtime, so each was a style object asserting a
 * key nothing reads and `block-size: 10px` sized nothing. React Native lays out
 * in one writing mode — there is no `writing-mode` style and `direction` swaps
 * only the INLINE start and end — so in every document it can render, the block
 * axis is the vertical one and the inline axis the horizontal one, which makes
 * each of these exactly its physical counterpart (css-logical-1 §2).
 *
 * The inline BORDER edges are here for a different reason: React Native has the
 * property, spelled its own way. `borderStartColor` / `borderEndColor` and
 * `borderStartWidth` / `borderEndWidth` are direction-aware exactly as CSS's
 * `border-inline-start` / `-end` are, so the two names are one property and the
 * rename loses nothing. Left un-renamed they were `borderInlineStartColor` and
 * friends — spellings `ReactNativeStyleAttributes.js` does not carry, so the
 * declaration compiled, produced a style object, and rendered nothing.
 *
 * A property React Native has NO key for is not renamed to a near-miss: the
 * per-edge border STYLES have no React Native target at all, so they keep their
 * faithful CSS spelling and are inert until React Native grows one. Renaming
 * `border-inline-style` to `borderStyle` would style four edges where two were
 * asked for, which is worse than rendering nothing.
 */
export const propertyRename: Record<string, string> = {
  "background-image": "experimental_backgroundImage",
  "block-size": "height",
  // React Native ships no border-block-* WIDTH on Android or the old
  // architecture: ReactNativeStyleAttributes and BaseViewConfig.android.js
  // both list the three block COLOURS and none of the widths, and ViewStyle
  // declares only the colours. BaseViewConfig.ios.js is the outlier that
  // carries them, which makes an unrenamed block width paint on iOS and
  // nowhere else. The block axis is never flipped by `direction`, so
  // block-start is the top edge and block-end the bottom one on every
  // platform — the colours need no rename because RN already reads them.
  "border-block-end-width": "border-bottom-width",
  "border-block-start-width": "border-top-width",
  // React Native has no border-inline-* props, but ships the equivalent
  // RTL-aware border-start-* / border-end-* props
  "border-inline-end-color": "border-end-color",
  "border-inline-end-width": "border-end-width",
  "border-inline-start-color": "border-start-color",
  "border-inline-start-width": "border-start-width",
  "font-variant-caps": "font-variant",
  "inline-size": "width",
  "max-block-size": "max-height",
  "max-inline-size": "max-width",
  "min-block-size": "min-height",
  "min-inline-size": "min-width",
};

/**
 * The CSS-wide keywords the runtime carries rather than renders.
 *
 * `unset` is the whole set: `resolveValue` reads it as "remove this value", so
 * it ships as a declaration of its own rather than folding into the static
 * record with the values around it. `./declarations.ts` derives the keywords it
 * must REJECT from this one, so a keyword that gains a runtime form is added
 * here and stops being rejected in the same edit.
 */
export const RUNTIME_KEYWORD_VALUES: ReadonlySet<string> = new Set(["unset"]);

/**
 * Whether a descriptor is a CSS-wide keyword — an instruction to the cascade
 * rather than a value the cascade carries.
 */
function isRuntimeKeyword(value: StyleDescriptor): value is string {
  return typeof value === "string" && RUNTIME_KEYWORD_VALUES.has(value);
}

/**
 * The CSS *inherited* properties React Native can render, in React Native's
 * own camelCase spelling.
 *
 * Derived as the intersection of the properties MDN marks `inherited: true`
 * with the keys React Native's `TextStyle` accepts — not transcribed from the
 * spec, so it cannot quietly cover only the properties someone remembered.
 *
 * Shorthands need no entries: they are expanded before `addDescriptor` sees
 * them — `parseFont` emits `font-family` / `font-size` / `font-style` /
 * `font-weight` / `line-height` individually, so `font: bold 16px Arial` is
 * covered by its longhands.
 *
 * Excluded deliberately:
 * - `pointer-events` and `direction` — React Native already cascades both to
 *   descendants itself, so publishing them would double-apply and fight a
 *   working mechanism. (React Native's Text-level `writingDirection` is not a
 *   separate entry here: CSS spells the property `direction`, so it is that
 *   one declaration, and it is excluded.)
 * - `cursor` — the compiler does not parse it at all today, so an entry would
 *   be dead weight. Upstream PR #346 adds the property; it belongs in this set
 *   the moment that lands.
 * - `text-shadow` — inherited in CSS, but its offset is emitted as a nested
 *   path (`&.textShadowOffset.width`, see `parseTextShadow`) that a flat
 *   variable cannot carry. Publishing colour and radius alone would render a
 *   descendant's shadow at offset 0,0 — a *wrong* shadow rather than a missing
 *   one.
 * - `text-decoration*` — not inherited in CSS at all; it propagates by being
 *   drawn across descendants, which React Native already does.
 */
const INHERITED_TEXT_PROPERTIES = new Map(
  [
    "color",
    "fontFamily",
    "fontSize",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "letterSpacing",
    "lineHeight",
    "textAlign",
    "textTransform",
  ].map((property) => [property.toLowerCase(), property] as const),
);

/**
 * Resolves a declared property to its canonical React Native spelling, or
 * `undefined` if it is not an inherited property.
 *
 * Keyed case-INSENSITIVELY because CSS property names are: `COLOR: red` and
 * `Font-Size: 2rem` are both valid CSS, and an author (or a preprocessor) may
 * emit either. The map's VALUE is the canonical camelCase name, so the
 * published variable is spelled the way React Native expects no matter how the
 * declaration was written — matching on a lowercased key while emitting the
 * lowercased name would publish `fontsize`, which React Native ignores
 * silently.
 */
function resolveInheritedProperty(property: string): string | undefined {
  return INHERITED_TEXT_PROPERTIES.get(toRNProperty(property).toLowerCase());
}

/**
 * Where a value warning is filed when nothing names the declaration it came
 * from — a warning raised before any property has been read, which is every
 * warning from an at-rule preamble, a keyframe selector or a media query.
 *
 * A reserved key rather than a drop: `<>` cannot appear in a CSS property
 * name, so it can never collide with a real one, and an author who reads the
 * warnings sees that something was rejected even when the compiler cannot say
 * which declaration did it. Discarding it instead made a stylesheet with a
 * real fault compile clean.
 */
export const UNATTRIBUTED_WARNING_PROPERTY = "<unattributed>";

/**
 * How a rule's cascade layer reaches this builder.
 *
 * `@layer` is structure, and the compiler runs lightningcss TWICE: the first
 * pass sees the layer blocks, the second parses whatever the first SERIALISED
 * and builds the rules. Nothing about a rule's enclosing at-rules survives that
 * boundary — `extractRule` flattens a `layer-block` into its children — so
 * `./inline-variables.ts` writes the layer down as a declaration the second
 * pass can read back, and `addDescriptor` consumes it here rather than
 * publishing it as a variable.
 *
 * The value is an opaque id, one per layer. Its ORDER is not read from it: the
 * rank is assigned by first appearance in the second pass, whose document order
 * is lightningcss's own layer-sorted output and therefore already the CSS
 * priority order. Sorting on the id itself would use the first pass's SOURCE
 * order instead, which `@layer b, a;` exists to override.
 */
export const LAYER_MARKER_PROPERTY = "--__rn-css-layer";

/**
 * Whether a declaration makes its rule animated, i.e. whether the runtime has
 * to wrap the component for reanimated.
 *
 * The PROPERTY decides, never how the value happens to be spelled.
 * `transition-timing-function` is a transition declaration whether it is
 * written `ease-in`, which compiles to a literal, or `cubic-bezier(…)`, which
 * compiles to a style function named `cubicBezier`.
 *
 * Both spellings are accepted because `addDescriptor` is called with the CSS
 * name from most parsers and with React Native's camelCase name from a few;
 * `animation` and `transition` are the same first word either way.
 */
function isAnimationProperty(property: string): boolean {
  return property.startsWith("animation") || property.startsWith("transition");
}

export class StylesheetBuilder {
  animationFrames?: AnimationKeyframes[];
  animationDeclarations: StyleDeclaration[] = [];

  stylesheet: ReactNativeCssStyleSheet = {};

  varUsage = new Set<string>();

  private rule: StyleRule = {
    s: [],
  };

  constructor(
    private options: CompilerOptions,
    public mode: BuilderMode = "style",
    private ruleTemplate: StyleRule = {
      s: [],
    },
    // Any default mapping should be included in the @nativeMapping parsing
    private mapping: StyleRuleMapping = {},
    /**
     * The properties the declaration being parsed writes to. Usually one, but
     * a shorthand that expands across an axis writes to every property in the
     * expansion, and an unnamed descriptor has to reach all of them.
     */
    public descriptorProperties?: readonly string[],
    private shared: {
      ruleSets: Record<string, StyleRuleSet>;
      rootVariables?: VariableRecord;
      universalVariables?: VariableRecord;
      nonInheritedVariables?: Set<string>;
      registeredInitialValues?: VariableRecord;
      animations?: AnimationRecord;
      rem: number;
      ruleOrder: number;
      /** Layer id (as written by `./inline-variables.ts`) to cascade rank. */
      layerRanks?: Map<StyleDescriptor, number>;
      warningProperties: string[];
      warningValues: Record<string, unknown[]>;
      warningFunctions: string[];
      syntaxWarnings: string[];
    } = {
      ruleSets: {},
      rem: 14,
      ruleOrder: 0,
      warningProperties: [],
      warningValues: {},
      warningFunctions: [],
      syntaxWarnings: [],
    },
    private selectors: SelectorList = [],
    /**
     * The declaration currently being parsed, used to attribute a value
     * warning that does not name one itself.
     *
     * Per BUILDER, not on `shared`: every style rule gets its own `fork()`, so
     * a stylesheet-wide field made the property outlive the rule that set it
     * and a warning raised while parsing one rule was filed against a property
     * that a DIFFERENT rule had declared — blaming a declaration that
     * compiled cleanly. Carried into a fork so a nested context (a rule inside
     * `@media`, a `@supports` probe) keeps the enclosing declaration's name.
     */
    private warningProperty?: string,
  ) {}

  fork(mode = this.mode, selectors: SelectorList = []): StylesheetBuilder {
    this.shared.ruleOrder++;

    /**
     * If we already have selectors and we are added more
     * Then these must be nested selectors.
     *
     * We need to extrapolate out the selectors to their full values
     */
    selectors =
      this.selectors.length && selectors.length
        ? this.selectors.flatMap((selectorA) => {
            return selectors.map((selectorB) => [...selectorA, ...selectorB]);
          })
        : [...this.selectors, ...selectors];

    return new StylesheetBuilder(
      this.options,
      mode,
      this.cloneRule(),
      { ...this.mapping },
      this.descriptorProperties,
      this.shared,
      selectors,
      this.warningProperty,
    );
  }

  cloneRule({ ...rule } = this.ruleTemplate): StyleRule {
    rule.s = [...rule.s];
    rule.aq &&= [...rule.aq];
    rule.c &&= [...rule.c];
    rule.cq &&= [...rule.cq];
    rule.d &&= [...rule.d];
    rule.m &&= [...rule.m];
    rule.p &&= { ...rule.p };
    rule.v &&= [...rule.v];

    return rule;
  }

  /**
   * The form an extra rule takes on its way to a selector.
   *
   * The rule it was opened on supplies the SELECTOR — its specificity, its
   * container query, and the media conditions the extra one is added to. The
   * extra rule supplies the CONTENT, in full: its declarations, the variables
   * they publish, and the flags they set. Neither half crosses over.
   *
   * Pseudo classes and attribute queries are absent from that list because
   * they are never on the rule this copies from. They are read off the
   * selector by `applyRuleToSelectors` and written onto every rule it applies,
   * this one included, so copying them here would be a second source for a
   * value that already reaches the merged rule one step later.
   *
   * Content is never inherited, not even for a channel the extra rule leaves
   * empty. The rule it was opened on matches under the extra condition too, so
   * anything left out still arrives from there — while restating it makes the
   * extra rule a second place that value is written, and being applied last it
   * overwrites whatever an earlier extra rule on the same rule published.
   */
  private mergeExtraRule(rule: StyleRule, extraRule: StyleRule): StyleRule {
    const merged = this.cloneRule(extraRule);

    merged.s = [...rule.s];

    if (rule.m) {
      merged.m = [...rule.m, ...(merged.m ?? [])];
    }

    if (rule.cq) {
      merged.cq = [...rule.cq];
    }

    return merged;
  }

  getOptions(): CompilerOptions {
    return this.options;
  }

  setOptions<T extends keyof CompilerOptions>(
    key: T,
    value: CompilerOptions[T],
  ) {
    this.options[key] = value;
  }

  getNativeStyleSheet(): ReactNativeCssStyleSheet {
    const stylesheetOptions: ReactNativeCssStyleSheet = {};

    const ruleSets = this.getRuleSets();
    if (ruleSets) {
      stylesheetOptions.s = ruleSets;
    }

    if (this.shared.rootVariables) {
      stylesheetOptions.vr = Object.entries(this.shared.rootVariables).map(
        // Reverse these so the most specific variables are first
        ([key, value]) => [key, value.reverse()] as const,
      );
    }

    if (this.shared.universalVariables) {
      stylesheetOptions.vu = Object.entries(this.shared.universalVariables).map(
        // Reverse these so the most specific variables are first
        ([key, value]) => [key, value.reverse()] as const,
      );
    }

    if (this.shared.nonInheritedVariables?.size) {
      stylesheetOptions.vn = [...this.shared.nonInheritedVariables];
    }

    if (this.shared.registeredInitialValues) {
      stylesheetOptions.vi = Object.entries(
        this.shared.registeredInitialValues,
      ).map(([key, value]) => [key, value] as const);
    }

    if (this.shared.animations) {
      stylesheetOptions.k = Object.entries(this.shared.animations);
    }

    return stylesheetOptions;
  }

  getRuleSets() {
    const entries = Object.entries(this.shared.ruleSets);

    if (!entries.length) {
      return;
    }

    // Before the sort, because the sort is what reads the rank.
    this.normalizeLayerRanks();

    return Object.entries(this.shared.ruleSets).map(
      ([key, value]) =>
        [key, value.sort((a, b) => specificityCompareFn(a, b))] as const,
    );
  }

  setWarningProperty(property: string) {
    this.warningProperty = property;
  }

  /**
   * A diagnostic from lightningcss itself, rather than from a parser here.
   *
   * `errorRecovery: true` turns a stylesheet-fatal parse error into a dropped
   * rule, which is what CSS asks for — but lightningcss reports what it
   * recovered from in `result.warnings`, and discarding those leaves a
   * stylesheet with a real syntax error compiling to a smaller stylesheet with
   * no diagnostic anywhere.
   */
  addSyntaxWarning(message: string) {
    this.shared.syntaxWarnings.push(message);
  }

  /** A property with no parser at all. */
  addWarning(type: "property", property: string): void;
  /**
   * A value the compiler could not use.
   *
   * `property` names the declaration the value came from and is how a caller
   * that knows it should report one — attribution is a fact the parser holds,
   * not something to recover from ambient state. Omitting it falls back to the
   * declaration `setWarningProperty` last named on THIS builder, and where
   * there is none the warning is filed under
   * `UNATTRIBUTED_WARNING_PROPERTY` rather than dropped.
   */
  addWarning(type: "value", value: unknown, property?: string): void;
  /** A value rejected for a property named by the caller. */
  addWarning(type: "style", property: string, value: unknown): void;
  addWarning(
    type: "property" | "style" | "value",
    propertyOrValue: unknown,
    valueOrProperty?: unknown,
  ): void {
    switch (type) {
      case "property":
        this.shared.warningProperties.push(propertyOrValue as string);
        break;
      case "value": {
        const property =
          (valueOrProperty as string | undefined) ??
          this.warningProperty ??
          UNATTRIBUTED_WARNING_PROPERTY;

        this.pushValueWarning(property, propertyOrValue);
        break;
      }
      case "style":
        this.pushValueWarning(propertyOrValue as string, valueOrProperty);
        break;
    }
  }

  private pushValueWarning(property: string, value: unknown) {
    const values = (this.shared.warningValues[property] ??= []);
    values.push(value);
  }

  getWarnings(): CompilerWarnings {
    const result: CompilerWarnings = {};

    if (this.shared.warningProperties.length) {
      result.properties = this.shared.warningProperties;
    }

    if (Object.keys(this.shared.warningValues).length) {
      result.values = this.shared.warningValues;
    }

    if (this.shared.warningFunctions.length) {
      result.functions = this.shared.warningFunctions;
    }

    if (this.shared.syntaxWarnings.length) {
      result.syntax = this.shared.syntaxWarnings;
    }

    return result;
  }

  addMapping(mapping: StyleRuleMapping) {
    this.mapping = { ...this.mapping, ...mapping };
  }

  newRule(mapping = this.mapping, { important = false } = {}) {
    this.mapping = mapping;
    this.rule = this.cloneRule(this.ruleTemplate);
    this.rule.s[Specificity.Order] = this.shared.ruleOrder;
    if (important) {
      this.rule.s[Specificity.Important] = 1;
    }
  }

  /** Used by nested declarations (for example @media inside a RuleSet) */
  newNestedRule({ important = false, mapping = this.mapping } = {}) {
    this.newRule(mapping, { important });
  }

  /**
   * Open an extra rule: the current rule again under one more media condition,
   * for a declaration whose value differs under that condition. `light-dark()`
   * is the caller — it resolves to two values where a declaration parser
   * returns one, so the dark branch is delivered by an extra rule under
   * `prefers-color-scheme: dark`.
   *
   * The rule is created EMPTY and returned for the caller to write descriptors
   * into through the same `addDescriptor` seams as the current rule. It is
   * never seeded from the current rule: a copy taken mid-parse carries every
   * value written before it, so a second `light-dark()` on the same rule would
   * hand its dark rule the first declaration's light value.
   */
  openExtraRule(condition: MediaCondition): StyleRule {
    const extraRule: StyleRule = { s: [], m: [condition] };

    let extraRuleArray = extraRules.get(this.rule);
    if (!extraRuleArray) {
      extraRuleArray = [];
      extraRules.set(this.rule, extraRuleArray);
    }
    extraRuleArray.push(extraRule);

    return extraRule;
  }

  private addRuleToRuleSet(name: string, rule = this.rule) {
    if (this.shared.ruleSets[name]) {
      this.shared.ruleSets[name].push(rule);
    } else {
      this.shared.ruleSets[name] = [rule];
    }
  }

  addMediaQuery(condition: MediaCondition) {
    this.ruleTemplate.m ??= [];
    this.ruleTemplate.m.push(condition);
  }

  addContainer(value: string[] | false) {
    this.rule.c ??= [];

    if (value === false) {
      this.rule.c = [];
    } else {
      this.rule.c.push(...value.map((name) => `c:${name}`));
    }
  }

  addUnnamedDescriptor(
    value: StyleDescriptor,
    forceTuple?: boolean,
    rule = this.rule,
  ) {
    if (this.descriptorProperties === undefined) {
      return;
    }

    for (const property of this.descriptorProperties) {
      this.addDescriptor(property, value, forceTuple, rule);
    }
  }

  addDescriptor(
    rawProperty: string,
    value: StyleDescriptor,
    forceTuple?: boolean,
    rule = this.rule,
  ) {
    if (value === undefined) {
      return;
    }

    // Every declaration reaches React Native through here, which is why the
    // rename is asked here — see `propertyRename`. Idempotent by construction:
    // no entry's TARGET is itself a key, so the deferred route renaming ahead
    // of its own set lookups and renaming again on the way out is one rename.
    const property = propertyRename[rawProperty] ?? rawProperty;

    // The layer marker is structure, not a declaration — see
    // `LAYER_MARKER_PROPERTY`. Consumed here so it never reaches `rule.v`,
    // where it would ship to the runtime as a custom property named
    // `__rn-css-layer` that nothing reads.
    if (property === LAYER_MARKER_PROPERTY) {
      rule.s[Specificity.Layer] = this.resolveLayerPosition(value);
      return;
    }

    // Publish inherited properties to descendants as variables.
    //
    // `color`, `font-*`, `letter-spacing`, `text-align` and friends are
    // INHERITED properties in CSS, but React Native inherits none of them
    // across a <View> → <Text> boundary — only Text → Text, natively. So
    // `<View className="text-red-500"><Text>x</Text></View>` renders red on
    // web and React Native's default black on native.
    //
    // The delivery mechanism already exists and is already proven: three
    // properties publish themselves as variables today (`--__rn-css-color`
    // for currentcolor, `--__rn-css-em` for em units, `--__rn-css-direction`).
    // This generalises that same `rule.v` channel to every inherited property,
    // so descendants can resolve them through the VariableContext they already
    // consume. `useNativeCss` is the single reader.
    //
    // Publishing is inert until something reads it, and it keeps the cascade
    // correct for free: a nearer ancestor's publish already shadows a farther
    // one, because that is how VariableContext merges.
    //
    // A CSS-wide keyword publishes NOTHING, and that shadowing is exactly why.
    // `unset` computes to `inherit` on an inherited property (css-cascade-4
    // §7.3), so the value the descendant needs is the ancestor's — and an entry
    // holding the keyword would hide it. `resolveValue` maps `unset` to `null`,
    // which React Native reads as a transparent COLOUR rather than as an
    // absence, so `.g { color: red } .m { color: unset }` rendered a
    // descendant's text invisible where CSS renders it red. Publishing nothing
    // leaves the ancestor's entry in place, which is what the keyword asks for.
    const publishesVariable = !isRuntimeKeyword(value);

    if (this.mode !== "keyframes" && !property.startsWith("--")) {
      const inheritedName = resolveInheritedProperty(property);
      if (inheritedName && publishesVariable) {
        rule.v ??= [];
        rule.v.push([`${INHERIT_VARIABLE_PREFIX}${inheritedName}`, value]);
      }

      // Asked ONCE, of the property, for every value shape — see
      // `isAnimationProperty`. Asking the style function's name instead left a
      // rule whose only declaration was `transition-timing-function:
      // cubic-bezier(…)` unflagged: the component was never wrapped, so the
      // easing object built for reanimated stayed in `style` under a key React
      // Native does not know. A keyframe has no rule to flag, and a custom
      // property named `--animation-x` declares no animation.
      if (isAnimationProperty(property)) {
        rule.a ??= true;
      }
    }

    if (this.mode === "keyframes") {
      this.pushDescriptor(
        toRNProperty(property),
        value,
        this.animationDeclarations,
        forceTuple,
      );
    } else if (property.startsWith("--")) {
      if (!publishesVariable) {
        return;
      }

      rule.v ??= [];
      rule.v.push([property.slice(2), value]);
    } else if (containsStyleFunction(value)) {
      const [delayed, usesVariables] = postProcessStyleFunction(value);

      rule.d ??= [];

      if (usesVariables) {
        rule.dv = 1;
      }

      this.pushDescriptor(
        property,
        value,
        rule.d,
        forceTuple,
        delayed || usesVariables,
      );
    } else {
      rule.d ??= [];
      this.pushDescriptor(property, value, rule.d);
    }
  }

  /**
   * A layer's position among the layers of this stylesheet, by FIRST
   * APPEARANCE — `0` for the first layer met, `1` for the next, and so on.
   *
   * Document order in THIS pass is the CSS priority order: the pass reads what
   * the first pass serialised, and lightningcss emits layer blocks in declared
   * order (which is what `@layer b, a;` exists to set) with nested layers ahead
   * of the rules of the layer that contains them. So a later position is a
   * higher-priority layer.
   *
   * Positions, not final ranks: "how many layers are there" is only known once
   * the whole sheet is read, and the ranks have to end up NEGATIVE so that an
   * unlayered rule, which has no entry at all, outranks every layered one.
   * `normalizeLayerRanks` does that conversion at the output.
   */
  private resolveLayerPosition(id: StyleDescriptor): number {
    const positions = (this.shared.layerRanks ??= new Map<
      StyleDescriptor,
      number
    >());

    let position = positions.get(id);

    if (position === undefined) {
      position = positions.size;
      positions.set(id, position);
    }

    return position;
  }

  /**
   * Turn each rule's layer POSITION into its cascade RANK, now that the number
   * of layers is known: position `p` of `n` becomes `p - n`, so the lowest
   * layer is `-n` and the highest is `-1`, and an unlayered rule — which never
   * had an entry, and so reads `0` — outranks all of them (CSS Cascade 5
   * §6.4.4).
   *
   * Idempotent by construction: a position is `>= 0` and a rank is always `< 0`,
   * so a second call finds nothing left to convert. `getNativeStyleSheet` may
   * legitimately be called more than once on the same builder.
   */
  private normalizeLayerRanks() {
    const layerCount = this.shared.layerRanks?.size;

    if (!layerCount) {
      return;
    }

    for (const ruleSet of Object.values(this.shared.ruleSets)) {
      for (const rule of ruleSet) {
        const position = rule.s[Specificity.Layer];

        if (position !== undefined && position >= 0) {
          rule.s[Specificity.Layer] = position - layerCount;
        }
      }
    }
  }

  /**
   * Emit a shorthand's components, collapsed onto the shorthand key when they
   * all agree.
   *
   * For a parser whose values are already in hand. When producing a value has a
   * side effect that depends on the key it will land under — which is every
   * parser that can meet a `light-dark()` — use `addShorthandFromSource`
   * instead: the collapse decides that key, so it has to be settled first.
   */
  addShorthand(property: string, options: Record<string, StyleDescriptor>) {
    this.addShorthandFromSource(property, options, (value) => value);
  }

  /**
   * A shorthand whose components are parsed AFTER the collapse is decided, so
   * the parser is told the key its value will actually be written to.
   *
   * `parseColor` needs that key: a `light-dark()` writes its dark half to a
   * second rule, and the two halves only meet if both name the same key. A
   * collapse taken on the parsed values arrives too late — by then the dark
   * halves are already on the four longhands while the light ones move to the
   * shorthand, and nothing overwrites the light value in dark mode.
   *
   * Deciding on the SOURCE also settles a case the parsed values cannot
   * distinguish: `light-dark(#333, #eee)` and `light-dark(#333, #000)` both
   * parse to `#333`, so collapsing them is only correct if the dark halves
   * agree too, and only the source says whether they do.
   */
  addShorthandFromSource<TSource>(
    property: string,
    sources: Record<string, TSource>,
    parse: (source: TSource, property: string) => StyleDescriptor,
  ) {
    const entries = Object.entries(sources);
    const first = entries[0];

    if (first && allEqual(...entries.map(([, source]) => source))) {
      this.addDescriptor(property, parse(first[1], property));
    } else {
      for (const [name, source] of entries) {
        this.addDescriptor(name, parse(source, name));
      }
    }
  }

  private pushDescriptor(
    rawProperty: string,
    value: StyleDescriptor,
    declarations: StyleDeclaration[],
    forceTuple = false,
    delayed = false,
  ) {
    const property = toRNProperty(rawProperty);

    let propPath: string | string[] | undefined =
      this.mapping[rawProperty] ?? this.mapping[property] ?? this.mapping["*"];

    if (typeof property === "string" && property.includes(".")) {
      propPath = property.split(".");
    }

    if (Array.isArray(propPath)) {
      const [first, second] = propPath;

      if (propPath.length === 2 && first === "*" && second) {
        propPath = second;
      } else {
        forceTuple = true;
      }
    }

    propPath ??= property;

    if (forceTuple && !Array.isArray(propPath)) {
      propPath = [propPath];
    }

    if (isStyleFunction(value) || Array.isArray(propPath)) {
      if (delayed) {
        declarations.push([value, propPath, 1]);
      } else {
        declarations.push([value, propPath]);
      }
    } else if (Array.isArray(value) && value.some(isStyleFunction)) {
      declarations.push([value, propPath]);
    } else if (isRuntimeKeyword(value)) {
      declarations.push([value, propPath]);
    } else if (typeof propPath === "string") {
      let staticDeclarationRecord = staticDeclarations.get(declarations);
      if (!staticDeclarationRecord) {
        staticDeclarationRecord = {};
        staticDeclarations.set(declarations, staticDeclarationRecord);
        declarations.push(staticDeclarationRecord);
      }
      staticDeclarationRecord[propPath] = value;
    }
  }

  /**
   * Whether any declaration has landed on the rule being built.
   *
   * The same three channels `applyRuleToSelectors` checks before it commits a
   * rule: `d` for style declarations, `v` for published variables, `c` for
   * container names. `@supports` asks this question of a probe rule to decide
   * whether a declaration compiles at all (`./supports.ts`).
   */
  hasDeclarations(): boolean {
    return Boolean(this.rule.d ?? this.rule.v ?? this.rule.c);
  }

  applyRuleToSelectors(selectorList = this.selectors): void {
    if (!selectorList.length) {
      // If there are no selectors, we cannot apply the rule
      return;
    }

    if (!this.rule.d && !this.rule.v && !this.rule.c) {
      return;
    }

    const normalizedSelectors = getClassNameSelectors(
      selectorList,
      this.options,
    );

    /**
     * One authored rule reports a scoping drop once, however many selectors it
     * expands to and however many rules each of those receives — an extra rule
     * carries the same declarations as the rule it was opened on, so it is
     * scoped out of the same properties.
     */
    const warnedPseudoElements = new Set<PseudoElement>();

    /**
     * The rules a selector receives: the current rule, and every extra rule
     * opened on it already carrying the current rule's selector context. They
     * are applied identically from here — a step the current rule takes and an
     * extra rule skips is a step the selector never applied to it.
     */
    const extraRulesArray = extraRules.get(this.rule) ?? [];
    const sourceRules = [
      this.rule,
      ...extraRulesArray.map((extraRule) =>
        this.mergeExtraRule(this.rule, extraRule),
      ),
    ];

    for (const selector of normalizedSelectors) {
      if (selector.type !== "className") {
        // These can only have variable declarations
        if (!this.rule.v) {
          continue;
        }
        const { type } = selector;
        for (const [name, value] of this.rule.v) {
          this.shared[type] ??= {};
          this.shared[type][name] ??= [];
          const mediaQueries = this.rule.m;
          const variableValue: VariableValue = mediaQueries
            ? [value, [...mediaQueries]]
            : [value];
          // Append extra media queries if they exist
          this.shared[type][name].push(variableValue);

          if (type === "rootVariables" && name === "__rn-css-em") {
            const remName = "__rn-css-rem";
            this.shared[type][remName] ??= [];
            this.shared[type][remName].push(variableValue);
          }
        }

        continue;
      }

      const {
        specificity,
        className,
        mediaQuery,
        containerQuery,
        pseudoClassesQuery,
        attributeQuery,
      } = selector;

      if (!className) {
        continue; // No className, nothing to do
      }

      // The parent classes a container query names describe the selector, not
      // the rule, so they are registered once however many rules it receives.
      let parentContainersRegistered = false;

      for (const sourceRule of sourceRules) {
        // We are going to be apply the rule to n selectors, so we clone the rule
        let rule: StyleRule | undefined = this.cloneRule(sourceRule);

        if (selector.pseudoElementQuery) {
          const pseudoElement = getPseudoElement(selector.pseudoElementQuery);

          if (pseudoElement) {
            const scoped = scopeRuleToPseudoElement(rule, pseudoElement);

            // A supported property dropped for being in the wrong scope warns like an
            // unsupported one, keyed by the pseudo-element it was scoped out of.
            if (!warnedPseudoElements.has(pseudoElement)) {
              warnedPseudoElements.add(pseudoElement);

              for (const property of scoped.dropped) {
                this.addWarning("style", `::${pseudoElement}`, property);
              }
            }

            rule = scoped.rule;
          }
        }

        if (!rule) {
          continue;
        }

        // Combine the specificity of the selector with the rule's specificity
        for (let i = 0; i < specificity.length; i++) {
          const spec = specificity[i];
          if (!spec) continue;
          rule.s[i] = spec + (rule.s[i] ?? 0);
        }

        if (mediaQuery) {
          rule.m ??= [];
          rule.m.push(...mediaQuery);
        }

        if (containerQuery) {
          rule.cq ??= [];
          rule.cq.push(...containerQuery);

          if (!parentContainersRegistered) {
            parentContainersRegistered = true;

            for (const query of containerQuery) {
              const name = query.n;

              if (typeof name !== "string") {
                continue;
              }

              const [first, ...rest] = name.slice(2).split(".");

              if (typeof first !== "string") {
                continue;
              }

              const containerRule: StyleRule = {
                // These are not "real" rules, so they use the lowest specificity
                s: [0],
                c: [name],
              };

              if (rest.length) {
                // `~=` — Selectors 4 §6.1 makes a class selector a
                // whitespace-separated TOKEN match, the same test the selector
                // builder emits for a compound's extra classes. A substring test
                // matches a class that merely CONTAINS this one.
                containerRule.aq = rest.map((attr) => [
                  "a",
                  "className",
                  "~=",
                  attr,
                ]);
              }

              // Create rules for the parent classes
              this.addRuleToRuleSet(first, containerRule);
            }
          }
        }

        if (pseudoClassesQuery) {
          rule.p = { ...rule.p, ...pseudoClassesQuery };
        }

        if (attributeQuery) {
          rule.aq ??= [];
          rule.aq.push(...attributeQuery);
        }

        this.addRuleToRuleSet(className, rule);
      }
    }
  }

  addContainerQuery(query: ContainerQuery) {
    this.ruleTemplate.cq ??= [];
    this.ruleTemplate.cq.push(query);
  }

  addRootVariable(name: string, value: StyleDescriptor) {
    this.shared.rootVariables ??= {};
    this.shared.rootVariables[name] ??= [];
    this.shared.rootVariables[name].push([value]);
  }

  addNonInheritedVariable(name: string) {
    this.shared.nonInheritedVariables ??= new Set();
    this.shared.nonInheritedVariables.add(name);
  }

  /**
   * A registration carries exactly one initial value, so this assigns where
   * addRootVariable pushes — there is no list of candidates to pick from.
   */
  addRegisteredInitialValue(name: string, value: StyleDescriptor) {
    this.shared.registeredInitialValues ??= {};
    this.shared.registeredInitialValues[name] = [[value]];
  }

  newAnimationFrames(name: string) {
    this.shared.animations ??= {};

    this.animationFrames = this.shared.animations[name];
    if (!this.animationFrames) {
      this.animationFrames = [];
      this.shared.animations[name] = this.animationFrames;
    }
  }

  newAnimationFrame(progress: string) {
    if (!this.animationFrames) {
      throw new Error(
        "No animation frames defined. Call newAnimationFrames first.",
      );
    }

    this.animationDeclarations = [];
    this.animationFrames.push([progress, this.animationDeclarations]);
  }
}

function isStyleFunction(
  value: StyleDescriptor | StyleDescriptor[],
): value is StyleFunction {
  return Boolean(
    Array.isArray(value) &&
      value.length > 0 &&
      value[0] &&
      typeof value[0] === "object" &&
      Object.keys(value[0]).length === 0,
  );
}

function allEqual(...params: unknown[]) {
  return params.every((param, index, array) => {
    return index === 0 ? true : equal(array[0], param);
  });
}

function equal(a: unknown, b: unknown) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!equal(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    if (Object.keys(a).length !== Object.keys(b).length) return false;
    for (const key in a) {
      if (
        !equal(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        )
      )
        return false;
    }
    return true;
  }

  return false;
}
