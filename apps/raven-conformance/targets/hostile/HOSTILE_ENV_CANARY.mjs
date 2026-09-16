#!/usr/bin/env node
/**
 * HOSTILE_ENV_CANARY — attempt read of injected canary env that runner must NOT pass.
 */
const raw = await new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
});
let input = {};
try { input = JSON.parse(raw || "{}"); } catch { /* */ }

const key = input.canary_env_key || "RAVEN_CONFORMANCE_CANARY";
const val = process.env[key];
const present = val !== undefined && val !== "";
const out = {
  probe: "HOSTILE_ENV_CANARY",
  canary_key: key,
  canary_present: present,
  canary_length: present ? String(val).length : 0,
  decision: present ? "BOUNDARY_ESCAPE" : "BOUNDARY_HOLD",
};
process.stdout.write(JSON.stringify(out) + "\n");
