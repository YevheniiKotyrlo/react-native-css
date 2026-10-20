import { View } from "react-native-css/components";

import { render } from "./_tailwind";

test("renders that read the same millisecond compile and apply their own classes", async () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(0);

  try {
    for (const [className, style] of [
      ["left-0", { left: 0 }],
      ["left-1", { left: 3.5 }],
    ] as const) {
      const { stylesheet, getByTestId } = await render(
        <View testID={className} className={className} />,
      );

      expect(stylesheet().s?.map(([name]) => name)).toStrictEqual([className]);
      expect(getByTestId(className).props.style).toStrictEqual(style);
    }
  } finally {
    now.mockRestore();
  }
});
