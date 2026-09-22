import { I18nManager, type StyleProp, type ViewStyle } from "react-native";

import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

const originalIsRTL = Object.getOwnPropertyDescriptor(I18nManager, "isRTL");

afterEach(() => {
  if (originalIsRTL) {
    Object.defineProperty(I18nManager, "isRTL", originalIsRTL);
  }
});

const answerIsRTL = (isRTL: boolean) => {
  Object.defineProperty(I18nManager, "isRTL", {
    configurable: true,
    value: isRTL,
  });
};

/** Tailwind's `rtl:` / `ltr:` output, verbatim. */
const DIRECTION_CSS = `
  .paint:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *) { color: red; }
  .paint:where(:dir(ltr), [dir="ltr"], [dir="ltr"] *) { color: blue; }
`;

const RTL = { color: "#f00" };
const LTR = { color: "#00f" };

test("an element declaring dir=rtl matches :dir(rtl) and not :dir(ltr)", () => {
  registerCSS(DIRECTION_CSS);

  render(<View testID="subject" dir="rtl" className="paint" />);

  expect(screen.getByTestId("subject")).toHaveStyle(RTL);
  expect(screen.getByTestId("subject")).not.toHaveStyle(LTR);
});

test("an element with no declaration above it reads the platform's direction", () => {
  registerCSS(DIRECTION_CSS);

  render(<View testID="subject" className="paint" />);

  expect(screen.getByTestId("subject")).toHaveStyle(LTR);
  expect(screen.getByTestId("subject")).not.toHaveStyle(RTL);
});

test("on a right-to-left platform an undeclared element reads rtl", () => {
  registerCSS(DIRECTION_CSS);
  answerIsRTL(true);

  render(<View testID="subject" className="paint" />);

  expect(screen.getByTestId("subject")).toHaveStyle(RTL);
  expect(screen.getByTestId("subject")).not.toHaveStyle(LTR);
});

test("directionality is inherited from the closest declaring ancestor", () => {
  registerCSS(DIRECTION_CSS);

  render(
    <View dir="rtl">
      <View>
        <View testID="descendant" className="paint" />
      </View>
    </View>,
  );

  expect(screen.getByTestId("descendant")).toHaveStyle(RTL);
  expect(screen.getByTestId("descendant")).not.toHaveStyle(LTR);
});

test("a nested declaration overrides its ancestor for its own subtree", () => {
  registerCSS(DIRECTION_CSS);

  render(
    <View dir="rtl">
      <View testID="outer" className="paint" />
      <View dir="ltr">
        <View testID="inner" className="paint" />
      </View>
    </View>,
  );

  expect(screen.getByTestId("outer")).toHaveStyle(RTL);
  expect(screen.getByTestId("inner")).toHaveStyle(LTR);
  expect(screen.getByTestId("inner")).not.toHaveStyle(RTL);
});

test("a declaration overrides the platform's direction for its subtree", () => {
  registerCSS(DIRECTION_CSS);
  answerIsRTL(true);

  render(
    <>
      <View testID="undeclared" className="paint" />
      <View dir="ltr">
        <View testID="declared" className="paint" />
      </View>
    </>,
  );

  expect(screen.getByTestId("undeclared")).toHaveStyle(RTL);
  expect(screen.getByTestId("declared")).toHaveStyle(LTR);
  expect(screen.getByTestId("declared")).not.toHaveStyle(RTL);
});

test("an ancestor [dir] selector answers from the directionality the element inherits", () => {
  registerCSS(`[dir="rtl"] .paint { color: red; }`);

  render(
    <>
      <View dir="rtl">
        <View testID="under-rtl" className="paint" />
      </View>
      <View dir="rtl">
        <View dir="ltr">
          <View testID="under-nested-ltr" className="paint" />
        </View>
      </View>
      <View testID="undeclared" className="paint" />
    </>,
  );

  expect(screen.getByTestId("under-rtl")).toHaveStyle(RTL);
  expect(screen.getByTestId("under-nested-ltr")).not.toHaveStyle(RTL);
  expect(screen.getByTestId("undeclared")).not.toHaveStyle(RTL);
});

