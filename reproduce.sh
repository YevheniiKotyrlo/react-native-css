#!/usr/bin/env bash
# The default src/metro/index.ts documents, the one setupTypeScript writes, and the two options as yarn build publishes them
set -u

grep -n "types-env" src/metro/index.ts
grep -n "envPath = " src/metro/typescript.ts

yarn build > /dev/null 2>&1 || {
  echo "yarn build failed"
  exit 1
}
grep -n -B1 -E "typescriptEnvPath|disableTypeScriptGeneration" dist/typescript/module/src/metro/index.d.ts
