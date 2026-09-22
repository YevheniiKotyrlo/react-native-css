import { compile } from "react-native-css/compiler";

function firstRule(css: string, className: string): Record<string, unknown> {
  const entry = (compile(css).stylesheet().s ?? []).find(
    ([name]) => name === className,
  );
  if (!entry) {
    throw new Error(`the compiler emitted no rule for .${className}`);
  }
  const [, declarations] = entry;
  return declarations[0] as unknown as Record<string, unknown>;
}

/**
 * `dir` is on HTML's ASCII-case-insensitive attribute list, so a browser answers
 * `[dir="RTL"]` for `dir="rtl"` with no `i` flag written. The media condition it
 * compiles to compares literally, so the fold has to happen here.
 */
describe("the dir operand is folded at compile time", () => {
  const DIR_CASES = [
    ["upper", `.t[dir="RTL"] { color: red }`, "t"],
    ["mixed", `.t[dir="Rtl"] { color: red }`, "t"],
    ["already lower", `.t[dir="rtl"] { color: red }`, "t"],
    ["an explicit i flag is a no-op", `.t[dir="RTL" i] { color: red }`, "t"],
  ] as const;

  test("the census is not empty, so the cases below are not vacuous", () => {
    expect(DIR_CASES.length).toBeGreaterThan(0);
  });

  test.each(DIR_CASES)("%s", (_label, css, className) => {
    expect(firstRule(css, className).m).toStrictEqual([["=", "dir", "rtl"]]);
  });
});

/**
 * Selectors §6.3 — the `i` flag is part of the selector, so a runtime that folds
 * unconditionally would answer the same for a selector that never asked. The
 * flag reaching the query is what keeps the two distinguishable.
 */
describe("the case-sensitivity flag reaches the attribute query", () => {
  test("an i flag is carried as a fifth element", () => {
    expect(firstRule(`.u[data-x="A" i] { color: red }`, "u").aq).toStrictEqual([
      ["d", "x", "=", "A", "i"],
    ]);
  });

  test("its absence is carried too — the operand keeps its case", () => {
    expect(firstRule(`.u[data-x="A"] { color: red }`, "u").aq).toStrictEqual([
      ["d", "x", "=", "A"],
    ]);
  });

  test("a plain attribute carries the flag the same way", () => {
    expect(firstRule(`.u[title="A" i] { color: red }`, "u").aq).toStrictEqual([
      ["a", "title", "=", "A", "i"],
    ]);
  });
});
