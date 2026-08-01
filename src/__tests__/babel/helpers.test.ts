import { toPosixPath } from "../../babel/helpers";

/**
 * Both module resolvers find a package inside a resolved absolute path by
 * splitting it on a marker written with forward slashes —
 * `react-native/Libraries/Components/` and `react-native-web/dist`. `resolve`
 * answers in the HOST's separator, so on Windows the marker is absent from a
 * path that plainly contains the directories it names, the split finds nothing,
 * and every relative React Native import is left unrewritten. The plugin
 * silently does nothing for a whole platform.
 *
 * The plugin suites cover the wiring, but only on a POSIX host: there `resolve`
 * already answers in forward slashes, so they would pass with or without the
 * normalisation. This is the platform-independent half.
 */
test("toPosixPath rewrites Windows separators so a forward-slash marker matches", () => {
  const windowsPath = String.raw`C:\proj\node_modules\react-native\Libraries\Components\View\View.js`;

  expect(toPosixPath(windowsPath)).toBe(
    "C:/proj/node_modules/react-native/Libraries/Components/View/View.js",
  );

  expect(
    toPosixPath(windowsPath).split("react-native/Libraries/Components/")[1],
  ).toBe("View/View.js");
});

test("toPosixPath leaves a POSIX path alone", () => {
  const posixPath =
    "/proj/node_modules/react-native-web/dist/modules/View/index.js";

  expect(toPosixPath(posixPath)).toBe(posixPath);
  expect(toPosixPath(posixPath).split("react-native-web/dist")[1]).toBe(
    "/modules/View/index.js",
  );
});
