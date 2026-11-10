#!/usr/bin/env bash
# PreToolUse on Bash|Read: block anything that touches .env. Exit 2 blocks the call; stderr goes to the agent.
input=$(cat)
target=$(echo "$input" | jq -r '.tool_input.command // .tool_input.file_path // ""')
echo "guard $(echo "$input" | jq -r '.tool_name')" >> .claude/hooks.log
if [[ "$target" == *.env* ]]; then
  echo "blocked $target" >> .claude/hooks.log
  echo "BLOCKED: .env is off limits" >&2
  exit 2
fi
exit 0
