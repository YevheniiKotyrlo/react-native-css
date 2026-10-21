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

const isTypeDeclaration = (node: ts.Node): node is TypeDeclaration =>
  ts.isInterfaceDeclaration(node) ||
  ts.isTypeAliasDeclaration(node) ||
  ts.isClassDeclaration(node);

type OptionalMemberDeclaration =
  | ts.PropertySignature
  | ts.PropertyDeclaration
  | ts.MethodSignature
  | ts.MethodDeclaration
  | ts.NamedTupleMember;

const isOptionalMemberDeclaration = (
  node: ts.Node,
): node is OptionalMemberDeclaration =>
  (ts.isPropertySignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isNamedTupleMember(node)) &&
  node.questionToken !== undefined;

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

  // A type parameter, such as one an augmentation of a React Native interface redeclares, stands for a type rather than being one
  const isOwnType = (type: ts.Type): boolean =>
    (type.flags & ts.TypeFlags.TypeParameter) === 0 &&
    ((type.aliasSymbol ?? type.getSymbol())?.declarations?.some(
      isOwnDeclaration,
    ) ??
      false);

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

  // Each place is reported once: a member its declaration makes optional under the type that declares it, anything else under the first path or line that reaches it
  const offenders = new Set<string>();
  const reported = new Set<ts.Node | string>();
  const report = (place: ts.Node | string, name: string): void => {
    if (reported.has(place)) return;
    reported.add(place);
    offenders.add(name);
  };

  const lineOf = (node: ts.Node): string => {
    const nodeSource = node.getSourceFile();
    const { line } = nodeSource.getLineAndCharacterOfPosition(
      node.getStart(nodeSource),
    );
    const written = node.getText(nodeSource).replace(/\s+/g, " ");
    return `${line + 1}: ${written.length > 80 ? `${written.slice(0, 79)}…` : written}`;
  };

  const declaringTypeName = (
    member: OptionalMemberDeclaration,
  ): string | undefined => {
    const owner = member.parent;
    if (ts.isInterfaceDeclaration(owner) || ts.isClassDeclaration(owner)) {
      return owner.name?.text;
    }
    return ts.isTypeLiteralNode(owner) &&
      ts.isTypeAliasDeclaration(owner.parent)
      ? owner.parent.name.text
      : undefined;
  };

  const reportDeclaredMember = (
    member: OptionalMemberDeclaration,
    anonymousName: () => string,
  ): void => {
    const owner = declaringTypeName(member);
    report(
      member,
      owner === undefined
        ? anonymousName()
        : `${owner}.${member.name.getText(member.getSourceFile())}`,
    );
  };

  const typeNodeRejectsUndefined = (node: ts.TypeNode | undefined): boolean =>
    node !== undefined && !acceptsUndefined(checker.getTypeFromTypeNode(node));

  // An optional method's type is a function, which an explicit undefined never matches
  const declarationRejectsUndefined = (
    declaration: OptionalMemberDeclaration,
  ): boolean =>
    ts.isMethodSignature(declaration) ||
    ts.isMethodDeclaration(declaration) ||
    typeNodeRejectsUndefined(declaration.type);

  const checkedTypes = new Set<ts.Type>();

  const referenceArguments = (type: ts.Type): readonly ts.Type[] =>
    (type.flags & ts.TypeFlags.Object) !== 0 &&
    ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) !== 0
      ? checker.getTypeArguments(type as ts.TypeReference)
      : [];

  // A library's generic, such as Map or Promise, holds this package's types in its arguments, through any union or intersection; a type is answered once, so a recursive one ends
  const mentionsOwnTypeMemo = new Map<ts.Type, boolean>();
  const mentionsOwnType = (type: ts.Type): boolean => {
    const known = mentionsOwnTypeMemo.get(type);
    if (known !== undefined) return known;
    mentionsOwnTypeMemo.set(type, false);
    const mentions =
      isOwnType(type) ||
      (type.isUnionOrIntersection() && type.types.some(mentionsOwnType)) ||
      (type.aliasTypeArguments ?? []).some(mentionsOwnType) ||
      referenceArguments(type).some(mentionsOwnType);
    mentionsOwnTypeMemo.set(type, mentions);
    return mentions;
  };

  const isMappedType = (type: ts.Type): boolean =>
    (type.flags & ts.TypeFlags.Object) !== 0 &&
    ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Mapped) !== 0;

  // A signature's type parameters' constraints, its parameters and its return type, such as a component it returns, reach what a consumer writes
  const descendIntoSignature = (
    signature: ts.Signature,
    path: string,
  ): void => {
    for (const parameter of signature.getTypeParameters() ?? []) {
      const constraint = parameter.getConstraint();
      if (constraint !== undefined) {
        descend(constraint, `${path}<${parameter.symbol.name}>`);
      }
    }
    for (const parameter of signature.getParameters()) {
      descend(checker.getTypeOfSymbol(parameter), `${path}(${parameter.name})`);
    }
    descend(signature.getReturnType(), `${path}()`);
  };

  // Call and construct signatures, index signatures and base types reach what a consumer writes too
  const descendIntoStructure = (type: ts.Type, path: string): void => {
    for (const kind of [ts.SignatureKind.Call, ts.SignatureKind.Construct]) {
      for (const signature of checker.getSignaturesOfType(type, kind)) {
        descendIntoSignature(signature, path);
      }
    }
    for (const index of checker.getIndexInfosOfType(type)) {
      descend(index.type, `${path}[]`);
    }
    if (type.isClassOrInterface()) {
      for (const base of checker.getBaseTypes(type)) {
        descend(base, path);
      }
    }
  };

  // An option type sits in a member's type itself, in a union or an intersection, in a tuple, in a generic's arguments, or behind a mapped type
  const descend = (type: ts.Type, path: string): void => {
    if (type.isUnionOrIntersection()) {
      for (const part of type.types) descend(part, path);
    } else if (
      checker.isTupleType(type) ||
      isMappedType(type) ||
      isOwnType(type)
    ) {
      checkMembers(type, path);
    } else if (
      (type.flags & ts.TypeFlags.Object) !== 0 &&
      mentionsOwnType(type)
    ) {
      for (const argument of referenceArguments(type)) descend(argument, path);
      checkMembers(type, path);
    }
  };

  // A resolved type's members as a consumer writes them, inherited, picked and mapped ones included, and the option types they reach
  const checkMembers = (type: ts.Type, path: string): void => {
    if (checkedTypes.has(type)) return;
    checkedTypes.add(type);

    descendIntoStructure(type, path);

    for (const property of checker.getPropertiesOfType(type)) {
      const memberPath = `${path}.${property.name}`;
      const propertyType = checker.getTypeOfSymbol(property);
      if (
        (property.flags & ts.SymbolFlags.Optional) !== 0 &&
        !acceptsUndefined(propertyType)
      ) {
        const declaration = property.declarations?.find(
          isOptionalMemberDeclaration,
        );
        if (
          declaration === undefined ||
          !declarationRejectsUndefined(declaration)
        ) {
          // A mapped type made the member optional or gave it a type without undefined, so the fix is where the mapped type is applied
          report(memberPath, memberPath);
        } else if (isOwnDeclaration(declaration)) {
          reportDeclaredMember(declaration, () => memberPath);
        }
        // A member another package declares optional without undefined, such as a React Native prop, is that package's
      }
      if (
        (property.declarations?.some(isOwnDeclaration) ?? true) ||
        mentionsOwnType(propertyType)
      ) {
        descend(propertyType, memberPath);
      }
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

  const addsQuestionToken = (node: ts.MappedTypeNode): boolean =>
    node.questionToken !== undefined &&
    node.questionToken.kind !== ts.SyntaxKind.MinusToken;

  // A mapped type over keyof T keeps T's optional members optional unless it says -?
  const isOptionalMappedType = (node: ts.MappedTypeNode): boolean => {
    if (node.questionToken !== undefined) {
      return addsQuestionToken(node);
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

  // The mapped type alias behind a type, when the alias adds `?`, as a library's Partial does
  const optionalMappedAlias = (
    type: ts.Type,
  ): ts.TypeAliasDeclaration | undefined => {
    const declaration = type.aliasSymbol?.declarations?.[0];
    return declaration !== undefined &&
      ts.isTypeAliasDeclaration(declaration) &&
      ts.isMappedTypeNode(declaration.type) &&
      addsQuestionToken(declaration.type)
      ? declaration
      : undefined;
  };

  // A library's mapped type that adds `?`, such as Partial, makes optional the members its source declares required
  const addsOptionalMembersRejectingUndefined = (
    node: ts.TypeReferenceNode | ts.ExpressionWithTypeArguments,
  ): boolean => {
    const type = ts.isTypeReferenceNode(node)
      ? checker.getTypeFromTypeNode(node)
      : checker.getTypeAtLocation(node);
    const declaration = optionalMappedAlias(type);
    const argument = type.aliasTypeArguments?.[0];
    if (
      declaration === undefined ||
      argument === undefined ||
      declaration.getSourceFile() === source
    ) {
      return false;
    }
    // Over a type parameter nothing proves its members accept undefined
    return (
      argument.isTypeParameter() ||
      checker
        .getPropertiesOfType(argument)
        .some(
          (property) =>
            (property.flags & ts.SymbolFlags.Optional) === 0 &&
            !acceptsUndefined(checker.getTypeOfSymbol(property)),
        )
    );
  };

  // A generic declaration resolves only once instantiated, so its members are read as written
  const visitGeneric = (node: ts.Node): void => {
    if (isOptionalMemberDeclaration(node)) {
      if (declarationRejectsUndefined(node)) {
        reportDeclaredMember(node, () => lineOf(node));
      }
    } else if (
      (ts.isOptionalTypeNode(node) && typeNodeRejectsUndefined(node.type)) ||
      (ts.isMappedTypeNode(node) &&
        isOptionalMappedType(node) &&
        !isTransparentMappedType(node) &&
        typeNodeRejectsUndefined(node.type)) ||
      ((ts.isTypeReferenceNode(node) ||
        ts.isExpressionWithTypeArguments(node)) &&
        addsOptionalMembersRejectingUndefined(node))
    ) {
      report(node, lineOf(node));
    }

    // A member a generic declaration types without its parameters resolves as any other
    if (
      (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
      node.type !== undefined
    ) {
      const owner = ts.findAncestor(node.parent, isTypeDeclaration);
      descend(
        checker.getTypeFromTypeNode(node.type),
        `${owner?.name?.text ?? ""}.${node.name.getText(source)}`,
      );
    }

    // A generic declaration inherits the members of what it extends as resolved
    if (
      ts.isExpressionWithTypeArguments(node) &&
      ts.isHeritageClause(node.parent)
    ) {
      const inherited = checker.getTypeAtLocation(node);
      descend(inherited, inherited.getSymbol()?.name ?? node.getText(source));
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
    // A class's constructor, which a consumer calls, is on its static side
    if (ts.isClassDeclaration(declaration)) {
      descend(checker.getTypeOfSymbol(symbol), name.text);
    }
  };

  const typeDeclarations: TypeDeclaration[] = [];
  const collect = (node: ts.Node): void => {
    if (isTypeDeclaration(node)) {
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

  return [...offenders];
}

const fixtureName = `${root}/src/__tests__/types/optional-members.fixture.ts`;

const foreignName = `${root}/node_modules/optional-members-fixture/index.d.ts`;

const foreign = `declare module "optional-members-fixture" {
  export interface Rect { x: number; y?: number | undefined; label?: string }
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
export interface TupleOptions { pair?: [string, number?] | undefined }
export interface Callable { (component: string, options?: { passThrough?: boolean }): void }
interface AliasOptions { target?: string }
export interface IndexedOptions { aliases?: Record<string, AliasOptions> | undefined }
export interface MappedOptions { lookup?: Map<string, Item> | undefined }
export interface ExtendsForeignPartial extends Partial<import("optional-members-fixture").Rect> {}
type OwnOptional<T> = { [K in keyof T]?: T[K] };
export interface OwnMappedOptions { rect?: OwnOptional<import("optional-members-fixture").Rect> | undefined }
export interface GenericHolder<T> { item?: Item | undefined; value?: T | undefined }
export interface ForeignOptions {
  rect?: Partial<import("optional-members-fixture").Rect> | undefined;
  props?: import("optional-members-fixture").ForeignProps | undefined;
}
export interface Returns { make(): { flag?: boolean } }
export type Factory = <M extends { constrained?: boolean }>(mapping: M) => { produced?: string };
export declare class Constructed { constructor(options?: { built?: boolean }) }
export interface Constructs { new (options?: { made?: boolean }): object }
interface PresetOptions { minify?: boolean }
export interface UnionArguments {
  presets?: Record<string, PresetOptions | false> | undefined;
  maybe?: Map<string, Item | undefined> | undefined;
}
export interface UnionElements { items?: readonly (Item | null)[] | undefined }
export interface NestedMapped {
  viewport?: Readonly<Partial<import("optional-members-fixture").Rect>> | undefined;
  picked?: Pick<Partial<import("optional-members-fixture").Rect>, "x"> | undefined;
}
export interface GenericForeignPartial<T> { props?: Partial<import("optional-members-fixture").ForeignProps> | undefined; value?: T | undefined }
interface Holder { inner?: string }
export declare class GenericClass<T> {
  flag?: boolean;
  method?(): void;
  holder?: Holder | undefined;
  value?: T | undefined;
}
export type GenericPair<T> = [T, number?];
export type GenericNamed<T> = [first: T, second?: number];
export interface Wrapper<T> { box?: { inner?: string; value?: T | undefined } | undefined }
export interface FirstUse { wrapper?: Wrapper<string> | undefined }
export interface SecondUse { wrapper?: Wrapper<number> | undefined }
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
      "FlagOptions.features.experimental",
      "Item.tag",
      "WrappedOptions.joined.extra",
      "TupleOptions.pair.1",
      "Callable(options).passThrough",
      "AliasOptions.target",
      "ExtendsForeignPartial.x",
      "58: { [K in keyof T]?: T[K] }",
      "OwnMappedOptions.rect.x",
      "Returns.make().flag",
      "Factory<M>.constrained",
      "Factory().produced",
      "Constructed(options).built",
      "Constructs(options).made",
      "PresetOptions.minify",
      "NestedMapped.viewport.x",
      "NestedMapped.picked.x",
      "Holder.inner",
      "GenericClass.flag",
      "GenericClass.method",
      "87: number?",
      "88: second?: number",
      "Wrapper.box.inner",
    ],
  );
});

test.each([
  ["Callable", ["Callable(options).passThrough"]],
  ["IndexedOptions", ["AliasOptions.target"]],
  ["MappedOptions", ["Item.tag"]],
  ["GenericHolder", ["Item.tag"]],
  ["Returns", ["Returns.make().flag"]],
  ["Factory", ["Factory<M>.constrained", "Factory().produced"]],
  ["Constructed", ["Constructed(options).built"]],
  ["Constructs", ["Constructs(options).made"]],
  ["UnionArguments", ["PresetOptions.minify", "Item.tag"]],
  ["UnionElements", ["Item.tag"]],
  [
    "GenericClass",
    ["GenericClass.flag", "GenericClass.method", "Holder.inner"],
  ],
  ["GenericPair", ["87: number?"]],
  ["GenericNamed", ["88: second?: number"]],
])(
  "the walk reaches the options %s holds, and names each under the type that declares it",
  (name, expected) => {
    expect(
      optionalMembersRejectingUndefined(program, fixtureName, [name]),
    ).toStrictEqual(expected);
  },
);

test.each([
  ["ExtendsForeignPartial", ["ExtendsForeignPartial.x"]],
  ["OwnMappedOptions", ["OwnMappedOptions.rect.x"]],
  ["ForeignOptions", ["ForeignOptions.rect.x"]],
  ["NestedMapped", ["NestedMapped.viewport.x", "NestedMapped.picked.x"]],
  ["GenericForeignPartial", []],
])(
  "in %s a member a mapped type makes optional is named where the mapped type is applied, and one its source already makes optional stays the source's",
  (name, expected) => {
    expect(
      optionalMembersRejectingUndefined(program, fixtureName, [name]),
    ).toStrictEqual(expected);
  },
);

test("the walk reaches an option type in an array, an intersection, a library's alias and what a generic type extends", () => {
  expect(
    optionalMembersRejectingUndefined(program, fixtureName, [
      "ListOptions",
      "WrappedOptions",
      "GenericOptions",
    ]),
  ).toStrictEqual([
    "Item.tag",
    "WrappedOptions.partial.passThrough",
    "Source.value",
    "WrappedOptions.joined.extra",
    "Shared.filename",
  ]);
});

test("a member two instantiations of a generic reach is named once, under the first path", () => {
  expect(
    optionalMembersRejectingUndefined(program, fixtureName, [
      "FirstUse",
      "SecondUse",
    ]),
  ).toStrictEqual(["FirstUse.wrapper.box.inner"]);
});

test("a listed type is checked with the members it inherits from a declaration the list leaves out, named under that declaration", () => {
  expect(
    optionalMembersRejectingUndefined(program, fixtureName, ["SharedOptions"]),
  ).toStrictEqual(["Shared.filename"]);
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
