// Run from a react-native-css checkout: copy to src/__tests__/native/dashed-ident.test.tsx, then `yarn jest` it.
import { compile } from "react-native-css/compiler";

test.each(["--foo", "--foo, width", "width, --foo"])("--v: %s", (value) => {
  const compiled = compile(`.a { --v: ${value}; transition-property: var(--v); } .b { transition-property: ${value}; }`, { inlineVariables: false });
  console.log(`--v: ${value} -> a=${JSON.stringify(compiled.stylesheet().s?.find(([n]) => n === "a")?.[1][0])} b=${JSON.stringify(compiled.stylesheet().s?.find(([n]) => n === "b")?.[1][0]?.d)} warnings=${JSON.stringify(compiled.warnings())}`);
});
