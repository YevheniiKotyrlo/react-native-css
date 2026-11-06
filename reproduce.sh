#!/usr/bin/env bash
# Runs the repository's own type check, tsc --noEmit -p tsconfig.json, under its pinned TypeScript and then under TypeScript 7.0.2.
# Exits 1 while TypeScript 7.0.2 reports the defect's errors and no other, 0 once it passes, and 2 when a step before the check
# fails, the pinned TypeScript fails too, or TypeScript 7.0.2 reports another error.
set -uo pipefail

latest=7.0.2
# The defect's errors: two options TypeScript 7 no longer knows, and an index into a variable map TypeScript 7 refuses
options_error="error TS5023: Unknown compiler option '(noImplicitUseStrict|noStrictGenericChecks)'\."
index_error="^src/native/styles/variables\.ts\([0-9]+,[0-9]+\): error TS7053: "

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
  verdict 2 "ERROR: yarn install --immutable failed, so no type check ran"
fi
echo "yarn install --immutable: done"

pinned=$(yarn tsc --version) || verdict 2 "ERROR: the pinned tsc does not start"
pinned=${pinned#Version }
if ! pinned_output=$(yarn tsc --noEmit -p tsconfig.json 2>&1); then
  printf '%s\n' "$pinned_output"
  verdict 2 "ERROR: the pinned TypeScript $pinned fails the type check too, so it is not TypeScript $latest that fails it"
fi
echo "TypeScript $pinned: tsc --noEmit -p tsconfig.json exits 0"

latest_version=$(npx --yes -p "typescript@$latest" tsc --version) || verdict 2 "ERROR: npx could not run TypeScript $latest"
latest_output=$(npx --yes -p "typescript@$latest" tsc --noEmit -p tsconfig.json 2>&1)
latest_status=$?
printf '%s\n' "$latest_output"
echo "TypeScript ${latest_version#Version }: tsc --noEmit -p tsconfig.json exits $latest_status"

if [ "$latest_status" -eq 0 ]; then
  verdict 0 "FIXED: TypeScript $latest passes the type check, as TypeScript $pinned does"
fi
errors=$(grep -c -E 'error TS[0-9]+' <<< "$latest_output")
options=$(grep -c -E "$options_error" <<< "$latest_output")
indexes=$(grep -c -E "$index_error" <<< "$latest_output")
if [ "$errors" -eq 0 ]; then
  verdict 2 "ERROR: TypeScript $latest exited $latest_status without an error line"
fi
others=$((errors - options - indexes))
if [ "$others" -gt 0 ]; then
  verdict 2 "ERROR: TypeScript $latest reports $others errors besides the defect's"
fi
verdict 1 "DEFECT: TypeScript $latest fails the type check TypeScript $pinned passes: $options errors for options it no longer knows (TS5023) and $indexes for an index into a variable map in src/native/styles/variables.ts (TS7053)"
