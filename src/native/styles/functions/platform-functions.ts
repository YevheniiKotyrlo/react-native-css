import { PixelRatio, PlatformColor, StyleSheet } from "react-native";

import type { StyleFunctionResolver } from "../resolve";

export const platformColor: StyleFunctionResolver = (resolveValue, value) => {
  const color: unknown = resolveValue(value[2]);
  if (Array.isArray(color)) {
    return PlatformColor(...(color as string[]));
  } else if (typeof color === "string") {
    return PlatformColor(color);
  }

  return;
};

export const hairlineWidth: StyleFunctionResolver = () => {
  return StyleSheet.hairlineWidth;
};

/**
 * Named for the function the compiler EMITS, which is `pixelScale()`
 * (`parseUnparsed`'s allow-list). The resolver was called `pixelRatio`, so no
 * name ever matched it and `width: pixelScale(2)` reached React Native as the
 * literal string `"pixelScale(2)"`.
 */
export const pixelScale: StyleFunctionResolver = () => {
  return PixelRatio.get();
};

export const fontScale: StyleFunctionResolver = () => {
  return PixelRatio.getFontScale();
};

export const getPixelSizeForLayoutSize: StyleFunctionResolver = (
  resolveValue,
  value,
) => {
  const size: unknown = resolveValue(value[2]);
  if (typeof size === "number") {
    return PixelRatio.getPixelSizeForLayoutSize(size);
  }

  return;
};

export const roundToNearestPixel: StyleFunctionResolver = (
  resolveValue,
  value,
) => {
  const size: unknown = resolveValue(value[2]);
  if (typeof size === "number") {
    return PixelRatio.roundToNearestPixel(size);
  }

  return;
};
