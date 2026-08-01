import type {
  Declaration,
  DimensionPercentageFor_LengthValue,
} from "lightningcss";

/**
 * Rescue `transform-origin`'s z-component before lightningcss serialises it
 * away.
 *
 * lightningcss parses `transform-origin` with the `<position>` grammar — the
 * one `background-position` uses. `Position` carries only `x` and `y`, and its
 * components each carry an optional side OFFSET, so a three-value
 * `transform-origin` is not rejected; it is quietly re-read as a two-value
 * background position:
 *
 * ```
 * transform-origin: left top 30px
 *   parsed as  {x: side left, y: side top + offset 30px}
 *   meaning    x = left, y = 30px from the top      <- WRONG
 *   CSS says   x = left, y = top, z = 30px
 * ```
 *
 * That parse is lossy in one direction only, which is what makes it hard to
 * see. `right top 8px` and `center bottom 5px` survive a round-trip through
 * lightningcss's own serialiser, because `top 8px` measured from a far side
 * cannot be shortened. `left top 30px` does not — both keywords collapse to
 * `0`, and the declaration is written back as `transform-origin: 0 30px`, a
 * different transform. (`top left 30px` fares worse still: `30px 0`.)
 *
 * This compiler runs lightningcss twice, so a declaration that does not survive
 * serialisation never reaches the declaration parser at all. Normalising here,
 * inside the FIRST pass, is the only point where the original parse is still
 * intact — and it is where the loss happens, so it is where the repair belongs.
 *
 * The output is the three-length spelling, which lightningcss cannot fold and
 * cannot parse as a `Position` either. It therefore arrives at the second pass
 * as an `unparsed` declaration and is assembled by
 * `native/styles/transform-origin.ts`, so every three-value `transform-origin`
 * takes one route and one grammar implementation.
 *
 * Upstream: lightningcss should give `transform-origin` its own property type
 * rather than reusing `Position`. Until it does, this normalisation is also the
 * only thing standing between a Tailwind/Parcel WEB build and the same silent
 * corruption.
 */

interface PositionComponent {
  type: "center" | "length" | "side";
  side?: string;
  offset?: DimensionPercentageFor_LengthValue | null;
  value?: DimensionPercentageFor_LengthValue;
}

type TokenOrValue = Extract<
  Declaration,
  { property: "unparsed" }
>["value"]["value"][number];

const WHITESPACE: TokenOrValue = {
  type: "token",
  value: { type: "white-space", value: " " },
};

const lengthToken = (pixels: number): TokenOrValue => ({
  type: "length",
  value: { unit: "px", value: pixels },
});

/** Whether a rescued z-component is a `<length>`, which CSS requires it to be. */
const isLengthToken = (token: TokenOrValue): boolean => token.type === "length";

/** lightningcss models a percentage token as a FRACTION, so 50% is 0.5. */
const percentageToken = (fraction: number): TokenOrValue => ({
  type: "token",
  value: { type: "percentage", value: fraction },
});

/** `right` and `bottom` are the far sides; `left` and `top` the near ones. */
const sideToken = (side: string | undefined): TokenOrValue =>
  side === "right" || side === "bottom" ? percentageToken(1) : lengthToken(0);

function dimensionToken(
  value: DimensionPercentageFor_LengthValue,
): TokenOrValue | undefined {
  if (value.type === "percentage") {
    return percentageToken(value.value);
  }

  if (value.type === "dimension") {
    // EVERY unit, not just px. `rem` is the unit Tailwind emits, so restricting
    // this to px left the commonest spelling of the bug unfixed —
    // `transform-origin: left top 2rem` still shipped the corrupted
    // `<position>` parse. lightningcss's `LengthValue` carries the unit, the
    // second pass reads it back, and the runtime resolver resolves it before
    // checking the z is a number.
    return { type: "length", value: value.value };
  }

  // A `calc()` keeps a structure the token forms here cannot carry, so it is
  // left to the ordinary parsed route.
  return;
}

function componentToken(
  component: PositionComponent,
): TokenOrValue | undefined {
  switch (component.type) {
    case "center":
      return percentageToken(0.5);
    case "side":
      return sideToken(component.side);
    case "length":
      return component.value ? dimensionToken(component.value) : undefined;
    default:
      return;
  }
}

export function normalizeTransformOriginDeclaration(
  declaration: Declaration,
): Declaration | undefined {
  if (declaration.property !== "transform-origin") {
    return;
  }

  const x = declaration.value.x as PositionComponent;
  const y = declaration.value.y as PositionComponent;

  const xOffset = x.type === "side" ? (x.offset ?? undefined) : undefined;
  const yOffset = y.type === "side" ? (y.offset ?? undefined) : undefined;

  // The z folds onto whichever component was written LAST, so exactly one of
  // the two carries an offset. Both carrying one means four tokens
  // (`left 10px top 20px`) — `background-position`'s grammar, which
  // `transform-origin` has no reading for, so it is left to be refused.
  //
  // One reading has to be CHOSEN here, because the wrong grammar has already
  // made two different declarations identical:
  //
  // ```
  // transform-origin: center left 10px   valid    x=left, y=center, z=10px
  // transform-origin: left 10px center   INVALID  (no such production)
  //   both parse to  {x: side left + offset 10px, y: center}
  // ```
  //
  // Reading the offset as the z is what makes the VALID spelling render. The
  // invalid one then renders as though it had been written the valid way,
  // which is a better failure than refusing the valid one — an invalid
  // declaration has no correct rendering to lose.
  if ((xOffset === undefined) === (yOffset === undefined)) {
    return;
  }

  const zSource = xOffset ?? yOffset;
  if (zSource === undefined) {
    return;
  }

  const z = dimensionToken(zSource);
  const xToken = componentToken(x);
  const yToken = componentToken(y);

  // The z-component is a `<length>`, so a percentage there is invalid CSS.
  if (
    z === undefined ||
    !isLengthToken(z) ||
    xToken === undefined ||
    yToken === undefined
  ) {
    return;
  }

  return {
    property: "unparsed",
    value: {
      propertyId: { property: "transform-origin" },
      value: [xToken, WHITESPACE, yToken, WHITESPACE, z],
    },
  } as Declaration;
}
