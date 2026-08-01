import { processColor } from "react-native";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react-native";
import { VariableContextProvider } from "react-native-css";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";
import ts from "typescript";

/**
 * The route-equivalence harness: one declaration, rendered every way a value
 * can reach React Native, so the ways can be compared against each other.
 *
 * A declaration's value takes one of a handful of paths through this library,
 * and each path is a different amount of work done at compile time. They are
 * supposed to be indistinguishable at the far end — the same CSS renders the
 * same thing however the value was spelled — and every divergence found so far
 * has been a defect on exactly one of them, invisible from the others.
 *
 * "The same thing" is BOTH halves of what React Native receives: the `style`
 * object and every other prop. A mapped property delivers its value to a prop
 * rather than to `style`, so a comparison of `style` alone is blind to it by
 * construction — every route can agree on a style that is correct while a prop
 * beside it carries an unresolved placeholder.
 *
 * The routes, in order of how much the compiler knows:
 *
 * | route | how the value arrives | resolved |
 * | --- | --- | --- |
 * | `literal` | written out in the declaration | compile time |
 * | `inlinable` | a custom property with ONE definition in a universal scope | compile time, after folding |
 * | `fallback` | `var(--never-declared, <value>)` | runtime, from the fallback |
 * | `deferred` | a custom property with TWO definitions | runtime |
 * | `provider` | `VariableContextProvider` supplies it | runtime, from outside the stylesheet |
 *
 * `inlinable` is folded into the reference and is therefore a literal by the
 * time it compiles — it is kept as its own route because whether a fold happens
 * is a compiler decision that has changed, and a property can pass as a literal
 * while failing the moment the fold stops applying.
 *
 * The last three are the ones that carry defects, because they are the ones
 * where the compiler cannot see the value: a parser that validates a keyword,
 * expands a shorthand or renames a property has nothing to work with, and the
 * declaration is dropped or shipped raw unless the runtime does the same job.
 */

export type RouteName =
  | "literal"
  | "inlinable"
  | "fallback"
  | "deferred"
  | "provider";

export const ROUTE_NAMES: readonly RouteName[] = [
  "literal",
  "inlinable",
  "fallback",
  "deferred",
  "provider",
];

/** A rendered style, as React Native receives it. */
export type RenderedStyle = Record<string, unknown> | undefined;

/**
 * Everything a declaration delivered that is NOT a style, as React Native
 * receives it.
 *
 * A CSS property does not always land in `style`. A mapping sends it to a PROP
 * instead — `object-fit` to expo-image's `contentFit`, `-webkit-line-clamp` to
 * Text's `numberOfLines`, `-rn-ripple-color` to `android_ripple.color` — and a
 * prop is a separate delivery path with its own resolution step. Comparing only
 * `style` therefore cannot see a whole class of route divergence — the shape it
 * is blind to is `object-fit` delivering the correct `style.objectFit` on all
 * five routes while three of them deliver `contentFit: {contentFit: true}`, an
 * unresolved placeholder object, where expo-image wants a string.
 *
 * The two halves are kept apart rather than compared as one object because a
 * style is compared whole — a missing key is a real difference — while props are
 * compared key by key, which is what lets a failure name the prop.
 */
export type RenderedProps = Record<string, unknown>;

/** One route's render, as both halves reach React Native. */
export interface RenderedRoute {
  readonly style: RenderedStyle;
  readonly props: RenderedProps;
}

export type RouteRenders = Record<RouteName, RenderedRoute>;

/**
 * Props the harness itself sets, or that carry the element's contents rather
 * than a declaration's value. Neither says anything about the declaration under
 * test, and `children` is a React element whose serialisation is unbounded.
 */
const HARNESS_PROPS: ReadonlySet<string> = new Set(["children", "testID"]);

/**
 * Which component the declaration is rendered on.
 *
 * A `TextStyle` key has to be rendered on a `<Text>` to reach `props.style`
 * unchanged, and a `ViewStyle` key on a `<View>`; the two are separate React
 * Native surfaces and a case has to name the one its property belongs to.
 */
export type RouteSurface = "view" | "text";

export interface RouteCase {
  /** The CSS property, spelled as CSS spells it. */
  readonly property: string;
  /** A value the property accepts, written as an author would write it. */
  readonly value: string;
  /**
   * A DIFFERENT value the property also accepts.
   *
   * Its only job is to give the deferred route's custom property a second
   * definition, which is what stops the compiler folding it. It is never
   * rendered — the media query that declares it does not match under the
   * default colour scheme — so it only has to be valid and different.
   */
  readonly alternate: string;
  /** The component the property's style key belongs to. */
  readonly surface?: RouteSurface;
  /**
   * Why this case's routes are allowed to disagree, when they are.
   *
   * A case with no note must produce an identical style on every route. A note
   * is a claim that the difference is understood and correct — a `GAP` that
   * React Native cannot express, or a spelling difference that renders the
   * same — and it has to say which.
   */
  readonly divergenceNote?: string;
}

