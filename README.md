# hooks-doctor

Which of your Claude Code hooks never fire, and why.

A hook whose matcher matches nothing is still valid JSON. Claude Code prints no error and no warning for it; the
script just never runs. `hooks-doctor` reads your settings, checks every hook against the rules Claude Code
applies, and replays the tool calls of your own recent sessions against each matcher, so you see a number next to
every hook instead of a config you have to trust.

```
$ npx github:agentshipped/hooks-doctor

hooks-doctor 0.1.2  /workspace/notes-api
history: 1 session, 8 tool calls (Bash 3, Read 2, Edit 2, Write 1)

.claude/settings.json
  ok    PreToolUse   "Bash|Read"   bash .claude/hooks/guard.sh
        matcher selects 5 of 8 past tool calls (Bash 3, Read 2)
  DEAD  PreToolUse   "bash"        bash .claude/hooks/audit.sh
        matcher selects 0 of 8 past tool calls
        x "bash" never fires: matchers are case-sensitive and the tool is called Bash
          fix: write "Bash"
  ok    PostToolUse  "Edit|Write"  bash .claude/hooks/syntax.sh
        matcher selects 3 of 8 past tool calls (Edit 2, Write 1)
  WARN  PostToolUse  "Write"       bash .claude/hooks/changed.sh
        matcher selects 1 of 8 past tool calls (Write 1)
        ! "Write" does not see edits: changing an existing file is the Edit tool; Write only creates a file or replaces it whole
          fix: use "Edit|Write"
  ok    Stop         (no matcher)  bash .claude/hooks/stop.sh
  i 5 commands use a relative script path: it is resolved from the session's current directory; prefix it with "$CLAUDE_PROJECT_DIR"/ to survive a cd

5 hooks: 1 dead, 1 with a warning, 3 ok
A hook that cannot fire prints no error in Claude Code. Rules follow the hooks reference as of 2026-11-24.
```

Those counts come from a real session. The hooks in it write a line to a log each time they run, and the log
agreed with every count above: 5, 0, 3, 1. The same five hooks are in [`examples/five-hooks`](examples/five-hooks).

## Run it

In the project you use Claude Code in:

```
npx github:agentshipped/hooks-doctor
```

Node 18 or newer (tested on Node 22 and 24), no dependencies. It reads files and prints; it changes nothing and
makes no network request.

The report shows your project path, each hook's event, matcher and command (for `prompt`, `http` and `mcp_tool`
hooks the prompt, the URL, or the server and tool name), and the names of the tools your sessions called, MCP
server names included. Commands are cut at 70 characters; `--json` gives them whole. Read the report before you
paste it somewhere public.

```
hooks-doctor [project-dir] [options]

  --sessions <n>   how many recent sessions of this project to replay (default 20)
  --no-history     static checks only; do not read session transcripts
  --no-user        skip the user settings file (~/.claude/settings.json)
  --strict         exit 1 on warnings too
  --json           machine-readable output
```

Exit code 0 when clean, 1 when at least one hook cannot fire or a settings file does not parse (with `--strict`,
also on a warning), so it can sit in CI or a pre-commit step:
`npx github:agentshipped/hooks-doctor --no-history --no-user`.

## What it checks

| Finding | Verdict | What is wrong |
|---|---|---|
| `case` | dead | `bash`, `edit`, `edit.*`: matchers are case-sensitive, the tools are `Bash`, `Edit` |
| `event-case` | dead | `PreTooluse`, `postToolUse`: a misspelt event key runs nothing |
| `permission-syntax` | dead | `Bash(npm:*)` in a matcher: that syntax belongs in the hook's `if` field |
| `bad-regex` | dead | the matcher is not a valid regular expression |
| `group-shape`, `no-type`, `missing-field`, `bad-type` | dead | the handler is at the wrong level or incomplete |
| `type-unsupported` | dead | a `prompt` hook on `SessionStart`, an `agent` hook on `PermissionRequest`: the event does not run that handler type |
| `unhooked-tool` | dead | `EndConversation` on `PreToolUse`, `PostToolUse` or `PermissionRequest`: its calls skip those events |
| `script-missing`, `not-executable` | dead | the command points at a file that is not there, or cannot be executed |
| `bad-json` | error | the settings file does not parse |
| `write-without-edit` | warning | `Write` alone: edits to existing files are `Edit` calls and never reach the hook |
| `unknown-tool`, `unknown-event` | warning | a name that is neither documented nor seen in your sessions |
| `never-matched` | warning | nothing wrong on paper, but the matcher selects none of your last 20+ tool calls |
| `disabled` | warning | `disableAllHooks` is set |
| `matcher-ignored` | note | a matcher on `Stop`, `UserPromptSubmit` and other events that ignore it: the hook runs every time |
| `edit-without-write`, `retired-tool`, relative script path | note | worth knowing, not broken |

