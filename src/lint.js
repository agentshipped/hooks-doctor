// Static checks for the `hooks` block of a Claude Code settings file.
// Each rule is documented behaviour or was measured on a real session; see README, "How it knows".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EVENTS, TOOLS, RETIRED_TOOLS, HOOK_TYPES } from "./facts.js";

// Only letters, digits, _, -, spaces, commas and | : a list of exact names. Anything else: a regular expression.
const LIST = /^[A-Za-z0-9_\-, |]+$/;

export function parseMatcher(matcher) {
  if (matcher === undefined || matcher === null) return { kind: "all" };
  const m = String(matcher).trim();
  if (m === "" || m === "*") return { kind: "all" };
  if (LIST.test(m)) return { kind: "list", names: m.split(/[|,]/).map((s) => s.trim()).filter(Boolean) };
  try {
    return { kind: "regex", re: new RegExp(m) };
  } catch (e) {
    return { kind: "invalid", error: e.message };
  }
}

/** Does `matcher` select `name`? Mirrors Claude Code: exact names in a list, unanchored regex otherwise. */
export function matches(matcher, name) {
  const p = parseMatcher(matcher);
  if (p.kind === "all") return true;
  if (p.kind === "list") return p.names.includes(name);
  if (p.kind === "regex") return p.re.test(name);
  return false;
}

export const isToolEvent = (event) => EVENTS[event]?.matcher === "tool";

const lower = (s) => s.toLowerCase();
const byLower = (list) => new Map(list.map((x) => [lower(x), x]));
const finding = (level, code, message, fix) => ({ level, code, message, fix });

/** The script file a command runs, when it can be worked out without running anything. */
export function scriptPath(command, projectDir) {
  const words = (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) => w.replace(/^["']|["']$/g, ""));
  const interpreters = new Set(["bash", "sh", "zsh", "node", "python", "python3", "uv", "npx", "deno", "bun", "pwsh", "powershell", "env"]);
  let direct = true;
  for (const raw of words) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) continue; // VAR=value prefix
    if (interpreters.has(path.basename(raw).replace(/\.exe$/i, ""))) {
      direct = false;
      continue;
    }
    if (["-c", "-e", "-m", "-p", "--eval", "--command", "-Command"].includes(raw)) return null; // inline code
    if (raw.startsWith("-") || raw === "run") continue;
    const w = raw
      .replace(/^\$\{?CLAUDE_PROJECT_DIR\}?/, projectDir)
      .replace(/^(~|\$\{?HOME\}?)(?=[\\/])/, os.homedir());
    if (w.includes("$")) return null; // a variable we cannot resolve
    const looksLikeFile = /[\\/]/.test(w) || /\.(sh|js|mjs|cjs|py|ts|ps1)$/.test(w);
    if (!looksLikeFile) return null;
    const relative = !path.isAbsolute(w);
    return { file: relative ? path.join(projectDir, w) : w, shown: raw, direct, relative };
  }
  return null;
}

