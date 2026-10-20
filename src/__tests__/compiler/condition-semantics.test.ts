import { compile, type StyleRule } from "react-native-css/compiler";

function compileChildConditions(css: string): Pick<StyleRule, "m" | "cq">[] {
  return (compile(css).stylesheet().s ?? []).flatMap(([className, rules]) =>
    className === "child" ? rules.map(({ m, cq }) => ({ m, cq })) : [],
  );
}

// CSS Conditional 5 §5.4: an unknown size feature or an unresolvable value selects no container
test.each([
  "@container (fictional-feature > 10px)",
  "@container (fictional-feature > 10px) or (width > 400px)",
  "@container not (fictional-feature > 10px)",
  "@container (width > env(safe-area-inset-top))",
  "@container (width > env(safe-area-inset-top)) or (width > 400px)",
])("%s emits no block", (prelude) => {
  expect(
    compileChildConditions(`${prelude} { .child { color: red } }`),
  ).toStrictEqual([]);
});

// An unknown keeps an `and` or a `not` unknown (MQ5 §3.2), so a condition no device can make true compiles to no rule
test.each([
  "@container style(--foo: bar)",
  "@container not style(--foo: bar)",
  "@container style(--foo: bar) and (width > 400px)",
  "@media (width > env(safe-area-inset-top))",
  "@media not (width: env(safe-area-inset-top))",
  "@media (orientation: bogus)",
  "@media not (orientation: bogus)",
])("%s, which no device can make true, emits no block", (prelude) => {
  expect(
    compileChildConditions(`${prelude} { .child { color: red } }`),
  ).toStrictEqual([]);
});

test.each<[string, Pick<StyleRule, "m" | "cq">]>([
  [
    "@container style(--foo: bar) or (width > 400px)",
    { m: undefined, cq: [{ m: ["|", [["?"], [">", "width", 400]]] }] },
  ],
  [
    "@media (width > env(safe-area-inset-top)) or (width > 400px)",
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
    "@container (aspect-ratio > 16/9) or (width > 10in)",
    {
      m: undefined,
      cq: [
        {
          m: [
            "|",
            [
              [">", "aspect-ratio", 16 / 9],
              [">", "width", null],
            ],
          ],
        },
      ],
    },
  ],
  ["@media (min-width: 40em)", { m: [[">=", "width", 560]], cq: undefined }],
  [
    "@container (width > 10em)",
    { m: undefined, cq: [{ m: [">", "width", [{}, "em", 10, 1]] }] },
  ],
  [
    "@media (constructor: x)",
    { m: [["=", "constructor", "x"]], cq: undefined },
  ],
  ["@media (grid: 0)", { m: [["=", "grid", 0]], cq: undefined }],
  ["@media (grid: 1)", { m: [["=", "grid", 1]], cq: undefined }],
])("%s compiles to %j", (prelude, conditions) => {
  expect(
    compileChildConditions(`${prelude} { .child { color: red } }`),
  ).toStrictEqual([conditions]);
});

test("a media query list keeps the branch a device can match beside one none can", () => {
  expect(
    compileChildConditions(
      "@media (width > env(safe-area-inset-top)), (width > 400px) { .child { color: red } }",
    ),
  ).toStrictEqual([{ m: [[">", "width", 400]], cq: undefined }]);
});
