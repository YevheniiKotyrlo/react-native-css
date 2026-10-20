import { join } from "node:path";

import ts from "typescript";

const root = join(__dirname, "../../..").replaceAll("\\", "/");
const declarationFiles = ["types.d.ts", "src/runtime.types.ts"] as const;

function createProgram(
  rootNames: readonly string[],
  virtualFiles: Readonly<Record<string, string>> = {},
): ts.Program {
  const { config } = ts.readConfigFile(`${root}/tsconfig.json`, (path) =>
    ts.sys.readFile(path),
  );
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root);
  const compilerOptions = { ...options, exactOptionalPropertyTypes: true };
  const host = ts.createCompilerHost(compilerOptions, true);

  return ts.createProgram(rootNames, compilerOptions, {
    ...host,
    fileExists: (name) => name in virtualFiles || host.fileExists(name),
    readFile: (name) => virtualFiles[name] ?? host.readFile(name),
    getSourceFile: (name, languageVersion, ...rest) => {
      const text = virtualFiles[name];
      return text === undefined
        ? host.getSourceFile(name, languageVersion, ...rest)
        : ts.createSourceFile(name, text, languageVersion, true);
    },
  });
}

// Under exactOptionalPropertyTypes a bare `?: T` rejects an explicit undefined, which React Native's own optional props accept
function optionalMembersRejectingUndefined(
  program: ts.Program,
  fileName: string,
): readonly string[] {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(fileName);
  if (source === undefined) throw new Error(`${fileName} is not compiled`);

  const rejectsUndefined = (type: ts.Type): boolean =>
    // `?: never` marks a key that must stay absent
    (type.flags & ts.TypeFlags.Never) === 0 &&
    !checker.isTypeAssignableTo(checker.getUndefinedType(), type);

  const typeNodeRejectsUndefined = (node: ts.TypeNode | undefined) =>
    node !== undefined && rejectsUndefined(checker.getTypeFromTypeNode(node));

  // A mapped type over `keyof T`, or over a `K extends keyof T`, keeps T's optional members optional unless it says -?
  const isOptionalMappedType = (node: ts.MappedTypeNode): boolean => {
    if (node.questionToken !== undefined) {
      return node.questionToken.kind !== ts.SyntaxKind.MinusToken;
    }

    const constraint = node.typeParameter.constraint;
    if (constraint === undefined) return false;
    if (isKeyOf(constraint)) return true;

    const keyDeclaration = ts.isTypeReferenceNode(constraint)
      ? checker.getSymbolAtLocation(constraint.typeName)?.declarations?.[0]
      : undefined;
    return (
      keyDeclaration !== undefined &&
      ts.isTypeParameterDeclaration(keyDeclaration) &&
      keyDeclaration.constraint !== undefined &&
      isKeyOf(keyDeclaration.constraint)
    );
  };

  // A library's mapped type that adds `?`, such as Partial, makes optional members of its argument's, which this file never spells out
  const addsOptionalMembersRejectingUndefined = (
    node: ts.TypeReferenceNode,
  ): boolean => {
    const type = checker.getTypeFromTypeNode(node);
    const declaration = type.aliasSymbol?.declarations?.[0];
    const argument = type.aliasTypeArguments?.[0];
    return (
      declaration !== undefined &&
      argument !== undefined &&
      declaration.getSourceFile() !== source &&
      ts.isTypeAliasDeclaration(declaration) &&
      ts.isMappedTypeNode(declaration.type) &&
      declaration.type.questionToken !== undefined &&
      declaration.type.questionToken.kind !== ts.SyntaxKind.MinusToken &&
      checker
        .getPropertiesOfType(argument)
        .some((property) => rejectsUndefined(checker.getTypeOfSymbol(property)))
    );
  };

  const offenders: string[] = [];

  const visit = (node: ts.Node): void => {
    const rejects =
      ((ts.isPropertySignature(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isNamedTupleMember(node)) &&
        node.questionToken !== undefined &&
        typeNodeRejectsUndefined(node.type)) ||
      ((ts.isMethodSignature(node) || ts.isMethodDeclaration(node)) &&
        node.questionToken !== undefined) ||
      (ts.isOptionalTypeNode(node) && typeNodeRejectsUndefined(node.type)) ||
      (ts.isMappedTypeNode(node) &&
        isOptionalMappedType(node) &&
        typeNodeRejectsUndefined(node.type)) ||
      (ts.isTypeReferenceNode(node) &&
        addsOptionalMembersRejectingUndefined(node));

    if (rejects) {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      );
      offenders.push(`${line + 1}: ${node.getText(source).split("\n")[0]}`);
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  return offenders;
}

function isKeyOf(node: ts.TypeNode): boolean {
  return (
    ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.KeyOfKeyword
  );
}

test("the walk finds each form of an optional member that rejects undefined, and leaves a never member", () => {
  const fileName = `${root}/src/__tests__/types/optional-members.fixture.ts`;
  const program = createProgram([fileName], {
    [fileName]: `type Maybe<T> = T | undefined;
interface Source {
  value?: string;
}
export interface Props {
  bare?: string;
  widened?: string | undefined;
  absent?: never;
  method?(): void;
  aliased?: Maybe<string>;
  voided?: void;
  parenthesised?: (string | undefined);
  indexed?: Source["value"];
}
export declare class Options {
  passThrough?: boolean;
  widened?: boolean | undefined;
}
export type Inherited<T> = { [K in keyof T]: string };
export type Stripped<T> = { [K in keyof T]-?: string };
export type Optional<T> = { [K in keyof T]?: string | undefined };
export type Picked<T, K extends keyof T> = { [Q in K]: string };
export type Partly = Partial<{ passThrough: boolean }>;
export type PartlyWidened = Partial<{ passThrough: boolean | undefined }>;
export type Pair = [string, number?];
export type Named = [first: string, second?: number | undefined];
`,
  });

  expect(optionalMembersRejectingUndefined(program, fileName)).toStrictEqual([
    "3: value?: string;",
    "6: bare?: string;",
    "9: method?(): void;",
    "16: passThrough?: boolean;",
    "19: { [K in keyof T]: string }",
    "22: { [Q in K]: string }",
    "23: Partial<{ passThrough: boolean }>",
    "25: number?",
  ]);
});

test("every optional member of the declarations accepts an explicit undefined, or is never and must stay absent", () => {
  const fileNames = declarationFiles.map((file) => `${root}/${file}`);
  const program = createProgram(fileNames);

  expect(
    Object.fromEntries(
      declarationFiles.map((file) => [
        file,
        optionalMembersRejectingUndefined(program, `${root}/${file}`),
      ]),
    ),
  ).toStrictEqual({ "types.d.ts": [], "src/runtime.types.ts": [] });
});
