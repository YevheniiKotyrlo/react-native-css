import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { compile as compileTailwindCss } from "@tailwindcss/node";
import {
  screen,
  render as tlRender,
  type RenderOptions,
} from "@testing-library/react-native";
import type { compile } from "react-native-css/compiler";
import { View } from "react-native-css/components";
import { registerCSS } from "react-native-css/jest";

const testID = "tailwind";

export type NativewindRenderOptions = RenderOptions &
  Readonly<{
    /** Replace the generated CSS */
    css?: string;
    /** Appended after the generated CSS */
    extraCss?: string;
    /** Add `@source inline('<className>')` to the CSS. @default Values are extracted from the component's className */
    sourceInline?: readonly string[];
    /** Whether to include the theme in the generated CSS @default true */
    theme?: boolean;
    /** Whether to include the preflight in the generated CSS @default false */
    preflight?: boolean;
    /** Enable debug logging. @default true while the node inspector is attached (`--inspect` in NODE_OPTIONS) */
    debug?: boolean | "verbose";
  }>;

const debugDefault =
  typeof process.env.NODE_OPTIONS === "string" &&
  process.env.NODE_OPTIONS.includes("--inspect");

export async function render(
  component: ReactElement,
  {
    css,
    sourceInline = Array.from(getClassNames(component)),
    debug = debugDefault,
    theme = true,
    preflight = false,
    extraCss,
    ...options
  }: NativewindRenderOptions = {},
): Promise<ReturnType<typeof tlRender> & ReturnType<typeof compile>> {
  const input = renderInput({ css, sourceInline, theme, preflight, extraCss });

  if (debug === "verbose") {
    console.log(`Input CSS:\n---\n${input}\n---\n`);
  }

  const output = await compileTailwind(input);

  if (debug) {
    console.log(`Output CSS:\n---\n${output}\n---\n`);
  }

  // The stylesheet is registered before the component renders, so the first render reads it
  const compiled = registerCSS(output, { debug: Boolean(debug) });

  return { ...tlRender(component, options), ...compiled };
}

function renderInput({
  css,
  sourceInline,
  theme,
  preflight,
  extraCss,
}: Readonly<{
  css: string | undefined;
  sourceInline: readonly string[];
  theme: boolean;
  preflight: boolean;
  extraCss: string | undefined;
}>): string {
  const base =
    css ??
    [
      theme && `@import "tailwindcss/theme.css" layer(theme);`,
      preflight && `@import "tailwindcss/preflight.css" layer(base);`,
      `@import "tailwindcss/utilities.css" layer(utilities) source(none);`,
      `@import "tailwindcss-safe-area";`,
    ]
      .filter((line) => line !== false)
      .join("\n");

  return [
    base,
    ...sourceInline.map((source) => `@source inline("${source}");`),
    ...(extraCss === undefined ? [] : [extraCss]),
  ].join("\n");
}

render.debug = (
  component: ReactElement,
  options: NativewindRenderOptions = {},
) => {
  return render(component, { ...options, debug: true });
};

// @tailwindcss/postcss keeps one compiler per from and base, reusing it for other CSS until a file it read changes, and only logs a failed compile, so each render compiles with the compiler it wraps: https://github.com/tailwindlabs/tailwindcss/blob/v4.1.13/packages/@tailwindcss-postcss/src/index.ts
async function compileTailwind(css: string): Promise<string> {
  const compiler = await compileTailwindCss(css, {
    base: __dirname,
    onDependency: () => undefined,
  });

  if (
    compiler.sources.length > 0 ||
    (compiler.root !== null && compiler.root !== "none")
  ) {
    throw new Error(
      `The harness builds only the classes of @source inline(), and this CSS names a file source: ${JSON.stringify({ sources: compiler.sources, root: compiler.root })}`,
    );
  }

  return compiler.build([]);
}

function getClassNames(node: ReactNode): ReadonlySet<string> {
  const classNames = new Set<string>();

  const collect = (child: ReactNode): void => {
    if (!isValidElement<{ className?: unknown; children?: ReactNode }>(child)) {
      return;
    }

    if (typeof child.props.className === "string") {
      classNames.add(child.props.className);
    }

    Children.forEach(child.props.children, collect);
  };
  collect(node);

  return classNames;
}

export async function renderSimple({
  className,
  ...options
}: NativewindRenderOptions & Readonly<{ className: string }>) {
  const { warnings: getWarnings } = await render(
    <View testID={testID} className={className} />,
    options,
  );
  const {
    testID: _testID,
    children: _children,
    ...props
  } = screen.getByTestId(testID, { hidden: true }).props;
  const { properties, values } = getWarnings();
  const warnings = {
    ...(properties && { properties }),
    ...(values && {
      values: Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          value.length > 1 ? value : value[0],
        ]),
      ),
    }),
  };

  return Object.keys(warnings).length > 0 ? { props, warnings } : { props };
}

renderSimple.debug = (
  options: NativewindRenderOptions & Readonly<{ className: string }>,
) => {
  return renderSimple({ ...options, debug: true });
};

type CurrentTestRenderOptions = NativewindRenderOptions &
  Readonly<{
    /** Specify the className to use for the component @default sourceInline */
    className?: string;
  }>;

/**
 * Renders a View whose class is the last word of the current test's name
 * It does not support several components or another component type
 */
export async function renderCurrentTest({
  sourceInline = [expect.getState().currentTestName?.split(/\s+/).at(-1) ?? ""],
  className = sourceInline.join(" "),
  ...options
}: CurrentTestRenderOptions = {}) {
  return renderSimple({
    ...options,
    sourceInline,
    className,
  });
}

renderCurrentTest.debug = (options: CurrentTestRenderOptions = {}) => {
  return renderCurrentTest({ ...options, debug: true });
};
