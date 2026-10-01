import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { runIsolated } from "../src/sandbox.mjs";
const request = {
  op: "create",
  input_base64: "AA==",
  adapter_id: "solana-kit-tx-decode",
  name: "test",
  intake: null,
  intake_reference: null,
};
function setup(change = {}) {
  const calls = [];
  const box = {
    name: "test-vm",
    writeFiles: async (files) => {
      calls.push(["write", files]);
    },
    runCommand: async (command) => {
      calls.push(["command", command]);
      return { exitCode: 0 };
    },
    readFile: async () =>
      Readable.from([
        JSON.stringify({ ok: true, data: { status: "CREATED" } }),
      ]),
    stop: async () => {
      calls.push(["stop"]);
      return { status: "stopped" };
    },
    ...change,
  };
  return {
    calls,
    run: () =>
      runIsolated(request, {
        snapshotId: "snap_test",
        enginePinSha256: "a".repeat(64),
        createSandbox: async (options) => {
          calls.push(["create", options]);
          return box;
        },
      }),
  };
}
test("fresh offline VM, fixed worker, bounded lifetime, stop before success", async () => {
  const { run, calls } = setup();
  const result = await run();
  assert.equal(result.data.status, "CREATED");
  assert.equal(result.isolation.lifecycle, "STOPPED");
  const options = calls[0][1];
  assert.equal(options.networkPolicy, "deny-all");
  assert.equal(options.persistent, false);
  assert.deepEqual(options.ports, []);
  assert.equal(options.timeout, 60000);
  assert.deepEqual(options.env, {});
  const command = calls.find((x) => x[0] === "command")[1];
  assert.equal(command.cmd, "/vercel/sandbox/node/bin/node");
  assert.deepEqual(command.args, ["/vercel/sandbox/app/src/bootstrap.mjs"]);
  assert.equal(command.timeoutMs, 20000);
  const files = calls.find((x) => x[0] === "write")[1];
  assert.equal(
    files.filter((x) => x.path === "/vercel/sandbox/request.json").length,
    1,
  );
  assert.equal(calls.at(-1)[0], "stop");
});
test("invalid input never provisions a VM", async () => {
  let created = 0;
  await assert.rejects(
    runIsolated(
      { ...request, adapter_id: "control-hang" },
      {
        snapshotId: "snap_test",
        createSandbox: async () => {
          created++;
        },
      },
    ),
    { code: "UNKNOWN_ADAPTER" },
  );
  assert.equal(created, 0);
});
test("missing snapshot refuses instead of using an unpinned image", async () => {
  await assert.rejects(runIsolated(request, { snapshotId: "" }), {
    code: "HOST_NOT_CONFIGURED",
  });
});
test("execution failure still stops VM and returns no result", async () => {
  for (const change of [
    {
      writeFiles: async () => {
        throw Error("sensitive");
      },
    },
    { runCommand: async () => ({ exitCode: 1 }) },
    { readFile: async () => null },
    { readFile: async () => Readable.from(["bad-json"]) },
  ]) {
    const { run, calls } = setup(change);
    await assert.rejects(run(), { code: "EXECUTION_BROKEN" });
    assert.equal(calls.at(-1)[0], "stop");
  }
});
test("oversized output is bounded and stopped", async () => {
  const { run, calls } = setup({
    readFile: async () => Readable.from([Buffer.alloc(1024 * 1024 + 1)]),
  });
  await assert.rejects(run(), { code: "EXECUTION_BROKEN" });
  assert.equal(calls.at(-1)[0], "stop");
});
test("unconfirmed stop never returns a success result", async () => {
  for (const stop of [
    async () => {
      throw Error("secret failure");
    },
    async () => ({ status: "stopping" }),
    async () => ({ status: "failed" }),
  ]) {
    const { run } = setup({ stop });
    await assert.rejects(run(), { code: "CLEANUP_UNCONFIRMED" });
  }
});
test("worker refusal stays refusal, no provider error text forwarded", async () => {
  const { run } = setup({
    readFile: async () =>
      Readable.from([JSON.stringify({ ok: false, error: "INVALID_CASE" })]),
  });
  const r = await run();
  assert.deepEqual(r, {
    ok: false,
    error: "INVALID_CASE",
    isolation: { network: "DENIED", lifecycle: "STOPPED" },
  });
  const bad = setup({
    readFile: async () =>
      Readable.from([
        JSON.stringify({ ok: false, error: "secret from worker" }),
      ]),
  });
  await assert.rejects(bad.run(), { code: "EXECUTION_BROKEN" });
});
