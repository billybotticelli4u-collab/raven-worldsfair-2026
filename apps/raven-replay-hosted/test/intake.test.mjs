import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchTransaction,
  validateIntake,
  intakeDigest,
  decodeSignature,
  MAINNET_GENESIS,
} from "../src/intake.mjs";

const signature = "1".repeat(64);
// Synthetic legacy envelope: one zero signature followed by a minimal message.
const wire = Buffer.concat([
  Buffer.from([1]),
  Buffer.alloc(64),
  Buffer.from([1, 0, 0, 1]),
  Buffer.alloc(64),
  Buffer.from([0]),
]);
const result = {
  slot: 123456,
  blockTime: 1700000000,
  version: "legacy",
  transaction: [wire.toString("base64"), "base64"],
  meta: { err: null, logMessages: ["must never be retained"] },
};
function rpc(
  value = result,
  { genesis = MAINNET_GENESIS, status = 200, error, raw } = {},
) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const req = JSON.parse(options.body);
    calls.push({ url: String(url), ...req, redirect: options.redirect });
    return new Response(
      raw ??
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          ...(error
            ? { error }
            : { result: req.method === "getGenesisHash" ? genesis : value }),
        }),
      { status },
    );
  };
  return { calls, fetchImpl };
}
const obtain = (mock, opts = {}) =>
  fetchTransaction(signature, {
    fetchImpl: mock.fetchImpl,
    now: () => new Date("2026-10-01T20:00:00Z"),
    ...opts,
  });
