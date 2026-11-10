#!/usr/bin/env bash
# PreToolUse on shell commands: keep a line per command. Registered with the matcher "bash", so it never runs.
echo "audit $(jq -r '.tool_input.command')" >> .claude/hooks.log
exit 0
