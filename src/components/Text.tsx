import { Text as RNText, type TextProps } from "react-native";

import {
  useCssElement,
  type StyledConfiguration,
  type StyledProps,
} from "react-native-css";

import { copyComponentProperties } from "./copyComponentProperties";

// Text is the component that RENDERS the CSS inherited text properties, so it
// is the component that declares it receives them — the same way TextInput
// declares its own `nativeStyleMapping`. Keeping this here rather than
// special-casing Text inside `useNativeCss` is what lets the runtime stay
// component-agnostic, and lets a custom `styled()` text component opt in.
const mapping = {
  className: {
    target: "style",
    inheritsTextStyle: true,
  },
} satisfies StyledConfiguration<typeof RNText>;

export const Text = copyComponentProperties(
  RNText,
  (props: StyledProps<TextProps, typeof mapping>) => {
    return useCssElement(RNText, props, mapping);
  },
);

export default Text;
