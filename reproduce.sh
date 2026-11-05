#!/usr/bin/env bash
# The secret auto-triage.yml hands its triage step, how its runs ended, the last change to the file, and the latest run's failing step
set -u

repository=nativewind/react-native-css

grep -n "CLAUDE_CODE_OAUTH_TOKEN" .github/workflows/auto-triage.yml
git log -1 --format="last change to the workflow: %h %cs" -- .github/workflows/auto-triage.yml

gh run list --repo "$repository" --workflow auto-triage.yml --limit 500 --json conclusion,createdAt \
  --jq 'group_by(.conclusion)[] | "\(.[0].conclusion): \(length) runs, \(map(.createdAt) | min) to \(map(.createdAt) | max)"'

latest=$(gh run list --repo "$repository" --workflow auto-triage.yml --limit 1 --json databaseId --jq '.[0].databaseId')
echo "== run $latest"
gh run view "$latest" --repo "$repository" --log-failed |
  grep -E "ANTHROPIC_API_KEY:|CLAUDE_CODE_OAUTH_TOKEN:|is required|##\[error\]" |
  cut -f3-
