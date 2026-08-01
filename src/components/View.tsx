import { View as RNView, type ViewProps } from "react-native";

import {
  useCssElement,
  type StyledConfiguration,
  type StyledProps,
} from "react-native-css";

import { copyComponentProperties } from "./copyComponentProperties";

// `resetsTextAncestor` mirrors React Native: its own `View` sets
// `TextAncestorContext` back to `false`, because a View inside a Text starts a
// fresh box and the native Text -> Text inheritance does not cross it. Without
// the same reset here, a `<Text><View className="text-red"><Text/></View></Text>`
// would fall through BOTH mechanisms — React Native's native inheritance is
// broken by the View, and the CSS path would still believe a Text ancestor was
// handling it.
const mapping = {
  className: {
    target: "style",
    resetsTextAncestor: true,
  },
} satisfies StyledConfiguration<typeof RNView>;

export const View = copyComponentProperties(
  RNView,
  (props: StyledProps<ViewProps, typeof mapping>) => {
    return useCssElement(RNView, props, mapping);
  },
);

export default View;
