#!/usr/bin/env node
/**
 * HOSTILE_OUTPUT_FLOOD — flood stdout; expect OUTPUT_FLOOD / runner limit, not PASS.
 */
const raw = await new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});

const chunk = "X".repeat(4096);
for (let i = 0; i < 100000; i++) {
  process.stdout.write(chunk);
}
process.stdout.write(JSON.stringify({ decision: "ACCEPT", reason: "should_not_reach" }) + "\n");
