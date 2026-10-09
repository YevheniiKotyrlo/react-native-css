import { render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { registerCSS, testID } from "react-native-css/jest";

// A second definition keeps each variable from being inlined, so it resolves at runtime
const decoy = `.decoy { --c: green; --n: 9; }`;

function renderText(css: string) {
  registerCSS(`${decoy} ${css}`);

  return render(<Text testID={testID} className="my-class" />).getByTestId(
    testID,
  ).props;
}

// A deferred declaration resolves after every other one in its rule, against the target it was declared on
describe("a deferred declaration beside a nested one", () => {
  test("color: var() beside a box-shadow", () => {
    expect(
      renderText(
        `.my-class { --c: red; color: var(--c); box-shadow: 1px 1px blue; }`,
      ).style,
    ).toStrictEqual({
      color: "red",
      boxShadow: [
        {
          color: "#00f",
          offsetX: 1,
          offsetY: 1,
          blurRadius: 0,
          spreadDistance: 0,
        },
      ],
    });
  });

  test("color: var() beside a text-shadow", () => {
    expect(
      renderText(
        `.my-class { --c: red; color: var(--c); text-shadow: 1px 1px 2px blue; }`,
      ).style,
    ).toStrictEqual({
      color: "red",
      textShadowColor: "#00f",
      textShadowRadius: 2,
      textShadowOffset: { width: 1, height: 1 },
    });
  });

  test("color: var() beside a prop", () => {
    const props = renderText(
      `.my-class { --c: red; color: var(--c); -webkit-line-clamp: 2; }`,
    );

    expect(props.style).toStrictEqual({ color: "red" });
    expect(props.numberOfLines).toBe(2);
  });

  test("a deferred prop beside a style", () => {
    const props = renderText(
      `.my-class { --n: 2; -webkit-line-clamp: var(--n); --c: red; color: var(--c); }`,
    );

    expect(props.style).toStrictEqual({ color: "red" });
    expect(props.numberOfLines).toBe(2);
  });
});
