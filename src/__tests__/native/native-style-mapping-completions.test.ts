import { join } from "node:path";

import ts from "typescript";

const root = join(__dirname, "../../..").replaceAll("\\", "/");
const fileName = `${root}/src/__tests__/native/native-style-mapping-completions.fixture.tsx`;
const beforeCursor = [
  `import { View } from "react-native";`,
  `import { styled } from "react-native-css";`,
  `export const StyledView = styled(View, {`,
  `  className: { target: "style", nativeStyleMapping: { `,
].join("\n");
const text = `${beforeCursor} } },\n});\n`;

function completionsAtCursor(): readonly string[] {
  const { config } = ts.readConfigFile(`${root}/tsconfig.json`, (path) =>
    ts.sys.readFile(path),
  );
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root);
  const service = ts.createLanguageService({
    getCompilationSettings: () => options,
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => {
      const content = name === fileName ? text : ts.sys.readFile(name);
      return content === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: (compilerOptions) =>
      ts.getDefaultLibFilePath(compilerOptions),
    fileExists: (name) => name === fileName || ts.sys.fileExists(name),
    readFile: (name) => (name === fileName ? text : ts.sys.readFile(name)),
    readDirectory: (...args) => ts.sys.readDirectory(...args),
    directoryExists: (name) => ts.sys.directoryExists(name),
    getDirectories: (name) => ts.sys.getDirectories(name),
  });
  const completions = service.getCompletionsAtPosition(
    fileName,
    beforeCursor.length,
    {},
  );
  return (completions?.entries ?? []).map(({ name }) => name);
}

test("nativeStyleMapping completes the style keys of the prop its target names", () => {
  expect(completionsAtCursor()).toEqual(
    expect.arrayContaining(["backgroundColor", "opacity"]),
  );
});
