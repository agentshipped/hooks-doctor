// What Claude Code documents about hooks, as read on 2026-11-24 from
//   https://code.claude.com/docs/en/hooks  ("Matcher patterns" table, "Prompt-based hooks" event lists)
//   https://code.claude.com/docs/en/tools-reference
// New events and tools appear often. Anything missing here is reported as "not known to this version",
// never as an error, and tool names seen in your own sessions are added at run time.
export const FACTS_DATE = "2026-11-24";

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
  PreModelSwitch: { matcher: "other", what: "canonical model name" },
  PostModelSwitch: { matcher: "other", what: "canonical model name" },
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
  "Agent", "Artifact", "AskUserQuestion", "Bash", "CronCreate", "CronDelete", "CronList", "Edit", "EndConversation",
  "EnterPlanMode", "EnterWorktree", "ExitPlanMode", "ExitWorktree", "Glob", "Grep", "ListAgents",
  "ListMcpResourcesTool", "ListPlugins", "ListSkills", "LSP", "Monitor", "NotebookEdit", "PowerShell",
  "propose_skills", "PushNotification", "Read", "ReadMcpResourceTool", "RemoteTrigger", "ReportFindings",
  "ScheduleWakeup", "SearchPlugins", "SearchSkills", "SendFeedback", "SendMessage", "SendUserFile",
  "ShareOnboardingGuide", "Skill", "SubagentHandback", "SuggestPluginInstall", "SuggestSkills", "TaskCreate",
  "TaskGet", "TaskList", "TaskStop", "TaskUpdate", "TodoWrite", "ToolSearch", "WaitForMcpServers", "WebFetch",
  "WebSearch", "Workflow", "Write",
];

// Tools whose calls skip some tool events, so a matcher that names only them never fires there.
export const UNHOOKED = {
  EndConversation: { events: ["PreToolUse", "PostToolUse", "PermissionRequest"], why: "EndConversation calls skip this event" },
};

// Names that still circulate in copied configs. A retired name in a list is harmless; alone, it is a dead hook.
export const RETIRED_TOOLS = {
  MultiEdit: "is not in the current tools reference; edits arrive as Edit",
  TaskOutput: "was removed in Claude Code 2.1.277",
};

// Names that older configs and tutorials use for a tool the tools reference lists under another name. Whether a
// matcher with the old name still fires is not documented, so it is a warning with the listed name as the hint,
// and it goes quiet when your own sessions contain calls under the old name.
export const LISTED_AS = {
  Task: { now: "Agent", what: "the tool that starts a subagent" },
};

// handler type -> fields it cannot work without
export const HOOK_TYPES = {
  command: ["command"],
  http: ["url"],
  mcp_tool: ["server", "tool"],
  prompt: ["prompt"],
  agent: ["prompt"],
};

// Handler types an event runs, where that is fewer than all five ("Not all events support every hook type").
// An event that is not listed here runs every type.
const NO_MODEL = ["command", "http", "mcp_tool"];
export const EVENT_TYPES = {
  PermissionRequest: ["command", "http", "mcp_tool", "prompt"],
  Setup: ["command"],
  SessionStart: ["command", "mcp_tool"],
  ...Object.fromEntries(
    [
      "ConfigChange", "CwdChanged", "DirectoryAdded", "Elicitation", "ElicitationResult", "FileChanged",
      "InstructionsLoaded", "MessageDisplay", "Notification", "PostCompact", "PostModelSwitch", "PreCompact",
      "PreModelSwitch", "SessionEnd", "StopFailure", "SubagentStart", "WorktreeCreate", "WorktreeRemove",
    ].map((e) => [e, NO_MODEL]),
  ),
};
