import { Text, View } from "react-native";

import * as runtime from "react-native-css";

import "../global.css";

// The build gate reads this through uiautomator: only a build with the change exports reducedMotion
const build = "reducedMotion" in runtime ? "with the change" : "main";

export default function App() {
  return (
    <View className="flex-1 bg-white">
      <View className="flex-1 items-center justify-center gap-20">
        <View className="items-center gap-4">
          <View className="size-28 rounded-2xl bg-sky-500 motion-safe:animate-spin" />
          <Text className="font-mono text-base text-gray-700">
            motion-safe:animate-spin
          </Text>
        </View>
        <View className="items-center gap-4">
          <View className="size-28 rounded-2xl bg-rose-500 animate-spin motion-reduce:animate-none" />
          <Text className="font-mono text-base text-gray-700">
            animate-spin motion-reduce:animate-none
          </Text>
        </View>
      </View>
      <Text
        testID="evidence-build"
        className="pb-16 text-center text-xs text-gray-400"
      >
        {build}
      </Text>
    </View>
  );
}
