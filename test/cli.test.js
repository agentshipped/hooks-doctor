import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main, diagnose, parseArgs } from "../src/cli.js";
import { slugOf, projectSlug, toolCalls, readHistory } from "../src/history.js";

const example = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples", "five-hooks");

function sink() {
  const chunks = [];
  return { write: (s) => chunks.push(s), text: () => chunks.join("") };
}

const line = (name, ts = "2026-11-10T10:00:00.000Z") => JSON.stringify({ type: "assistant", timestamp: ts, message: { content: [{ type: "text", text: "x" }, { type: "tool_use", name, input: { command: "secret" } }] } });

/** A fake Claude config dir holding transcripts for `projectDir`: sessions = [[toolName, ...], ...]. */
function fakeConfig(projectDir, sessions, { subagent = [] } = {}) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-doctor-cfg-"));
  const dir = path.join(cfg, "projects", projectSlug(projectDir));
  fs.mkdirSync(dir, { recursive: true });
  sessions.forEach((tools, i) => {
    const text = [JSON.stringify({ type: "user", message: { content: 'say "tool_use"' } }), "not json", ...tools.map((t) => line(t))].join("\n");
    fs.writeFileSync(path.join(dir, `session-${i}.jsonl`), text);
  });
  if (subagent.length) {
    fs.mkdirSync(path.join(dir, "session-0", "subagents"), { recursive: true });
    fs.writeFileSync(path.join(dir, "session-0", "subagents", "agent-1.jsonl"), subagent.map((t) => line(t)).join("\n"));
  }
  return cfg;
}

test("transcript folder names", () => {
  assert.equal(slugOf("/workspace/_pilot"), "-workspace--pilot");
  assert.equal(slugOf("C:\\dev\\my-app"), "C--dev-my-app");
});

test("toolCalls keeps names and timestamps only", () => {
  const calls = toolCalls([line("Bash"), "garbage", JSON.stringify({ type: "user", message: { content: [{ type: "tool_use", name: "Nope" }] } }), line("Edit")].join("\n"));
  assert.deepEqual(calls.map((c) => c.name), ["Bash", "Edit"]);
  assert.deepEqual(Object.keys(calls[0]), ["name", "ts"]);
});

test("readHistory counts sessions and subagent calls, newest sessions first", () => {
  const cfg = fakeConfig(example, [["Bash", "Bash", "Edit"], ["Read"], []], { subagent: ["Grep"] });
  const h = readHistory(example, { env: { CLAUDE_CONFIG_DIR: cfg } });
  assert.equal(h.sessions, 2); // the third has no tool calls
  assert.equal(h.calls, 5);
  assert.deepEqual(Object.fromEntries(h.byTool), { Bash: 2, Edit: 1, Grep: 1, Read: 1 });
  assert.equal(readHistory(example, { env: { CLAUDE_CONFIG_DIR: path.join(cfg, "nope") } }).found, false);
  fs.rmSync(cfg, { recursive: true });
});

test("the example with history: counts per hook, exit 1", () => {
  const tools = [...Array(12).fill("Bash"), ...Array(9).fill("Edit"), ...Array(5).fill("Read"), "Write"];
  const cfg = fakeConfig(example, [tools]);
  const env = { CLAUDE_CONFIG_DIR: cfg };
  const d = diagnose(parseArgs([example]), env);
  assert.deepEqual(d.summary, { hooks: 5, dead: 1, warn: 1, ok: 3, fileErrors: 0 });
  const by = Object.fromEntries(d.files[0].hooks.map((h) => [h.command.split("/").pop(), h]));
  assert.equal(by["audit.sh"].history.matched, 0);
  assert.equal(by["changed.sh"].history.matched, 1);
  assert.equal(by["syntax.sh"].history.matched, 10);
  assert.equal(by["guard.sh"].history.matched, 17);
  assert.equal(by["stop.sh"].history, undefined);

  const out = sink();
  assert.equal(main([example], { stdout: out, stderr: sink(), env }), 1);
  assert.match(out.text(), /history: 1 session, 27 tool calls \(Bash 12, Edit 9, Read 5, Write 1\)/);
  assert.match(out.text(), /DEAD {2}PreToolUse +"bash"/);
  assert.equal(out.text().match(/relative script path/g).length, 1);
  assert.match(out.text(), /matcher selects 0 of 27 past tool calls/);
  assert.match(out.text(), /5 hooks: 1 dead, 1 with a warning, 3 ok/);
  assert.ok(!out.text().includes("secret"));

  const json = sink();
  assert.equal(main([example, "--json"], { stdout: json, stderr: sink(), env }), 1);
  assert.equal(JSON.parse(json.text()).summary.dead, 1);
  fs.rmSync(cfg, { recursive: true });
});