/**
 * A stylesheet exercising every route for one declaration.
 *
 * The custom properties are named per route so one stylesheet can carry them
 * all without a name collision deciding the answer.
 */
export function routeStylesheet({ property, value, alternate }: RouteCase) {
  return `
    .route-literal { ${property}: ${value}; }

    :root { --route-inlinable: ${value}; }
    .route-inlinable { ${property}: var(--route-inlinable); }

    .route-fallback { ${property}: var(--route-never-declared, ${value}); }

    :root { --route-deferred: ${value}; }
    @media (prefers-color-scheme: dark) {
      :root { --route-deferred: ${alternate}; }
    }
    .route-deferred { ${property}: var(--route-deferred); }

    .route-provider { ${property}: var(--route-provided); }
  `;
}

/** Split a rendered element's props into the style and everything else. */
function splitRender(rendered: Record<string, unknown>): RenderedRoute {
  const props: RenderedProps = {};

  for (const [key, value] of Object.entries(rendered)) {
    if (key !== "style" && !HARNESS_PROPS.has(key)) {
      props[key] = value;
    }
  }

  return { style: rendered.style as RenderedStyle, props };
}

/**
 * Renders one declaration on every route and hands back the five renders.
 *
 * The provider route reads the SAME value through
 * `VariableContextProvider`, which is how a value reaches a declaration from
 * outside the stylesheet entirely — the runtime's own variable channel, with no
 * compiler involvement at all.
 */
export function renderRoutes(routeCase: RouteCase): RouteRenders {
  const onText = routeCase.surface === "text";

  registerCSS(routeStylesheet(routeCase));

  // Branched at each render rather than through a `Component` variable: `Text`
  // and `View` are different component types, and a variable holding either has
  // a union type JSX cannot call.
  const renderOf = (className: string): RenderedRoute => {
    const view = onText ? (
      <Text testID={testID} className={className} />
    ) : (
      <View testID={testID} className={className} />
    );

    return splitRender(
      render(view).getByTestId(testID).props as Record<string, unknown>,
    );
  };

  const provided = (
    <VariableContextProvider value={{ "--route-provided": routeCase.value }}>
      {onText ? (
        <Text testID={testID} className="route-provider" />
      ) : (
        <View testID={testID} className="route-provider" />
      )}
    </VariableContextProvider>
  );

  const provider = splitRender(
    render(provided).getByTestId(testID).props as Record<string, unknown>,
  );

  return {
    literal: renderOf("route-literal"),
    inlinable: renderOf("route-inlinable"),
    fallback: renderOf("route-fallback"),
    deferred: renderOf("route-deferred"),
    provider,
  };
}

/**
 * Two styles compared by what React Native RENDERS, not by the string that
 * reached it.
 *
 * The compile-time routes hand colours to lightningcss, which normalises them —
 * `red` becomes `#f00`. The runtime routes cannot: a custom property's value is
 * an uninterpreted token stream, so `red` arrives spelled the way it was
 * written. Those are the same colour, and React Native says so; treating them
 * as a divergence would put a note on twenty properties that render correctly
 * and bury the ones that do not.
 *
 * `processColor` is the authority because it is the code React Native actually
 * runs. Only STRINGS are offered to it, and only a string it parses is replaced
 * — a number is already a colour to `processColor` and would be "normalised"
 * into itself, and every non-colour string comes back unparsed and untouched.
 *
 * Object keys are SORTED, for the same reason. A style is read by key, so the
 * order the four `border-*-width` longhands were written in is not something
 * React Native can observe — but the comparison below is a string comparison,
 * and the compiler emits them top/bottom/left/right where the runtime emits
 * top/right/bottom/left. Without the sort those two identical styles compare
 * unequal, and jest's own diff hides why, because pretty-format sorts keys when
 * it prints: the failure shows two objects that look the same.
 *
 * ARRAYS are deliberately not sorted. Order is meaningful in every array React
 * Native reads — a transform list applies in sequence, and a shadow list layers
 * in sequence — so a difference there is a real one.
 *
 * FUNCTIONS become a marker. The comparison below serialises with
 * `JSON.stringify`, which omits a function-valued key entirely — so a route that
 * delivers an `onLayout` and a route that delivers nothing would serialise
 * identically. Styles hold no functions; props do.
 */
