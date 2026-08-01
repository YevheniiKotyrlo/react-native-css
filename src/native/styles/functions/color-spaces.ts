import {
  A98RGB,
  ColorSpace,
  HSL,
  HWB,
  Lab,
  LCH,
  OKLab,
  OKLCH,
  P3,
  ProPhoto,
  REC_2020,
  sRGB,
  sRGB_Linear,
  XYZ_D50,
  XYZ_D65,
} from "colorjs.io/fn";

/**
 * Every colour space css-color-5 §3 permits in `color-mix()`, registered once
 * for the whole runtime.
 *
 * colorjs's tree-shakeable entry point requires a space to be registered before
 * anything — `parse`, `to`, `mix` — can name it, and the registry is process
 * global. That makes registration a load-order dependency between modules,
 * which is why it lives in a module of its own rather than in whichever colour
 * function happened to need it first: `color-functions.ts` parses an origin
 * colour, `color-mix.ts` interpolates, and neither may assume the other was
 * imported.
 *
 * Three of the fifteen were registered before this list existed, and one of
 * those three — `P3` — was reached for under colorjs's id `p3` while CSS spells
 * it `display-p3`, so it never matched either. Twelve spaces threw inside
 * `mix()` and were swallowed, dropping the declaration with no warning.
 */
for (const space of [
  A98RGB,
  HSL,
  HWB,
  Lab,
  LCH,
  OKLab,
  OKLCH,
  P3,
  ProPhoto,
  REC_2020,
  sRGB,
  sRGB_Linear,
  XYZ_D50,
  XYZ_D65,
]) {
  ColorSpace.register(space);
}

/** The spaces whose CSS name differs from colorjs's id. */
export const SPACE_ID: Record<string, string | undefined> = {
  "a98-rgb": "a98rgb",
  "display-p3": "p3",
  "prophoto-rgb": "prophoto",
};
