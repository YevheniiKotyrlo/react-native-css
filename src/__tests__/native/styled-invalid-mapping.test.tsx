import { View } from "react-native";

import { styled } from "react-native-css";

test.each([
  [
    "an entry set to null",
    { className: { target: "style", nativeStyleMapping: { color: null } } },
  ],
  [
    "an entry set to false",
    { className: { target: "style", nativeStyleMapping: { color: false } } },
  ],
  ["a mapping set to null", { className: null }],
  [
    "a nativeStyleMapping set to a string",
    {
      className: { target: "style", nativeStyleMapping: "accessibilityLabel" },
    },
  ],
])("%s fails at styled() with its Invalid mapping error", (_, mapping) => {
  expect(() => styled(View, mapping as never)).toThrow(
    "styled(): Invalid mapping for className",
  );
});
