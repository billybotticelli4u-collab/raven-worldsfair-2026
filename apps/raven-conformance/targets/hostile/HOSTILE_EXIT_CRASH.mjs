#!/usr/bin/env node
/**
 * HOSTILE_EXIT_CRASH — throw/exit mid-case; expect TARGET_CRASH / non-zero, not PASS.
 */
const raw = await new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});
process.stdout.write(JSON.stringify({decision:"ACCEPT",reason:"answer_before_fatal_error"})+"\n");
process.stderr.write("hostile crash after valid decision\n");
throw new Error("HOSTILE_EXIT_CRASH intentional");
