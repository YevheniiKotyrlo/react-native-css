import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";

import { toRNProperty } from "../../compiler/selector-builder";
import { transformKeys } from "../../native/styles/defaults";
import * as functions from "../../native/styles/functions";
import * as shorthands from "../../native/styles/shorthands";

/**
 * The compiler and the runtime are two implementations of one decision, and
 * nothing has ever forced them to agree.
 *
 * A CSS declaration reaches React Native by two roads. When the compiler can
 * see the value it parses it — expanding a shorthand, renaming a property,
 * translating a keyword — and emits finished descriptors. When the value hides
 * behind a `var()` it cannot, so it defers, and a resolver in
 * `src/native/styles/` has to do the same job at render time from the same
 * inputs.
 *
 * Every defect this suite has caught has been those two roads disagreeing:
 *
 * - a property whose parser EXPANDS but that was never registered as deferred,
 *   so the runtime shipped the raw token list under the shorthand key
 *   (`{margin: [1,2,3,4]}`, and forty others);
 * - a property registered as deferred with NO resolver, which `resolveValue`
 *   drops with a warning nobody reads;
 * - a resolver nothing routes to, which is dead code that reads as coverage.
 *
 * The route-equivalence census catches the first class by RENDERING every
 * property five ways — but only for a property somebody wrote a case for, and
 * only after the defect exists. This file is the static half: it reads both
 * registries out of the source and fails when they stop lining up, before
 * anything renders.
 *
 * Neither registry is transcribed here. `unparsedRuntimeParsing` and
 * `unparsedNoRuntimeForm` are read from `src/compiler/declarations.ts` with
 * TypeScript's own parser, and the resolver names are read by IMPORTING the
 * runtime registry — so a list written down in this file could not drift,
 * because there is no list.
 */

/**
 * A CSS property name as `toRNProperty` types its input.
 *
 * CSS property names are already lowercase, so this narrows rather than
 * converts — the generic is constrained to `Lowercase<string>` and a `string`
 * read out of the AST carries no such evidence.
 */
function lowercase(property: string): Lowercase<string> {
  return property.toLowerCase() as Lowercase<string>;
}

/** Every name in a `const <name> = new Set([...])` in the compiler's source. */
function readStringSet(setName: string): Set<string> {
  const source = ts.createSourceFile(
    "declarations.ts",
    readFileSync(
      join(__dirname, "..", "..", "compiler", "declarations.ts"),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
  );

  const members = new Set<string>();
  let found = false;

  const walk = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === setName &&
      node.initializer &&
      ts.isNewExpression(node.initializer)
    ) {
      found = true;

      const [literal] = node.initializer.arguments ?? [];

      if (literal && ts.isArrayLiteralExpression(literal)) {
        for (const element of literal.elements) {
          if (ts.isStringLiteral(element)) {
            members.add(element.text);
          }
        }
      }
    }

    ts.forEachChild(node, walk);
  };

  walk(source);

  // A renamed or deleted registry would otherwise read as an empty one, and an
  // empty registry passes every assertion below while asserting nothing.
  expect(found).toBe(true);

  return members;
}

/**
 * The resolver names named directly by an `addKeywordDescriptor` call.
 *
 * The THIRD way a property reaches a runtime resolver, and the one that is
 * invisible from either registry. `unparsedRuntimeParsing` derives the resolver
 * from the property (`toRNProperty`); a CSS function is dispatched on its own
 * name inside a value; and a KEYWORD property names its resolver explicitly,
 * because the two often differ — `corner-shape` resolves through `cornerShape`
 * and lands on `borderCurve`, renaming both the property and the value.
 *
 * Read from the call sites rather than listed, for the same reason as
 * everything else here.
 */
