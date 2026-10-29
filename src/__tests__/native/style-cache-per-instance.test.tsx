// The resolved-style cache holds one entry per distinct class list, so 50 identical elements resolve one style set
import { View as RNView } from "react-native";

import { render } from "@testing-library/react-native";
import { View } from "react-native-css/components/View";
import { registerCSS } from "react-native-css/jest";
import { styled } from "react-native-css/native";

import { stylesFamily } from "../../native/styles";

const StyledView = styled(RNView, { className: { target: "style" } });

test.each([
  ["View", View],
  ["styled(View)", StyledView],
])(
  "50 identical %s elements hold one resolved-style cache entry",
  (_name, Component) => {
    registerCSS(`.probe { color: red; width: 10px; }`);
    stylesFamily.clear();

    render(
      <>
        {Array.from({ length: 50 }, (_unused, index) => (
          <Component key={index} className="probe" />
        ))}
      </>,
    );

    expect(stylesFamily.size()).toBe(1);
  },
);
