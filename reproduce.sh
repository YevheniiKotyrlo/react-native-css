#!/usr/bin/env bash
# The repository's own type check under its pinned TypeScript, then under TypeScript 7.0.2
set -u

echo "== $(yarn tsc --version)"
yarn tsc --noEmit -p tsconfig.json
echo "exit $?"

echo "== $(npx --yes -p typescript@7.0.2 tsc --version)"
npx --yes -p typescript@7.0.2 tsc --noEmit -p tsconfig.json
echo "exit $?"