function checkMatcher(event, matcher, tools) {
  const out = [];
  if (matcher === undefined || matcher === null) return out;
  if (typeof matcher !== "string") {
    out.push(finding("error", "matcher-type", `matcher must be a string, found ${JSON.stringify(matcher)}`, 'use a string such as "Bash" or "Edit|Write"'));
    return out;
  }
  const kind = EVENTS[event]?.matcher;
  if (kind === "none") {
    if (matcher.trim() !== "" && matcher.trim() !== "*") {
      out.push(finding("info", "matcher-ignored", `${event} does not support matchers: "${matcher}" is silently ignored and the hook runs every time`, "remove the matcher; to react to one tool, use PreToolUse or PostToolUse"));
    }
    return out;
  }
  if (kind !== "tool") return out; // matched against something other than tool names; not checked here
  const p = parseMatcher(matcher);
  if (p.kind === "all") return out;
  const m = matcher.trim();

  if (/^[A-Za-z_]+\(.*\)$/.test(m)) {
    const tool = m.replace(/\(.*$/, "");
    out.push(finding("error", "permission-syntax", `"${m}" is permission-rule syntax; a matcher is compared with the tool name alone, so this never fires`, `use "matcher": "${tool}" and move the rule to the hook's "if" field: "if": "${m}"`));
    return out;
  }
  if (p.kind === "invalid") {
    out.push(finding("error", "bad-regex", `"${m}" is not a valid regular expression (${p.error})`, "fix the pattern"));
    return out;
  }
  const known = byLower(tools);
  if (p.kind === "list") {
    const dead = [];
    let live = 0;
    for (const n of p.names) {
      if (tools.includes(n) || n.startsWith("mcp__")) {
        live += 1;
      } else if (known.has(lower(n))) {
        dead.push(finding("error", "case", `"${n}" never fires: matchers are case-sensitive and the tool is called ${known.get(lower(n))}`, `write "${known.get(lower(n))}"`));
      } else if (RETIRED_TOOLS[n]) {
        out.push(finding("info", "retired-tool", `"${n}" ${RETIRED_TOOLS[n]}`, `drop "${n}" from the matcher`));
      } else {
        const near = tools.filter((t) => t.startsWith(n) || n.startsWith(t));
        dead.push(finding("warn", "unknown-tool", `"${n}" is not a tool name this version knows; a name in a list must equal the whole tool name${near.length ? ` (did you mean ${near.join(" or ")}?)` : ""}`, near.length ? `write "${near[0]}", or a regular expression such as "${n}.*"` : "check the spelling against the tool names in your own sessions (the history line above lists them)"));
      }
    }
    // one live name keeps the hook alive: the dead ones are then a warning, not a dead hook
    out.push(...dead.map((f) => (live && f.level === "error" ? { ...f, level: "warn", message: f.message.replace("never fires", "never matches") } : f)));
  } else {
    const hit = tools.filter((t) => p.re.test(t));
    if (hit.length === 0 && !/mcp/.test(m)) {
      const ci = tools.filter((t) => new RegExp(m, "i").test(t));
      if (ci.length) out.push(finding("error", "case", `the pattern "${m}" never fires: it matches no tool as written, and would match ${ci.join(", ")} with the right case`, "fix the case"));
      else out.push(finding("warn", "unknown-tool", `the pattern "${m}" matches no tool name this version knows`, "check the spelling against the tool names in your own sessions"));
    }
  }
  const sel = new Set(tools.filter((t) => matches(m, t)));
  if (sel.has("Write") && !sel.has("Edit")) {
    out.push(finding("warn", "write-without-edit", `"${m}" does not see edits: changing an existing file is the Edit tool; Write only creates a file or replaces it whole`, 'use "Edit|Write"'));
  } else if (sel.has("Edit") && !sel.has("Write")) {
    out.push(finding("info", "edit-without-write", `"${m}" does not see new files: creating a file is the Write tool`, 'use "Edit|Write" if new files matter'));
  }
  return out;
}

function checkHandler(h, projectDir, platform) {
  const f = [];
  const type = h?.type;
  if (!type) {
    f.push(finding("error", "no-type", 'hook has no "type"', 'add "type": "command"'));
    return f;
  }
  if (!HOOK_TYPES[type]) {
    f.push(finding("error", "bad-type", `unknown hook type "${type}"`, `use one of: ${Object.keys(HOOK_TYPES).join(", ")}`));
    return f;
  }
  for (const req of HOOK_TYPES[type]) {
    if (h[req] === undefined || h[req] === "") f.push(finding("error", "missing-field", `a "${type}" hook needs "${req}"`, `add "${req}"`));
  }
  if (type !== "command" || typeof h.command !== "string" || !h.command.trim()) return f;
  const sp = scriptPath(h.command, projectDir);
  if (!sp) return f;
  if (!fs.existsSync(sp.file)) {
    f.push(finding("error", "script-missing", `script not found: ${sp.shown}`, "create the file or fix the path"));
    return f;
  }
  if (sp.direct && platform !== "win32") {
    try {
      fs.accessSync(sp.file, fs.constants.X_OK);
    } catch {
      f.push(finding("error", "not-executable", `${sp.shown} is not executable, so the hook fails each time it is called`, `chmod +x ${sp.shown}, or call it through its interpreter (bash ${sp.shown})`));
    }
  }
  if (sp.relative) {
    f.push(finding("info", "relative-path", `${sp.shown} is resolved from the directory the session is in at that moment`, 'prefix it with "$CLAUDE_PROJECT_DIR"/ so it survives a cd'));
  }
  return f;
}

/**
 * Lint one parsed settings object.
 * Returns { hooks: [{event, matcher, if, type, command, findings}], file: [findings] }.
 * `extraTools`: tool names seen in the project's own sessions (MCP tools, tools newer than this version).
 */
export function lintSettings(settings, { projectDir = process.cwd(), platform = process.platform, extraTools = [] } = {}) {
  const hooks = [];
  const file = [];
  const tools = [...new Set([...TOOLS, ...extraTools])];
  if (settings?.disableAllHooks === true) {
    file.push(finding("warn", "disabled", '"disableAllHooks" is true: no hook runs', 'remove "disableAllHooks"'));
  }
  const block = settings?.hooks;
  if (block === undefined) return { hooks, file };
  if (block === null || typeof block !== "object" || Array.isArray(block)) {
    file.push(finding("error", "hooks-shape", '"hooks" must be an object keyed by event name', 'use { "hooks": { "PreToolUse": [ ... ] } }'));
    return { hooks, file };
  }
  const events = byLower(Object.keys(EVENTS));
  for (const [event, groups] of Object.entries(block)) {
    const eventFindings = [];
    let canonical = event;
    if (!EVENTS[event]) {
      if (events.has(lower(event))) {
        canonical = events.get(lower(event));
        eventFindings.push(finding("error", "event-case", `event "${event}" never fires: the name is ${canonical}`, `rename the key to "${canonical}"`));
      } else {
        eventFindings.push(finding("warn", "unknown-event", `"${event}" is not a hook event this version knows; a misspelt event name runs nothing and reports nothing`, "check the name against the hooks reference"));
      }
    }
    if (!Array.isArray(groups)) {
      file.push(finding("error", "event-shape", `hooks.${event} must be an array of { "matcher", "hooks": [ ... ] }`, "wrap the entry in [ ]"));
      continue;
    }
    for (const group of groups) {
      const groupFindings = [...eventFindings, ...checkMatcher(canonical, group?.matcher, tools)];
      if (!Array.isArray(group?.hooks)) {
        const flat = group && typeof group === "object" && ("command" in group || "type" in group);
        groupFindings.push(finding("error", "group-shape", flat ? 'the handler sits one level too high: each entry needs its own "hooks" array' : 'entry has no "hooks" array', 'use { "matcher": "...", "hooks": [ { "type": "command", "command": "..." } ] }'));
        hooks.push({ event, matcher: group?.matcher, type: group?.type, command: group?.command ?? "", findings: groupFindings });
        continue;
      }
      for (const h of group.hooks) {
        hooks.push({
          event,
          matcher: group.matcher,
          if: h?.if,
          type: h?.type,
          command: h?.command ?? h?.prompt ?? h?.url ?? (h?.tool ? `${h.server}:${h.tool}` : ""),
          findings: [...groupFindings, ...checkHandler(h, projectDir, platform)],
        });
      }
    }
  }
  return { hooks, file };
}

export function worst(findings) {
  if (findings.some((f) => f.level === "error")) return "error";
  if (findings.some((f) => f.level === "warn")) return "warn";
  return "ok";
}
