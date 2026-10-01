import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/api.mjs";
const origin = "http://127.0.0.1:8797";
const req = (path, body, headers = {}) =>
  new Request(origin + path, {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
function setup(overrides = {}) {
  const seen = [];
  return {
    seen,
    handler: createApi({
      origin,
      acquirePermit: async () => true,
      fetchTransactionFn: async (signature) => {
        seen.push(["fetch", signature]);
        return { test: "retained" };
      },
      runIsolatedFn: async (body) => {
        seen.push(["run", body]);
        return { ok: true, data: { status: "MATCH" } };
      },
      ...overrides,
    }),
  };
}
test("intake is explicit POST and accepts only a signature, no URLs or RPC methods", async () => {
  const { handler, seen } = setup();
  const r = await handler(
    req("/api/transaction", { signature: "1".repeat(64) }),
  );
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
  assert.equal(seen.length, 1);
  for (const body of [
    { signature: "1".repeat(64), url: "http://localhost" },
    [],
    { method: "getBalance" },
    null,
  ])
    assert.equal((await handler(req("/api/transaction", body))).status, 400);
  assert.equal(seen.length, 1);
  assert.equal(
    (await handler(new Request(origin + "/api/transaction"))).status,
    405,
  );
});
test("cross-origin, absent origin and unsupported content type cannot spend a job", async () => {
  const { handler, seen } = setup();
  assert.equal(
    (await handler(req("/api/run", {}, { origin: "https://evil.example" })))
      .status,
    403,
  );
  const none = req("/api/run", {});
  none.headers.delete("origin");
  assert.equal((await handler(none)).status, 403);
  assert.equal(
    (await handler(req("/api/run", {}, { "content-type": "text/plain" })))
      .status,
    415,
  );
  assert.equal(seen.length, 0);
});
test("budget refusal is before RPC or execution; absent budget control fails closed", async () => {
  const a = setup({ acquirePermit: async () => false });
  assert.equal(
    (await a.handler(req("/api/transaction", { signature: "1".repeat(64) })))
      .status,
    429,
  );
  assert.equal(a.seen.length, 0);
  const handler = createApi({ origin });
  assert.equal(
    (await handler(req("/api/transaction", { signature: "1".repeat(64) })))
      .status,
    503,
  );
});
test("oversize, malformed and extra fields refuse before execution", async () => {
  const { handler, seen } = setup();
  assert.equal(
    (await handler(req("/api/run", { input: "x".repeat(330000) }))).status,
    413,
  );
  const malformed = new Request(origin + "/api/run", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: "{",
  });
  assert.equal((await handler(malformed)).status, 400);
  const body = {
    op: "create",
    input_base64: "AA==",
    adapter_id: "control-crash",
    name: "x",
    intake: null,
    intake_reference: null,
  };
  assert.equal((await handler(req("/api/run", body))).status, 400);
  assert.equal(seen.length, 0);
});
test("replay never calls the RPC and returns no cached previous success", async () => {
  let fail = false;
  const { handler, seen } = setup({
    runIsolatedFn: async () => {
      if (fail)
        throw Object.assign(Error("secret url"), { code: "EXECUTION_BROKEN" });
      return { ok: true, data: { status: "CREATED" } };
    },
  });
  const body = {
    op: "create",
    input_base64: "AA==",
    adapter_id: "solana-kit-tx-decode",
    name: "x",
    intake: null,
    intake_reference: null,
  };
  const good = await handler(req("/api/run", body));
  assert.equal(good.status, 200);
  assert.equal(good.headers.get("cache-control"), "no-store");
  fail = true;
  const bad = await handler(req("/api/run", body));
  assert.equal(bad.status, 502);
  assert.deepEqual(await bad.json(), { ok: false, error: "EXECUTION_BROKEN" });
  assert.equal(seen.length, 0);
});
test("unrecognized errors and malformed RPC integer never leak text", async () => {
  for (const error of [
    Error("credential canary"),
    Object.assign(Error("credential canary"), {
      code: "invented credential canary",
      rpcCode: 3.1,
    }),
  ]) {
    const { handler } = setup({
      fetchTransactionFn: async () => {
        throw error;
      },
    });
    const r = await handler(
      req("/api/transaction", { signature: "1".repeat(64) }),
    );
    assert.equal(r.status, 502);
    assert.deepEqual(await r.json(), {
      ok: false,
      error: "SERVICE_UNAVAILABLE",
    });
  }
});
