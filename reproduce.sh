#!/usr/bin/env bash
# Reads the secret auto-triage.yml hands its triage step, how the repository's Auto Triage runs ended, and why the latest one did.
# Exits 1 while the latest completed run fails for want of ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, 0 once it succeeds, and 2
# when a step before the check fails or that run ends another way.
set -uo pipefail

repository=nativewind/react-native-css
workflow=.github/workflows/auto-triage.yml
missing_token="Either ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN is required when using direct Anthropic API."

verdict() {
  printf '%s\n' "$2"
  exit "$1"
}

system=$(uname -sr) || verdict 2 "ERROR: uname failed"
gh_version=$(gh --version) || verdict 2 "ERROR: gh is not on PATH"
revision=$(git rev-parse --short HEAD) || verdict 2 "ERROR: this is not a git checkout"
echo "System: $system, ${gh_version%%$'\n'*}, react-native-css $revision"

gh auth status > /dev/null 2>&1 || verdict 2 "ERROR: gh is not signed in, so the runs cannot be read"
grep -n -E "ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN" "$workflow" || echo "$workflow names neither token"
last_change=$(git log -1 --format="%h %cs" -- "$workflow") || verdict 2 "ERROR: git log cannot read $workflow's history"
echo "last change to the workflow in this checkout: $last_change"

runs=$(gh run list --repo "$repository" --workflow auto-triage.yml --limit 500 --json conclusion,createdAt \
  --jq 'group_by(.conclusion)[] | "\(.[0].conclusion): \(length) runs, \(map(.createdAt) | min) to \(map(.createdAt) | max)"') ||
  verdict 2 "ERROR: gh could not list the Auto Triage runs"
printf '%s\n' "$runs"

latest=$(gh run list --repo "$repository" --workflow auto-triage.yml --status completed --limit 1 --json databaseId,conclusion \
  --jq '.[] | "\(.databaseId) \(.conclusion)"') || verdict 2 "ERROR: gh could not read the latest Auto Triage run"
[ -n "$latest" ] || verdict 2 "ERROR: the repository has no completed Auto Triage run"
run=${latest%% *}
conclusion=${latest#* }
echo "== run $run: $conclusion"
case $conclusion in
  success) verdict 0 "FIXED: the latest completed Auto Triage run, $run, succeeded" ;;
  failure) ;;
  *) verdict 2 "ERROR: the latest completed Auto Triage run, $run, ended $conclusion" ;;
esac
log=$(gh run view "$run" --repo "$repository" --log-failed) || verdict 2 "ERROR: gh could not read run $run's failed steps"
grep -E "ANTHROPIC_API_KEY:|CLAUDE_CODE_OAUTH_TOKEN:|is required|##\[error\]" <<< "$log" | cut -f3-
if grep -q -F "$missing_token" <<< "$log"; then
  verdict 1 "DEFECT: Auto Triage fails for want of a token: its latest completed run, $run, ended with \"$missing_token\""
fi
verdict 2 "ERROR: the latest completed Auto Triage run, $run, failed another way"
