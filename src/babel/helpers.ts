import tBabelTypes, { type CallExpression } from "@babel/types";

export type BabelTypes = typeof tBabelTypes;

export interface PluginOpts {
  target?: string;
  runtime?: string;
  commonjs?: boolean;
}

export interface PluginState {
  opts?: PluginOpts;
  filename: string;
}

/**
 * An absolute path in POSIX separators, whatever the host uses.
 *
 * Both module resolvers locate a package inside a resolved path by splitting it
 * on a marker written with forward slashes (`react-native/Libraries/Components/`,
 * `react-native-web/dist`). `path.resolve` answers in the host's separator, so
 * on Windows those markers are absent from a path that plainly contains the
 * directories they name. Normalising once, at the point the host's answer
 * enters, is what keeps the marker a single spelling.
 */
export function toPosixPath(path: string): string {
  return path.replaceAll("\\", "/");
}

export function getInteropRequireDefaultSource(
  init: CallExpression,
  t: BabelTypes,
) {
  if (!t.isIdentifier(init.callee, { name: "_interopRequireDefault" })) {
    return;
  }

  const interopArg = init.arguments.at(0);

  if (
    !t.isCallExpression(interopArg) ||
    !t.isIdentifier(interopArg.callee, { name: "require" })
  ) {
    return;
  }

  const requireArg = interopArg.arguments.at(0);

  if (!t.isStringLiteral(requireArg)) {
    return;
  }

  return requireArg.value;
}
