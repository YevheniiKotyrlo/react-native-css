/* eslint-disable */

import type {
  InlineVariable,
  StyleDescriptor,
  StyleFunction,
} from "react-native-css/compiler";

import { INHERITED_VAR_FUNCTION } from "react-native-css/utilities";

import type { RenderGuard } from "../conditions/guards";
import { type Getter, type VariableContextValue } from "../reactivity";
import type { calculateProps } from "./calculate-props";
import { transformKeys } from "./defaults";
import { PIXEL_LENGTH } from "./dimension";
import { fontSize } from "./font-size";
import * as functions from "./functions";
import { lineHeight } from "./line-height";
import { normalizeScaleValue, scaleTransformKeys } from "./scale-value";
import * as shorthands from "./shorthands";
import { transformOrigin } from "./transform-origin";
import { em, rem, vh, vw } from "./units";
import {
  inheritedScopeOptions,
  varResolver,
  type ResolvedVariable,
} from "./variables";

export type SimpleResolveValue = (
  value: StyleDescriptor,
  castToArray?: boolean,
) => unknown;

export type StyleFunctionResolver = (
  resolveValue: SimpleResolveValue,
  value: StyleFunction,
  get: Getter,
  options: ResolveValueOptions,
) => unknown;

export type StyleResolver = (
  resolveValue: SimpleResolveValue,
  value: StyleDescriptor,
  get: Getter,
  options: ResolveValueOptions,
) => unknown;

const functionResolvers = {
  ...shorthands,
  ...functions,
  fontSize,
  lineHeight,
  transformOrigin,
  em,
  rem,
  vh,
  vw,
};

export type ResolveValueOptions = {
  castToArray?: boolean;
  inheritedVariables?: VariableContextValue;
  inlineVariables?: InlineVariable | undefined;
  renderGuards?: RenderGuard[];
  variableHistory?: Set<string>;
  /**
   * A `var()` memo for one element's pass — what each name resolved TO and the
   * declaration that answered, kept apart from `inlineVariables`, which holds
   * what each name IS.
   */
  resolvedVariables?: Record<string, ResolvedVariable>;
  /**
   * These same options with the element's own declarations removed — the scope
   * an inherited value was computed in. Built on first use and cached, by
   * `inheritedScopeOptions`.
   */
  inheritedScope?: ResolveValueOptions;
  /** Pass down to perform recursive calculations and avoid circular dependencies */
  calculateProps?: typeof calculateProps;
};

