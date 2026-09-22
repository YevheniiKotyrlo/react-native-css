import { fireEvent, render, screen } from "@testing-library/react-native";
import { compile } from "react-native-css/compiler";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

const RED = { color: "#f00" };

const CHAIN_CSS = `.outer .inner .subject { color: red; }`;

describe("the compiled shape the runtime walks", () => {
  test("ancestor compounds are emitted OUTERMOST first", () => {
    const rules = compile(CHAIN_CSS)
      .stylesheet()
      .s?.find(([name]) => name === "subject")?.[1];

    expect(rules?.[0]?.cq).toStrictEqual([{ n: "g:outer" }, { n: "g:inner" }]);
  });

  test("each ancestor class registers itself as a container", () => {
    const stylesheet = compile(CHAIN_CSS).stylesheet();

    expect(
      stylesheet.s?.find(([name]) => name === "outer")?.[1]?.[0]?.c,
    ).toStrictEqual(["g:outer"]);
    expect(
      stylesheet.s?.find(([name]) => name === "inner")?.[1]?.[0]?.c,
    ).toStrictEqual(["g:inner"]);
  });
});

describe("a chain answers the nesting, not the set", () => {
  test("it applies when the ancestors nest in the order the selector names", () => {
    registerCSS(CHAIN_CSS);

    render(
      <View className="outer">
        <View className="inner">
          <View testID="subject" className="subject" />
        </View>
      </View>,
    );

    expect(screen.getByTestId("subject")).toHaveStyle(RED);
  });

  test("it does NOT apply when the same two ancestors nest the other way round", () => {
    registerCSS(CHAIN_CSS);

    render(
      <View className="inner">
        <View className="outer">
          <View testID="subject" className="subject" />
        </View>
      </View>,
    );

    expect(screen.getByTestId("subject").props.style).toStrictEqual(undefined);
  });

  test("it does not apply when neither ancestor contains the other", () => {
    registerCSS(CHAIN_CSS);

    render(
      <>
        <View className="inner" />
        <View className="outer">
          <View testID="subject" className="subject" />
        </View>
      </>,
    );

    expect(screen.getByTestId("subject").props.style).toStrictEqual(undefined);
  });

  test("intervening elements do not break the chain", () => {
    registerCSS(CHAIN_CSS);

    render(
      <View className="outer">
        <View>
          <View className="inner">
            <View>
              <View testID="subject" className="subject" />
            </View>
          </View>
        </View>
      </View>,
    );

    expect(screen.getByTestId("subject")).toHaveStyle(RED);
  });

  test("a three-deep chain answers the same way", () => {
    registerCSS(`.a .b .c .subject { color: red; }`);

    render(
      <>
        <View className="a">
          <View className="b">
            <View className="c">
              <View testID="ordered" className="subject" />
            </View>
          </View>
        </View>
        <View className="a">
          <View className="c">
            <View className="b">
              <View testID="swapped" className="subject" />
            </View>
          </View>
        </View>
      </>,
    );

    expect(screen.getByTestId("ordered")).toHaveStyle(RED);
    expect(screen.getByTestId("swapped").props.style).toStrictEqual(undefined);
  });

  test("one ancestor carrying both class names satisfies neither position twice", () => {
    registerCSS(CHAIN_CSS);

    render(
      <View className="outer inner">
        <View testID="subject" className="subject" />
      </View>,
    );

    expect(screen.getByTestId("subject").props.style).toStrictEqual(undefined);
  });
});

describe("what the chain walk must not move", () => {
  test("a single ancestor is unchanged", () => {
    registerCSS(`.group .subject { color: red; }`);

    render(
      <>
        <View className="group">
          <View testID="under" className="subject" />
        </View>
        <View testID="outside" className="subject" />
      </>,
    );

    expect(screen.getByTestId("under")).toHaveStyle(RED);
    expect(screen.getByTestId("outside").props.style).toStrictEqual(undefined);
  });

  test("an interaction condition still reads the container it is written on", () => {
    registerCSS(`.outer .inner:hover .subject { color: red; }`);

    render(
      <View className="outer">
        <View testID="inner" className="inner">
          <View testID="subject" className="subject" />
        </View>
      </View>,
    );

    expect(screen.getByTestId("subject").props.style).toStrictEqual(undefined);

    fireEvent(screen.getByTestId("inner"), "hoverIn");

    expect(screen.getByTestId("subject")).toHaveStyle(RED);
  });

  test("an interaction condition on the OUTER compound reads the outer container", () => {
    registerCSS(`.outer:hover .inner .subject { color: red; }`);

    render(
      <View testID="outer" className="outer">
        <View testID="inner" className="inner">
          <View testID="subject" className="subject" />
        </View>
      </View>,
    );

    fireEvent(screen.getByTestId("inner"), "hoverIn");
    expect(screen.getByTestId("subject").props.style).toStrictEqual(undefined);

    fireEvent(screen.getByTestId("outer"), "hoverIn");
    expect(screen.getByTestId("subject")).toHaveStyle(RED);
  });

  test("a chain re-derives when an ancestor's condition changes", () => {
    registerCSS(`.outer .inner:hover .subject { color: red; }`);

    render(
      <View className="outer">
        <View testID="inner" className="inner">
          <View testID="subject" className="subject" />
        </View>
      </View>,
    );

    fireEvent(screen.getByTestId("inner"), "hoverIn");
    expect(screen.getByTestId("subject")).toHaveStyle(RED);

    fireEvent(screen.getByTestId("inner"), "hoverOut");
    expect(screen.getByTestId("subject").props.style).toStrictEqual(undefined);
  });

  test("rendering the same tree twice yields the same styles", () => {
    registerCSS(CHAIN_CSS);

    const tree = (
      <View className="outer">
        <View className="inner">
          <View testID="subject" className="subject" />
        </View>
      </View>
    );

    const { rerender } = render(tree);
    const first = screen.getByTestId("subject").props.style;

    rerender(tree);

    expect(screen.getByTestId("subject").props.style).toStrictEqual(first);
  });
});
