import { compile, type MediaCondition } from "react-native-css/compiler";

import { COMPARISON_MATCHES, sizeComparisons } from "../_media-features";
import { serializeStyleSheet } from "../../metro/injection-code";

/** The media conditions of every rule compiled for `className`. */
function mediaConditions(css: string, className: string) {
  const rules =
    compile(css)
      .stylesheet()
      .s?.find(([name]) => name === className)?.[1] ?? [];

  return rules.map((rule): MediaCondition[] | undefined => rule.m);
}

/**
 * Returns the media conditions the compiler attached to `.my-class`.
 *
 * The rest of the rule (declarations, specificity, extracted variables) is not
 * the subject of these tests, so reading just `m` keeps them from failing on
 * an unrelated change to how declarations are emitted.
 */
function compileMediaConditions(prelude: string): MediaCondition[] {
  const stylesheet = compile(`
    @media ${prelude} {
      .my-class { color: red; }
    }
  `).stylesheet();

  const rules =
    stylesheet.s?.flatMap(([className, ruleSet]) => {
      return className === "my-class" ? ruleSet : [];
    }) ?? [];

  return rules.flatMap((rule) => rule.m ?? []);
}

// Re-enabled: `@media android` / `@media ios` compile correctly and always did
// — the media condition in `m` was already exactly right. The suite was skipped
// because the REST of the expectation had gone stale: colours now serialise
// short (`#f00`), the specificity tuple changed, and every `color` declaration
// publishes its inherited-property variable. A skipped suite hid a working
// feature.
describe("platform media queries", () => {
  test("android", () => {
    const compiled = compile(`
    @media android and (min-width: 500px) {
      .my-class { color: red; }
    }
  `);

    expect(compiled.stylesheet()).toStrictEqual({
      s: [
        [
          "my-class",
          [
            {
              s: [2, 1],
              d: [{ color: "#f00" }],
              v: [["__rn-css-inherit-color", "#f00"]],
              m: [
                [
                  "&",
                  [
                    ["=", "platform", "android"],
                    [">=", "width", 500],
                  ],
                ],
              ],
            },
          ],
        ],
      ],
    });
  });

  test("ios", () => {
    const compiled = compile(`
    @media ios and (min-width: 500px) {
      .my-class { color: red; }
    }
  `);

    expect(compiled.stylesheet()).toStrictEqual({
      s: [
        [
          "my-class",
          [
            {
              s: [2, 1],
              d: [{ color: "#f00" }],
              v: [["__rn-css-inherit-color", "#f00"]],
              m: [
                [
                  "&",
                  [
                    ["=", "platform", "ios"],
                    [">=", "width", 500],
                  ],
                ],
              ],
            },
          ],
        ],
      ],
    });
  });
});

describe("comma-separated media query lists", () => {
  test("compile to a union, not an intersection", () => {
    expect(
      mediaConditions(
        `@media (min-width: 100px), (min-width: 9999px) {
          .my-class { background-color: red; }
        }`,
        "my-class",
      ),
    ).toStrictEqual([
      [
        [
          "|",
          [
            [">=", "width", 100],
            [">=", "width", 9999],
          ],
        ],
      ],
    ]);
  });

  test("a single query is not wrapped", () => {
    expect(
      mediaConditions(
        `@media (min-width: 100px) {
          .my-class { background-color: red; }
        }`,
        "my-class",
      ),
    ).toStrictEqual([[[">=", "width", 100]]]);
  });

  test("a comma list and an `or` condition compile identically", () => {
    const comma = mediaConditions(
      `@media (min-width: 100px), (min-width: 9999px) {
        .my-class { background-color: red; }
      }`,
      "my-class",
    );

    const or = mediaConditions(
      `@media ((min-width: 100px) or (min-width: 9999px)) {
        .my-class { background-color: red; }
      }`,
      "my-class",
    );

    expect(comma).toStrictEqual(or);
  });

  test("nested @media rules still intersect", () => {
    expect(
      mediaConditions(
        `@media (min-width: 100px) {
          @media (min-height: 200px) {
            .my-class { background-color: red; }
          }
        }`,
        "my-class",
      ),
    ).toStrictEqual([
      [
        [">=", "width", 100],
        [">=", "height", 200],
      ],
    ]);
  });
});

