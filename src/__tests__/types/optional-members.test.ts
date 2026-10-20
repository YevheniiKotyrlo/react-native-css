import ts from "typescript";

import { createProgram, root } from "./_program";

// Every declaration of a file, or only the option types a consumer writes
const declarations: readonly (readonly [string, readonly string[] | "all"])[] =
  [
    ["types.d.ts", "all"],
    ["src/runtime.types.ts", "all"],
    [
      "src/compiler/compiler.types.ts",
      ["CompilerOptions", "InlineVariableOptions"],
    ],
    ["src/metro/index.ts", ["WithReactNativeCSSOptions"]],
    [
      "src/jest/index.ts",
      ["RegisterCSSOptions", "CompileWithAutoDebugOptions"],
    ],
    ["src/babel/helpers.ts", ["PluginOpts"]],
    ["src/native/react/useNativeCss.ts", ["Config"]],
  ];

// Under exactOptionalPropertyTypes a bare `?: T` rejects an explicit undefined, which React Native's own optional props accept
function optionalMembersRejectingUndefined(
  program: ts.Program,
  fileName: string,
  names: readonly string[] | "all" = "all",
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

  // keyof T through any alias, or a type parameter declared as one
  const isKeyOfConstraint = (node: ts.TypeNode): boolean => {
    if ((checker.getTypeFromTypeNode(node).flags & ts.TypeFlags.Index) !== 0) {
      return true;
    }
    const declaration = ts.isTypeReferenceNode(node)
      ? checker.getSymbolAtLocation(node.typeName)?.declarations?.[0]
      : undefined;
    return (
      declaration !== undefined &&
      ts.isTypeParameterDeclaration(declaration) &&
      declaration.constraint !== undefined &&
      isKeyOfConstraint(declaration.constraint)
    );
  };

  // A mapped type over keyof T keeps T's optional members optional unless it says -?
  const isOptionalMappedType = (node: ts.MappedTypeNode): boolean => {
    if (node.questionToken !== undefined) {
      return node.questionToken.kind !== ts.SyntaxKind.MinusToken;
    }
    const constraint = node.typeParameter.constraint;
    return constraint !== undefined && isKeyOfConstraint(constraint);
  };

  // { [K in keyof T]: T[K] } keeps each member's own type, undefined included
  const isTransparentMappedType = (node: ts.MappedTypeNode): boolean => {
    if (node.type === undefined || !ts.isIndexedAccessTypeNode(node.type)) {
      return false;
    }
    const { objectType, indexType } = node.type;
    return (
      ts.isTypeReferenceNode(indexType) &&
      ts.isIdentifier(indexType.typeName) &&
      indexType.typeName.text === node.typeParameter.name.text &&
      node.typeParameter.constraint !== undefined &&
      ts.isTypeOperatorNode(node.typeParameter.constraint) &&
      node.typeParameter.constraint.operator === ts.SyntaxKind.KeyOfKeyword &&
      node.typeParameter.constraint.type.getText(source) ===
        objectType.getText(source)
    );
  };

  // A library's mapped type that adds `?`, such as Partial, makes members its source file never spells out
  const addsOptionalMembersRejectingUndefined = (
    node: ts.TypeReferenceNode | ts.ExpressionWithTypeArguments,
  ): boolean => {
    const type = ts.isTypeReferenceNode(node)
      ? checker.getTypeFromTypeNode(node)
      : checker.getTypeAtLocation(node);
    const declaration = type.aliasSymbol?.declarations?.[0];
    const argument = type.aliasTypeArguments?.[0];
    if (
      declaration === undefined ||
      argument === undefined ||
      declaration.getSourceFile() === source ||
      !ts.isTypeAliasDeclaration(declaration) ||
      !ts.isMappedTypeNode(declaration.type) ||
      declaration.type.questionToken === undefined ||
      declaration.type.questionToken.kind === ts.SyntaxKind.MinusToken
    ) {
      return false;
    }
    // Over a type parameter nothing proves its members accept undefined
    return (
      argument.isTypeParameter() ||
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
        !isTransparentMappedType(node) &&
        typeNodeRejectsUndefined(node.type)) ||
      ((ts.isTypeReferenceNode(node) ||
        ts.isExpressionWithTypeArguments(node)) &&
        addsOptionalMembersRejectingUndefined(node));

    if (rejects) {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      );
      offenders.push(`${line + 1}: ${node.getText(source).split("\n")[0]}`);
    }

    ts.forEachChild(node, visit);
  };

  if (names === "all") {
    visit(source);
  } else {
    for (const statement of source.statements) {
      if (
        (ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement)) &&
        names.includes(statement.name.text)
      ) {
        visit(statement);
      }
    }
  }

  return offenders;
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
interface Base { passThrough: boolean }
export interface ExtendsPartial extends Partial<Base> {}
export type GenericPartial<T> = Partial<T>;
type KeysOf<T> = keyof T;
export type ViaAlias<T> = { [K in KeysOf<T>]: string };
export type Same<T> = { [K in keyof T]: T[K] };
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
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
    "28: Partial<Base>",
    "29: Partial<T>",
    "31: { [K in KeysOf<T>]: string }",
  ]);
});

test("every optional member a consumer writes accepts an explicit undefined, or is never and must stay absent", () => {
  const program = createProgram(
    declarations.map(([file]) => `${root}/${file}`),
  );

  expect(
    Object.fromEntries(
      declarations.map(([file, names]) => [
        file,
        optionalMembersRejectingUndefined(program, `${root}/${file}`, names),
      ]),
    ),
  ).toStrictEqual(Object.fromEntries(declarations.map(([file]) => [file, []])));
});