test("the @media (dir) spelling answers the same way as :dir()", () => {
  registerCSS(`
    @media (dir: rtl) { .paint { color: red; } }
    @media (dir: ltr) { .paint { color: blue; } }
  `);

  render(
    <>
      <View testID="rtl" dir="rtl" className="paint" />
      <View testID="ltr" dir="ltr" className="paint" />
    </>,
  );

  expect(screen.getByTestId("rtl")).toHaveStyle(RTL);
  expect(screen.getByTestId("ltr")).toHaveStyle(LTR);
});

test("a declaring element takes the UA stylesheet's direction rule", () => {
  registerCSS(".paint { color: red; }");

  render(
    <>
      <View testID="rtl" dir="rtl" className="paint" />
      <View testID="ltr" dir="ltr" className="paint" />
      <View testID="undeclared" className="paint" />
    </>,
  );

  expect(screen.getByTestId("rtl")).toHaveStyle({
    direction: "rtl",
    writingDirection: "rtl",
  });
  expect(screen.getByTestId("ltr")).toHaveStyle({
    direction: "ltr",
    writingDirection: "ltr",
  });
  expect(screen.getByTestId("undeclared").props.style).toStrictEqual({
    color: "#f00",
  });
});

test("an author direction declaration outranks the UA rule and leaves the directionality untouched", () => {
  registerCSS(`
    .paint:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *) { color: red; }
    .author { direction: ltr; }
  `);

  render(<View testID="subject" dir="rtl" className="paint author" />);

  expect(screen.getByTestId("subject")).toHaveStyle({
    color: "#f00",
    direction: "ltr",
  });
});

test("a dir value outside the enumeration is not a declaration", () => {
  registerCSS(DIRECTION_CSS);

  render(
    <View dir="rtl">
      {/* Outside the prop's type on purpose; the runtime is what is under test. */}
      <View
        testID="subject"
        dir={"sideways" as unknown as "ltr"}
        className="paint"
      />
    </View>,
  );

  expect(screen.getByTestId("subject")).toHaveStyle(RTL);
  expect(screen.getByTestId("subject")).not.toHaveStyle({ direction: "ltr" });
});

test("dir=auto is not a declaration — the component holding the text resolves it", () => {
  registerCSS(DIRECTION_CSS);

  render(
    <View dir="rtl">
      {/* `auto` is outside the prop's type on purpose; the runtime is what is under test. */}
      <View
        testID="subject"
        dir={"auto" as unknown as "ltr"}
        className="paint"
      />
    </View>,
  );

  expect(screen.getByTestId("subject")).toHaveStyle(RTL);
  expect(screen.getByTestId("subject")).not.toHaveStyle({ direction: "rtl" });
});

test("a declaring element carrying inline variables still publishes its directionality", () => {
  registerCSS(`
    ${DIRECTION_CSS}
    .marker { color: var(--marker); }
  `);

  // The inline-variable object `vars()` builds, spelled through the registered symbol it is keyed on.
  const inlineVariables = {
    [Symbol.for("react-native-css.var")]: "inline",
    marker: "green",
  } as unknown as StyleProp<ViewStyle>;

  render(
    <View dir="rtl">
      <View
        testID="declaring"
        dir="ltr"
        className="marker"
        style={inlineVariables}
      >
        <View testID="descendant" className="paint" />
      </View>
    </View>,
  );

  expect(screen.getByTestId("declaring")).toHaveStyle({ color: "green" });
  expect(screen.getByTestId("descendant")).toHaveStyle(LTR);
  expect(screen.getByTestId("descendant")).not.toHaveStyle(RTL);
});

test("a changed dir prop re-derives the element and its descendants", () => {
  registerCSS(DIRECTION_CSS);

  const tree = (dir: "ltr" | "rtl") => (
    <View dir={dir}>
      <View>
        <View testID="descendant" className="paint" />
      </View>
    </View>
  );

  const { rerender } = render(tree("rtl"));
  expect(screen.getByTestId("descendant")).toHaveStyle(RTL);

  rerender(tree("ltr"));
  expect(screen.getByTestId("descendant")).toHaveStyle(LTR);
  expect(screen.getByTestId("descendant")).not.toHaveStyle(RTL);
});