export function resolveValue(
  value: StyleDescriptor,
  get: Getter,
  options: ResolveValueOptions,
): any {
  const { castToArray } = options;

  // The same hole the array filter below names, one level up. An argument the
  // compiler left out is `undefined` in memory and `null` once the stylesheet
  // has been through `JSON.stringify` on its way into a bundle — so a resolver
  // reading a positional slot saw a different value in production than in every
  // test, and `conic-gradient(red, blue)`, whose omitted prelude IS that slot,
  // rendered nothing on a device while the suite was green. `null` reaching a
  // media feature OPERAND means something else and is read before this, by the
  // condition evaluators, which never call through here.
  if (value === null) {
    return;
  }

  switch (typeof value) {
    case "bigint":
    case "symbol":
    case "undefined":
    case "function":
      // These types are not supported
      return;
    case "number":
    case "boolean":
      return value;
    case "string": {
      if (value === "unset") {
        return null;
      }

      // An inlined `var()` can arrive with a px suffix, so a string that IS a
      // pixel length becomes its number. The test is the WHOLE string, not just
      // its ending: `endsWith("px")` also matched any longer value that happens
      // to finish with a length — `radial-gradient`'s
      // `"ellipse farthest-corner at 0px 0px"` came back as `NaN`.
      const pixels = PIXEL_LENGTH.exec(value);

      return pixels ? Number.parseFloat(value) : value;
    }
    case "object": {
      if (!Array.isArray(value)) {
        return value;
      }

      if (isDescriptorArray(value)) {
        value = value
          .map((d) => resolveValue(d, get, options))
          // `null` as well as `undefined`, because the two are the SAME HOLE
          // wearing different clothes depending on how the stylesheet travelled.
          // In-memory (jest, the babel transform) an argument the compiler left
          // out is `undefined`; through Metro the stylesheet is serialised with
          // `JSON.stringify` (`metro/injection-code.ts`), which writes every
          // array hole as `null`. Filtering only `undefined` meant a positional
          // resolver such as `colorMix` saw a different argument list in
          // production than in every test.
          .filter((d) => d !== undefined && d !== null);

        if (castToArray && !Array.isArray(value)) {
          return [value];
        } else {
          return value;
        }
      }

      const name = value[1];

      const simpleResolve: SimpleResolveValue = (value) => {
        return resolveValue(value, get, options);
      };

      if (name === "var") {
        return varResolver(simpleResolve, value, get, options);
      } else if (name === INHERITED_VAR_FUNCTION) {
        // The same lookup, run against the scope the value was inherited from
        // rather than this element's. Both the name and everything the
        // descriptor it finds refers to resolve there — see
        // `inheritedScopeOptions`.
        const scoped = inheritedScopeOptions(options);

        return varResolver(
          (value) => resolveValue(value, get, scoped),
          value,
          get,
          scoped,
        );
      } else if (name in functionResolvers) {
        const fn = functionResolvers[name as keyof typeof functionResolvers];

        if (typeof fn !== "function") {
          throw new Error(`Unknown function: ${name}`);
        }

        value = fn(
          simpleResolve,
          value as StyleFunction,
          get,
          options,
        ) as StyleDescriptor;
      } else if (transformKeys.has(name)) {
        // translate, rotate, scale, etc.
        // scaleX/scaleY arrive here rather than through a resolver function, so
        // this is the second boundary a percentage can escape from — React
        // Native rejects a non-numeric scale component by crashing the screen.
        const resolved = simpleResolve(value[2], castToArray);

        return {
          [name]: scaleTransformKeys.has(name)
            ? normalizeScaleValue(resolved)
            : resolved,
        };
      } else {
        // A name the compiler emitted that nothing here resolves. It is dropped
        // with a warning, and there is no generic stringifier to fall back to.
        //
        // This is the standing drift hazard in the library: the emit side is a
        // hand-written `case` list in `compiler/declarations.ts` and the resolve
        // side is `functionResolvers` above, and nothing checks them against
        // each other. Writing an unknown name back out as `name(args)` hid every
        // instance of that drift behind a value that looks like CSS and renders
        // as nothing — `width: pixelScale(2)` became the literal
        // `"pixelScale(2)"`, and `transform: matrix3d(…)` a raw string inside
        // the transform array.
        //
        // Joining arguments with `", "` is also a guess about a grammar, and it
        // is the wrong guess for most of the functions that reached it. `rgb()`
        // takes its channels space-separated with a `/` before the alpha, so a
        // variable supplying `255 0 0` produced `rgba(255 0 0, 0.5)`, a hybrid
        // React Native answers `null` to; a gradient's first argument is a
        // prelude of space-separated tokens, and the stop list after it may
        // arrive from one `var()` with its commas already collapsed away. Both
        // families have resolvers that know their own grammar —
        // `./functions/color-functions.ts` and `./functions/gradient-functions.ts`.
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `react-native-css: no runtime resolver for \`${name}()\`. The declaration was dropped.`,
          );
        }
        return;
      }

      return castToArray && value && !Array.isArray(value) ? [value] : value;
    }
  }
}

function isDescriptorArray(
  value: StyleDescriptor | StyleDescriptor[],
): value is StyleDescriptor[] {
  // `null` is excluded explicitly because `typeof null` is `"object"`, and the
  // object in slot 0 is what tells a style function from a list of arguments.
  // An argument the compiler left out is `null` once the stylesheet has been
  // through `JSON.stringify` on its way into a bundle, so a list whose FIRST
  // argument is omitted — `conic-gradient(red, blue)`, whose prelude is that
  // slot — read as a style function named `#f00` and resolved to nothing on a
  // device, while every test injected the compiler's object and saw a list.
  return Array.isArray(value) &&
    value[0] !== null &&
    typeof value[0] === "object"
    ? Array.isArray(value[0])
    : true;
}
