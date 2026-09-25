#!/usr/bin/env node
// Writes own pid (+ optional in-group descendants) to a pidfile, then hangs.
// Same process group as parent unless --setsid.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const pidfile = args[0];
const mode = args[1] || 'hang'; // hang | ignore-term | spawn-child | spawn-child-ignore | setsid-escape
if (!pidfile) { console.error('usage: group-child <pidfile> [mode]'); process.exit(2); }

function appendPid(p) {
  fs.appendFileSync(pidfile, String(p) + '\n');
}
appendPid(process.pid);

if (mode === 'ignore-term' || mode === 'spawn-child-ignore') {
  process.on('SIGTERM', () => { /* resist */ });
}

if (mode === 'spawn-child' || mode === 'spawn-child-ignore') {
  const self = fileURLToPath(import.meta.url);
  const childMode = mode === 'spawn-child-ignore' ? 'ignore-term' : 'hang';
  // Inherit group (detached:false default)
  const c = spawn(process.execPath, [self, pidfile, childMode], {
    stdio: 'ignore',
    shell: false,
    detached: false,
  });
  c.unref();
}

if (mode === 'setsid-escape') {
  const self = fileURLToPath(import.meta.url);
  const c = spawn(process.execPath, [self, pidfile, 'ignore-term'], {
    stdio: 'ignore',
    shell: false,
    detached: true, // NEW process group — documents escape limit
  });
  c.unref();
}

setInterval(() => {}, 1 << 30);
