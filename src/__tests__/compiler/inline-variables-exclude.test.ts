import { join } from "node:path";

import ts from "typescript";

const root = join(__dirname, "../../..").replaceAll("\\", "/");
const fixtureName = `${root}/src/__tests__/compiler/inline-variables-exclude.fixture.ts`;

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

test("inlineVariables.exclude takes a list declared as const", () => {
  expect(
    diagnostics(
      [
        `import { compile } from "react-native-css/compiler";`,
        `const preserved = ["--brand", "--accent"] as const;`,
        `compile(":root { --brand: red; }", { inlineVariables: { exclude: preserved } });`,
      ].join("\n"),
    ),
  ).toStrictEqual([]);
});
