import { before, after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const PORT = 9000 + Math.floor(Math.random() * 500);
const BASE = `http://${HOST}:${PORT}`;

let child;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await sleep(200);
  }
  throw new Error("server did not become healthy");
}

function parseSse(text) {
  return text
    .split(/\n\n+/)
    .map((chunk) => chunk.split(/\n/).filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n"))
    .filter(Boolean)
    .map((json) => JSON.parse(json));
}

before(async () => {
  child = spawn(process.execPath, ["src/server.js"], {
    cwd: APP,
    env: { ...process.env, HOST, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
});

after(() => {
  if (child) child.kill("SIGTERM");
});

describe("Challenge 2 judge server", () => {
  it("serves contract and recorded report metadata", async () => {
    const contract = await fetch(`${BASE}/api/contract`).then((res) => res.json());
    assert.equal(contract.schema, "raven-conformance-ui-contract/1");

    const recorded = await fetch(`${BASE}/api/recorded`).then((res) => res.json());
    assert.ok(Array.isArray(recorded.recorded));
    assert.ok(recorded.recorded.some((item) => item.id === "BROKEN_SUBTLE"));

    const sample = await fetch(`${BASE}/api/recorded/BROKEN_SUBTLE`).then((res) => res.json());
    assert.equal(sample.source, "recorded_demo_report");
    assert.equal(sample.report.target.id, "BROKEN_SUBTLE");
    assert.match(sample.ui.first_issue.vector_id, /unexpected_top_level/i);
  });

  it("streams live progress with SSE and returns final payload", async () => {
    const response = await fetch(`${BASE}/api/run-stream?target=CONFORMANT_REFERENCE`);
    assert.match(response.headers.get("content-type") || "", /text\/event-stream/i);
    const text = await response.text();
    const events = parseSse(text);
    assert.equal(events[0].type, "run_started");
    assert.ok(events.some((event) => event.type === "vector_finished"));
    const finished = events.find((event) => event.type === "run_finished");
    assert.ok(finished);
    assert.equal(finished.payload.report.summary.overall, "CONFORMANT");
  });

  it("enforces the demo allowlist for POST /api/run", async () => {
    const response = await fetch(`${BASE}/api/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "HOSTILE_ENDLESS" }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, "unknown_target");
  });
});