describe("an operand the compiler cannot resolve", () => {
  // `env()` has no compile-time value. The operand compiles to `null`, the one
  // spelling of "no value" that survives `JSON.stringify` into a native bundle,
  // and it has to survive into the condition: a condition that is absent applies
  // unconditionally, so dropping the query is the opposite of refusing it.
  test("compiles to null beside a sibling operand", () => {
    expect(
      mediaConditions(
        `@media ((orientation: env(safe-area-inset-top)) and (min-width: 0px)) {
        .my-class { background-color: red; }
      }`,
        "my-class",
      ),
    ).toStrictEqual([
      [
        [
          "&",
          [
            ["=", "orientation", null],
            [">=", "width", 0],
          ],
        ],
      ],
    ]);
  });

  test("compiles to null as the only operand", () => {
    expect(
      mediaConditions(
        `@media (orientation: env(safe-area-inset-top)) {
        .my-class { background-color: red; }
      }`,
        "my-class",
      ),
    ).toStrictEqual([[["=", "orientation", null]]]);
  });

  test("survives the serializer that carries it to a device", () => {
    const conditions = mediaConditions(
      `@media (orientation: env(safe-area-inset-top)) {
        .my-class { background-color: red; }
      }`,
      "my-class",
    );

    expect(JSON.parse(serializeStyleSheet(conditions))).toStrictEqual(
      conditions,
    );
  });
});

test("a boolean feature compiles to a boolean condition", () => {
  expect(
    mediaConditions(
      `@media (width) {
        .my-class { background-color: red; }
      }`,
      "my-class",
    ),
  ).toStrictEqual([[["!!", "width"]]]);
});

test("@media (hover: hover)", () => {
  const compiled = compile(`
    @media (hover: hover) {
      .my-class { color: red; }
    }
  `);

  expect(compiled.stylesheet()).toStrictEqual({
    s: [
      [
        "my-class",
        [
          {
            s: [2, 1],
            d: [{ color: "#f00" }],
            m: [["=", "hover", "hover"]],
            v: [["__rn-css-inherit-color", "#f00"]],
          },
        ],
      ],
    ],
  });
});

describe("size feature comparisons", () => {
  /**
   * Every comparison operator on every size axis, in both spellings — the same
   * census the `@container` compiler table and both runtime tables are built
   * from.
   *
   * `@media` and `@container` share one `MediaCondition` vocabulary and one
   * runtime primitive, so an operator that compiles differently between them
   * is a divergence with nowhere to be caught downstream. Both at-rules are
   * held to the identical table for that reason.
   */
  const cases: [prelude: string, condition: MediaCondition][] =
    sizeComparisons().map((row) => {
      const condition: MediaCondition = [row.operator, row.feature, 400];
      return [row.condition(400), condition];
    });

  test("every operator in the census reaches this table", () => {
    // Against `COMPARISON_MATCHES`, whose keys are the operator union itself,
    // rather than against the length of the generator these cases came from —
    // that product holds for any census, an empty one included.
    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map(([, condition]) => condition[0]))).toStrictEqual(
      new Set(Object.keys(COMPARISON_MATCHES)),
    );
  });

  test.each(cases)("@media %s", (prelude, condition) => {
    expect(compileMediaConditions(prelude)).toStrictEqual([condition]);
  });
});

describe("aspect-ratio", () => {
  /**
   * `<ratio>` is a media feature value like any other, so the same parse
   * serves `@media` and `@container`. A bare number is a ratio too — `1` is
   * `1/1`.
   */
  const cases: [prelude: string, condition: MediaCondition][] = [
    ["(aspect-ratio > 1)", [">", "aspect-ratio", 1]],
    ["(aspect-ratio: 2/1)", ["=", "aspect-ratio", 2]],
    ["(min-aspect-ratio: 16/9)", [">=", "aspect-ratio", 16 / 9]],
    ["(max-aspect-ratio: 16/9)", ["<=", "aspect-ratio", 16 / 9]],
  ];

  test.each(cases)("@media %s", (prelude, condition) => {
    expect(compileMediaConditions(prelude)).toStrictEqual([condition]);
  });
});

describe("interval (range pair) conditions", () => {
  /**
   * The emitted tuple is `["[]", name, start, startOperator, end,
   * endOperator]`, and it reads in CSS source order: `start startOperator
   * name endOperator end`. The runtime evaluates it in that order, so the two
   * operators are pinned separately from the two bounds — swapping either pair
   * reads as a valid interval and means something else.
   *
   * The `@container` compiler suite pins the same layout. One evaluator now
   * serves both at-rules, so a divergence in what either one emits reaches a
   * shared consumer that cannot tell them apart.
   */
  const cases: [prelude: string, condition: MediaCondition][] = [
    ["(400px < width < 800px)", ["[]", "width", 400, "<", 800, "<"]],
    ["(400px <= width <= 800px)", ["[]", "width", 400, "<=", 800, "<="]],
    ["(800px > width > 400px)", ["[]", "width", 800, ">", 400, ">"]],
    ["(400px < height < 800px)", ["[]", "height", 400, "<", 800, "<"]],
    ["(400px <= width < 800px)", ["[]", "width", 400, "<=", 800, "<"]],
  ];

  test.each(cases)("@media %s", (prelude, condition) => {
    expect(compileMediaConditions(prelude)).toStrictEqual([condition]);
  });
});
