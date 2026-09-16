#!/usr/bin/env node
/**
 * HOSTILE_ENDLESS — infinite loop; expect TIMEOUT classification.
 */
const raw = await new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});
// Consume stdin then spin forever
for (;;) {
  /* busy wait — runner must timeout + kill process group */
}
