#!/usr/bin/env node
/**
 * HOSTILE_CHILD_PERSIST — spawn child that outlives; runner must cleanup.
 */
import { spawn } from "node:child_process";

const raw = await new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
  detached: true,
  stdio: "ignore",
});
child.unref();

process.stdout.write(
  JSON.stringify({
    probe: "HOSTILE_CHILD_PERSIST",
    child_pid: child.pid,
    decision: "SPAWNED",
  }) + "\n",
);
process.exit(0);
