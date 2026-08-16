import { fireEvent, render, screen } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";

/**
 * The rendered half of `compiler/inherited-color-scope.test.ts`.
 *
 * The compiler tests prove the right descriptor is emitted; they cannot prove
 * the runtime reads it from the right scope, and the scope is the whole defect.
 * Every case here therefore puts a colour on the element ITSELF as well as on
 * its ancestor — with only an ancestor colour in play both scopes answer the
 * same, so a test without the element's own colour cannot fail whichever scope
 * the read used.
 */
describe("`color: inherit` reads past the element's own colour", () => {
  test("under a pseudo-class, beside a colour the element declares", () => {
    registerCSS(`
      .parent { color: red; }
      .child { color: blue; }
      .child:hover { color: inherit; }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    const child = screen.getByTestId("child");

    expect(child.props.style).toStrictEqual({ color: "#00f" });

    fireEvent(child, "hoverIn", {});

    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
    });
  });

  test("as `!important`, beside a colour another class on the same element declares", () => {
    // Both classes match, so the element's own scope holds `.override`'s blue
    // whichever order they resolve in. `!important` decides which DECLARATION
    // wins; it cannot decide which scope the winner reads from.
    registerCSS(`
      .parent { color: red; }
      .child { color: inherit !important; }
      .override { color: blue; }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child override" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
    });
  });

  test("through an ancestor colour that is an UNINLINED variable", () => {
    // A second definition of `--brand` stops the compiler inlining it, so what
    // the ancestor publishes is the `var()` lookup itself rather than a colour.
    // The descendant redefines the same name — so resolving the inherited
    // descriptor in the DESCENDANT's scope answers blue, and only resolving it
    // in the scope it came from answers the ancestor's red.
    registerCSS(`
      .parent { --brand: #ff0000; color: var(--brand); }
      .child { --brand: #0000ff; color: inherit; }
    `);

    render(
      <View testID="parent" className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    const parentColor = screen.getByTestId("parent").props.style.color;

    expect(parentColor).toBeDefined();
    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: parentColor,
    });
  });

  test("through a middle element that inherits too", () => {
    // The middle element publishes NOTHING, so the grandchild's context still
    // carries the parent's colour. A middle element that republished its own
    // lookup would hand the grandchild a reference to itself, and the
    // grandchild would resolve nothing.
    registerCSS(`
      .parent { color: red; }
      .middle { color: inherit; }
      .child { color: inherit; }
    `);

    render(
      <View className="parent">
        <View testID="middle" className="middle">
          <View testID="child" className="child" />
        </View>
      </View>,
    );

    expect(screen.getByTestId("middle").props.style).toStrictEqual({
      color: "#f00",
    });
    expect(screen.getByTestId("child").props.style).toStrictEqual({
      color: "#f00",
    });
  });

  test("with no coloured ancestor at all, both reads land on the root seed", () => {
    // The channel's last rung is the `:root` registry, which seeds the platform
    // label colour. Without it an element with no coloured ancestor would
    // resolve nothing and React Native would paint its default.
    //
    // Asserted as an agreement between the two reads rather than against a
    // colour literal: the seed is a `PlatformColor` on iOS and a scheme-aware
    // pair on Android, so a literal would pin the platform the suite happens to
    // run as. What matters is that the inherited-scope read still reaches the
    // rung the cascading one does.
    registerCSS(`
      .inheriting { color: inherit; }
      .bordered { border-color: currentcolor; border-width: 1px; }
    `);

    render(
      <View>
        <View testID="inheriting" className="inheriting" />
        <View testID="bordered" className="bordered" />
      </View>,
    );

    const seeded = screen.getByTestId("inheriting").props.style.color;

    expect(seeded).toBeDefined();
    expect(screen.getByTestId("bordered").props.style).toMatchObject({
      borderColor: seeded,
    });
  });
});

/**
 * A rule publishes its OWN value, so an element carrying two colour rules
 * publishes the loser's.
 *
 * `.middle { color: blue }` publishes blue and `.middle:hover { color: inherit }`
 * withholds, so under hover the middle renders the ancestor's red — correctly,
 * because the read skips its own scope — while a descendant still inherits the
 * blue the losing rule published. Both the read and the publish would have to
 * be the element's COMPUTED colour for these to agree, and the publish happens
 * per rule, before any cascade between them has been resolved.
 *
 * Pre-existing and unchanged by the scope split: measured on `ae2f881`, where
 * the descendant reads the same blue by a different route. Pinned rather than
 * fixed so that whichever change makes the publish computed-value-shaped has to
 * update this expectation deliberately.
 */
test("a losing colour rule still publishes, so a descendant can disagree with its parent", () => {
  registerCSS(`
    .parent { color: red; }
    .middle { color: blue; }
    .middle:hover { color: inherit; }
    .child { color: inherit; }
  `);

  render(
    <View className="parent">
      <View testID="middle" className="middle">
        <View testID="child" className="child" />
      </View>
    </View>,
  );

  fireEvent(screen.getByTestId("middle"), "hoverIn", {});

  // The middle itself is right — this half IS the fix, and it renders the
  // element's own blue without it.
  expect(screen.getByTestId("middle").props.style).toStrictEqual({
    color: "#f00",
  });
  // The descendant is not, and this half is the standing limitation.
  expect(screen.getByTestId("child").props.style).toStrictEqual({
    color: "#00f",
  });
});

describe("`currentcolor` elsewhere reads the element's OWN colour", () => {
  test("beside a colour the element declares", () => {
    // The discriminator for the whole fix. On a property that is not `color`,
    // `currentcolor` is the element's own computed colour — so this must be
    // blue while the `color: inherit` cases above are red, and one read cannot
    // serve both.
    registerCSS(`
      .parent { color: red; }
      .child { color: blue; border-color: currentcolor; border-width: 1px; }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toMatchObject({
      borderColor: "#00f",
      color: "#00f",
    });
  });

  test("falling through to the ancestor when the element declares none", () => {
    // The same cascading read, one rung further on: with nothing in the
    // element's own scope the ancestor's entry answers, which is what makes
    // `border-color: currentcolor` follow inherited text colour.
    registerCSS(`
      .parent { color: red; }
      .child { border-color: currentcolor; border-width: 1px; }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toMatchObject({
      borderColor: "#f00",
    });
  });

  test("inside a rule whose own `color` is itself inherited", () => {
    // `unset` computes to `inherit` on `color`, so the element's computed
    // colour IS the ancestor's — and `currentcolor` beside it has to agree.
    // The two spellings reach that answer by different reads, which is why
    // they are worth pinning together.
    registerCSS(`
      .parent { color: red; }
      .child { color: unset; border-color: currentcolor; border-width: 1px; }
    `);

    render(
      <View className="parent">
        <View testID="child" className="child" />
      </View>,
    );

    expect(screen.getByTestId("child").props.style).toMatchObject({
      borderColor: "#f00",
      color: "#f00",
    });
  });
});
