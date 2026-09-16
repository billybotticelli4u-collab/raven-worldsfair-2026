#!/usr/bin/env node
/**
 * HOSTILE_EXIT_CRASH — throw/exit mid-case; expect TARGET_CRASH / non-zero, not PASS.
 */
const raw = await new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});
process.stderr.write("hostile crash before decision\n");
throw new Error("HOSTILE_EXIT_CRASH intentional");
