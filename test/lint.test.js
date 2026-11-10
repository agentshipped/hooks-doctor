import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matches, lintSettings, scriptPath, worst } from "../src/lint.js";

const example = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples", "five-hooks");
const codes = (h) => h.findings.map((f) => f.code);
const group = (event, matcher, extra = {}) => ({ hooks: { [event]: [{ ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: "command", command: "echo hi", ...extra }] }] } });
const lintOne = (event, matcher) => lintSettings(group(event, matcher)).hooks[0];

// Measured on Claude Code 2.1.316 (10 Nov 2026): two sessions that each called Bash, Read, Edit and Write once,
// with one logging hook per matcher (PreToolUse in one, PostToolUse in the other).
// Each row: matcher -> the tools whose call ran the hook.
const MEASURED = [
  ["", ["Bash", "Read", "Edit", "Write"]],
  ["*", ["Bash", "Read", "Edit", "Write"]],
  [undefined, ["Bash", "Read", "Edit", "Write"]],
  [".*", ["Bash", "Read", "Edit", "Write"]],
  ["bash", []],
  ["Bas", []],
  ["Writ", []],
  ["Bash ", ["Bash"]],
  ["Bash|", ["Bash"]],
  ["Bash.*", ["Bash"]],
  ["B.*h", ["Bash"]],
  ["^Bash$", ["Bash"]],
  ["as.", ["Bash"]],
  ["ash$", ["Bash"]],
  ["^Ba", ["Bash"]],
  ["[Bb]ash", ["Bash"]],
  ["Bash(npm:*)", []],
  ["Edit", ["Edit"]],
  ["Edi.", ["Edit"]],
  ["Read|Bash", ["Bash", "Read"]],
  ["Bash,Read", ["Bash", "Read"]],
  ["Write|Edit", ["Edit", "Write"]],
  ["Edit | Write", ["Edit", "Write"]],
  ["(Edit|Write)", ["Edit", "Write"]],
  ["Edit|Wri.*", ["Edit", "Write"]],
  ["Edit|Write|MultiEdit", ["Edit", "Write"]],
  ["Edit|write", ["Edit"]],
  ["^(?!Bash).*$", ["Read", "Edit", "Write"]],
];

test("matches() agrees with what Claude Code did", () => {
  for (const [matcher, fired] of MEASURED) {
    for (const tool of ["Bash", "Read", "Edit", "Write"]) {
      assert.equal(matches(matcher, tool), fired.includes(tool), `matcher ${JSON.stringify(matcher)} on ${tool}`);
    }
  }
});

test("the five-hooks example: one dead hook, one that misses edits, three fine", () => {
  const settings = JSON.parse(fs.readFileSync(path.join(example, ".claude", "settings.json"), "utf8"));
  const { hooks, file } = lintSettings(settings, { projectDir: example });
  assert.equal(file.length, 0);
  const by = Object.fromEntries(hooks.map((h) => [h.command.split("/").pop(), h]));
  assert.equal(worst(by["audit.sh"].findings), "error");
  assert.deepEqual(codes(by["audit.sh"]).filter((c) => c !== "relative-path"), ["case"]);
  assert.equal(worst(by["changed.sh"].findings), "warn");
  assert.ok(codes(by["changed.sh"]).includes("write-without-edit"));
  for (const name of ["guard.sh", "syntax.sh", "stop.sh"]) assert.equal(worst(by[name].findings), "ok", name);
});

test("a lower-case name is dead alone and a warning next to a live one", () => {
  assert.equal(worst(lintOne("PreToolUse", "bash").findings), "error");
  const mixed = lintOne("PreToolUse", "Edit|write");
  assert.equal(worst(mixed.findings), "warn");
  assert.ok(codes(mixed).includes("case"));
});

test("permission-rule syntax in a matcher never fires", () => {
  const h = lintOne("PreToolUse", "Bash(npm:*)");
  assert.deepEqual(codes(h), ["permission-syntax"]);
  assert.match(h.findings[0].fix, /"if": "Bash\(npm:\*\)"/);
});

test("regex matchers: wrong case is dead, a working one is quiet", () => {
  assert.deepEqual(codes(lintOne("PostToolUse", "edit.*")), ["case"]);
  assert.deepEqual(codes(lintOne("PostToolUse", "Edit.*")), ["edit-without-write"]); // Edit, NotebookEdit; not Write
  assert.deepEqual(codes(lintOne("PostToolUse", "mcp__github__.*")), []);
  assert.deepEqual(codes(lintOne("PostToolUse", "Bash(")), ["bad-regex"]);
});

