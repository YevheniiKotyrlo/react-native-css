import { Text, View } from "react-native-css/components";

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

test("a render whose CSS fails to compile rejects", async () => {
  await expect(
    render(<View className="left-0" />, { css: '@import "./missing.css";' }),
  ).rejects.toThrow("Can't resolve './missing.css'");
});

test("a render after one whose CSS uses no Tailwind feature compiles its own classes", async () => {
  await render(<View className="left-0" />, {
    css: "@theme { --color-brand: red; }",
  });
  const { stylesheet } = await render(<View className="left-1" />);

  expect(stylesheet().s?.map(([name]) => name)).toStrictEqual(["left-1"]);
});

test("a render leaves a caller's console.error spy in place", async () => {
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);

  try {
    await render(<View className="left-0" />);
    console.error("after the render");

    expect(consoleError).toHaveBeenCalledWith("after the render");
  } finally {
    consoleError.mockRestore();
  }
});

test("a render collects the classes of a tree with text and empty children", async () => {
  const { stylesheet } = await render(
    <View className="left-0">
      <Text>label</Text>
      {null}
      {false}
    </View>,
  );

  expect(stylesheet().s?.map(([name]) => name)).toStrictEqual(["left-0"]);
});