function readEmittedFunctionNames(): Set<string> {
  const source = ts.createSourceFile(
    "declarations.ts",
    readFileSync(
      join(__dirname, "..", "..", "compiler", "declarations.ts"),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
  );

  const names = new Set<string>();

  // A style function is written `[{}, "name", args?, 1?]` — an array whose
  // first element is an empty object literal and whose second is the resolver's
  // name. That shape IS the emit, so reading it finds every resolver the
  // compiler names, whichever branch names it.
  const walk = (node: ts.Node): void => {
    if (ts.isArrayLiteralExpression(node)) {
      const [first, second] = node.elements;

      if (
        first &&
        ts.isObjectLiteralExpression(first) &&
        first.properties.length === 0 &&
        second &&
        ts.isStringLiteral(second)
      ) {
        names.add(second.text);
      }
    }

    ts.forEachChild(node, walk);
  };

  walk(source);

  return names;
}

function readKeywordResolverNames(): Set<string> {
  const source = ts.createSourceFile(
    "declarations.ts",
    readFileSync(
      join(__dirname, "..", "..", "compiler", "declarations.ts"),
      "utf8",
    ),
    ts.ScriptTarget.Latest,
    true,
  );

  const names = new Set<string>();

  const walk = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "resolver" &&
      ts.isStringLiteral(node.initializer)
    ) {
      names.add(node.initializer.text);
    }

    ts.forEachChild(node, walk);
  };

  walk(source);

  return names;
}

/**
 * The names `resolveValue` can dispatch to.
 *
 * Read by importing the same modules `resolve.ts` spreads into
 * `functionResolvers`, rather than by parsing it: a resolver added through a
 * barrel export is reachable the moment it exists, and a name list would have
 * to be updated by hand — which is the failure mode this file exists to catch.
 */
/**
 * The names of a barrel's exports that are RESOLVERS, which is not every export.
 *
 * A resolver is a function — `resolveValue` calls what it looks up — so the type
 * test is exact rather than a list of things to skip. A module may also export
 * data its own resolvers are built from (the gradient family census), and that
 * is not a resolver: nothing routes to it by name, and a registry entry for it
 * would be the drift this file exists to catch, pointed the wrong way.
 */
function readCallableExportNames(barrel: Record<string, unknown>): string[] {
  return Object.entries(barrel)
    .filter(([, value]) => typeof value === "function")
    .map(([name]) => name);
}

function readResolverNames(): Set<string> {
  return new Set([
    ...readCallableExportNames(shorthands),
    ...readCallableExportNames(functions),
    // The four unit resolvers and the three named ones `resolve.ts` adds
    // individually. They are properties of no barrel, so they are the one
    // thing here that IS written down — and each is a unit or a single
    // property rather than a registry, so there is nothing for them to
    // drift against.
    "fontSize",
    "lineHeight",
    "transformOrigin",
    "em",
    "rem",
    "vh",
    "vw",
  ]);
}

describe("the compiler's deferred registry and the runtime's resolvers", () => {
  const deferred = readStringSet("unparsedRuntimeParsing");
  const noRuntimeForm = readStringSet("unparsedNoRuntimeForm");
  const keywordResolvers = readKeywordResolverNames();
  const emittedFunctions = readEmittedFunctionNames();
  const resolvers = readResolverNames();

  test("every keyword property names a resolver that exists", () => {
    // `addKeywordDescriptor` writes the resolver's name into the descriptor, so
    // a typo compiles cleanly and produces a declaration `resolveValue` warns
    // about and drops at render time.
    const missing = [...keywordResolvers]
      .filter((name) => !resolvers.has(name))
      .sort();

    expect(missing).toStrictEqual([]);
  });

  test("every deferred property has a resolver of its React Native name", () => {
    // `resolveValue` looks the resolver up by `toRNProperty(property)`. A name
    // with no match is warned about and DROPPED — so the declaration compiles,
    // registers as deferred, and then produces nothing at render time. That is
    // the shape `filter` had: in `parsers`, expanding, and unreachable.
    const missing = [...deferred]
      .filter((property) => !resolvers.has(toRNProperty(lowercase(property))))
      .sort();

    expect(missing).toStrictEqual([]);
  });

  test("no property is registered as both deferred and having no runtime form", () => {
    // The two registries are answers to the same question. A property in both
    // takes whichever branch is tested first, which is a coin toss written as
    // code.
    const both = [...deferred].filter((property) =>
      noRuntimeForm.has(property),
    );

    expect(both.sort()).toStrictEqual([]);
  });

  test("every resolver is reachable from the deferred registry", () => {
    // The other direction. A resolver nothing routes to is dead code that
    // reads as coverage — the next person to look for "is this handled at
    // runtime?" finds a function and stops.
    //
    // The exemptions are the resolvers reached by a route OTHER than a
    // property name: CSS FUNCTIONS the compiler emits inside a value
    // (`calc`, `rgb`, `translateX`, `platformSelect`, …), and the units.
    // `resolveValue` dispatches those on the function's own name, which is not
    // a property and never appears in either registry.
    const reachedByPropertyName = new Set<string>(
      [...deferred].map((property) => toRNProperty(lowercase(property))),
    );

    const unreachable = [...resolvers]
      .filter((name) => !reachedByPropertyName.has(name))
      .filter((name) => !keywordResolvers.has(name))
      .filter((name) => !emittedFunctions.has(name))
      .filter((name) => !INDIRECTLY_EMITTED_RESOLVERS.has(name))
      .sort();

    expect(unreachable).toStrictEqual([]);
  });

  test("every resolver the compiler names actually exists", () => {
    // The mirror of the test above, and the one that catches a typo: the
    // compiler names a resolver in a descriptor, `resolveValue` finds nothing
    // under that name, warns, and drops the declaration. A compile-clean way to
    // produce no style at all.
    const named = new Set([...keywordResolvers, ...emittedFunctions]);

    const missing = [...named]
      .filter((name) => !resolvers.has(name))
      // `resolveValue`'s FIFTH dispatch route: a name in `transformKeys` is
      // wrapped generically as `{ [name]: value }` rather than resolved, which
      // is what React Native's transform array holds. `rotateX` and its
      // siblings are handled there and correctly have no resolver of their own.
      .filter((name) => !transformKeys.has(name))
      .filter((name) => !DISPATCHED_BEFORE_THE_REGISTRY.has(name))
      .filter((name) => !NOT_A_RESOLVER.has(name))
      .sort();

    expect(missing).toStrictEqual([]);
  });
});

