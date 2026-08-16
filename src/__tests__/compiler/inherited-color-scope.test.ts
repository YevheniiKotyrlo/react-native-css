import { compile } from "react-native-css/compiler";
import type { StyleRule } from "react-native-css/compiler";
import { INHERIT_VARIABLE_PREFIX } from "react-native-css/utilities";

/**
 * `currentcolor` and `color: inherit` read the inherited colour, and which
 * SCOPE they read it from is the whole subject here.
 *
 * A custom property cascades: an element's own declaration of a name shadows
 * the one it would inherit. That is right for `border-color: currentcolor`,
 * where the keyword means the element's OWN computed colour — and it is exactly
 * wrong on `color` itself, where the keyword is defined as `inherit` and the
 * declaration being computed IS the element's own. The two reads therefore
 * cannot be the same function, and no choice of variable NAME separates them:
 * every name the compiler publishes lands in the element's own scope.
 *
 * `inheritedVar` is the second read. These tests pin which declaration gets
 * which — the rendered half is `native/inherited-color-scope.test.tsx`, and
 * neither substitutes for the other: the descriptor can be right and the read
 * still wrong.
 */
const CHANNEL = `${INHERIT_VARIABLE_PREFIX}color`;

const rulesFor = (css: string, className = "a"): StyleRule[] => {
  const sheet = compile(css).stylesheet();
  const entry = sheet.s?.find(([name]) => name === className);

  return entry?.[1] ?? [];
};

/** The declarations one rule applies to the element itself. */
const declarationsFor = (css: string, className = "a") =>
  rulesFor(css, className)[0]?.d;

/** The names one rule publishes to its subtree. */
const publishedBy = (css: string, className = "a") =>
  (rulesFor(css, className)[0]?.v ?? []).map(([name]) => name);

describe("the read on `color` itself skips the element's own scope", () => {
  test.each([["currentcolor"], ["inherit"], ["unset"]])(
    "`color: %s` compiles to an inherited-scope read",
    (keyword) => {
      // All three are the same declaration. css-color-4 §6.2 makes
      // `currentcolor` on `color` mean `inherit`, and css-cascade-4 §7.3 makes
      // `unset` mean `inherit` on an inherited property — `color` is one.
      expect(declarationsFor(`.a { color: ${keyword}; }`)).toStrictEqual([
        [[{}, "inheritedVar", CHANNEL], "color", 1],
      ]);
    },
  );

  test("the read nested inside a colour function is re-pointed too", () => {
    // `color-mix(in srgb, currentcolor, blue)` is still a value of the `color`
    // property, so the `currentcolor` buried in its argument list is still the
    // inherited colour rather than the one this declaration is computing.
    expect(
      JSON.stringify(
        declarationsFor(
          `.a { color: color-mix(in srgb, currentcolor, blue); }`,
        ),
      ),
    ).toContain(`"inheritedVar","${CHANNEL}"`);
  });

  test.each([
    ["light-dark(currentcolor, blue)", 0],
    ["light-dark(blue, currentcolor)", 1],
  ])("the read inside `%s` is re-pointed too", (value, ruleIndex) => {
    // The DARK branch (rule 1) does not return through the declaration's own
    // handler — `parseColor` writes it straight onto an extra rule from inside
    // itself. It is the case that decides where the re-point has to live: at
    // the single funnel every declaration passes through, not at the keyword
    // sites, because only the funnel sees both branches.
    const rules = rulesFor(`.a { color: ${value}; }`);

    expect(rules).toHaveLength(2);
    expect(rules[ruleIndex]?.d).toStrictEqual([
      [[{}, "inheritedVar", CHANNEL], "color", 1],
    ]);
  });

  test("a rule that reads the channel publishes nothing back into it", () => {
    // An element hands descendants an UNRESOLVED descriptor, so an entry
    // holding its own lookup shadows the ancestor's real colour with a
    // reference to itself and a descendant resolves nothing. Withholding leaves
    // the ancestor's entry standing, which is what `inherit` asks for.
    expect(publishedBy(`.a { color: inherit; }`)).toStrictEqual([]);
    expect(publishedBy(`.a { color: currentcolor; }`)).toStrictEqual([]);
    expect(
      publishedBy(`.a { color: color-mix(in srgb, currentcolor, blue); }`),
    ).toStrictEqual([]);
  });

  test("a rule that names a colour of its own publishes exactly one channel", () => {
    // One, not two. `color` is an inherited property like any other, so the
    // channel every inherited property publishes IS the one `currentcolor`
    // resolves against — a second channel beside it held the same value under
    // a second name and could only ever disagree with the first.
    expect(rulesFor(`.a { color: red; }`)[0]?.v).toStrictEqual([
      [CHANNEL, "#f00"],
    ]);
  });
});

describe("the read on every other property keeps the cascade", () => {
  test.each([
    ["border-color", "borderColor"],
    ["outline-color", "outlineColor"],
    ["text-decoration-color", "textDecorationColor"],
  ])(
    "`%s: currentcolor` compiles to a cascading read of the same channel",
    (property, key) => {
      // Not `inheritedVar`. On a property that is not `color`, the keyword is
      // the element's own computed colour, and the element's own `color`
      // declaration publishes into this channel — so the cascade is what
      // answers with it. These three are also the properties whose INITIAL
      // value is `currentcolor`, which is how a shorthand naming no colour
      // reaches the same place.
      expect(
        declarationsFor(`.a { ${property}: currentcolor; }`),
      ).toStrictEqual([[[{}, "var", CHANNEL], key, 1]]);
    },
  );

  test("`border-color: inherit` is still dropped", () => {
    // `inherit` on a non-`color` property means the parent's value of THAT
    // property, which has no channel. Answering it with the inherited text
    // colour would be a confident wrong answer rather than a dropped one.
    const compiled = compile(`.a { border-color: inherit; }`);

    expect(compiled.stylesheet()).toStrictEqual({});
    expect(compiled.warnings()).toStrictEqual({
      values: { "border-color": ["inherit"] },
    });
  });
});

test("the inherited-scope read is flagged as using variables", () => {
  // `dv` is what makes the runtime resolve the declaration against the
  // element's variable scope rather than settling it at collection time. The
  // flag is derived from the function's NAME, so a second variable function
  // that the flag did not know about would resolve before any scope existed.
  expect(rulesFor(`.a { color: inherit; }`)[0]?.dv).toBe(1);
});
