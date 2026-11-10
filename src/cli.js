import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lintSettings, matches, isToolEvent, worst } from "./lint.js";
import { readHistory, configDir } from "./history.js";
import { FACTS_DATE } from "./facts.js";

const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const MIN_CALLS = 20; // below this, "matched nothing so far" says too little to warn about

const HELP = `hooks-doctor ${VERSION}: which of your Claude Code hooks never fire, and why

Usage: hooks-doctor [project-dir] [options]

  --sessions <n>   how many recent sessions of this project to replay (default 20)
  --no-history     static checks only; do not read session transcripts
  --no-user        skip the user settings file (~/.claude/settings.json)
  --strict         exit 1 on warnings too
  --json           machine-readable output
  -h, --help       this text
  -v, --version    version

Reads .claude/settings.json, .claude/settings.local.json and the user settings file. Changes nothing.
Exit code: 0 clean, 1 at least one hook that cannot fire (or a warning with --strict), 2 usage error.`;

export function parseArgs(argv) {
  const o = { dir: ".", sessions: 20, history: true, user: true, strict: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "-v" || a === "--version") o.version = true;
    else if (a === "--no-history") o.history = false;
    else if (a === "--no-user") o.user = false;
    else if (a === "--strict") o.strict = true;
    else if (a === "--json") o.json = true;
    else if (a === "--sessions") {
      o.sessions = Number(argv[++i]);
      if (!Number.isInteger(o.sessions) || o.sessions < 1) throw new Error("--sessions needs a positive whole number");
    } else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else o.dir = a;
  }
  return o;
}

function tilde(p) {
  const home = os.homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length).replaceAll("\\", "/") : p;
}

/** Everything the report needs, as plain data. */
export function diagnose(o, env = process.env) {
  const projectDir = path.resolve(o.dir);
  const sources = [
    { label: ".claude/settings.json", file: path.join(projectDir, ".claude", "settings.json") },
    { label: ".claude/settings.local.json", file: path.join(projectDir, ".claude", "settings.local.json") },
  ];
  if (o.user) {
    const user = path.join(configDir(env), "settings.json");
    sources.push({ label: tilde(user), file: user });
  }
  const history = o.history ? readHistory(projectDir, { sessions: o.sessions, env }) : null;
  const seen = history ? [...history.byTool.keys()] : [];
  const files = [];
  for (const s of sources) {
    if (!fs.existsSync(s.file)) continue;
    let settings;
    try {
      settings = JSON.parse(fs.readFileSync(s.file, "utf8").replace(/^﻿/, ""));
    } catch (e) {
      files.push({ label: s.label, hooks: [], file: [{ level: "error", code: "bad-json", message: `not valid JSON (${e.message})`, fix: "fix the syntax; a settings file that does not parse contributes no hooks" }] });
      continue;
    }
    const r = lintSettings(settings, { projectDir, extraTools: seen });
    for (const h of r.hooks) {
      if (!history || !history.calls || !isToolEvent(h.event)) continue;
      const hit = [...history.byTool].filter(([name]) => matches(h.matcher, name));
      h.history = { calls: history.calls, matched: hit.reduce((n, [, c]) => n + c, 0), tools: Object.fromEntries(hit) };
      if (h.history.matched === 0 && history.calls >= MIN_CALLS && worst(h.findings) === "ok") {
        h.findings.push({ level: "warn", code: "never-matched", message: `the matcher selects none of the ${history.calls} tool calls in your last ${history.sessions} session${history.sessions === 1 ? "" : "s"}`, fix: "compare it with the tool names in the history line; if the tool is simply rare here, ignore this" });
      }
    }
    for (const h of r.hooks) h.verdict = worst(h.findings) === "error" ? "dead" : worst(h.findings);
    if (r.hooks.length || r.file.length) files.push({ label: s.label, ...r });
  }
  const all = files.flatMap((f) => f.hooks);
  const summary = {
    hooks: all.length,
    dead: all.filter((h) => h.verdict === "dead").length,
    warn: all.filter((h) => h.verdict === "warn").length,
    ok: all.filter((h) => h.verdict === "ok").length,
    fileErrors: files.flatMap((f) => f.file).filter((x) => x.level === "error").length,
  };
  return {
    version: VERSION,
    project: projectDir,
    history: history && { found: history.found, sessions: history.sessions, calls: history.calls, byTool: Object.fromEntries([...history.byTool].sort((a, b) => b[1] - a[1])), from: history.from, to: history.to },
    files,
    summary,
  };
}

