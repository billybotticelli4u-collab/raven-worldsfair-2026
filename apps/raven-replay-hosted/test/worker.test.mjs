import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { executeRequest } from "../src/worker.mjs";
import { digest } from "../src/envelope.mjs";
const corpus = JSON.parse(
  readFileSync(
    new URL(
      "../../raven-conformance/corpus/raven-solana-txversion-demo-corpus-1.4.json",
      import.meta.url,
    ),
  ),
);
const input = corpus.vectors.find((x) => x.id === "V01_valid_legacy")?.input
  .tx_base64;
const create = () =>
  executeRequest({
    op: "create",
    input_base64: input,
    adapter_id: "solana-kit-tx-decode",
    name: "Synthetic offline example",
    intake: null,
    intake_reference: null,
  });
test("real pinned SDK creates, imports and replays saved bytes without fetching", () => {
  assert.equal(typeof input, "string");
  const a = create();
  assert.equal(a.status, "CREATED");
  assert.equal(
    a.envelope.sdk_case.expected_execution.parsed.decision,
    "ACCEPT",
  );
  assert.equal(
    executeRequest({
      op: "import",
      envelope: a.envelope,
      reference: a.reference,
    }).status,
    "IMPORTED",
  );
  const r = executeRequest({
    op: "replay",
    envelope: JSON.parse(JSON.stringify(a.envelope)),
    reference: a.reference,
  });
  assert.equal(r.status, "MATCH");
  assert.equal(r.report.exit_code, 0);
});
test("wrong reference and changed expectation refuse; intentional rebaseline produces REGRESSION", () => {
  const a = create();
  assert.throws(
    () =>
      executeRequest({
        op: "replay",
        envelope: a.envelope,
        reference: "f".repeat(64),
      }),
    { code: "REFERENCE_MISMATCH" },
  );
  const changed = structuredClone(a.envelope);
  changed.sdk_case.expected_execution.parsed.reason = "edited-expectation";
  assert.throws(
    () =>
      executeRequest({
        op: "replay",
        envelope: changed,
        reference: a.reference,
      }),
    { code: "REFERENCE_MISMATCH" },
  );
  const r = executeRequest({
    op: "replay",
    envelope: changed,
    reference: digest(changed),
  });
  assert.equal(r.status, "REGRESSION");
});
test("registry control adapters and caller-supplied commands never execute", () => {
  for (const id of [
    "control-hang",
    "control-crash",
    "example-parser-v1",
    "../../etc/passwd",
  ])
    assert.throws(
      () =>
        executeRequest({
          op: "create",
          input_base64: input,
          adapter_id: id,
          name: "x",
          intake: null,
          intake_reference: null,
        }),
      { code: "UNKNOWN_ADAPTER" },
    );
  assert.throws(
    () =>
      executeRequest({
        op: "create",
        input_base64: input,
        adapter_id: "solana-kit-tx-decode",
        name: "x",
        intake: null,
        intake_reference: null,
        command: "echo surprise",
      }),
    { code: "INVALID_REQUEST" },
  );
});
test("retrieval support does not silently expand the SDK v1 saved-case contract", () => {
  assert.throws(
    () =>
      executeRequest({
        op: "create",
        input_base64: Buffer.from([0x81, 1, 0, 0]).toString("base64"),
        adapter_id: "solana-kit-tx-decode",
        name: "v1",
        intake: null,
        intake_reference: null,
      }),
    { code: "UNSUPPORTED_DECODER_VERSION" },
  );
});
