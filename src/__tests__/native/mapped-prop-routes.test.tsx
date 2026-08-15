import { render } from "@testing-library/react-native";
import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";
import { registerCSS, testID } from "react-native-css/jest";

import {
  renderRoutes,
  ROUTE_NAMES,
  type RenderedProps,
  type RouteName,
  type RouteSurface,
} from "./_routes/harness";

/**
 * A declaration whose target is a PROP, resolved at runtime.
 *
 * `calculate-props.ts` parks a placeholder for any value it cannot resolve
 * immediately — `{ [prop]: true }` — and swaps it for the real value in a
 * callback that runs once every rule has been read. The swap finds its
 * placeholder by reading the target object back, so it depends on reaching the
 * object the declaration actually wrote to.
 *
 * `applyDeclarations` walks every declaration of a rule with ONE `target`
 * binding, moving it to `topLevelTarget` for a mapped prop, to a nested object
 * for a deep path, and back to the style object at the top of the next
 * iteration. A callback that read that binding after the loop would read
 * whatever the last declaration left, look for its placeholder in another
 * declaration's object, fail to find it, and leave the placeholder standing as
 * the delivered value. Each declaration therefore captures its own target, and
 * these tests are what hold that.
 *
 * The three shapes a shared binding produces, each pinned below:
 *
 * - `object-fit: var(--f)` delivers `contentFit: {contentFit: true}` to
 *   expo-image, which wants a string. `parseObjectFit` emits the mapped
 *   descriptor first and an `objectFit` style descriptor second, so the style
 *   key resolves and the prop does not — `props.style` is identical on every
 *   route, which is why a style-only comparison cannot see it.
 * - `-webkit-line-clamp: var(--n); color: var(--c)` delivers
 *   `numberOfLines: {numberOfLines: true}`.
 * - The same two declarations in the opposite order deliver
 *   `style.color: {color: true}` — the placeholder leaks into the STYLE just as
 *   readily, so this is a property of the shared binding rather than of props.
 */

/**
 * A rule whose values all arrive at runtime.
 *
 * Every custom property is defined twice — once at `:root` and once behind a
 * media query that does not match — so the compiler cannot fold it and every
 * declaration in the rule takes the deferred route. Which is what makes a
 * placeholder necessary in the first place.
 */
const deferredRule = (declarations: string): string => `
  :root {
    --a: red; --b: 3; --c: contain; --d: 4px;
    --rs: borderless; --rl: foreground; --op: 10px 20px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --a: blue; --b: 4; --c: cover; --d: 5px;
      --rs: unset; --rl: background; --op: 30px 40px;
    }
  }
  .subject { ${declarations} }
`;

/**
 * Everything `.subject` delivers, style INCLUDED.
 *
 * The style stays in the bag here — unlike the census harness, which compares
 * the two halves separately — because these cases assert both at once: the
 * placeholder lands in whichever half the LAST declaration did not target, so a
 * test that looked at one half would pass on half the fault.
 */
function renderedProps(css: string, surface: RouteSurface): RenderedProps {
  registerCSS(css);

  const element =
    surface === "text" ? (
      <Text testID={testID} className="subject" />
    ) : (
      <View testID={testID} className="subject" />
    );

  const rendered = render(element).getByTestId(testID).props as RenderedProps;

  return Object.fromEntries(
    Object.entries(rendered).filter(
      ([key]) => key !== "children" && key !== "testID",
    ),
  );
}

/** One prop's value on every route, so a divergence names the routes. */
function propOnEveryRoute(
  routeCase: Parameters<typeof renderRoutes>[0],
  prop: string,
): Record<RouteName, unknown> {
  const renders = renderRoutes(routeCase);

  return Object.fromEntries(
    ROUTE_NAMES.map((route) => [route, renders[route].props[prop]]),
  ) as Record<RouteName, unknown>;
}

describe("a mapped prop resolves on every route", () => {
  test("object-fit reaches expo-image's contentFit as a string", () => {
    expect(
      propOnEveryRoute(
        { property: "object-fit", value: "contain", alternate: "cover" },
        "contentFit",
      ),
    ).toStrictEqual({
      literal: "contain",
      inlinable: "contain",
      fallback: "contain",
      deferred: "contain",
      provider: "contain",
    });
  });

  test("object-fit's style key keeps agreeing with its prop", () => {
    // Both halves of `parseObjectFit`. React Native's own `<Image>` reads the
    // style key and expo-image reads the prop, so a fix that resolved one and
    // dropped the other would still be wrong.
    const renders = renderRoutes({
      property: "object-fit",
      value: "contain",
      alternate: "cover",
    });

    for (const route of ROUTE_NAMES) {
      expect(renders[route].style).toStrictEqual({ objectFit: "contain" });
    }
  });

  test("-webkit-line-clamp reaches Text's numberOfLines as a number", () => {
    expect(
      propOnEveryRoute(
        {
          property: "-webkit-line-clamp",
          value: "3",
          alternate: "4",
          surface: "text",
        },
        "numberOfLines",
      ),
    ).toStrictEqual({
      literal: 3,
      inlinable: 3,
      fallback: 3,
      deferred: 3,
      provider: 3,
    });
  });

  test("object-position reaches contentPosition as joined lengths", () => {
    expect(
      propOnEveryRoute(
        {
          property: "object-position",
          value: "10px 20px",
          alternate: "30px 40px",
        },
        "contentPosition",
      ),
    ).toStrictEqual({
      literal: "10 20",
      inlinable: "10 20",
      fallback: "10 20",
      deferred: "10 20",
      provider: "10 20",
    });
  });

  test("-rn-ripple-color reaches the nested android_ripple.color path", () => {
    // A two-segment path, which lands the declaration on a nested object rather
    // than on the props root — the other shape the target binding takes.
    const ripple = propOnEveryRoute(
      { property: "-rn-ripple-color", value: "red", alternate: "blue" },
      "android_ripple",
    );

    // `red` on every route, including the compile-time ones. lightningcss does
    // not model a `-rn-*` property, so its value is an uninterpreted token
    // stream on all five and nothing normalises the colour to `#f00`.
    expect(ripple).toStrictEqual({
      literal: { color: "red" },
      inlinable: { color: "red" },
      fallback: { color: "red" },
      deferred: { color: "red" },
      provider: { color: "red" },
    });
  });
});