function painter(on) {
  const c = (code) => (s) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { red: c(31), yellow: c(33), green: c(32), dim: c(2), bold: c(1) };
}

const top = (counts, n = 6) => {
  const e = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return e.slice(0, n).map(([k, v]) => `${k} ${v}`).join(", ") + (e.length > n ? `, +${e.length - n} more` : "");
};

export function render(d, { color = false } = {}) {
  const p = painter(color);
  const out = [`${p.bold("hooks-doctor")} ${d.version}  ${p.dim(d.project)}`];
  if (d.history) {
    if (!d.history.found) out.push(p.dim("history: no session transcripts for this project yet; static checks only"));
    else if (!d.history.calls) out.push(p.dim("history: sessions found, but no tool calls in them"));
    else out.push(`history: ${d.history.sessions} session${d.history.sessions === 1 ? "" : "s"}, ${d.history.calls} tool calls (${top(d.history.byTool)})`);
  }
  if (!d.files.length) {
    out.push("", "No hooks found in .claude/settings.json, .claude/settings.local.json or the user settings file.");
    return out.join("\n");
  }
  const mark = { error: p.red("x"), warn: p.yellow("!"), info: p.dim("i") };
  const tag = { dead: p.red("DEAD"), warn: p.yellow("WARN"), ok: p.green("ok  ") };
  for (const f of d.files) {
    out.push("", p.bold(f.label));
    for (const x of f.file) out.push(`  ${mark[x.level]} ${x.message}`, p.dim(`    fix: ${x.fix}`));
    const wE = Math.max(...f.hooks.map((h) => h.event.length), 0);
    const mText = (h) => (h.matcher === undefined || h.matcher === null ? "(no matcher)" : JSON.stringify(h.matcher));
    const wM = Math.max(...f.hooks.map((h) => mText(h).length), 0);
    for (const h of f.hooks) {
      const cmd = String(h.command ?? "").replace(/\s+/g, " ");
      out.push(`  ${tag[h.verdict]}  ${h.event.padEnd(wE)}  ${mText(h).padEnd(wM)}  ${p.dim(cmd.length > 70 ? cmd.slice(0, 67) + "..." : cmd)}`);
      if (h.history) {
        const which = h.history.matched ? ` (${top(h.history.tools, 4)})` : "";
        out.push(p.dim(`        matcher selects ${h.history.matched} of ${h.history.calls} past tool calls${which}${h.if ? `; "if": ${JSON.stringify(h.if)} not evaluated` : ""}`));
      }
      for (const x of h.findings) if (x.code !== "relative-path") out.push(`        ${mark[x.level]} ${x.message}`, p.dim(`          fix: ${x.fix}`));
    }
    const rel = f.hooks.filter((h) => h.findings.some((x) => x.code === "relative-path")).length;
    if (rel) out.push(p.dim(`  i ${rel} command${rel === 1 ? " uses a relative script path" : "s use a relative script path"}: it is resolved from the session's current directory; prefix it with "$CLAUDE_PROJECT_DIR"/ to survive a cd`));
  }
  const s = d.summary;
  const parts = [s.dead ? p.red(`${s.dead} dead`) : null, s.warn ? p.yellow(`${s.warn} with a warning`) : null, `${s.ok} ok`].filter(Boolean);
  out.push("", `${s.hooks} hook${s.hooks === 1 ? "" : "s"}: ${parts.join(", ")}`);
  if (s.dead || s.warn) out.push(p.dim(`A hook that cannot fire prints no error in Claude Code. Rules follow the hooks reference as of ${FACTS_DATE}.`));
  return out.join("\n");
}

export function main(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    stderr.write(`hooks-doctor: ${e.message}\n\n${HELP}\n`);
    return 2;
  }
  if (o.help) return stdout.write(HELP + "\n"), 0;
  if (o.version) return stdout.write(VERSION + "\n"), 0;
  if (!fs.existsSync(path.resolve(o.dir))) {
    stderr.write(`hooks-doctor: no such directory: ${o.dir}\n`);
    return 2;
  }
  const d = diagnose(o, env);
  if (o.json) stdout.write(JSON.stringify(d, null, 2) + "\n");
  else stdout.write(render(d, { color: Boolean(stdout.isTTY) && !env.NO_COLOR }) + "\n");
  const s = d.summary;
  return s.dead || s.fileErrors || (o.strict && s.warn) ? 1 : 0;
}