Matchers are evaluated the way Claude Code evaluates them: `""`, `"*"` or no matcher selects everything; a
matcher made only of letters, digits, `_`, `-`, spaces, `,` and `|` is a list of exact tool names; anything else
is an unanchored JavaScript regular expression. So `Bas` selects nothing, `Bash.*` selects `Bash`, and `Edit.*`
also selects `NotebookEdit`.

## The history replay

Claude Code keeps a transcript of each session under `~/.claude/projects/<project>/` (or `$CLAUDE_CONFIG_DIR`).
`hooks-doctor` reads the transcripts of the project you run it in, including subagent transcripts, and keeps two
things per tool call: the tool's name and the time of the call (the times only give the `from` and `to` of the
`--json` output). Nothing else is taken from a transcript: prompts, command text and file contents are not kept,
printed or sent anywhere. Each matcher is then tested against those names.

Read the count for what it is:

- "selects 0 of 212" means the matcher, as written today, would not have fired on any tool call you made. It is
  strong evidence for a dead hook and the only way to catch a wrong MCP tool name.
- "selects 37 of 212" means the matcher is right. It does not prove the hook ran then: the transcripts do not
  record hook runs, and a hook you added today gets counts from before it existed.
- A hook's `if` filter is not evaluated, so its real number is at most the one shown.
- A `Bash` matcher on `PreToolUse` or `PermissionRequest` also runs for commands started with the Monitor tool
  (Claude Code 2.1.314 or later). Those calls are counted under `Monitor`, not under your `Bash` matcher.
- Only tool events have a count (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`,
  `PermissionDenied`). Matchers of other events are compared with other things (how the session started, the
  notification type) and are not checked.

## How it knows

Two sources, both dated in [`src/facts.js`](src/facts.js):

- The hooks reference and the tools reference at code.claude.com/docs, read on 24 Nov 2026: event names, which
  events take a matcher and what it is compared with, which handler types each event runs, the matcher grammar,
  the tool names.
- Measurement. Two sessions on Claude Code 2.1.316 called `Bash`, `Read`, `Edit` and `Write` once each with one
  logging hook per matcher, 28 matchers in all. The table of which hook ran for which tool is the first test in
  [`test/lint.test.js`](test/lint.test.js), and `matches()` has to reproduce it.

Events and tools are added often. A name this version does not know is reported as unknown, never as dead, and
tool names found in your own sessions count as known.

## What it does not do

- It does not run your hooks or simulate their exit codes.
- It reads project, local and user settings. Managed policy settings, plugin `hooks.json` files and hooks in
  skill or subagent frontmatter are not read.
- The transcript format is not a documented interface. If a Claude Code release changes it, the history line
  will say it found no tool calls and the static checks still work.

## Development

```
node --test
```

## License

MIT. Made for the [Agent Shipped](https://www.youtube.com/@AgentShipped) channel, where each technique is shown
on a public demo repo. Not affiliated with Anthropic.

## Where it came from

- [I wired 5 Claude Code hooks. Two never fired](https://youtu.be/aR5c3T0jqvc) · E028 · 2026-11-22.
  The video shows the two hooks of the example staying at zero. It was recorded before this tool was written, so
  the tool itself is not in it.