test("a removed declaration falls back to what the element would have had without it", () => {
  registerCSS(DIRECTION_CSS);

  const tree = (dir: "rtl" | undefined) => (
    <View dir={dir}>
      <View testID="descendant" className="paint" />
    </View>
  );

  const { rerender } = render(tree("rtl"));
  expect(screen.getByTestId("descendant")).toHaveStyle(RTL);

  rerender(tree(undefined));
  expect(screen.getByTestId("descendant")).toHaveStyle(LTR);
  expect(screen.getByTestId("descendant")).not.toHaveStyle(RTL);
});

test("a Text declares its directionality the same way, and takes the text-side UA rule", () => {
  registerCSS(DIRECTION_CSS);

  render(
    <Text testID="subject" dir="rtl" className="paint">
      مرحبا
    </Text>,
  );

  expect(screen.getByTestId("subject")).toHaveStyle({
    ...RTL,
    writingDirection: "rtl",
  });
  expect(screen.getByTestId("subject")).not.toHaveStyle(LTR);
});

test("a declaration reaches descendants only — a sibling reads the platform's direction", () => {
  registerCSS(DIRECTION_CSS);

  render(
    <View>
      <View dir="rtl">
        <View testID="descendant" className="paint" />
      </View>
      <View testID="sibling" className="paint" />
    </View>,
  );

  expect(screen.getByTestId("descendant")).toHaveStyle(RTL);
  expect(screen.getByTestId("sibling")).toHaveStyle(LTR);
  expect(screen.getByTestId("sibling")).not.toHaveStyle(RTL);
});

test("the UA rule lands on the declaring element alone; a descendant inherits the directionality, not the style", () => {
  registerCSS(".paint { color: red; }");

  render(
    <View testID="declaring" dir="rtl" className="paint">
      <View testID="descendant" className="paint" />
    </View>,
  );

  expect(screen.getByTestId("declaring")).toHaveStyle({ direction: "rtl" });
  expect(screen.getByTestId("descendant").props.style).toStrictEqual({
    color: "#f00",
  });
});

test("every media-condition operator threads the element's directionality", () => {
  registerCSS(`
    @media not (dir: rtl) { .negated { color: red; } }
    @media (dir: rtl) and (platform: ios) { .conjoined { color: red; } }
    @media (dir: ltr) or (dir: rtl) { .either { color: red; } }
  `);

  render(
    <>
      <View testID="negated-rtl" dir="rtl" className="negated" />
      <View testID="negated-ltr" dir="ltr" className="negated" />
      <View testID="conjoined-rtl" dir="rtl" className="conjoined" />
      <View testID="conjoined-ltr" dir="ltr" className="conjoined" />
      <View testID="either" dir="rtl" className="either" />
    </>,
  );

  expect(screen.getByTestId("negated-rtl")).not.toHaveStyle(RTL);
  expect(screen.getByTestId("negated-ltr")).toHaveStyle(RTL);
  expect(screen.getByTestId("conjoined-rtl")).toHaveStyle(RTL);
  expect(screen.getByTestId("conjoined-ltr")).not.toHaveStyle(RTL);
  expect(screen.getByTestId("either")).toHaveStyle(RTL);
});

test("a :root declaration belongs to no element and reads the platform's direction", () => {
  answerIsRTL(true);
  registerCSS(`
    :root { --marker: blue; }
    @media (dir: rtl) { :root { --marker: red; } }
    .marker { color: var(--marker); }
  `);

  render(
    <View dir="ltr">
      <View testID="subject" className="marker" />
    </View>,
  );

  expect(screen.getByTestId("subject")).toHaveStyle({ color: "red" });
});

test("rendering the same tree twice yields the same styles", () => {
  registerCSS(DIRECTION_CSS);

  const tree = (
    <View dir="rtl">
      <View testID="descendant" className="paint" />
    </View>
  );

  const { rerender } = render(tree);
  const first = screen.getByTestId("descendant").props.style;

  rerender(tree);

  expect(screen.getByTestId("descendant").props.style).toStrictEqual(first);
  expect(screen.getByTestId("descendant")).toHaveStyle(RTL);
});
