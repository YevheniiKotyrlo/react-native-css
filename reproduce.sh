#!/usr/bin/env bash
# Compares the default the Metro options' comments name with the file setupTypeScript writes, then builds the package and reads
# those comments in the declaration it publishes.
# Exits 1 while a comment names types-env.d.ts or the declaration drops a comment, 0 once neither holds, and 2 when a step before
# the check fails or a file no longer holds what the check reads.
set -uo pipefail

options_file=src/metro/index.ts
setup_file=src/metro/typescript.ts
declaration=dist/typescript/module/src/metro/index.d.ts
options=(typescriptEnvPath disableTypeScriptGeneration)

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
  verdict 2 "ERROR: yarn install --immutable failed, so nothing was built"
fi
echo "yarn install --immutable: done"

written=$(sed -n -E 's/^ *envPath = "([^"]+)",?$/\1/p' "$setup_file") || verdict 2 "ERROR: $setup_file cannot be read"
[ -n "$written" ] || verdict 2 "ERROR: $setup_file no longer sets envPath's default"
echo "$setup_file: setupTypeScript writes $written"
for option in "${options[@]}"; do
  grep -n -B1 -E "^ +$option\?:" "$options_file" || verdict 2 "ERROR: $options_file no longer declares $option"
done
stale=$(grep -c -E '(^|[^-])types-env\.d\.ts' "$options_file")

if ! build_output=$(yarn build 2>&1); then
  printf '%s\n' "$build_output" | tail -n 15
  verdict 2 "ERROR: yarn build failed, so there is no declaration to read"
fi
echo "yarn build: done"
[ -f "$declaration" ] || verdict 2 "ERROR: yarn build wrote no $declaration"
documented=0
for option in "${options[@]}"; do
  line=$(grep -n -E "^ +$option\?:" "$declaration" | head -n 1)
  [ -n "$line" ] || verdict 2 "ERROR: $declaration no longer declares $option"
  number=${line%%:*}
  above=$(sed -n "$((number - 1))p" "$declaration")
  printf '%s:%s: %s\n%s\n' "$declaration" "$((number - 1))" "$above" "$line"
  if [[ $above =~ \*/[[:space:]]*$ ]]; then
    documented=$((documented + 1))
  fi
done

parts=()
if [ "$stale" -gt 0 ]; then
  parts+=("$options_file names types-env.d.ts in $stale comments")
fi
if [ "$documented" -lt "${#options[@]}" ]; then
  parts+=("$declaration documents $documented of ${#options[@]} options")
fi
if [ "${#parts[@]}" -eq 0 ]; then
  verdict 0 "FIXED: the Metro options' comments name $written, and $declaration keeps both"
fi
summary=$(IFS=';' && echo "${parts[*]}")
verdict 1 "DEFECT: the Metro options' comments name another file than setupTypeScript writes, or leave the published declaration: ${summary//;/; }"
