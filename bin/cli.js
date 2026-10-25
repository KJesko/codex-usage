#!/usr/bin/env node
// Launch the local Python service. Project origins are documented in README.md.
'use strict';
const {spawnSync} = require('child_process');
const path = require('path');
const fs = require('fs');
const root = path.resolve(__dirname, '..');
const venv = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (process.platform === 'win32' && !fs.existsSync(venv)) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'run.ps1'), ...process.argv.slice(2)], {stdio:'inherit'});
  process.exit(result.status ?? 1);
}
const candidates = fs.existsSync(venv) ? [venv] : ['python3', 'python'];
const python = candidates.find(cmd => spawnSync(cmd, ['--version'], {stdio:'ignore'}).status === 0);
if (!python) { console.error('Python 3.10+ is required. See README.md.'); process.exit(1); }
const result = spawnSync(python, [path.join(root, 'codex_usage.py'), ...process.argv.slice(2)], {stdio:'inherit'});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
