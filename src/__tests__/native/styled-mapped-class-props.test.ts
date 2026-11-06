import { join } from "node:path";

import ts from "typescript";

const root = join(__dirname, "../../..").replaceAll("\\", "/");
const fixtureName = `${root}/src/__tests__/native/styled-mapped-class-props.fixture.ts`;

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

test("a class prop a styled() mapping adds is as writable as the component's own props", () => {
  expect(
    diagnostics(
      [
        `import type { ComponentProps } from "react";`,
        `import { Image } from "react-native";`,
        `import { styled } from "react-native-css";`,
        `const StyledImage = styled(Image, { className: "style" });`,
        `type Props = ComponentProps<typeof StyledImage>;`,
        `export function withRoundedCorners(props: Props): Props {`,
        `  const next: Props = { ...props };`,
        '  next.className = `${props.className ?? ""} rounded`;',
        `  next.style = props.style;`,
        `  return next;`,
        `}`,
      ].join("\n"),
    ),
  ).toStrictEqual([]);
});

test("the className styled() adds without a mapping is writable", () => {
  expect(
    diagnostics(
      [
        `import type { ComponentProps } from "react";`,
        `import { View } from "react-native";`,
        `import { styled } from "react-native-css";`,
        `const StyledView = styled(View);`,
        `type Props = ComponentProps<typeof StyledView>;`,
        `export function withPadding(props: Props): Props {`,
        `  const next: Props = { ...props };`,
        '  next.className = `${props.className ?? ""} p-4`;',
        `  return next;`,
        `}`,
      ].join("\n"),
    ),
  ).toStrictEqual([]);
});
