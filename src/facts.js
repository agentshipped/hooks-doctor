// What Claude Code documents about hooks, as read on 2026-11-10 from
//   https://code.claude.com/docs/en/hooks  ("Matcher patterns" table)
//   https://code.claude.com/docs/en/tools-reference
// New events and tools appear often. Anything missing here is reported as "not known to this version",
// never as an error, and tool names seen in your own sessions are added at run time.
export const FACTS_DATE = "2026-11-10";

// matcher: "tool" = compared with the tool name; "none" = the event ignores matchers; "other" = compared with
// something else (what), which this tool does not check.
export const EVENTS = {
  PreToolUse: { matcher: "tool" },
  PostToolUse: { matcher: "tool" },
  PostToolUseFailure: { matcher: "tool" },
  PermissionRequest: { matcher: "tool" },
  PermissionDenied: { matcher: "tool" },
  SessionStart: { matcher: "other", what: "how the session started (startup, resume, clear, compact, fork)" },
  Setup: { matcher: "other", what: "which CLI flag triggered setup (init, maintenance)" },
  SessionEnd: { matcher: "other", what: "why the session ended" },
  Notification: { matcher: "other", what: "notification type" },
  SubagentStart: { matcher: "other", what: "agent type" },
  SubagentStop: { matcher: "other", what: "agent type" },
  PreCompact: { matcher: "other", what: "what triggered compaction (manual, auto)" },
  PostCompact: { matcher: "other", what: "what triggered compaction (manual, auto)" },
  PreModelSwitch: { matcher: "other", what: "model name" },
  PostModelSwitch: { matcher: "other", what: "model name" },
  ConfigChange: { matcher: "other", what: "configuration source" },
  DirectoryAdded: { matcher: "other", what: "how the directory was added" },
  FileChanged: { matcher: "other", what: "literal filenames to watch" },
  StopFailure: { matcher: "other", what: "error type" },
  InstructionsLoaded: { matcher: "other", what: "load reason" },
  UserPromptExpansion: { matcher: "other", what: "command name" },
  Elicitation: { matcher: "other", what: "MCP server name" },
  ElicitationResult: { matcher: "other", what: "MCP server name" },
  UserPromptSubmit: { matcher: "none" },
  PostToolBatch: { matcher: "none" },
  Stop: { matcher: "none" },
  TeammateIdle: { matcher: "none" },
  TaskCreated: { matcher: "none" },
  TaskCompleted: { matcher: "none" },
  WorktreeCreate: { matcher: "none" },
  WorktreeRemove: { matcher: "none" },
  MessageDisplay: { matcher: "none" },
  CwdChanged: { matcher: "none" },
};

export const TOOLS = [
  "Agent", "AskUserQuestion", "Bash", "CronCreate", "CronDelete", "CronList", "Edit", "EnterPlanMode",
  "EnterWorktree", "ExitPlanMode", "ExitWorktree", "Glob", "Grep", "ListMcpResourcesTool", "LSP", "Monitor",
  "NotebookEdit", "PowerShell", "PushNotification", "Read", "ReadMcpResourceTool", "ReportFindings",
  "SendFeedback", "ShareOnboardingGuide", "Skill", "TaskCreate", "TaskGet", "TaskList", "TaskStop", "TaskUpdate",
  "TodoWrite", "ToolSearch", "WaitForMcpServers", "WebFetch", "WebSearch", "Workflow", "Write",
];

// Names that still circulate in copied configs. A retired name in a list is harmless; alone, it is a dead hook.
export const RETIRED_TOOLS = {
  MultiEdit: "is not in the current tools reference; edits arrive as Edit",
  TaskOutput: "was removed in Claude Code 2.1.277",
};

// handler type -> fields it cannot work without
export const HOOK_TYPES = {
  command: ["command"],
  http: ["url"],
  mcp_tool: ["server", "tool"],
  prompt: ["prompt"],
  agent: [],
};
