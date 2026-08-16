import { compile, type StyleRule } from "react-native-css/compiler";

/**
 * Returns every rule the compiler emitted for `.child`.
 *
 * A conditional group rule (`@media`, `@container`) contributes its inner
 * rules to this list; if the block is skipped the list is empty.
 */
function compileChildRules(css: string): StyleRule[] {
  const stylesheet = compile(css).stylesheet();

  return (
    stylesheet.s?.flatMap(([className, ruleSet]) => {
      return className === "child" ? ruleSet : [];
    }) ?? []
  );
}

/**
 * Conditions this compiler cannot evaluate, one per reason it cannot.
 *
 * A block guarded by one of these can never be shown to match, so it must not
 * be emitted. Each case is also a vacuity guard on the case above it: if
 * support for one of these lands, its `m`/`cq` stops being absent and the test
 * fails, which is the signal to move the case rather than delete it.
 */
const uncompilable: [label: string, css: string][] = [
  [
    "a container style() query",
    "@container style(--foo: bar) { .child { color: red } }",
  ],
  [
    "a container feature value the compiler cannot resolve",
    "@container (width > env(safe-area-inset-top)) { .child { color: red } }",
  ],
  [
    "a media feature value the compiler cannot resolve",
    "@media (width > env(safe-area-inset-top)) { .child { color: red } }",
  ],
  [
    "a negated media condition the compiler cannot resolve",
    "@media not (width > env(safe-area-inset-top)) { .child { color: red } }",
  ],
  // A `<ratio>` stands for its quotient, and a zero denominator has none.
  // There is no number a comparison against it could be written as: the
  // emitted value would be `Infinity` or `NaN`, which the bundle serialises to
  // `null` and the runtime then reads as an unresolved bound anyway.
  [
    "a media ratio with no finite quotient",
    "@media (min-aspect-ratio: 1/0) { .child { color: red } }",
  ],
  [
    "a media ratio that is not a number at all",
    "@media (min-aspect-ratio: 0/0) { .child { color: red } }",
  ],
  [
    "a container ratio with no finite quotient",
    "@container (min-aspect-ratio: 1/0) { .child { color: red } }",
  ],
];

describe("a block whose condition does not compile keeps its condition", () => {
  test.each(uncompilable)("%s", (_label, css) => {
    // Emitting the rule with NO condition is the failure this guards: the
    // declarations would then apply to every element carrying the class, which
    // is the opposite of what the author wrote. Dropping the block is the other
    // way to avoid that and is not what happens — every prelude form compiles
    // to a term, an unresolved operand as `null` and an unrepresentable form as
    // `["?"]`, and the runtime answers the term unknown. So the rule is emitted
    // and it carries something to refuse; `native/media-unknown.test.tsx` and
    // `native/container-style-query.test.tsx` are where the refusal is read.
    const rules = compileChildRules(css);

    expect(rules).toHaveLength(1);
    expect(rules[0]?.m ?? rules[0]?.cq).toBeDefined();
  });
});

describe("a block whose condition does compile is emitted", () => {
  /**
   * The control for the table above — without it, a compiler that emitted
   * nothing at all would pass every case there.
   *
   * Each case names the condition the rule must carry rather than counting the
   * rules, because the two failures being pinned are opposite and a count sees
   * only one of them: a block dropped when it should not be, and a block kept
   * but stripped of the condition that was the whole point of it. The second
   * is the more dangerous, since the declarations then apply everywhere.
   *
   * An absent condition is therefore stated, not omitted. `@media all` and
   * `@media not print and (…)` genuinely carry none — `not print` reads `not
   * (print and …)`, true on every non-print device whatever follows — and that
   * is exactly the state a condition which failed to compile must not be
   * confused with.
   */
  const cases: [
    label: string,
    css: string,
    conditions: Pick<StyleRule, "m" | "cq">,
  ][] = [
    [
      "@container",
      "@container (width > 400px) { .child { color: red } }",
      { m: undefined, cq: [{ m: [">", "width", 400] }] },
    ],
    [
      "@media",
      "@media (width > 400px) { .child { color: red } }",
      { m: [[">", "width", 400]], cq: undefined },
    ],
    [
      "@media all",
      "@media all { .child { color: red } }",
      { m: undefined, cq: undefined },
    ],
    [
      "@media screen",
      "@media screen { .child { color: red } }",
      { m: undefined, cq: undefined },
    ],
    [
      "@media not print",
      "@media not print and (width > 400px) { .child { color: red } }",
      { m: undefined, cq: undefined },
    ],
    [
      // An operand this compiler cannot resolve does not make the branch
      // uncompilable — it is emitted with a `null` operand, which the runtime
      // answers UNKNOWN in either polarity. So BOTH branches survive and fold
      // into the one `["|", …]` term a comma list compiles to.
      "a media query list with one unresolvable operand",
      "@media (width > env(safe-area-inset-top)), (width > 400px) { .child { color: red } }",
      {
        m: [
          [
            "|",
            [
              [">", "width", null],
              [">", "width", 400],
            ],
          ],
        ],
        cq: undefined,
      },
    ],
    [
      "a ratio whose quotient is finite",
      "@media (min-aspect-ratio: 0/1) { .child { color: red } }",
      { m: [[">=", "aspect-ratio", 0]], cq: undefined },
    ],
  ];

  test.each(cases)("%s", (_label, css, conditions) => {
    expect(
      compileChildRules(css).map((rule) => ({ m: rule.m, cq: rule.cq })),
    ).toStrictEqual([conditions]);
  });
});
