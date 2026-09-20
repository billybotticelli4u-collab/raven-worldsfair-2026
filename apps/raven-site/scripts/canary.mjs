#!/usr/bin/env node
// Raven daily canary — READ-ONLY monitoring. No deploys, no env changes, no
// engine writes. Verifies the live public surface and (opt-in) live receipts.
//
// Release-identity binding (added 2026-08-02): every run fetches /buildinfo
// BEFORE the probes and AGAIN after them.
//   - Manual post-deploy runs (the workflow sets RAVEN_CANARY_EXPECT_COMMIT
//     from its immutable github.sha; never operator-supplied) require the live
//     commit to equal that SHA exactly.
//   - Every run, scheduled or manual, requires the observed identity — commit
//     AND startedAt — to be unchanged across the run, so a behavioral pass is
//     bound to one stable process. A mid-run restart or redeploy fails the run.
//   Scheduled runs leave RAVEN_CANARY_EXPECT_COMMIT empty: they record the
//   observed identity and remain behavior monitoring, without asserting that
//   current main must already be deployed.
//
// Unkeyed checks (always run, no credentials):
//   1. GET /healthz responds OK
//   2. GET /pubkey contains the expected keyId AND the expected public key
//      material (rotation alarm; same keyId with different material alarms)
//   3. live public test vector passes the full clean-room verification
//      (signature recipe, wire schema, unsigned sibling boundary)
//
// Keyed checks (ONLY if RAVEN_API_KEY is set in the environment):
//   For each baseline mint in canary-config.json:
//   4. POST /verify returns 200 + ok:true
//   5. receipt (body minus top-level `unsigned`) validates against the
//      published wire schema; `unsigned` exists only as a top-level sibling
//   6. ed25519 signature verifies via the published preimage recipe against
//      the live /pubkey key set
//   7. verdict matches baseline (drift alarm)
//   8. triggeringFindingCodes match baseline exactly
//   9. Stage-2: known husks still carry liquidity.supply_majority_returned_to_pool
//  10. Stage-3 invariant: no launch.* code EVER appears in triggeringFindingCodes
//  11. no finding codes outside the committed baseline (unexpected-code alarm)
//
// Full-evidence readiness + fail-closed probes (keyed; added 2026-07-12) — these
// prove Raven can COMPLETE evidence and REFUSE correctly, the class of failure a
// liveness-only /healthz check misses (e.g. the 2026-07 rotted-RPC-credential
// incident, where control mints silently went unknowable while /healthz stayed
// green):
//   A. GET /readyz reports rpc ok (RPC credential/health signal)
//   B. fail-closed: a fresh nonexistent mint -> /verify unknowable and
//      /receipt/v1 unsigned 422 with the exact {error,ok,reason} body and NO
//      signed-artifact field leaking into the refusal
//   C. full-evidence: a control mint issues a signed receipt-v1 within budget,
//      with a real slot, no rpc_evidence_timeout gap, expectedRulesVersion, the
//      continuity signer key, and a receipt-v1 signature that verifies clean-room
//   Tunable: CANARY_FULL_EVIDENCE_BUDGET_MS (default 6000, safely under the 7s
//   evidence budget). The deployed profile remains raven-rules@1.1.3. Candidate
//   1.1.4 selection is an explicit, authorization-gated profile; neither profile
//   is inferred from receipt content.
//
// Local run (Glen):  RAVEN_API_KEY=<key> node apps/raven-site/scripts/canary.mjs
// Unkeyed-only run:  node apps/raven-site/scripts/canary.mjs
// Authorized candidate validation (the committed candidate packet is pending
// until a separately reviewed release packet supplies every exact value):
//   RAVEN_CANARY_PROFILE=candidate-1.1.4 \
//   RAVEN_CANARY_CANDIDATE_AUTHORIZED=true \
//   RAVEN_CANARY_OWNER_APPROVAL_MARKER=<approved-owner-marker> \
//   RAVEN_CANARY_ENVIRONMENT=<approved-isolated-environment> \
//   RAVEN_CANARY_ARTIFACT_COMMIT=<approved-candidate-commit> \
//   RAVEN_CANARY_VECTOR_SET_SHA256=<approved-vector-set-sha256> \
//   RAVEN_API_BASE=<approved-canonical-candidate-api-origin> \
//   RAVEN_SITE_BASE=<approved-canonical-candidate-site-origin> \
//   RAVEN_API_KEY=<candidate-key> node apps/raven-site/scripts/canary.mjs
// Production mode:   CANARY_REQUIRE_KEYED=true — the canary FAILS if
//                    RAVEN_API_KEY is absent, so a green run always means the
//                    keyed receipt invariants were actually tested. Unkeyed
//                    skipping is for local/manual runs only.
// Post-deploy gate:  RAVEN_CANARY_EXPECT_COMMIT=<exact 40-hex commit> — the
//                    canary FAILS unless live /buildinfo reports exactly that
//                    commit. Set by the workflow from its immutable github.sha
//                    on manual dispatch; empty on scheduled runs.
// The key is read from the environment and NEVER printed or logged.
import { createHash, createPublicKey, verify as edVerify, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import {
  assertCandidateBuildInfo,
  assertCandidateVectorSet,
  selectCanaryProfile,
} from "./canary-profile.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, "canary-config.json"), "utf8"));
let profile;
try {
  profile = selectCanaryProfile(cfg, process.env);
} catch (error) {
  console.error(`CANARY CONFIG ERROR - ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const API = profile.apiBase;
const SITE = profile.siteBase;
const KEY = process.env.RAVEN_API_KEY || "";
const REQUIRE_KEYED = process.env.CANARY_REQUIRE_KEYED === "true" || profile.requireKeyed;
const EXPECTED_RULES_VERSION = profile.expectedRulesVersion;
const EXPECTED_KEY_ID = profile.expectedSigner.keyId;
const EXPECTED_PUBLIC_KEY_BASE64 = profile.expectedSigner.publicKeyBase64;
const noRedirect = Object.freeze({ redirect: "error" });

// ---- release identity (see header) ----
const EXPECT_COMMIT = process.env.RAVEN_CANARY_EXPECT_COMMIT || "";
const BUILD_COMMIT = /^[0-9a-f]{40}$/;
const fetchBuildIdentity = async () => {
  const res = await fetch(`${API}/buildinfo`, noRedirect);
  if (!res.ok) throw new Error(`/buildinfo status ${res.status}`);
  const body = await res.json();
  if (body === null || typeof body !== "object" || Array.isArray(body))
    throw new Error("/buildinfo body is not an object");
  if (!BUILD_COMMIT.test(body.commit ?? ""))
    throw new Error(`/buildinfo commit missing or malformed: ${JSON.stringify(body.commit ?? null)}`);
  if (typeof body.startedAt !== "string" || body.startedAt.length === 0)
    throw new Error("/buildinfo startedAt missing or malformed");
  return { commit: body.commit, startedAt: body.startedAt };
};

// A candidate cannot reach even an unkeyed endpoint until the local reviewed
// vector set and the target's public build identity match the complete packet.
// `redirect: "error"` is intentional: a target redirect must never forward an
// API key or turn a canonical approved origin into an implicit second target.
if (profile.candidateAuthorization) {
  try {
    const vectorPath = join(here, "canary-1.1.4-vector-set.json");
    const vectorBytes = readFileSync(vectorPath);
    const vectorSet = JSON.parse(vectorBytes.toString("utf8"));
    const vectorSetSha256 = `sha256:${createHash("sha256").update(vectorBytes).digest("hex")}`;
    assertCandidateVectorSet(profile, vectorSet, vectorSetSha256);

    const buildInfoResponse = await fetch(`${API}/buildinfo`, noRedirect);
    if (!buildInfoResponse.ok) throw new Error(`/buildinfo status ${buildInfoResponse.status}`);
    assertCandidateBuildInfo(profile, await buildInfoResponse.json());
    console.log("CANDIDATE PRE-FLIGHT - approved vector set and build identity matched");
  } catch (error) {
    console.error(`CANARY CANDIDATE PRE-FLIGHT ERROR - ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

let fail = 0;
const check = (name, ok, detail = "") => {
  console.log((ok ? "PASS" : "FAIL") + " - " + name + (ok || !detail ? "" : " -> " + detail));
  if (!ok) fail++;
};
const sameSet = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`CANARY PROFILE - ${profile.name} (${EXPECTED_RULES_VERSION})`);

// ---- release identity: pre-probe read ----
let preIdentity = null;
try {
  preIdentity = await fetchBuildIdentity();
  check("pre-probe /buildinfo identity is well-formed", true);
} catch (e) {
  check("pre-probe /buildinfo identity is well-formed", false, e.message);
}
if (preIdentity) {
  if (EXPECT_COMMIT) {
    // Manual post-deploy gate: the live commit must equal the workflow's
    // immutable github.sha exactly.
    check("deployed commit matches the workflow commit (github.sha)",
      preIdentity.commit === EXPECT_COMMIT,
      `expected ${EXPECT_COMMIT}, got ${preIdentity.commit}`);
  }
  console.log(`CANARY OBSERVED IDENTITY - commit ${preIdentity.commit} startedAt ${preIdentity.startedAt}` +
    (EXPECT_COMMIT ? " (manual post-deploy gate)" : " (behavior monitoring; no main/prod equality asserted)"));
}

// ---- unkeyed ----
try {
  const h = await fetch(`${API}/healthz`, noRedirect);
  check("healthz responds OK", h.ok, `status ${h.status}`);
} catch (e) { check("healthz responds OK", false, e.message); }

let keys = [];
try {
  const p = await (await fetch(`${API}/pubkey`, noRedirect)).json();
  keys = p.keys ?? [];
  const expected = keys.find((k) => k.keyId === EXPECTED_KEY_ID);
  check("pubkey contains expected keyId", Boolean(expected),
    `expected ${EXPECTED_KEY_ID}, got [${keys.map((k) => k.keyId).join(",")}]`);
  // Same keyId with different key material must alarm — keyId alone is a
  // label, the material is the identity.
  check("pubkey material matches expected publicKeyBase64",
    expected?.publicKeyBase64 === EXPECTED_PUBLIC_KEY_BASE64,
    expected ? "keyId matches but public key material DIFFERS from committed baseline" : "expected keyId absent");
} catch (e) {
  check("pubkey contains expected keyId", false, e.message);
  check("pubkey material matches expected publicKeyBase64", false, e.message);
}

{
  const r = spawnSync(process.execPath, [join(here, "verify-test-vector.mjs"), `${SITE}/receipt-test-vector.json`], { encoding: "utf8" });
  check("live test vector passes clean-room verification", r.status === 0,
    (r.stdout || "").split("\n").filter((l) => l.startsWith("FAIL")).join("; ") || r.stderr?.slice(0, 200));
}

// ---- keyed ----
if (!KEY) {
  if (REQUIRE_KEYED) {
    // Production daily canary: green must mean the receipt invariants were
    // actually tested, not just healthz/pubkey/vector.
    check("RAVEN_API_KEY present (CANARY_REQUIRE_KEYED=true)", false,
      "keyed receipt checks are mandatory in production mode and the key is missing");
  } else {
    console.log("\nSKIP - keyed receipt checks (RAVEN_API_KEY not set; unkeyed checks only)");
  }
} else {
  const schema = JSON.parse(readFileSync(join(here, "..", "receipt-wire-schema.json"), "utf8"));
  const typeOk = (val, t) => {
    const ts = Array.isArray(t) ? t : [t];
    return ts.some((x) =>
      x === "null" ? val === null :
      x === "array" ? Array.isArray(val) :
      x === "integer" ? Number.isInteger(val) :
      x === "object" ? (typeof val === "object" && val !== null && !Array.isArray(val)) :
      typeof val === x);
  };
  const wireProblems = (r) => {
    const out = [];
    for (const f of schema.required ?? []) if (!(f in r)) out.push(`missing ${f}`);
    for (const [k, p] of Object.entries(schema.properties ?? {})) {
      if (p === false) { if (k in r) out.push(`forbidden ${k}`); continue; }
      if (!(k in r)) continue;
      if (p.type && !typeOk(r[k], p.type)) out.push(`${k}: type`);
      if (p.enum && !p.enum.includes(r[k])) out.push(`${k}: enum`);
      if ("const" in p && r[k] !== p.const) out.push(`${k}: const`);
      if (p.pattern && typeof r[k] === "string" && !new RegExp(p.pattern).test(r[k])) out.push(`${k}: pattern`);
    }
    return out;
  };
  const canonical = (obj) =>
    "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + JSON.stringify(obj[k])).join(",") + "}";

  for (const m of cfg.mints) {
    const tag = `[${m.name}]`;
    let body;
    try {
      // /verify is per-key rate-limited (burst 4, refills ~1 token/6s). The
      // canary issues one call per baseline mint back-to-back, so the last
      // mints can drain the bucket and 429. Retry 429s with backoff (honoring
      // retry_after_seconds when the server sends it) instead of failing —
      // this is throttling, not a receipt-invariant violation.
      let res;
      for (let attempt = 0; ; attempt++) {
        res = await fetch(`${API}/verify`, {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json", "x-api-key": KEY },
          body: JSON.stringify({ mintAddress: m.mintAddress, tokenProgramAddress: m.tokenProgramAddress }),
        });
        if (res.status !== 429 || attempt >= 5) break;
        let waitMs = 7000;
        try {
          const ra = Number((await res.clone().json())?.retry_after_seconds);
          if (Number.isFinite(ra) && ra > 0) waitMs = Math.ceil(ra * 1000);
        } catch { /* 429 body not JSON; fall back to fixed backoff */ }
        await sleep(waitMs);
      }
      check(`${tag} /verify 200`, res.ok, `status ${res.status}`);
      if (!res.ok) continue;
      body = await res.json();
    } catch (e) { check(`${tag} /verify 200`, false, e.message); continue; }

    check(`${tag} ok:true`, body.ok === true);
    const { unsigned, ...receipt } = body;
    check(`${tag} unsigned is top-level sibling only`, typeof unsigned === "object" && unsigned !== null && !("unsigned" in receipt));
    const probs = wireProblems(receipt);
    check(`${tag} receipt validates against wire schema`, probs.length === 0, probs.join("; "));

    const pub = keys.find((k) => k.keyId === receipt.keyId);
    if (!pub) { check(`${tag} signature verifies`, false, `keyId ${receipt.keyId} not in /pubkey`); }
    else {
      const preimage = canonical({
        domain: "raven-official-attestation",
        issuedAt: receipt.issuedAt,
        keyId: receipt.keyId,
        officialAttestationHash: receipt.officialAttestationHash,
        version: "v2",
      });
      const k = createPublicKey({ key: Buffer.from(pub.publicKeyBase64, "base64"), format: "der", type: "spki" });
      check(`${tag} signature verifies`, edVerify(null, Buffer.from(preimage, "utf8"), k, Buffer.from(receipt.signature, "base64")));
    }

    check(`${tag} verdict matches baseline`, receipt.verdict === m.expectVerdict,
      `expected ${m.expectVerdict}, got ${receipt.verdict}`);
    check(`${tag} triggering codes match baseline`, sameSet(receipt.triggeringFindingCodes ?? [], m.expectTriggering),
      `got [${(receipt.triggeringFindingCodes ?? []).join(",")}]`);
    for (const rc of m.requireFindingCodes)
      check(`${tag} carries ${rc}`, (receipt.findingCodes ?? []).includes(rc));
    check(`${tag} launch.* never in triggering (informational-only invariant)`,
      !(receipt.triggeringFindingCodes ?? []).some((c) => c.startsWith("launch.")));
    const unexpected = (receipt.findingCodes ?? []).filter((c) => !m.baselineFindingCodes.includes(c));
    check(`${tag} no unexpected finding codes`, unexpected.length === 0, `new: [${unexpected.join(",")}]`);
  }

  // ── FULL-EVIDENCE READINESS + FAIL-CLOSED PROBES (added 2026-07-12) ──
  // These prove Raven can actually COMPLETE evidence end-to-end and REFUSE
  // correctly — not merely that /healthz answers. They are the checks that would
  // have caught the 2026-07 credential-rot incident (a dead RPC silently turns
  // control mints unknowable) and any fail-closed regression. Still READ-ONLY,
  // still clean-room (never imports Raven's own verifier lib), key never logged.
  const FULL_EVIDENCE_BUDGET_MS = Number(process.env.CANARY_FULL_EVIDENCE_BUDGET_MS || 6000);
  const retryPost = async (path, payload) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API}${path}`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", "x-api-key": KEY },
        body: JSON.stringify(payload),
      });
      if ((res.status !== 429 && res.status < 500) || attempt >= 5) return res;
      let waitMs = 7000;
      try {
        const ra = Number((await res.clone().json())?.retry_after_seconds);
        if (Number.isFinite(ra) && ra > 0) waitMs = Math.ceil(ra * 1000);
      } catch { /* non-JSON 429/5xx body; fixed backoff */ }
      await sleep(waitMs);
    }
  };
  const TOKENKEG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

  // (A) /readyz reports ready AND rpc healthy — the RPC-credential health signal
  // that would have fired during the 2-week rotted-credential window.
  try {
    const rz = await (await fetch(`${API}/readyz`, noRedirect)).json();
    check("readyz reports rpc ok (RPC credential health)",
      rz.status === "ok" && rz.rpc === "ok", `readyz=${JSON.stringify(rz)}`);
  } catch (e) { check("readyz reports rpc ok (RPC credential health)", false, e.message); }

  // (B) FAIL-CLOSED: a freshly generated, syntactically-valid, NONEXISTENT mint
  // must be unknowable on /verify and an unsigned 422 on /receipt/v1, with NO
  // signed-artifact field leaking into the refusal body. Fresh each run so a
  // cached/whitelisted answer cannot mask a regression.
  const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const freshMint = (() => {
    let bytes = [...randomBytes(32)], out = "";
    while (bytes.length) {
      let rem = 0; const q = [];
      for (const x of bytes) { const v = rem * 256 + x; q.push(Math.floor(v / 58)); rem = v % 58; }
      out = B58[rem] + out; bytes = q;
      while (bytes.length && bytes[0] === 0) bytes.shift();
    }
    return out || "1";
  })();
  try {
    const v = await (await retryPost("/verify", { mintAddress: freshMint, tokenProgramAddress: TOKENKEG })).json();
    check("fail-closed: nonexistent mint -> /verify unknowable",
      v.verdict === "unknowable" && v.replayable === false, `verdict=${v.verdict} replayable=${v.replayable}`);
    const rc = await retryPost("/receipt/v1", { mintAddress: freshMint, tokenProgramAddress: TOKENKEG });
    const rb = await rc.json();
    check("fail-closed: nonexistent mint -> /receipt/v1 422", rc.status === 422, `status ${rc.status}`);
    check("fail-closed: refusal body is exactly {error,ok,reason}",
      JSON.stringify(Object.keys(rb).sort()) === JSON.stringify(["error", "ok", "reason"]),
      `keys=${JSON.stringify(Object.keys(rb))}`);
    const forbidden = ["signature", "signerPublicKey", "receiptId", "payloadHash", "findings", "slot", "receipt"];
    const leaked = forbidden.filter((f) => f in rb);
    check("fail-closed: no signed-artifact field in refusal", leaked.length === 0, `leaked: [${leaked.join(",")}]`);
  } catch (e) {
    check("fail-closed: nonexistent mint -> /verify unknowable", false, e.message);
    check("fail-closed: nonexistent mint -> /receipt/v1 422", false, e.message);
  }

  // (C) FULL-EVIDENCE READINESS: a stable control mint must ISSUE a signed
  // receipt-v1, within budget, with a real slot, no rpc-timeout gap, the
  // expected rulesVersion, and a receipt-v1 signature that verifies clean-room
  // against the published continuity key. A dead/slow/lying RPC breaks one of
  // these — the exact incident signature.
  const control = cfg.mints.find((m) => m.name === "control-usdc") ?? cfg.mints.find((m) => m.kind === "control");
  if (control) {
    try {
      const t0 = Date.now();
      const rc = await retryPost("/receipt/v1", { mintAddress: control.mintAddress, tokenProgramAddress: control.tokenProgramAddress });
      const ms = Date.now() - t0;
      check("full-evidence: control mint /receipt/v1 issues 200", rc.status === 200, `status ${rc.status}`);
      if (rc.status === 200) {
        const rec = await rc.json();
        check("full-evidence: real observed slot", Number.isInteger(rec.slot) && rec.slot > 0, `slot=${rec.slot}`);
        check("full-evidence: no rpc_evidence_timeout in signed gaps",
          !(rec.coverageGaps ?? []).includes("rpc_evidence_timeout"));
        check("full-evidence: rulesVersion matches expected",
          rec.rulesVersion === EXPECTED_RULES_VERSION, `expected ${EXPECTED_RULES_VERSION}, got ${rec.rulesVersion}`);
        check("full-evidence: completes within budget", ms <= FULL_EVIDENCE_BUDGET_MS, `${ms}ms > ${FULL_EVIDENCE_BUDGET_MS}ms`);
        check("full-evidence: signer matches published continuity key",
          rec.signerPublicKey === EXPECTED_PUBLIC_KEY_BASE64, "signer material differs from selected profile expectation");
        check("full-evidence: receiptId derives from payloadHash",
          rec.receiptId === "raven-receipt-v1:" + rec.payloadHash);
        // Clean-room receipt-v1 signature verification, independent of Raven's
        // own verifier lib: signedBytes = canonical({domain,payloadHash,version}).
        const signedBytes = canonical({ domain: "raven-receipt", payloadHash: rec.payloadHash, version: "v1" });
        let v1ok = false;
        try {
          const k = createPublicKey({ key: Buffer.from(rec.signerPublicKey, "base64"), format: "der", type: "spki" });
          v1ok = edVerify(null, Buffer.from(signedBytes, "utf8"), k, Buffer.from(rec.signature, "base64"));
        } catch { /* v1ok stays false */ }
        check("full-evidence: receipt-v1 signature verifies clean-room", v1ok);
      }
    } catch (e) { check("full-evidence: control mint /receipt/v1 issues 200", false, e.message); }
  }
}

// ---- release identity: post-probe read ----
// The behavioral result above is only meaningful if it came from ONE stable
// process. A mid-run restart or redeploy changes startedAt (and usually
// commit); either invalidates the run. Applies to every run, scheduled or
// manual.
if (preIdentity) {
  try {
    const postIdentity = await fetchBuildIdentity();
    check("post-probe /buildinfo identity unchanged (same commit and startedAt)",
      postIdentity.commit === preIdentity.commit && postIdentity.startedAt === preIdentity.startedAt,
      `pre ${preIdentity.commit} @ ${preIdentity.startedAt}, post ${postIdentity.commit} @ ${postIdentity.startedAt}`);
  } catch (e) {
    check("post-probe /buildinfo identity unchanged (same commit and startedAt)", false, e.message);
  }
}

console.log(fail === 0 ? "\nCANARY OK" : `\nCANARY: ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