test("history catches a matcher the static rules accept", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-doctor-prj-"));
  fs.mkdirSync(path.join(dir, ".claude"));
  const settings = { hooks: { PreToolUse: [{ matcher: "mcp__github__.*", hooks: [{ type: "command", command: "echo hi" }] }, { matcher: "mcp__memory__.*", hooks: [{ type: "command", command: "echo hi" }] }] } };
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), JSON.stringify(settings));
  const cfg = fakeConfig(dir, [[...Array(25).fill("Bash"), "mcp__memory__create_entities"]]);
  const env = { CLAUDE_CONFIG_DIR: cfg };
  const [github, memory] = diagnose(parseArgs([dir]), env).files[0].hooks;
  assert.deepEqual(github.findings.map((f) => f.code), ["never-matched"]);
  assert.equal(github.verdict, "warn");
  assert.equal(memory.verdict, "ok");
  assert.equal(main([dir], { stdout: sink(), stderr: sink(), env }), 0);
  assert.equal(main([dir, "--strict"], { stdout: sink(), stderr: sink(), env }), 1);
  // too little history to say anything
  const few = fakeConfig(dir, [["Bash"]]);
  assert.equal(diagnose(parseArgs([dir]), { CLAUDE_CONFIG_DIR: few }).files[0].hooks[0].verdict, "ok");
  for (const d of [dir, cfg, few]) fs.rmSync(d, { recursive: true });
});

test("settings files: local and user are read, broken JSON is an error, none is clean", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-doctor-prj-"));
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-doctor-cfg-"));
  const env = { CLAUDE_CONFIG_DIR: cfg };
  const out = sink();
  assert.equal(main([dir], { stdout: out, stderr: sink(), env }), 0);
  assert.match(out.text(), /No hooks found/);

  fs.mkdirSync(path.join(dir, ".claude"));
  fs.writeFileSync(path.join(dir, ".claude", "settings.json"), "{ not json");
  fs.writeFileSync(path.join(dir, ".claude", "settings.local.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo local" }] }] } }));
  fs.writeFileSync(path.join(cfg, "settings.json"), "\uFEFF" + JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo user" }] }] } }));
  const d = diagnose(parseArgs([dir, "--no-history"]), env);
  assert.equal(d.history, null);
  assert.equal(d.files.length, 3);
  assert.equal(d.files[0].file[0].code, "bad-json");
  assert.deepEqual(d.summary, { hooks: 2, dead: 0, warn: 0, ok: 2, fileErrors: 1 });
  assert.equal(main([dir, "--no-history"], { stdout: sink(), stderr: sink(), env }), 1);
  assert.equal(diagnose(parseArgs([dir, "--no-history", "--no-user"]), env).summary.hooks, 1);
  for (const d2 of [dir, cfg]) fs.rmSync(d2, { recursive: true });
});

test("usage", () => {
  const err = sink();
  assert.equal(main(["--nope"], { stdout: sink(), stderr: err }), 2);
  assert.match(err.text(), /unknown option --nope/);
  assert.equal(main(["--sessions", "x"], { stdout: sink(), stderr: sink() }), 2);
  assert.equal(main(["/no/such/dir/anywhere"], { stdout: sink(), stderr: sink() }), 2);
  const out = sink();
  assert.equal(main(["--help"], { stdout: out, stderr: sink() }), 0);
  assert.match(out.text(), /Usage: hooks-doctor/);
});
