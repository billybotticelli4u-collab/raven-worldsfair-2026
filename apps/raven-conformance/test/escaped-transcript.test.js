import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  checkEscapedTranscriptSizes,
  serializedEvidenceBytes,
  ESCAPED_STDOUT_LIMIT_BYTES,
  ESCAPED_STDERR_LIMIT_BYTES,
  replayReport,
} from "../src/lib/replay.js";
import { runConformance } from "../src/lib/runner.js";

describe("escaped transcript size beside replay", () => {
  it("defines UTF-8 JSON.stringify thresholds", () => {
    assert.equal(ESCAPED_STDOUT_LIMIT_BYTES, 3 * 256 * 1024);
    assert.equal(ESCAPED_STDERR_LIMIT_BYTES, 3 * 64 * 1024);
    const raw = "A".repeat(100);
    const serialized = JSON.stringify(raw);
    assert.equal(serializedEvidenceBytes(raw), Buffer.byteLength(serialized, "utf8"));
    assert.ok(serializedEvidenceBytes(raw) > Buffer.byteLength(raw, "utf8"));
  });

  it("escaping expansion exceeds raw byte length for backslashes/quotes", () => {
    const hostile = "\\".repeat(1000) + '"'.repeat(100);
    const rawLen = Buffer.byteLength(hostile, "utf8");
    const escLen = serializedEvidenceBytes(hostile);
    assert.ok(escLen > rawLen, `escaped ${escLen} should exceed raw ${rawLen}`);
  });

  it("honest CONFORMANT report passes escaped-size check", async () => {
    const report = await runConformance("CONFORMANT_REFERENCE", { write: false });
    const check = checkEscapedTranscriptSizes(report);
    assert.equal(check.ok, true, JSON.stringify(check.diffs));
    assert.equal(check.limits.encoding, "utf8");
    assert.match(check.limits.note, /not attestation/i);
  });

  it("oversized escaped stdout fails beside replay (not digest auth)", async () => {
    const report = await runConformance("CONFORMANT_REFERENCE", { write: false });
    const dir = mkdtempSync(path.join(os.tmpdir(), "raven-esc-"));
    try {
      // Craft pathological escaping: many backslashes inflate JSON.stringify far beyond raw.
      const blowup = "\\".repeat(ESCAPED_STDOUT_LIMIT_BYTES);
      assert.ok(serializedEvidenceBytes(blowup) > ESCAPED_STDOUT_LIMIT_BYTES);
      report.results[0].evidence.stdout = blowup;
      // Keep digests inconsistent intentionally — integrity may also fail; we assert size check API.
      const size = checkEscapedTranscriptSizes(report);
      assert.equal(size.ok, false);
      assert.ok(size.diffs.some((d) => d.error === "escaped_transcript_limit"));

      const file = path.join(dir, "report.json");
      // Reseal digests so integrity passes and size check is the gate.
      const { computeDeterministicDigest } = await import("../src/lib/runner.js");
      const { sha256Hex } = await import("../src/lib/digest.js");
      delete report.binding.deterministic_report_sha256;
      report.deterministic_report_sha256 = computeDeterministicDigest(report);
      report.binding.deterministic_report_sha256 = report.deterministic_report_sha256;
      const { _written_path, report_content_digest_sha256, deterministic_report_sha256, ...body } = report;
      report.report_content_digest_sha256 = sha256Hex(JSON.stringify(body, null, 2) + "\n");
      writeFileSync(file, JSON.stringify(report));
      const replay = await replayReport(file, { write: false });
      assert.equal(replay.ok, false);
      assert.equal(replay.error, "escaped_transcript_limit");
      assert.equal(replay.attestation, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("malformed evidence (non-string transcript) fails closed", () => {
    const check = checkEscapedTranscriptSizes({
      results: [{ vector_id: "V1", evidence: { stdout: null, stderr: "" } }],
    });
    assert.equal(check.ok, false);
    assert.ok(check.diffs.some((d) => d.error === "transcript_not_string"));
  });

  it("missing evidence object fails closed", () => {
    const check = checkEscapedTranscriptSizes({
      results: [{ vector_id: "V1" }],
    });
    assert.equal(check.ok, false);
    assert.ok(check.diffs.some((d) => d.error === "malformed_evidence"));
  });
});
