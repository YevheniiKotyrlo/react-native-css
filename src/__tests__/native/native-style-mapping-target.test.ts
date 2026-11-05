import { join } from "node:path";

import ts from "typescript";

const root = join(__dirname, "../../..").replaceAll("\\", "/");
const fixtureName = `${root}/src/__tests__/native/native-style-mapping-target.fixture.ts`;

function diagnostics(text: string): readonly string[] {
  const { config } = ts.readConfigFile(`${root}/tsconfig.json`, (path) =>
    ts.sys.readFile(path),
  );
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root);
  const host = ts.createCompilerHost(options, true);
  const program = ts.createProgram([fixtureName], options, {
    ...host,
    getCurrentDirectory: () => root,
    fileExists: (name) => name === fixtureName || host.fileExists(name),
    readFile: (name) => (name === fixtureName ? text : host.readFile(name)),
    getSourceFile: (name, languageVersion, ...rest) =>
      name === fixtureName
        ? ts.createSourceFile(name, text, languageVersion, true)
        : host.getSourceFile(name, languageVersion, ...rest),
  });
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(fixtureName))
    .map(({ messageText }) =>
      ts.flattenDiagnosticMessageText(messageText, "\n"),
    );
}

const viewStyleOf = (resolved: string) =>
  [
    `import type { ComponentProps } from "react";`,
    `import type { View } from "react-native";`,
    `import type { ResolveDotPath } from "react-native-css/utilities";`,
    `type ViewProps = ComponentProps<typeof View>;`,
    `export const style: ${resolved} = { backgroundColor: "red" };`,
  ].join("\n");

test("a string target resolves to its prop's type as runtime.types.ts resolves it for nativeStyleMapping", () => {
  expect(
    diagnostics(viewStyleOf(`ResolveDotPath<"style", ViewProps>`)),
  ).toStrictEqual([]);
});

test("a string target resolves to its prop's type in the order ResolveDotPath declares", () => {
  expect(
    diagnostics(viewStyleOf(`ResolveDotPath<ViewProps, "style">`)),
  ).toStrictEqual([]);
});
