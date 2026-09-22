import { compile } from "react-native-css/compiler";

/**
 * The attribute query the compiler emits for one class's first rule.
 *
 * The runtime suite can only observe the RESULT of evaluating this, so a wrong
 * prop name and a wrong evaluation are the same red there. This reads the
 * emitted query itself, which is the half the runtime cannot see.
 */
function attributeQueryFor(css: string, className: string): unknown {
  const rules = compile(css).stylesheet().s;
  const entry = rules?.find(([name]) => name === className);
  if (!entry) {
    throw new Error(
      `the compiler emitted no rule for .${className} — the stylesheet carries ${JSON.stringify(rules?.map(([name]) => name))}`,
    );
  }
  const [, declarations] = entry;
  return declarations.map((declaration) => declaration.aq);
}

/**
 * `class` is the CSS attribute; `className` is the prop it arrives on in React
 * Native. Emitting `class` names a prop no element has, so every `[class…]`
 * selector matches nothing.
 */
const CLASS_ATTRIBUTE_CASES = [
  [
    "exact match",
    `.exact[class="a b"] { color: red }`,
    "exact",
    ["a", "className", "=", "a b"],
  ],
  [
    "whitespace-list match",
    `.list[class~="b"] { color: red }`,
    "list",
    ["a", "className", "~=", "b"],
  ],
  [
    "substring match",
    `.part[class*="b"] { color: red }`,
    "part",
    ["a", "className", "*=", "b"],
  ],
  ["presence", `.present[class] { color: red }`, "present", ["a", "className"]],
] as const;

describe("[class…] reads the prop the class list arrives on", () => {
  test("the census is not empty, so the cases below are not vacuous", () => {
    expect(CLASS_ATTRIBUTE_CASES.length).toBeGreaterThan(0);
  });

  test.each(CLASS_ATTRIBUTE_CASES)("%s", (_label, css, className, expected) => {
    expect(attributeQueryFor(css, className)).toStrictEqual([[expected]]);
  });
});

describe("every other attribute keeps its own channel", () => {
  test("a data-* attribute compiles to a dataSet query, not an attribute one", () => {
    expect(
      attributeQueryFor(`.d[data-state="open"] { color: red }`, "d"),
    ).toStrictEqual([[["d", "state", "=", "open"]]]);
  });

  test("a plain attribute is untouched by the class mapping", () => {
    expect(attributeQueryFor(`.p[disabled] { color: red }`, "p")).toStrictEqual(
      [[["a", "disabled"]]],
    );
  });
});
