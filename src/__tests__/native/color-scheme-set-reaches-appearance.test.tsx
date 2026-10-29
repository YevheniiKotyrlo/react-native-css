// colorScheme.set() is a request every reader of the scheme hears, so it reaches Appearance, which useColorScheme() reads
import { Appearance } from "react-native";

import { colorScheme } from "react-native-css/native";

afterEach(() => {
  jest.restoreAllMocks();
});

test("colorScheme.set() hands the scheme to Appearance", () => {
  const setColorScheme = jest.spyOn(Appearance, "setColorScheme");

  colorScheme.set("dark");

  expect(colorScheme.get()).toBe("dark");
  expect(setColorScheme).toHaveBeenCalledWith("dark");
});
