#!/usr/bin/env node
/**
 * Control: drains stdin, ignores SIGTERM, keeps event loop alive.
 * Used only to prove hard-deadline termination (SDK-C6). Not a sandbox test.
 */
process.on('SIGTERM', () => {});
process.stdin.on('data', () => {});
process.stdin.resume();
setInterval(() => {}, 100);
