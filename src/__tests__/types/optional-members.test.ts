import ts from "typescript";

import { createProgram, root } from "./_program";

// Every declaration of a file, or only the option types a consumer writes, with the option types their members reach
const declarations: readonly (readonly [string, readonly string[] | "all"])[] =
  [
    ["types.d.ts", "all"],
    ["src/runtime.types.ts", "all"],
    ["src/compiler/compiler.types.ts", ["CompilerOptions"]],
    ["src/metro/index.ts", ["WithReactNativeCSSOptions"]],
    ["src/jest/index.ts", ["RegisterCSSOptions"]],
    ["src/native/react/useNativeCss.ts", ["Config"]],
  ];

type TypeDeclaration =
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.ClassDeclaration;

// Under exactOptionalPropertyTypes a bare `?: T` rejects an explicit undefined, which React Native's own optional props accept
function optionalMembersRejectingUndefined(
  program: ts.Program,
  fileName: string,
  names: readonly string[] | "all" = "all",
): readonly string[] {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(fileName);
  if (source === undefined) throw new Error(`${fileName} is not compiled`);
  const undefinedType = checker.getUndefinedType();

  const isOwnDeclaration = (node: ts.Node): boolean =>
    !node.getSourceFile().fileName.includes("/node_modules/");

  const isOwnType = (type: ts.Type): boolean =>
    (type.aliasSymbol ?? type.getSymbol())?.declarations?.some(
      isOwnDeclaration,
    ) ?? false;

  const partsOf = (type: ts.Type): readonly ts.Type[] =>
    type.isUnion() ? type.types : [type];

  // An optional member reads as its type and TypeScript's missing type, which is not the undefined a written `| undefined` adds
  const acceptsUndefined = (type: ts.Type): boolean => {
    const written = partsOf(type).filter(
      (part) =>
        part === undefinedType || (part.flags & ts.TypeFlags.Undefined) === 0,
    );
    // `?: never` marks a key that must stay absent
    return (
      written.length === 0 ||
      written.some((part) => checker.isTypeAssignableTo(undefinedType, part))
    );
  };

  const offenders: string[] = [];
  const checkedTypes = new Set<ts.Type>();
  const checkedMappedTypes = new Set<ts.Type>();

  // A library's mapped type that adds `?`, such as Partial, makes every member it maps optional by this package's choice
  const addsOptionalMembers = (type: ts.Type): boolean => {
    const declaration = type.aliasSymbol?.declarations?.[0];
    return (
      declaration !== undefined &&
      !isOwnDeclaration(declaration) &&
      ts.isTypeAliasDeclaration(declaration) &&
      ts.isMappedTypeNode(declaration.type) &&
      declaration.type.questionToken !== undefined &&
      declaration.type.questionToken.kind !== ts.SyntaxKind.MinusToken
    );
  };

  const mentionsOwnType = (type: ts.Type): boolean =>
    isOwnType(type) || (type.aliasTypeArguments ?? []).some(mentionsOwnType);

  // An option type sits in a member's type itself, in a union or an intersection, in an array or a tuple, or behind a library's alias over this package's types
  const descend = (type: ts.Type, path: string): void => {
    if (type.isUnionOrIntersection()) {
      type.types.forEach((part) => {
        descend(part, path);
      });
    } else if (checker.isArrayType(type)) {
      checker.getTypeArguments(type as ts.TypeReference).forEach((element) => {
        descend(element, path);
      });
    } else if (checker.isTupleType(type)) {
      checkMembers(type, path, false);
    } else if ((type.flags & ts.TypeFlags.Object) !== 0) {
      if (addsOptionalMembers(type)) {
        checkMembers(type, path, true);
      } else if (mentionsOwnType(type)) {
        checkMembers(type, path, false);
      }
    }
  };

  // A resolved type's members as a consumer writes them, inherited, picked and mapped ones included, and the option types they reach
  const checkMembers = (
    type: ts.Type,
    path: string,
    ownsEveryMember: boolean,
  ): void => {
    const checked = ownsEveryMember ? checkedMappedTypes : checkedTypes;
    if (checked.has(type)) return;
    checked.add(type);

    for (const property of checker.getPropertiesOfType(type)) {
      // A member another package declares, such as a React Native prop, is that package's, unless this package's mapped type made it optional
      if (
        !ownsEveryMember &&
        property.declarations?.every((node) => !isOwnDeclaration(node))
      ) {
        continue;
      }
      const propertyType = checker.getTypeOfSymbol(property);
      const memberPath = `${path}.${property.name}`;
      if (
        (property.flags & ts.SymbolFlags.Optional) !== 0 &&
        !acceptsUndefined(propertyType)
      ) {
        offenders.push(memberPath);
      }
      descend(propertyType, memberPath);
    }
  };

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

  const typeNodeRejectsUndefined = (node: ts.TypeNode | undefined): boolean =>
    node !== undefined && !acceptsUndefined(checker.getTypeFromTypeNode(node));

  // A mapped type over keyof T keeps T's optional members optional unless it says -?
  const isOptionalMappedType = (node: ts.MappedTypeNode): boolean => {
    if (node.questionToken !== undefined) {
      return node.questionToken.kind !== ts.SyntaxKind.MinusToken;
    }
    const constraint = node.typeParameter.constraint;
    return constraint !== undefined && isKeyOfConstraint(constraint);
  };

  // { [K in keyof T]: T[K] } keeps each member's own type, undefined included, as long as it adds no ?
  const isTransparentMappedType = (node: ts.MappedTypeNode): boolean => {
    if (
      node.questionToken !== undefined ||
      node.type === undefined ||
      !ts.isIndexedAccessTypeNode(node.type)
    ) {
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
        .some(
          (property) => !acceptsUndefined(checker.getTypeOfSymbol(property)),
        )
    );
  };

  // A generic declaration resolves only once instantiated, so its members are read as written
  const visitGeneric = (node: ts.Node): void => {
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

    // A generic declaration inherits the members of what it extends as resolved
    if (
      ts.isExpressionWithTypeArguments(node) &&
      ts.isHeritageClause(node.parent)
    ) {
      const inherited = checker.getTypeAtLocation(node);
      descend(inherited, inherited.getSymbol()?.name ?? node.getText(source));
    }

    if (rejects) {
      const { line } = source.getLineAndCharacterOfPosition(
        node.getStart(source),
      );
      offenders.push(`${line + 1}: ${node.getText(source).split("\n")[0]}`);
    }

    ts.forEachChild(node, visitGeneric);
  };

  const checkDeclaration = (declaration: TypeDeclaration): void => {
    const name = declaration.name;
    if (name === undefined) return;
    if ((declaration.typeParameters?.length ?? 0) > 0) {
      visitGeneric(declaration);
      return;
    }
    const symbol = checker.getSymbolAtLocation(name);
    if (symbol === undefined) return;
    descend(checker.getDeclaredTypeOfSymbol(symbol), name.text);
  };

  const typeDeclarations: TypeDeclaration[] = [];
  const collect = (node: ts.Node): void => {
    if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isClassDeclaration(node)
    ) {
      typeDeclarations.push(node);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  if (names === "all") {
    typeDeclarations.forEach(checkDeclaration);
  } else {
    for (const name of names) {
      const named = typeDeclarations.filter(
        (declaration) => declaration.name?.text === name,
      );
      // A renamed or moved option type would otherwise pass with nothing checked
      if (named.length === 0) {
        throw new Error(`${fileName} declares no ${name}`);
      }
      named.forEach(checkDeclaration);
    }
  }

  return offenders;
}

const fixtureName = `${root}/src/__tests__/types/optional-members.fixture.ts`;

const foreignName = `${root}/node_modules/optional-members-fixture/index.d.ts`;

const foreign = `declare module "optional-members-fixture" {
  export interface Rect { x: number; y?: number | undefined }
  export interface ForeignProps { label?: string }
}
`;

const fixture = `type Maybe<T> = T | undefined;
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
export type OptionalSame<T> = { [K in keyof T]?: T[K] };
export type ReadonlyOptionalSame<T> = { +readonly [K in keyof T]+?: T[K] };
interface LabelOptions { label?: string | undefined; plain: number }
export type Labels = { [K in keyof LabelOptions]: string };
export type RenamedLabels = { [K in keyof LabelOptions as \`\${K}Text\`]: string };
interface Shared { filename?: string }
export interface SharedOptions extends Shared { root?: string | undefined }
export type PickedShared = Pick<Shared, "filename">;
type Flags = "experimental";
export interface FlagOptions { features?: Partial<Record<Flags, boolean>> | undefined }
interface Item { name?: string | undefined; tag?: string }
export interface ListOptions { items?: readonly Item[] | undefined }
export interface WrappedOptions {
  partial?: Partial<Base> | undefined;
  frozen?: Readonly<Source> | undefined;
  joined?: (Source & { extra?: number }) | undefined;
}
export interface GenericOptions<T> extends Shared { value?: T | undefined }
export interface ForeignOptions {
  rect?: Partial<import("optional-members-fixture").Rect> | undefined;
  props?: import("optional-members-fixture").ForeignProps | undefined;
}
`;

let program: ts.Program;

beforeAll(() => {
  program = createProgram([fixtureName, foreignName], {
    [fixtureName]: fixture,
    [foreignName]: foreign,
  });
});

test("the walk finds each form of an optional member that rejects undefined, and leaves a never member", () => {
  expect(optionalMembersRejectingUndefined(program, fixtureName)).toStrictEqual(
    [
      "Source.value",
      "Props.bare",
      "Props.method",
      "Options.passThrough",
      "19: { [K in keyof T]: string }",
      "22: { [Q in K]: string }",
      "Partly.passThrough",
      "Pair.1",
      "ExtendsPartial.passThrough",
      "29: Partial<T>",
      "31: { [K in KeysOf<T>]: string }",
      "34: { [K in keyof T]?: T[K] }",
      "35: { +readonly [K in keyof T]+?: T[K] }",
      "Labels.label",
      "RenamedLabels.labelText",
      "Shared.filename",
      "SharedOptions.filename",
      "PickedShared.filename",
      "FlagOptions.features.experimental",
      "Item.tag",
      "WrappedOptions.partial.passThrough",
      "WrappedOptions.frozen.value",
      "WrappedOptions.joined.extra",
      "ForeignOptions.rect.x",
    ],
  );
});

test("the walk reaches an option type in an array, an intersection, a library's alias and what a generic type extends", () => {
  expect(
    optionalMembersRejectingUndefined(program, fixtureName, [
      "ListOptions",
      "WrappedOptions",
      "GenericOptions",
    ]),
  ).toStrictEqual([
    "ListOptions.items.tag",
    "WrappedOptions.partial.passThrough",
    "WrappedOptions.frozen.value",
    "WrappedOptions.joined.value",
    "WrappedOptions.joined.extra",
    "Shared.filename",
  ]);
});

test("a listed type is checked with the members it inherits from a declaration the list leaves out", () => {
  expect(
    optionalMembersRejectingUndefined(program, fixtureName, ["SharedOptions"]),
  ).toStrictEqual(["SharedOptions.filename"]);
});

test("a listed type the file no longer declares fails the walk", () => {
  expect(() =>
    optionalMembersRejectingUndefined(program, fixtureName, ["Missing"]),
  ).toThrow("declares no Missing");
});

test("every optional member a consumer writes accepts an explicit undefined, or is never and must stay absent", () => {
  const packageProgram = createProgram(
    declarations.map(([file]) => `${root}/${file}`),
  );

  expect(
    Object.fromEntries(
      declarations.map(([file, names]) => [
        file,
        optionalMembersRejectingUndefined(
          packageProgram,
          `${root}/${file}`,
          names,
        ),
      ]),
    ),
  ).toStrictEqual(Object.fromEntries(declarations.map(([file]) => [file, []])));
});
