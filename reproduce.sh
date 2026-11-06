#!/usr/bin/env bash
# Compares the folders under src/__tests__ with the test folders each contributor doc names.
# Exits 1 while a doc leaves a folder out, 0 once every doc names every folder, and 2 when a step before the check fails or a file
# it reads is gone.
set -uo pipefail

docs=(DEVELOPMENT.md .claude/skills/add-test/SKILL.md .claude/skills/triage/SKILL.md)

verdict() {
  printf '%s\n' "$2"
  exit "$1"
}

system=$(uname -sr) || verdict 2 "ERROR: uname failed"
git_version=$(git --version) || verdict 2 "ERROR: git does not run"
revision=$(git rev-parse --short HEAD) || verdict 2 "ERROR: this is not a git checkout"
echo "System: $system, $git_version, react-native-css $revision"

listing=$(git ls-tree -d --name-only HEAD src/__tests__/) || verdict 2 "ERROR: git cannot list src/__tests__"
[ -n "$listing" ] || verdict 2 "ERROR: src/__tests__ holds no folder"
mapfile -t folders <<< "${listing//src\/__tests__\//}"
echo "src/__tests__ holds ${#folders[@]} folders: ${folders[*]}"

short=()
for doc in "${docs[@]}"; do
  [ -f "$doc" ] || verdict 2 "ERROR: $doc is gone"
  missing=()
  for folder in "${folders[@]}"; do
    grep -q -E "(\`$folder/?\`|__tests__/$folder([/\`]|$))" "$doc" || missing+=("$folder")
  done
  named=$((${#folders[@]} - ${#missing[@]}))
  if [ "${#missing[@]}" -eq 0 ]; then
    echo "$doc: names all ${#folders[@]}"
  else
    echo "$doc: names $named of ${#folders[@]}, leaving out ${missing[*]}"
    short+=("$doc names $named of ${#folders[@]}")
  fi
done

if [ "${#short[@]}" -eq 0 ]; then
  verdict 0 "FIXED: every contributor doc names all ${#folders[@]} folders under src/__tests__"
fi
summary=$(IFS=';' && echo "${short[*]}")
verdict 1 "DEFECT: the contributor docs leave out folders under src/__tests__: ${summary//;/; }"
