import { compile } from "react-native-css/compiler";

const RTL = ["=", "dir", "rtl"] as const;
const LTR = ["=", "dir", "ltr"] as const;
const PADDING = { paddingLeft: 4 } as const;

describe("the subject compound", () => {
  test("a bare :dir() compiles to the dir condition", () => {
    expect(
      compile(`.bare:dir(rtl) { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual({
      s: [["bare", [{ s: [1, 2], d: [PADDING], m: [RTL] }]]],
    });
  });

  test("both directions are answerable", () => {
    expect(
      compile(`.bare:dir(ltr) { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual({
      s: [["bare", [{ s: [1, 2], d: [PADDING], m: [LTR] }]]],
    });
  });

  test("a [dir] attribute compiles to the same condition, with an attribute's specificity", () => {
    expect(
      compile(`.self[dir="rtl"] { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual({
      s: [["self", [{ s: [1, 2], d: [PADDING], m: [RTL] }]]],
    });
  });

  test(":dir() composes with the other pseudo-classes on the element", () => {
    expect(
      compile(`.hover:dir(rtl):hover { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual({
      s: [["hover", [{ s: [1, 3], d: [PADDING], m: [RTL], p: { h: 1 } }]]],
    });
  });
});

describe("an ancestor compound", () => {
  test("a [dir] attribute on an ancestor is the directionality the subject inherits", () => {
    expect(
      compile(`[dir="rtl"] .descendant { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual({
      s: [["descendant", [{ s: [1, 2], d: [PADDING], m: [RTL] }]]],
    });
  });

  test("a :dir() on an ancestor answers the same way", () => {
    expect(
      compile(`:dir(rtl) .descendant { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual({
      s: [["descendant", [{ s: [1, 2], d: [PADDING], m: [RTL] }]]],
    });
  });

  test("html[dir] and :root[dir] name the document element, which every element descends from", () => {
    const fromHtml = compile(
      `html[dir="rtl"] .descendant { padding-left: 4px; }`,
    ).stylesheet();

    expect(fromHtml).toStrictEqual({
      s: [["descendant", [{ s: [1, 2], d: [PADDING], m: [RTL] }]]],
    });
    expect(
      compile(
        `:root[dir="rtl"] .descendant { padding-left: 4px; }`,
      ).stylesheet(),
    ).toStrictEqual(fromHtml);
  });

  test(":root as an ancestor is transparent, and no element IS the root", () => {
    expect(
      compile(`:root .under { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual({
      s: [["under", [{ s: [1, 1], d: [PADDING] }]]],
    });
    expect(
      compile(`.self:root { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual({});
  });

  test("a directionality beside an ancestor class keeps the container query", () => {
    expect(
      compile(`.group:dir(rtl) .item { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual({
      s: [
        ["group", [{ s: [0], c: ["g:group"] }]],
        [
          "item",
          [{ s: [1, 3], d: [PADDING], m: [RTL], cq: [{ n: "g:group" }] }],
        ],
      ],
    });
  });
});

describe(":is() and :where()", () => {
  test("Tailwind's rtl: variant compiles to ONE rule carrying ONE dir condition", () => {
    expect(
      compile(
        `.tw:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *) { padding-left: 4px; }`,
      ).stylesheet(),
    ).toStrictEqual({
      s: [["tw", [{ s: [1, 1], d: [PADDING], m: [RTL] }]]],
    });
  });

  test("the variant's condition is the same shape a bare :dir() compiles to", () => {
    const bare = compile(`.x:dir(rtl) { padding-left: 4px; }`).stylesheet();
    const variant = compile(
      `.x:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *) { padding-left: 4px; }`,
    ).stylesheet();

    expect(variant.s?.[0]?.[1][0]?.m).toStrictEqual(bare.s?.[0]?.[1][0]?.m);
  });

  test("a [dir] attribute inside :where() answers like :dir(), with :where()'s specificity", () => {
    expect(
      compile(`.where:where([dir="rtl"]) { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual({
      s: [["where", [{ s: [1, 1], d: [PADDING], m: [RTL] }]]],
    });
  });

  test("a [dir] attribute inside :is() carries its specificity", () => {
    expect(
      compile(`.is:is([dir="rtl"]) { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual({
      s: [["is", [{ s: [1, 2], d: [PADDING], m: [RTL] }]]],
    });
  });

  test("arms that are not the same query stay separate rules", () => {
    expect(
      compile(
        `.mixed:is(:dir(rtl), .group) { padding-left: 4px; }`,
      ).stylesheet(),
    ).toStrictEqual({
      s: [
        [
          "mixed",
          [
            { s: [1, 1], d: [PADDING], m: [RTL] },
            { s: [1, 2], d: [PADDING], cq: [{ n: "g:group" }] },
          ],
        ],
        ["group", [{ s: [0], c: ["g:group"] }]],
      ],
    });
  });

  test("identical arms of any kind emit one rule", () => {
    expect(
      compile(`.dup:is(.group, .group) { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual({
      s: [
        ["group", [{ s: [0], c: ["g:group"] }]],
        ["dup", [{ s: [1, 2], d: [PADDING], cq: [{ n: "g:group" }] }]],
      ],
    });
  });
});

describe("media queries", () => {
  test("the (dir) media feature is the same condition", () => {
    expect(
      compile(
        `@media (dir: rtl) { .media { padding-left: 4px; } }`,
      ).stylesheet(),
    ).toStrictEqual({
      s: [["media", [{ s: [2, 1], m: [RTL], d: [PADDING] }]]],
    });
  });

  test("a negated feature keeps its negation", () => {
    expect(
      compile(
        `@media not (dir: rtl) { .media { padding-left: 4px; } }`,
      ).stylesheet(),
    ).toStrictEqual({
      s: [["media", [{ s: [2, 1], m: [["!", RTL]], d: [PADDING] }]]],
    });
  });

  test("an author's own `and` is carried whole beside the dir condition", () => {
    expect(
      compile(`
        @media (min-width: 10px) and (prefers-color-scheme: dark) {
          .both:dir(rtl) { padding-left: 4px; }
        }
      `).stylesheet(),
    ).toStrictEqual({
      s: [
        [
          "both",
          [
            {
              s: [2, 2],
              m: [
                [
                  "&",
                  [
                    [">=", "width", 10],
                    ["=", "prefers-color-scheme", "dark"],
                  ],
                ],
                RTL,
              ],
              d: [PADDING],
            },
          ],
        ],
      ],
    });
  });

  test("a dir condition composes with a media query and a container query", () => {
    expect(
      compile(`
        @media (prefers-color-scheme: dark) {
          .group:where(:dir(rtl)) .dark { padding-left: 8px; }
        }
      `).stylesheet(),
    ).toStrictEqual({
      s: [
        ["group", [{ s: [0], c: ["g:group"] }]],
        [
          "dark",
          [
            {
              s: [2, 2],
              m: [["=", "prefers-color-scheme", "dark"], RTL],
              d: [{ paddingLeft: 8 }],
              cq: [{ n: "g:group" }],
            },
          ],
        ],
      ],
    });
  });
});

describe("the [dir] value", () => {
  test("is read ASCII-case-insensitively, as HTML defines the attribute", () => {
    const lower = compile(
      `.upper[dir="rtl"] { padding-left: 4px; }`,
    ).stylesheet();

    expect(
      compile(`.upper[dir="RTL"] { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual(lower);
    expect(
      compile(`.upper[dir="RTL" i] { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual(lower);
  });

  test("the selector's own s flag is honoured, so an upper-case value matches nothing", () => {
    expect(
      compile(`.upper[dir="RTL" s] { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual({});
  });

  test("a value the engine cannot answer matches nothing", () => {
    expect(
      compile(`
        .auto[dir="auto"] { padding-left: 4px; }
        .present[dir] { padding-left: 4px; }
      `).stylesheet(),
    ).toStrictEqual({});
  });

  test("every operator but equality matches nothing, so a partial match never widens the rule", () => {
    expect(
      compile(`
        .prefix[dir^="r"] { padding-left: 4px; }
        .suffix[dir$="tl"] { padding-left: 4px; }
        .substring[dir*="rtl"] { padding-left: 4px; }
        .includes[dir~="rtl"] { padding-left: 4px; }
        .dash[dir|="rtl"] { padding-left: 4px; }
      `).stylesheet(),
    ).toStrictEqual({});
  });

  test("a negated :dir() is outside the builder's negation and matches nothing", () => {
    expect(
      compile(`.not:not(:dir(rtl)) { padding-left: 4px; }`).stylesheet(),
    ).toStrictEqual({});
  });

  test("an unanswerable value inside :is() drops the rule rather than the arm", () => {
    // The fail-closed arm the subject compound already has, one nesting in: the `:is()` path
    // resolves the value itself, so a rule kept there would apply in every direction.
    expect(
      compile(`
        .isauto:is([dir="auto"]) { padding-left: 4px; }
        .wherepresent:where([dir]) { padding-left: 4px; }
        .isop:is([dir^="r"]) { padding-left: 4px; }
      `).stylesheet(),
    ).toStrictEqual({});
  });

  test("an unanswerable arm drops only its own rule, leaving its siblings", () => {
    expect(
      compile(
        `.mixedauto:is([dir="auto"], :dir(rtl)) { padding-left: 4px; }`,
      ).stylesheet(),
    ).toStrictEqual({
      s: [["mixedauto", [{ s: [1, 1], d: [PADDING], m: [RTL] }]]],
    });
  });
});

describe("determinism", () => {
  test("compiling the same stylesheet twice yields equal output", () => {
    const css = `
      .tw:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *) { padding-left: 4px; }
      [dir="ltr"] .tw { padding-left: 8px; }
    `;

    expect(compile(css).stylesheet()).toStrictEqual(compile(css).stylesheet());
  });
});
