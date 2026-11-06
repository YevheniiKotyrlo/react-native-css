#!/usr/bin/env bash
# Type-checks code that sets className on the props of a styled() component, with a mapping and without one, through the test this
# branch adds.
# Exits 1 while the mapped className is read-only, 0 once it is writable, and 2 when a step before the check fails or a case fails
# another way, the unmapped control among them.
set -uo pipefail

test_file=src/__tests__/native/styled-mapped-class-props.test.ts
result=.reproduce-result.json

verdict() {
  printf '%s\n' "$2"
  exit "$1"
}

system=$(uname -sr) || verdict 2 "ERROR: uname failed"
node_version=$(node --version) || verdict 2 "ERROR: node is not on PATH"
yarn_version=$(yarn --version) || verdict 2 "ERROR: yarn is not on PATH"
revision=$(git rev-parse --short HEAD) || verdict 2 "ERROR: this is not a git checkout"
echo "System: $system, Node $node_version, Yarn $yarn_version, react-native-css $revision"

if ! install_output=$(yarn install --immutable 2>&1); then
  printf '%s\n' "$install_output" | tail -n 15
  verdict 2 "ERROR: yarn install --immutable failed, so the test did not run"
fi
echo "yarn install --immutable: done"

rm -f "$result"
trap 'rm -f "$result"' EXIT
yarn jest "$test_file" --json --outputFile="$result" 2>&1
echo "jest: ran $test_file"

RESULT=$result node - <<'JS'
const fs = require("node:fs");

const defect = "the className a styled() mapping adds is read-only";
// Each case's title, and text its failure holds only while the defect is there; a control's is null, as it passes either way
const cases = new Map([
  ["a class prop a styled() mapping adds is as writable as the component's own props", "Cannot assign to 'className' because it is a read-only property."],
  ["the className styled() adds without a mapping is writable", null],
]);
const defectCases = [...cases.values()].filter((sign) => sign !== null).length;

const plain = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");
const firstLine = (text) => plain(text).split("\n").map((line) => line.trim()).find(Boolean) ?? "no message";
const finish = (code, line) => {
  console.log(line);
  process.exit(code);
};

let result;
try {
  result = JSON.parse(fs.readFileSync(process.env.RESULT, "utf8"));
} catch {
  finish(12, "ERROR: jest wrote no result, so the test did not run");
}
const [file] = result.testResults;
if (!file || file.testExecError || result.numRuntimeErrorTestSuites > 0) {
  finish(12, `ERROR: the test file did not run: ${firstLine(file?.message ?? "")}`);
}
const ran = new Map(file.assertionResults.map((assertion) => [assertion.title, assertion]));
const showing = [];
const otherwise = [];
for (const [title, sign] of cases) {
  const assertion = ran.get(title);
  if (assertion === undefined) {
    otherwise.push(`"${title}" did not run`);
  } else if (assertion.status !== "passed") {
    const message = plain(assertion.failureMessages.join("\n"));
    if (sign !== null && message.includes(sign)) showing.push(title);
    else otherwise.push(`"${title}" failed with: ${firstLine(message)}`);
  }
}
if (otherwise.length > 0) finish(12, `ERROR: ${otherwise.length} of ${cases.size} cases failed another way: ${otherwise.join("; ")}`);
if (showing.length > 0) finish(10, `DEFECT: ${defect}: ${showing.length} of ${defectCases} cases show it: ${showing.join("; ")}`);
finish(11, `FIXED: ${cases.size} of ${cases.size} cases pass`);
JS
judged=$?
case $judged in
  10) exit 1 ;;
  11) exit 0 ;;
  12) exit 2 ;;
  *) verdict 2 "ERROR: reading jest's result failed (node exited $judged)" ;;
esac
