import { join } from "node:path";

import { compile } from "react-native-css/compiler";
import { registerCSS } from "react-native-css/jest";
import ts from "typescript";

const root = join(__dirname, "../../..").replaceAll("\\", "/");
const fixtureName = `${root}/src/__tests__/native/jest-helper-options.fixture.ts`;

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

test('registerCSS takes the debug: "verbose" it hands compileWithAutoDebug', () => {
  expect(
    diagnostics(
      [
        `import { registerCSS } from "react-native-css/jest";`,
        `registerCSS(".a { color: red; }", { debug: "verbose" });`,
      ].join("\n"),
    ),
  ).toStrictEqual([]);
});

test("registerCSS calls the logger it is given, as compile does", () => {
  const css = ".a { color: red; }";
  const compileMessages: string[] = [];
  const registerMessages: string[] = [];

  compile(css, {
    logger: (message: string) => {
      compileMessages.push(message);
    },
  });
  registerCSS(css, {
    logger: (message: string) => {
      registerMessages.push(message);
    },
  });

  expect(registerMessages).toStrictEqual(compileMessages);
});
