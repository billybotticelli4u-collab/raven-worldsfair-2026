#!/usr/bin/env node
/**
 * HOSTILE_MALFORMED_OUTPUT — bad JSON; expect INVALID_OUTPUT.
 */
const raw = await new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});
process.stdout.write("this is not json at all {{{{\n");
process.exit(0);
