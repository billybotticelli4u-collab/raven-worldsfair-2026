import { readFileSync } from "node:fs";
import { Sandbox } from "@vercel/sandbox";
import { validateRequest, exact, fail } from "./envelope.mjs";
const MAX_RESULT_BYTES = 1024 * 1024;
const workerErrors = new Set([
  "INVALID_REQUEST",
  "INVALID_OPERATION",
  "UNKNOWN_ADAPTER",
  "INVALID_CASE_NAME",
  "INVALID_TRANSACTION_BYTES",
  "UNSUPPORTED_DECODER_VERSION",
  "INVALID_CASE",
  "REFERENCE_REQUIRED",
  "REFERENCE_MISMATCH",
  "INTAKE_INPUT_MISMATCH",
  "INVALID_INTAKE",
  "RUNTIME_MISMATCH",
  "ENGINE_IDENTITY_MISMATCH",
  "EXECUTION_BROKEN",
]);
const statuses = new Set([
  "CREATED",
  "IMPORTED",
  "MATCH",
  "REGRESSION",
  "RUN_ERROR",
  "INVALID_CASE",
  "COMPLETE",
  "INCOMPLETE",
]);
const workerFiles = [
  "bootstrap.mjs",
  "worker.mjs",
  "envelope.mjs",
  "intake.mjs",
];

export async function runIsolated(
  request,
  {
    snapshotId = process.env.RAVEN_REPLAY_SNAPSHOT_ID,
    enginePinSha256 = process.env.RAVEN_REPLAY_ENGINE_PIN_SHA256,
    credentials = {},
    createSandbox = (options) => Sandbox.create(options),
  } = {},
) {
  validateRequest(request);
  if (
    typeof snapshotId !== "string" ||
    !/^snap_[A-Za-z0-9_-]+$/.test(snapshotId)
  )
    fail("HOST_NOT_CONFIGURED");
  if (
    typeof enginePinSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(enginePinSha256)
  )
    fail("HOST_NOT_CONFIGURED");
  const signal = AbortSignal.timeout(45000);
  let box, result;
  try {
    box = await createSandbox({
      ...credentials,
      source: { type: "snapshot", snapshotId },
      persistent: false,
      networkPolicy: "deny-all",
      env: {},
      ports: [],
      timeout: 60000,
      resources: { vcpus: 2 },
      signal,
    });
    // Only source files controlled by this deployment and bounded request data go in.
    // No API keys, RPC URL, caller environment, shell text or uploaded code.
    await box.writeFiles(
      [
        ...workerFiles.map((name) => ({
          path: "/vercel/sandbox/app/src/" + name,
          content: readFileSync(new URL(name, import.meta.url)),
        })),
        {
          path: "/vercel/sandbox/request.json",
          content: JSON.stringify(request),
        },
        {
          path: "/vercel/sandbox/expected-engine-pin.txt",
          content: enginePinSha256 + "\n",
        },
      ],
      { signal },
    );
    const execution = await box.runCommand({
      cmd: "/vercel/sandbox/node/bin/node",
      args: ["/vercel/sandbox/app/src/bootstrap.mjs"],
      cwd: "/vercel/sandbox/app",
      env: {},
      timeoutMs: 20000,
      signal,
    });
    if (execution.exitCode !== 0) throw Error("worker failed");
    const stream = await box.readFile(
      { path: "/vercel/sandbox/result.json" },
      { signal },
    );
    if (!stream) throw Error("missing result");
    const chunks = [];
    let bytes = 0;
    try {
      for await (const chunk of stream) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_RESULT_BYTES) throw Error("oversized result");
        chunks.push(Buffer.from(chunk));
      }
    } finally {
      stream.destroy();
    }
    result = JSON.parse(Buffer.concat(chunks));
    if (result?.ok === true) {
      if (!exact(result, ["ok", "data"]) || !statuses.has(result.data?.status))
        throw Error("invalid result");
    } else if (
      !exact(result, ["ok", "error"]) ||
      result.ok !== false ||
      !workerErrors.has(result.error)
    )
      throw Error("invalid refusal");
  } catch {
    fail("EXECUTION_BROKEN");
  } finally {
    if (box) {
      let stopped;
      try {
        stopped = await box.stop({ signal: AbortSignal.timeout(10000) });
      } catch {
        fail("CLEANUP_UNCONFIRMED");
      }
      if (stopped?.status !== "stopped") fail("CLEANUP_UNCONFIRMED");
    }
  }
  return { ...result, isolation: { network: "DENIED", lifecycle: "STOPPED" } };
}
