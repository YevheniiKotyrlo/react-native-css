import { compile } from "react-native-css/compiler";

/**
 * Which classes the compiler emitted a rule for.
 *
 * The runtime suite asserts that no style reaches the element, which a DROPPED
 * rule and an emitted-but-unmatchable one both produce. This reads whether the
 * rule exists at all — the half only the compiler can answer, and the half that
 * decides whether the stylesheet carries dead weight to every device.
 */
function emittedClasses(css: string): readonly string[] {
  return (compile(css).stylesheet().s ?? []).map(([name]) => name);
}

/** Measured against lightningcss: only `[ns|att]` reports a `specific` namespace. */
const REPRESENTS_THE_SAME_SET = [
  ["no namespace", `[data-x='a']`],
  ["explicitly no namespace", `[|data-x='a']`],
  ["any namespace", `[*|data-x='a']`],
] as const;

const NAMESPACE_QUALIFIED = [
  [
    "a declared prefix",
    `@namespace ns url(http://example.com/ns); .test[ns|data-x='a'] { width: 10px }`,
  ],
  ["an undeclared prefix", `.test[undeclared|data-x='a'] { width: 10px }`],
] as const;

describe("a selector naming no namespace still emits its rule", () => {
  test("the census is not empty, so the cases below are not vacuous", () => {
    expect(REPRESENTS_THE_SAME_SET.length).toBeGreaterThan(0);
    expect(NAMESPACE_QUALIFIED.length).toBeGreaterThan(0);
  });

  test.each(REPRESENTS_THE_SAME_SET)("%s", (_label, selector) => {
    expect(emittedClasses(`.test${selector} { width: 10px }`)).toStrictEqual([
      "test",
    ]);
  });
});

describe("a namespace-qualified attribute selector emits no rule at all", () => {
  test.each(NAMESPACE_QUALIFIED)("%s", (_label, css) => {
    expect(emittedClasses(css)).toStrictEqual([]);
  });

  test("only the qualified selector is dropped — a sibling rule survives", () => {
    expect(
      emittedClasses(
        `.kept[data-x='a'] { width: 10px } .dropped[undeclared|data-x='a'] { width: 10px }`,
      ),
    ).toStrictEqual(["kept"]);
  });
});
