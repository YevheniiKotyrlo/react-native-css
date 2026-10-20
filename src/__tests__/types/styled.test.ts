import ts from "typescript";

import { createLanguageService, createProgram, root } from "./_program";

const fixtureName = `${root}/src/__tests__/types/styled.fixture.tsx`;

const prelude = [
  `import type { ComponentProps } from "react";`,
  `import { ActivityIndicator, Image, Text, TextInput, View } from "react-native";`,
  `import { styled } from "react-native-css";`,
  `const StyledView = styled(View);`,
  `const MappedText = styled(Text, { className: { target: "style" } });`,
] as const;

function compiles(cases: Readonly<Record<string, string>>) {
  const names = Object.keys(cases);
  const text = [
    ...prelude,
    ...names.map((name) => `export const ${name} = ${cases[name]};`),
  ].join("\n");
  const program = createProgram([fixtureName], { [fixtureName]: text });
  const source = program.getSourceFile(fixtureName);
  if (source === undefined) throw new Error("the fixture is not compiled");

  const failing = new Set(
    ts.getPreEmitDiagnostics(program, source).map((diagnostic) => {
      const { line } = source.getLineAndCharacterOfPosition(
        diagnostic.start ?? 0,
      );
      return names[line - prelude.length] ?? `prelude line ${line + 1}`;
    }),
  );
  return Object.fromEntries(
    [...names, ...failing]
      .filter((name, index, all) => all.indexOf(name) === index)
      .map((name) => [name, !failing.has(name)]),
  );
}

test("a mapping takes any style key, a -rn- declaration's among them, and a value naming a prop", () => {
  expect(
    compiles({
      colorOfView: `styled(View, { className: { target: "style", nativeStyleMapping: { color: "accessibilityLabel" } } })`,
      colorOfActivityIndicator: `styled(ActivityIndicator, { className: { target: "style", nativeStyleMapping: { color: "color" } } })`,
      rnDeclaration: `styled(TextInput, { className: { target: "style", nativeStyleMapping: { selectionColor: true } } })`,
      keptName: `styled(Image, { className: { target: "style", nativeStyleMapping: { tintColor: true } } })`,
      leftUndefined: `styled(View, { className: { target: "style", nativeStyleMapping: { backgroundColor: undefined, fill: undefined } } })`,
      intoStyleFromTargetFalse: `styled(View, { labelClassName: { target: false, nativeStyleMapping: { color: "style.borderColor" } } })`,
      deprecatedAlias: `styled(Text, { className: { target: "style", nativeStyleToProp: { color: "accessibilityLabel" } } })`,
      noSuchProp: `styled(View, { className: { target: "style", nativeStyleMapping: { color: "accessibilityLabl" } } })`,
      noSuchPropFromTargetFalse: `styled(View, { labelClassName: { target: false, nativeStyleMapping: { color: "style.borderColour" } } })`,
      falseValue: `styled(View, { className: { target: "style", nativeStyleMapping: { color: false } } })`,
    }),
  ).toStrictEqual({
    colorOfView: true,
    colorOfActivityIndicator: true,
    rnDeclaration: true,
    keptName: true,
    leftUndefined: true,
    intoStyleFromTargetFalse: true,
    deprecatedAlias: true,
    noSuchProp: false,
    noSuchPropFromTargetFalse: false,
    falseValue: false,
  });
});

test("a mapping completes React Native's style keys, whatever the target", () => {
  const text = [
    ...prelude,
    `export const mapped = styled(View, { labelClassName: { target: false, nativeStyleMapping: { /*keys*/ } } });`,
  ].join("\n");
  const completions = createLanguageService({
    [fixtureName]: text,
  }).getCompletionsAtPosition(fixtureName, text.indexOf("/*keys*/"), {});

  expect(
    completions?.entries
      .map(({ name }) => name)
      .filter((name) =>
        ["backgroundColor", "color", "tintColor", "fill", "stroke"].includes(
          name,
        ),
      )
      .sort(),
  ).toStrictEqual(["backgroundColor", "color", "fill", "stroke", "tintColor"]);
});

test("a styled component's class props are writable, as the component's own props are", () => {
  expect(
    compiles({
      defaultConfiguration: `(props: ComponentProps<typeof StyledView>) => { props.className = "x"; }`,
      ownConfiguration: `(props: ComponentProps<typeof MappedText>) => { props.className = "x"; }`,
    }),
  ).toStrictEqual({ defaultConfiguration: true, ownConfiguration: true });
});
