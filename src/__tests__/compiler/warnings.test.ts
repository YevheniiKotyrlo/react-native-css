import { compile } from "react-native-css/compiler";

/** Unknown to lightningcss, so every build reports them unless the filter removes them. */
const OWN_AT_RULES = ["@nativeMapping", "@react-native"] as const;

describe("the compiler's own at-rules never reach the warnings", () => {
  test("the census is not empty, so the cases below are not vacuous", () => {
    expect(OWN_AT_RULES.length).toBeGreaterThan(0);
  });

  test.each(OWN_AT_RULES)("%s is silent", (atRule) => {
    expect(compile(`${atRule} {}`).warnings()).toStrictEqual({});
  });
});

describe("every other syntax problem is surfaced", () => {
  // The filter keys on this wording, so an upstream rewording reddens here
  // rather than warning about `@nativeMapping` in every consumer's build.
  test("an unknown at-rule is reported, with the wording the filter reads", () => {
    expect(compile(`@totally-unknown-rule {}`).warnings()).toStrictEqual({
      syntax: ["Unknown at rule: @totally-unknown-rule"],
    });
  });

  // `float` rather than a property React Native may yet gain: Yoga lays out flexbox and has no floats.
  test("a property with no React Native equivalent is reported on its own channel", () => {
    expect(compile(`.a { float: left }`).warnings()).toStrictEqual({
      properties: ["float"],
    });
  });

  test("a clean stylesheet reports nothing, so the cases above are not always-on", () => {
    expect(compile(`.a { color: red }`).warnings()).toStrictEqual({});
  });
});