function canonicalize(value: unknown): unknown {
  if (typeof value === "function") {
    return "<function>";
  }

  if (typeof value === "string") {
    const asColor: unknown = processColor(value);

    return typeof asColor === "number" ? `<color ${asColor}>` : value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key, canonicalize(entry)] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    );
  }

  return value;
}

/**
 * One way a route's render differs from the literal route's.
 *
 * A discriminated union rather than one wide shape, because the two halves are
 * found differently and a reader needs to know which they are looking at: a
 * `style` entry reports the whole style object, since a missing key is itself
 * the difference, while a `prop` entry names the single prop that disagreed —
 * `props` carry the component's own rendering as well as the declaration's
 * value, and a whole-object diff there buries the one key that matters.
 */
export type RouteDivergence =
  | {
      readonly kind: "style";
      readonly route: RouteName;
      readonly literal: RenderedStyle;
      readonly actual: RenderedStyle;
    }
  | {
      readonly kind: "prop";
      readonly route: RouteName;
      readonly prop: string;
      readonly literal: unknown;
      readonly actual: unknown;
    };

/** Whether two rendered values are the same value to React Native. */
function differs(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(canonicalize(left)) !== JSON.stringify(canonicalize(right))
  );
}

/**
 * Everything a route rendered differently from the literal route, with what each
 * produced — the shape a report needs to be actionable.
 *
 * The literal route is the reference because it is the one the compiler knows
 * most about, and the one every existing test was written against.
 *
 * Props are walked over the UNION of both routes' keys, so a prop delivered by
 * one route and not the other is a divergence rather than a key nobody looked
 * at. A key whose value is `undefined` matches an absent key: React Native reads
 * those the same, and the harness must not report a difference the framework
 * cannot see.
 */
export function routeDivergences(renders: RouteRenders): RouteDivergence[] {
  const reference = renders.literal;
  const divergences: RouteDivergence[] = [];

  for (const route of ROUTE_NAMES) {
    if (route === "literal") {
      continue;
    }

    const actual = renders[route];

    if (differs(reference.style, actual.style)) {
      divergences.push({
        kind: "style",
        route,
        literal: reference.style,
        actual: actual.style,
      });
    }

    const props = [
      ...new Set([
        ...Object.keys(reference.props),
        ...Object.keys(actual.props),
      ]),
    ].sort();

    for (const prop of props) {
      if (differs(reference.props[prop], actual.props[prop])) {
        divergences.push({
          kind: "prop",
          route,
          prop,
          literal: reference.props[prop],
          actual: actual.props[prop],
        });
      }
    }
  }

  return divergences;
}

/**
 * Every property this compiler claims to handle, read out of the compiler's own
 * source rather than transcribed.
 *
 * Two censuses live in `src/compiler/declarations.ts` and both are needed:
 * `parsers`, keyed by the properties lightningcss models, and the chain of
 * `property === "…"` branches in `parseCustomDeclaration` that handles the ones
 * it does not. A list written down here instead would be a second copy, and it
 * would drift the first time a property is added — which is the failure this
 * whole file exists to catch, so it cannot be the way the file works.
 *
 * Read with TypeScript's own parser rather than a regular expression: the
 * `parsers` table is a nested object literal with quoted and unquoted keys, and
 * a regex over it answers confidently and wrongly.
 */
export function readPropertyCensus(): Set<string> {
  const source = ts.createSourceFile(
    "declarations.ts",
    readFileSync(
      join(__dirname, "..", "..", "..", "compiler", "declarations.ts"),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
  );

  const census = new Set<string>();

  const readParsersTable = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "parsers" &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const member of node.initializer.properties) {
        if (!ts.isPropertyAssignment(member)) {
          continue;
        }

        if (ts.isStringLiteral(member.name)) {
          census.add(member.name.text);
        } else if (ts.isIdentifier(member.name)) {
          census.add(member.name.text);
        }
      }
    }
  };

  // `property === "x"` inside `parseCustomDeclaration`. Collected from the whole
  // file rather than from that function alone, because the same comparison is
  // the only shape any of these branches take and a helper split out of it
  // would otherwise drop off the census silently.
  const readCustomBranches = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isIdentifier(node.left) &&
      node.left.text === "property" &&
      ts.isStringLiteral(node.right)
    ) {
      census.add(node.right.text);
    }
  };

  const walk = (node: ts.Node): void => {
    readParsersTable(node);
    readCustomBranches(node);
    ts.forEachChild(node, walk);
  };

  walk(source);

  return census;
}
