// TEST-ONLY helpers shared by live/test/*.test.js.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runLiveSolanaCli } from "../cli.js";

export const LIVE = fileURLToPath(new URL("..", import.meta.url));
export const APP = path.resolve(LIVE, "..");
export const ROOT = path.resolve(APP, "../..");
export const ENTRY = path.join(LIVE, "demo-live-solana.mjs");
export const PRELOAD_URL = pathToFileURL(path.join(LIVE, "test/testPreload.mjs")).href;
export const FIXTURE_BYTES = readFileSync(path.join(APP, "fixtures/bonk-valid-receipt.json"));
export const TAMPERED_BYTES = readFileSync(path.join(APP, "fixtures/bonk-tampered-receipt.json"));
export const FIXTURE = JSON.parse(FIXTURE_BYTES.toString("utf8"));
export const FIXTURE_TS_MS = Date.parse(FIXTURE.timestamp);
export const WSOL_MINT = "So11111111111111111111111111111111111111112";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Dummy, test-only key material. Not a Raven key. */
export const TEST_API_KEY = "test-only-dummy-key-0000";

export const at = (seconds) => () => new Date(FIXTURE_TS_MS + seconds * 1000);
export const isoAt = (seconds) => new Date(FIXTURE_TS_MS + seconds * 1000).toISOString();

/** In-process fetch that refuses anything but the loopback stub. */
export function loopbackOnlyFetch(input, init) {
  const u = new URL(typeof input === "string" ? input : input.url);
  assert.equal(u.hostname, "127.0.0.1", "tests may only reach the loopback stub");
  return fetch(input, init);
}

export function reportDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "raven-live-solana-report-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function readReports(dir) {
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => ({
    file: path.join(dir, f),
    text: readFileSync(path.join(dir, f), "utf8"),
  }));
}

function sink() {
  let text = "";
  return { write(s) { text += s; return true; }, get text() { return text; } };
}

/** Run the CLI function in-process (lets a test inject the evaluation clock). */
export async function runInProcess({ env, argv = [], clock, fetchImpl = loopbackOnlyFetch }) {
  const stdout = sink();
  const stderr = sink();
  const code = await runLiveSolanaCli({ argv, env, stdout, stderr, clock, fetchImpl });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

/**
 * Run the real entrypoint as a child process with a minimal environment
 * (never the parent's env, so a real RAVEN_API_KEY can never leak into a
 * test) and the loopback-only network guard preloaded.
 */
export function runCli(t, { env = {}, argv = [], fixedNow, timeoutMs = 20_000 } = {}) {
  const childEnv = { PATH: process.env.PATH, ...env };
  if (fixedNow) childEnv.RAVEN_TEST_FIXED_NOW = fixedNow;
  const child = spawn(process.execPath, [
    "--experimental-strip-types", "--disable-warning=ExperimentalWarning",
    "--import", PRELOAD_URL, ENTRY, ...argv,
  ], { cwd: tmpdir(), env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d; });
  child.stderr.on("data", (d) => { stderr += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("cli_test_timeout")); }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, pid: child.pid });
    });
  });
}

export const replay = (bytes, status = 200) => () => ({ status, body: bytes });
