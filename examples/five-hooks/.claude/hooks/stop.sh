#!/usr/bin/env bash
# Stop: one line each time the agent finishes a turn.
cat > /dev/null
echo "stop" >> .claude/hooks.log
exit 0
