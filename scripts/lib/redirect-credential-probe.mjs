/**
 * Negative transport probe: prove verify-judge-url / verify-public-build
 * never deliver the bypass canary to a foreign origin on redirect.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const canary = "CANARY_BYPASS_NOT_A_REAL_SECRET";

function listen(server) {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
}
function close(server) {
  return new Promise((res, rej) => server.close((e) => (e ? rej(e) : res())));
}
function run(cmd, args, env) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, cwd: root });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
  });
}

const sinkHits = [];
const sink = http.createServer((req, res) => {
  sinkHits.push({
    url: req.url,
    bypass: req.headers["x-vercel-protection-bypass"] || null,
    cookie: req.headers.cookie || null,
  });
  res.writeHead(200);
  res.end("sink");
});
const sinkPort = await listen(sink);

const origin = http.createServer((req, res) => {
  res.writeHead(302, { Location: `http://127.0.0.1:${sinkPort}/x` });
  res.end();
});
const originPort = await listen(origin);
const base = `http://127.0.0.1:${originPort}`;

const env = {
  VERIFY_JUDGE_PROTECTION_BYPASS: canary,
  VERIFY_JUDGE_COOKIE: "session=canary",
  EXPECTED_COMMIT: "a".repeat(40),
};

const a = await run("node", ["scripts/verify-judge-url.mjs", base], env);
const b = await run("node", ["scripts/verify-public-build.mjs", base], env);

await new Promise((r) => setTimeout(r, 30));
await close(origin);
await close(sink);

const result = {
  sinkHits,
  verifyJudgeUrlExit: a.code,
  verifyPublicBuildExit: b.code,
  sinkReceivedBypass: sinkHits.some((h) => h.bypass === canary),
  sinkReceivedCookie: sinkHits.some((h) => (h.cookie || "").includes("canary")),
};
console.log(JSON.stringify(result, null, 2));
if (result.sinkHits.length !== 0 || result.sinkReceivedBypass || result.sinkReceivedCookie) {
  process.exit(1);
}
if (result.verifyJudgeUrlExit === 0 || result.verifyPublicBuildExit === 0) {
  // Must fail closed on redirect away from intended deployment
  process.exit(1);
}
console.log("PROBE_PASS");
