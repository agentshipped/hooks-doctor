// Reads the tool calls of past Claude Code sessions for one project from the local session transcripts.
// Only tool names and timestamps leave this module; prompts, file contents and command text are never kept.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Claude Code names a project's transcript folder after its path, every non-alphanumeric character as "-". */
export function slugOf(absolutePath) {
  return absolutePath.replace(/[^A-Za-z0-9]/g, "-");
}

export function projectSlug(projectDir) {
  return slugOf(path.resolve(projectDir));
}

export function configDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

function transcriptFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name.endsWith(".jsonl")) out.push({ file: p, session: e.name.slice(0, -6) });
    else if (e.isDirectory()) {
      const sub = path.join(p, "subagents");
      if (fs.existsSync(sub)) for (const f of fs.readdirSync(sub)) if (f.endsWith(".jsonl")) out.push({ file: path.join(sub, f), session: e.name });
    }
  }
  return out;
}

/** Tool calls in one transcript: [{name, ts}]. Lines that are not assistant tool_use blocks are skipped. */
export function toolCalls(text) {
  const calls = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"tool_use"')) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row?.type !== "assistant" || !Array.isArray(row.message?.content)) continue;
    for (const block of row.message.content) {
      if (block?.type === "tool_use" && typeof block.name === "string") calls.push({ name: block.name, ts: row.timestamp ?? null });
    }
  }
  return calls;
}

/**
 * Tool-call counts for the project's most recent sessions.
 * Returns { dir, found, sessions, calls, byTool: Map<name, count>, from, to }.
 */
export function readHistory(projectDir, { sessions = 20, env = process.env } = {}) {
  const dir = path.join(configDir(env), "projects", projectSlug(projectDir));
  const files = transcriptFiles(dir);
  const result = { dir, found: files.length > 0, sessions: 0, calls: 0, byTool: new Map(), from: null, to: null };
  if (!files.length) return result;
  const bySession = new Map();
  for (const f of files) {
    const mtime = fs.statSync(f.file).mtimeMs;
    const s = bySession.get(f.session) ?? { files: [], mtime: 0 };
    s.files.push(f.file);
    s.mtime = Math.max(s.mtime, mtime);
    bySession.set(f.session, s);
  }
  const recent = [...bySession.values()].sort((a, b) => b.mtime - a.mtime).slice(0, sessions);
  for (const s of recent) {
    let any = false;
    for (const file of s.files) {
      for (const c of toolCalls(fs.readFileSync(file, "utf8"))) {
        any = true;
        result.calls += 1;
        result.byTool.set(c.name, (result.byTool.get(c.name) ?? 0) + 1);
        if (c.ts && (!result.from || c.ts < result.from)) result.from = c.ts;
        if (c.ts && (!result.to || c.ts > result.to)) result.to = c.ts;
      }
    }
    if (any) result.sessions += 1;
  }
  return result;
}