/**
 * Resolvers the compiler names through a COMPUTED expression rather than a
 * string literal, so the AST scan above cannot see them.
 *
 * Each is emitted as `toRNProperty(<something>)`, which camelCases a CSS name
 * read from lightningcss's parsed value — the filter functions come out of
 * `parseFilter`'s switch over the filter TYPE, and the transform functions out
 * of `parseTransform`'s. There is no literal to find, so these are the one
 * thing here that is written down.
 */
const INDIRECTLY_EMITTED_RESOLVERS = new Set([
  // `unparsedFunction`, which names the resolver `toRNProperty(<the CSS
  // function the author wrote>)`. Every CSS function reachable through a
  // deferred value arrives this way, so none of them is a literal in the
  // compiler's source.
  "calc",
  "min",
  "max",
  "clamp",
  "rgb",
  "hsl",
  "hsla",
  "cubicBezier",
  "steps",
  "hairlineWidth",
  "pixelScale",
  "fontScale",
  // `parseFilter`, keyed off lightningcss's filter type.
  "blur",
  "brightness",
  "contrast",
  "dropShadow",
  "grayscale",
  "hueRotate",
  "invert",
  "opacity",
  "saturate",
  "sepia",
  // `parseTransform`, keyed off lightningcss's transform type.
  "translateX",
  "translateY",
  "translate3d",
  "scaleX",
  "scaleY",
  "scale3d",
  "rotateX",
  "rotateY",
  "rotateZ",
  "rotate3d",
  "skewX",
  "skewY",
  "skew",
  "perspective",
  "matrix",
  "matrix3d",
  // The `animation` branch of `parseUnparsedDeclaration`, which names the
  // shorthand resolver rather than deriving it from the property.
  "animationShorthand",
  // React Native's own pixel helpers and the platform selectors, reached from
  // `parseUnparsed`'s function switch by the CSS spelling.
  "getPixelSizeForLayoutSize",
  "roundToNearestPixel",
  "platformSelect",
  "pixelScaleSelect",
  "fontScaleSelect",
]);

/**
 * `resolveValue`'s FIRST dispatch route, taken before the registry is consulted
 * at all.
 *
 * `var` is not in `functionResolvers` because it needs the whole options bag —
 * the inline variables, the inherited context, the render guards and the cycle
 * history — which a `StyleFunctionResolver` does not receive. So it is checked
 * by name and handed to `varResolver` directly.
 */
const DISPATCHED_BEFORE_THE_REGISTRY = new Set(["var"]);

/**
 * Names that appear in the style-function position but are not resolvers.
 *
 * `@colorStop` was one until gradients stopped using it. Anything here is a
 * marker the runtime reads structurally rather than dispatching on, and the set
 * being EMPTY is the healthy state — a marker that nothing dispatches is a
 * value React Native was never going to understand.
 */
const NOT_A_RESOLVER = new Set<string>([]);