test("uses the full mainnet genesis hash, not its truncated CAIP network identifier", () => {
  assert.equal(MAINNET_GENESIS, "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
});
test("retains exact transaction bytes and bounded provenance, not provider free text", async () => {
  const mock = rpc();
  const record = await obtain(mock);
  assert.equal(record.input_base64, result.transaction[0]);
  assert.equal(record.source.signature, signature);
  assert.equal(record.source.provider, "solana-public-mainnet");
  assert.equal(record.source.slot, 123456);
  assert.equal(record.source.version, "legacy");
  assert.equal(record.source.commitment, "finalized");
  assert.equal(record.source.fetched_at, "2026-10-01T20:00:00.000Z");
  assert.equal(record.source.assurance, "PROVIDER_REPORTED");
  assert.ok(!JSON.stringify(record).includes("must never"));
  assert.equal(validateIntake(record, intakeDigest(record)), record);
  assert.equal(mock.calls[1].params[1].encoding, "base64");
  assert.equal(mock.calls[1].params[1].maxSupportedTransactionVersion, 1);
  assert.equal(mock.calls[1].redirect, "error");
});
test("accepts Helius only as configured provider; never exports its endpoint/key", async () => {
  const mock = rpc();
  const record = await obtain(mock, {
    rpcUrl: "https://mainnet.helius-rpc.com/?api-key=CANARY_NEVER_EXPORT",
  });
  assert.equal(record.source.provider, "helius-mainnet");
  assert.ok(!JSON.stringify(record).includes("CANARY"));
  assert.match(mock.calls[0].url, /CANARY/);
});
test("canonical signature validation refuses URLs, wrong sizes and ambiguous alphabet before network", async () => {
  for (const value of [
    "https://evil.test",
    "0".repeat(88),
    "1".repeat(63),
    "1".repeat(65),
    " " + signature,
    signature + "\n",
    null,
    {},
    "z".repeat(88),
  ]) {
    const mock = rpc();
    await assert.rejects(
      () => fetchTransaction(value, { fetchImpl: mock.fetchImpl }),
      { code: "INVALID_SIGNATURE" },
    );
    assert.equal(mock.calls.length, 0);
  }
  assert.equal(decodeSignature(signature).length, 64);
});
test("disallows caller-supplied arbitrary RPC endpoints", async () => {
  for (const url of [
    "http://127.0.0.1:8000",
    "https://evil.test",
    "https://mainnet.helius-rpc.com.evil.test",
    "https://user:password@mainnet.helius-rpc.com",
    "https://mainnet.helius-rpc.com:444",
  ])
    await assert.rejects(() => obtain(rpc(), { rpcUrl: url }), {
      code: "RPC_CONFIGURATION",
    });
});
test("null result is unavailable, never a decoder rejection or successful case", async () => {
  await assert.rejects(() => obtain(rpc(null)), {
    code: "TRANSACTION_UNAVAILABLE",
  });
});
test("cluster mismatch is refused before fetching a transaction", async () => {
  const mock = rpc(result, { genesis: "wrong-chain" });
  await assert.rejects(() => obtain(mock), { code: "NETWORK_MISMATCH" });
  assert.equal(mock.calls.length, 1);
});
test("RPC and transport errors expose only closed codes and int32 numeric code", async () => {
  for (const code of [-32015, "secret", 1.1, 2 ** 32]) {
    try {
      await obtain(
        rpc(result, { error: { code, message: "CANARY_RPC_SECRET" } }),
      );
      assert.fail();
    } catch (e) {
      assert.ok(!JSON.stringify(e).includes("CANARY"));
      assert.ok(!e.message.includes("CANARY"));
      assert.equal(
        e.code,
        code === -32015 ? "UNSUPPORTED_TRANSACTION_VERSION" : "RPC_ERROR",
      );
      assert.equal(e.rpcCode, code === -32015 ? code : undefined);
    }
  }
  await assert.rejects(
    () =>
      fetchTransaction(signature, {
        fetchImpl: async () => {
          throw new Error("CANARY_TRANSPORT_SECRET");
        },
      }),
    (e) => e.code === "RPC_UNAVAILABLE" && !String(e).includes("CANARY"),
  );
});
test("HTTP failures, malformed JSON, incorrect response ID and oversized response fail closed", async () => {
  await assert.rejects(() => obtain(rpc(result, { status: 429 })), {
    code: "RPC_RATE_LIMITED",
  });
  await assert.rejects(() => obtain(rpc(result, { status: 503 })), {
    code: "RPC_UNAVAILABLE",
  });
  await assert.rejects(() => obtain(rpc(result, { raw: "CANARY_NOT_JSON" })), {
    code: "RPC_INVALID_RESPONSE",
  });
  await assert.rejects(
    () =>
      obtain(
        rpc(result, {
          raw: JSON.stringify({
            jsonrpc: "2.0",
            id: "wrong",
            result: MAINNET_GENESIS,
          }),
        }),
      ),
    { code: "RPC_INVALID_RESPONSE" },
  );
  await assert.rejects(
    () => obtain(rpc(result, { raw: "x".repeat(512 * 1024 + 1) })),
    { code: "RPC_RESPONSE_TOO_LARGE" },
  );
});
test("timeouts cover fetch and a streaming body that never ends", async () => {
  await assert.rejects(
    () =>
      fetchTransaction(signature, {
        fetchImpl: () => new Promise(() => {}),
        timeoutMs: 15,
      }),
    { code: "RPC_TIMEOUT" },
  );
  await assert.rejects(
    () =>
      fetchTransaction(signature, {
        fetchImpl: async () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode("{"));
              },
            }),
          ),
        timeoutMs: 15,
      }),
    { code: "RPC_TIMEOUT" },
  );
});
test("mismatched returned signature and version refused", async () => {
  const changed = Buffer.from(wire);
  changed[1] = 9;
  await assert.rejects(
    () =>
      obtain(
        rpc({ ...result, transaction: [changed.toString("base64"), "base64"] }),
      ),
    { code: "SIGNATURE_MISMATCH" },
  );
  await assert.rejects(() => obtain(rpc({ ...result, version: 0 })), {
    code: "TRANSACTION_VERSION_MISMATCH",
  });
});
test("invalid bytes or metadata cannot produce intake evidence", async () => {
  for (const change of [
    { transaction: { parsed: "not raw" } },
    { transaction: ["AA==", "base58"] },
    { transaction: ["AA==", "base64"] },
    { transaction: ["!!!!", "base64"] },
    { transaction: [Buffer.alloc(16385).toString("base64"), "base64"] },
    { slot: -1 },
    { slot: 2 ** 54 },
    { blockTime: "secret" },
    { version: 2 },
  ])
    await assert.rejects(() => obtain(rpc({ ...result, ...change })));
});
test("v0 and v1 raw bytes retained with version agreement, without claiming SDK support", async () => {
  const v0 = Buffer.from(wire);
  v0[65] = 0x80;
  const a = await obtain(
    rpc({
      ...result,
      version: 0,
      transaction: [v0.toString("base64"), "base64"],
    }),
  );
  assert.equal(a.source.version, 0);
  const v1 = Buffer.concat([
    Buffer.from([0x81, 1, 0, 0]),
    Buffer.alloc(100),
    Buffer.alloc(64),
  ]);
  const b = await obtain(
    rpc({
      ...result,
      version: 1,
      transaction: [v1.toString("base64"), "base64"],
    }),
  );
  assert.equal(b.source.version, 1);
  assert.equal(b.input_base64, v1.toString("base64"));
});
test("retained-reference check rejects edited metadata and edited input", async () => {
  const r = await obtain(rpc());
  const digest = intakeDigest(r);
  for (const change of [
    (x) => x.source.slot++,
    (x) => (x.source.provider = "helius-mainnet"),
    (x) => (x.input_base64 = "AA=="),
    (x) => (x.extra = "hidden"),
  ]) {
    const copy = structuredClone(r);
    change(copy);
    assert.throws(() => validateIntake(copy, digest));
  }
  assert.throws(() => validateIntake(r, "f".repeat(64)), {
    code: "REFERENCE_MISMATCH",
  });
  assert.throws(() => validateIntake(r, ""), { code: "REFERENCE_REQUIRED" });
});
