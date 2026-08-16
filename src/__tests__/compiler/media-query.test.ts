import { compile } from "react-native-css/compiler";

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
