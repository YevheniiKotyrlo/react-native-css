import { Text } from "react-native-css/components/Text";
import { View } from "react-native-css/components/View";

import { render } from "./_tailwind";

test("render takes an element whose child is text", async () => {
  await expect(render(<Text className="text-red-500">hello</Text>)).resolves.toBeDefined();
});

test("render takes an element with a false child", async () => {
  await expect(render(<View className="p-1">{false}</View>)).resolves.toBeDefined();
});
