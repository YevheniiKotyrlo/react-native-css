import type { AttributeQuery } from "react-native-css/compiler";

import type { RenderGuard } from "./guards";

export function testAttributes(
  queries: AttributeQuery[],
  props: Record<string, unknown> | undefined | null,
  guards: RenderGuard[],
) {
  return queries.every((query) => testAttribute(query, props, guards));
}

function testAttribute(
  query: AttributeQuery,
  props: Record<string, unknown> | undefined | null,
  guards: RenderGuard[],
): boolean {
  // `:not()`, and the conjunction its compound arguments compile to. The inner
  // query is still EVALUATED, so the prop it reads registers a render guard
  // whichever way the negation lands.
  if (query[0] === "!") {
    return !testAttribute(query[1], props, guards);
  }

  if (query[0] === "&") {
    return testAttributes(query[1], props, guards);
  }

  const [type, prop, operator, testValue, caseSensitivity] = query;

  let value: unknown = undefined;

  if (props) {
    if (type === "a") {
      value = props[prop];
    } else {
      const dataSet = props.dataSet as Record<string, unknown> | undefined;
      value = dataSet?.[prop];
    }
  }

  guards.push([type, prop, value]);

  if (!operator) {
    return value !== undefined && value !== null && value !== false;
  }

  if (operator === "!") {
    return !value;
  }

  /**
   * Selectors L4 §6.3 — `[attr="value" i]` compares ASCII case-insensitively.
   * Both sides are folded, never just one. The other flag, `s`, asks for the
   * default and so never reaches here.
   */
  const insensitive = caseSensitivity === "i";

  if (operator === "=") {
    // The case-sensitive path keeps its loose comparison, so a non-string prop
    // still answers (`dataSet: { count: 1 }` matches `[data-count="1"]`). The
    // folded path is a string on both sides before it compares.
    return insensitive
      ? value?.toString().toLowerCase() === testValue?.toLowerCase()
      : value == testValue;
  }

  if (!testValue) {
    return false;
  }

  const actual = insensitive
    ? value?.toString().toLowerCase()
    : value?.toString();
  const expected = insensitive ? testValue.toLowerCase() : testValue;

  switch (operator) {
    case "~=":
      // §6.2 includes-match: the value is a whitespace-separated LIST and one
      // of its items is `expected`. Any whitespace, not a literal space —
      // `className` is written by hand and a multi-line template literal is an
      // ordinary way to write one, so `"\n  a\n  b\n"` has to yield `a` and
      // `b`. Splitting on `" "` yields neither, and it is `className`'s own
      // tokeniser (`native/react/rules.ts`) that decides which rules an element
      // matches at all — so the two would answer differently about the same
      // element, one selector at a time.
      return actual?.split(/\s+/u).includes(expected) ?? false;
    case "|=":
      // §6.2 dash-match: the value is EXACTLY `expected`, or begins with
      // `expected-`. Both halves, so `[lang|="en"]` matches `en` — the language
      // it names — as well as `en-GB`.
      return (
        actual === expected || (actual?.startsWith(`${expected}-`) ?? false)
      );
    case "^=":
      return actual?.startsWith(expected) ?? false;
    case "$=":
      return actual?.endsWith(expected) ?? false;
    case "*=":
      return actual?.includes(expected) ?? false;
    default:
      operator satisfies never;
      return false;
  }
}