describe("a deferred declaration writes to its OWN target", () => {
  test("a mapped prop before a style declaration", () => {
    expect(
      renderedProps(
        deferredRule(`-webkit-line-clamp: var(--b); color: var(--a);`),
        "text",
      ),
    ).toStrictEqual({
      numberOfLines: 3,
      style: { color: "red" },
    });
  });

  test("a style declaration before a mapped prop", () => {
    // The reverse order, and the one that leaks a placeholder into the STYLE:
    // the last declaration leaves the binding on the props root, so the style
    // declaration's swap reads `props.color` and finds nothing.
    expect(
      renderedProps(
        deferredRule(`color: var(--a); -webkit-line-clamp: var(--b);`),
        "text",
      ),
    ).toStrictEqual({
      numberOfLines: 3,
      style: { color: "red" },
    });
  });

  test("a nested prop path before a style declaration", () => {
    expect(
      renderedProps(
        deferredRule(`-rn-ripple-color: var(--a); width: var(--d);`),
        "view",
      ),
    ).toStrictEqual({
      android_ripple: { color: "red" },
      style: { width: 4 },
    });
  });

  test("two mapped props in one rule", () => {
    expect(
      renderedProps(
        deferredRule(`-rn-ripple-color: var(--a); object-fit: var(--c);`),
        "view",
      ),
    ).toStrictEqual({
      android_ripple: { color: "red" },
      contentFit: "contain",
      style: { objectFit: "contain" },
    });
  });

  test("a transform key before a mapped prop", () => {
    // A transform key resolves through `transformStyles` rather than
    // `delayedStyles`, and reads the same binding. With the mapped prop last,
    // the transform entry landed on the props root as `props.transform`.
    //
    // `objectFit` in the style is the second half of `parseObjectFit`: the same
    // value is emitted to React Native's own `<Image>` style key as well as to
    // expo-image's prop.
    expect(
      renderedProps(
        deferredRule(`transform: translateX(10px); object-fit: var(--c);`),
        "view",
      ),
    ).toStrictEqual({
      contentFit: "contain",
      style: { objectFit: "contain", transform: [{ translateX: 10 }] },
    });
  });

  test("an @nativeMapping declaration beside a style declaration", () => {
    // The userland escape hatch takes the same path as the built-in mappings,
    // so it carries the same fault and the same fix. Asserted in both
    // declaration orders because the placeholder leaks whichever declaration is
    // last: the mapped one strands the style, the style one strands the prop.
    const expected = {
      myBackgroundColor: "red",
      style: { width: 4 },
    };

    expect(
      renderedProps(
        deferredRule(
          `background-color: var(--a); width: var(--d); @nativeMapping background-color: myBackgroundColor;`,
        ),
        "view",
      ),
    ).toStrictEqual(expected);

    expect(
      renderedProps(
        deferredRule(
          `width: var(--d); background-color: var(--a); @nativeMapping background-color: myBackgroundColor;`,
        ),
        "view",
      ),
    ).toStrictEqual(expected);
  });
});

/**
 * Every property this library maps to a PROP, each one deferred and each one
 * followed by a style declaration — the arrangement that strands a placeholder.
 *
 * The census is the two places a mapping is declared: the default table in
 * `parsePropAtRule` (`src/compiler/atRules.ts`) and the two `builder.addMapping`
 * calls `parseObjectFit` / `parseObjectPosition` make at parse time
 * (`src/compiler/declarations.ts`). `@nativeMapping`, the third source, is
 * userland and is covered by its own case above.
 */
describe("every mapped property survives a following style declaration", () => {
  test.each([
    ["caret-color", "var(--a)", { cursorColor: "red" }],
    ["fill", "var(--a)", { fill: "red" }],
    ["stroke", "var(--a)", { stroke: "red" }],
    ["stroke-width", "var(--d)", { strokeWidth: 4 }],
    ["-webkit-line-clamp", "var(--b)", { numberOfLines: 3 }],
    ["-rn-ripple-color", "var(--a)", { android_ripple: { color: "red" } }],
    ["-rn-ripple-style", "var(--rs)", { android_ripple: { borderless: true } }],
    ["-rn-ripple-radius", "var(--d)", { android_ripple: { radius: 4 } }],
    ["-rn-ripple-layer", "var(--rl)", { android_ripple: { foreground: true } }],
    [
      "object-fit",
      "var(--c)",
      { contentFit: "contain", style: { objectFit: "contain" } },
    ],
    ["object-position", "var(--op)", { contentPosition: "10 20" }],
  ] as const)("%s", (property, value, expected) => {
    const { style, ...props } = renderedProps(
      deferredRule(`${property}: ${value}; width: var(--d);`),
      "view",
    );

    const { style: expectedStyle, ...expectedProps } = expected as Record<
      string,
      unknown
    >;

    expect(props).toStrictEqual(expectedProps);
    // `width` is the following declaration, and its presence is half the
    // assertion: with the binding shared, the mapped prop's placeholder took
    // the style's slot and `width` never resolved.
    expect(style).toStrictEqual({
      width: 4,
      ...(expectedStyle as Record<string, unknown> | undefined),
    });
  });
});
