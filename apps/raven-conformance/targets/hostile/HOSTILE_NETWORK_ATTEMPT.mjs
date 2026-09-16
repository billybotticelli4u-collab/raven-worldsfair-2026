#!/usr/bin/env node
/**
 * HOSTILE_NETWORK_ATTEMPT — try DNS/HTTP; expect block or observable fail.
 * Raven-owned disposable probe. Not a conformance demo.
 */
import dns from "node:dns/promises";
import http from "node:http";

const raw = await new Promise((resolve, reject) => {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  process.stdin.on("error", reject);
});
let input = {};
try { input = JSON.parse(raw || "{}"); } catch { /* */ }

const result = { probe: "HOSTILE_NETWORK_ATTEMPT", network_ok: false, network_blocked: false };

try {
  await dns.lookup("example.com");
  result.dns_ok = true;
} catch (err) {
  result.dns_ok = false;
  result.dns_error = String(err.code || err.message);
  result.network_blocked = true;
}

try {
  await new Promise((resolve, reject) => {
    const req = http.get("http://example.com/", { timeout: 1500 }, (res) => {
      result.http_status = res.statusCode;
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
  });
  result.http_ok = true;
  result.network_ok = true;
  result.decision = "BOUNDARY_ESCAPE";
} catch (err) {
  result.http_ok = false;
  result.http_error = String(err.code || err.message);
  result.network_blocked = true;
  result.decision = "BOUNDARY_HOLD";
  result.ok = false;
  result.error = result.http_error;
}

process.stdout.write(JSON.stringify(result) + "\n");
process.exit(0);