test("names this version does not know are a warning, unless the project's sessions used them", () => {
  assert.deepEqual(codes(lintOne("PreToolUse", "Bas")), ["unknown-tool"]);
  assert.match(lintOne("PreToolUse", "Bas").findings[0].message, /did you mean Bash/);
  const settings = group("PreToolUse", "BrandNewTool");
  assert.deepEqual(codes(lintSettings(settings).hooks[0]), ["unknown-tool"]);
  assert.deepEqual(codes(lintSettings(settings, { extraTools: ["BrandNewTool"] }).hooks[0]), []);
  assert.deepEqual(codes(lintOne("PreToolUse", "mcp__memory__create")), []);
  assert.deepEqual(codes(lintOne("PostToolUse", "Edit|MultiEdit|Write")), ["retired-tool"]);
});

test("events: wrong case is dead, unknown is a warning, matcher on Stop is only a note", () => {
  const wrong = lintOne("PreTooluse", "Bash");
  assert.deepEqual(codes(wrong), ["event-case"]);
  assert.equal(worst(wrong.findings), "error");
  assert.deepEqual(codes(lintOne("PreToolUseX", "Bash")), ["unknown-event"]);
  const stop = lintOne("Stop", "Bash");
  assert.deepEqual(codes(stop), ["matcher-ignored"]);
  assert.equal(worst(stop.findings), "ok");
  assert.deepEqual(codes(lintOne("Stop", undefined)), []);
  assert.deepEqual(codes(lintOne("SessionStart", "startup")), []); // not a tool matcher: left alone
});

test("shape errors", () => {
  const flat = lintSettings({ hooks: { PreToolUse: [{ matcher: "Bash", type: "command", command: "echo hi" }] } });
  assert.deepEqual(codes(flat.hooks[0]), ["group-shape"]);
  assert.equal(lintSettings({ hooks: { PreToolUse: { matcher: "Bash" } } }).file[0].code, "event-shape");
  assert.equal(lintSettings({ hooks: [] }).file[0].code, "hooks-shape");
  assert.deepEqual(codes(lintSettings({ hooks: { Stop: [{ hooks: [{ command: "echo hi" }] }] } }).hooks[0]), ["no-type"]);
  assert.deepEqual(codes(lintSettings({ hooks: { Stop: [{ hooks: [{ type: "command" }] }] } }).hooks[0]), ["missing-field"]);
  assert.deepEqual(codes(lintSettings({ hooks: { Stop: [{ hooks: [{ type: "shell", command: "x" }] }] } }).hooks[0]), ["bad-type"]);
  assert.equal(lintSettings({ disableAllHooks: true }).file[0].code, "disabled");
  assert.deepEqual(lintSettings({ permissions: {} }), { hooks: [], file: [] });
});

test("script checks: missing file, not executable, relative path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-doctor-"));
  fs.mkdirSync(path.join(dir, "hooks"));
  fs.writeFileSync(path.join(dir, "hooks", "a.sh"), "#!/bin/sh\n", { mode: 0o644 });
  const run = (command, platform = "linux") => codes(lintSettings(group("Stop", undefined, { command }), { projectDir: dir, platform }).hooks[0]);
  assert.deepEqual(run("bash hooks/missing.sh"), ["script-missing"]);
  assert.deepEqual(run("bash hooks/a.sh"), ["relative-path"]);
  assert.deepEqual(run('bash "$CLAUDE_PROJECT_DIR"/hooks/a.sh'), []);
  assert.deepEqual(run("${CLAUDE_PROJECT_DIR}/hooks/a.sh", "win32"), []);
  if (process.platform !== "win32") assert.deepEqual(run("$CLAUDE_PROJECT_DIR/hooks/a.sh"), ["not-executable"]);
  fs.rmSync(dir, { recursive: true });
});

test("scriptPath leaves alone what it cannot resolve", () => {
  const none = ["echo done", "jq -r .tool_input.command", "npx prettier --write file", 'bash -c "cat ./x.sh"', "python3 -m tool.run", "$PLUGIN_DIR/run.sh", "node -e \"require('./x.js')\""];
  for (const c of none) assert.equal(scriptPath(c, "/p"), null, c);
  assert.equal(scriptPath("FOO=1 bash ./x.sh", "/p").shown, "./x.sh");
  assert.equal(scriptPath("uv run scripts/check.py", "/p").direct, false);
  assert.equal(scriptPath("./x.sh --flag", "/p").direct, true);
});
