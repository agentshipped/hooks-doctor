#!/usr/bin/env bash
# PostToolUse: keep a line per changed file. Registered with the matcher "Write", so edits never reach it.
echo "changed $(jq -r '.tool_input.file_path')" >> .claude/hooks.log
exit 0
