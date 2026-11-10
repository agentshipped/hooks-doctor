#!/usr/bin/env bash
# PostToolUse on Edit|Write: syntax-check the file that was just changed.
file=$(jq -r '.tool_input.file_path')
[[ "$file" == *.js ]] && node --check "$file"
echo "syntax $file" >> .claude/hooks.log
exit 0
