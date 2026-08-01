import { repeatShorthandHandler } from "./_expand";

/**
 * The shorthands whose values are the block axis then the inline axis, expanded
 * from the values a `var()` supplied.
 *
 * React Native has fewer keys here than CSS has positions: there is no
 * `justifyItems`, no `justifySelf`, and `overflow` is one key rather than one
 * per axis. Those positions are named `undefined` in the table, so the value is
 * read and discarded exactly as the compile-time parsers discard it.
 */

export const placeItems = repeatShorthandHandler({
  positions: ["alignItems", undefined],
});

export const placeContent = repeatShorthandHandler({
  positions: ["alignContent", "justifyContent"],
});

export const placeSelf = repeatShorthandHandler({
  positions: ["alignSelf", undefined],
});

export const overflow = repeatShorthandHandler({
  positions: ["overflow", undefined],
});
