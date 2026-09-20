import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { selectIdentity } from "../src/lib/buildIdentity.js";
import {
  isProductionRuntime,
  identityBlocksServing,
  isIdentityExemptPath,
  healthIdentityField,
} from "../src/lib/identityGate.js";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

test("I-2 selectIdentity: operator-only → UNKNOWN, never selected", () => {
  const info = selectIdentity({ env: { WORLDSFAIR_BUILD_COMMIT: "a".repeat(40) } });
  assert.equal(info.identityStatus, "UNKNOWN");
  assert.equal(info.fairBuildCommit, null);
  assert.equal(info.identityClaims[0].displaySource, "operator_asserted (unverified)");
  assert.equal(info.identityClaims[0].selectable, false);
});

test("I-2 selectIdentity: platform vs operator → CONFLICT", () => {
  const info = selectIdentity({
    env: {
      VERCEL_GIT_COMMIT_SHA: "b".repeat(40),
      WORLDSFAIR_BUILD_COMMIT: "c".repeat(40),
    },
  });
  assert.equal(info.identityStatus, "CONFLICT");
  assert.equal(info.fairBuildCommit, "b".repeat(40));
});

test("I-2 selectIdentity: platform only → UNVERIFIED_ASSERTION", () => {
  const info = selectIdentity({ env: { VERCEL_GIT_COMMIT_SHA: "d".repeat(40) } });
  assert.equal(info.identityStatus, "UNVERIFIED_ASSERTION");
  assert.equal(info.fairBuildCommit, "d".repeat(40));
});

test("I-2 gate helpers", () => {
  assert.equal(isProductionRuntime({ VERCEL: "1" }), true);
  assert.equal(isProductionRuntime({ NODE_ENV: "production" }), true);
  assert.equal(isProductionRuntime({ NODE_ENV: "development" }), false);
  assert.equal(identityBlocksServing({ identityStatus: "UNKNOWN" }), true);
  assert.equal(identityBlocksServing({ identityStatus: "CONFLICT" }), false);
  assert.equal(isIdentityExemptPath("/api/health"), true);
  assert.equal(isIdentityExemptPath("/api/build-info"), true);
  assert.equal(isIdentityExemptPath("/"), false);
  assert.equal(healthIdentityField({ identityStatus: "UNKNOWN" }, { VERCEL: "1" }), "unavailable");
});

test("I-2 production UNKNOWN → 503 on /; 200 on health + build-info", async () => {
  const port = await freePort();
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: APP,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      VERCEL: "1",
      RAVEN_FORCE_IDENTITY_UNKNOWN: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (b) => {
    err += b;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("start timeout: " + err)), 8000);
    child.stdout.on("data", (b) => {
      if (String(b).includes("listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("early exit " + code + ": " + err));
    });
  });
  try {
    const get = async (p) => {
      const r = await fetch(`http://127.0.0.1:${port}${p}`);
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: r.status, json, text };
    };
    const health = await get("/api/health");
    assert.equal(health.status, 200, health.text);
    assert.equal(health.json.identity, "unavailable");
    const info = await get("/api/build-info");
    assert.equal(info.status, 200, info.text);
    const home = await get("/");
    assert.equal(home.status, 503, home.text);
    assert.equal(home.json.error, "identity_unavailable");
    const targets = await get("/api/targets");
    assert.equal(targets.status, 503);
  } finally {
    child.kill("SIGTERM");
  }
});
