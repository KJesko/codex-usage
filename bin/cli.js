#!/usr/bin/env node
"use strict";

/**
 * npm/npx entry point. This is a thin wrapper: it locates a Python 3
 * interpreter and runs the bundled stdlib-only dashboard, forwarding all args.
 *
 * The heavy lifting (parsing ~/.claude logs, serving the UI) is done by the
 * Python app; Node is only used because `npx claude-usage-dashboard` is a
 * familiar install path for the Claude Code / ccusage audience.
 */

const { spawnSync } = require("child_process");
const path = require("path");

const APP = path.join(__dirname, "..", "src", "claude_usage_dashboard", "app.py");

function findPython() {
  // On Windows the `py` launcher is the most reliable; elsewhere prefer python3.
  const candidates =
    process.platform === "win32"
      ? [{ cmd: "py", pre: ["-3"] }, { cmd: "python", pre: [] }, { cmd: "python3", pre: [] }]
      : [{ cmd: "python3", pre: [] }, { cmd: "python", pre: [] }];
  for (const c of candidates) {
    try {
      const r = spawnSync(c.cmd, [...c.pre, "--version"], { stdio: "ignore" });
      if (r.status === 0) return c;
    } catch (_) {
      /* try next */
    }
  }
  return null;
}

const py = findPython();
if (!py) {
  console.error(
    "[claude-usage-dashboard] Python 3.8+ is required but was not found on PATH.\n" +
      "Install it from https://www.python.org/downloads/ and re-run."
  );
  process.exit(1);
}

const res = spawnSync(py.cmd, [...py.pre, APP, ...process.argv.slice(2)], {
  stdio: "inherit",
});
if (res.error) {
  console.error("[claude-usage-dashboard] Failed to launch:", res.error.message);
  process.exit(1);
}
process.exit(res.status === null ? 1 : res.status);
