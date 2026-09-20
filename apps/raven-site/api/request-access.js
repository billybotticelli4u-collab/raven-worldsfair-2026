// Deterministic Raven access intake (SJ1 PR B).
// Vercel zero-config Node function (CommonJS: this project has no package.json,
// so .js functions are CJS). No secrets in this file: the private operator
// destination is RAVEN_INTAKE_WEBHOOK_URL, set in the deployment environment.
//
// Contract:
//   POST /api/request-access  {name,email,project,usecase,...} ->
//     200 {ok:true, caseId:"RA-xxxxxxxxxx"}   after private delivery
//     400 {ok:false,error}                    invalid/missing fields
//     422 {ok:false,error:"sensitive_content"} secret-looking material refused
//     503 {ok:false,error:"intake_not_configured"}  destination not configured
//     502 {ok:false,error:"delivery_failed"}  destination rejected/unreachable
//   anything else -> 405
// Fail-closed: a case id is returned only after the destination accepted the
// submission. The case id is a deterministic hash of the submission content,
// so a resubmission of identical content yields the same reference.
"use strict";

const { createHash } = require("node:crypto");

const REQUIRED = ["name", "email", "project", "usecase"];
const OPTIONAL = ["token", "role", "decision", "evother", "storage", "path", "volume"];
const MAX_FIELD = 2000;
const MAX_EVIDENCE_ITEMS = 8;
const MAX_EVIDENCE_LEN = 80;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Mirrors the site change-review secret gate: never accept secret-shaped input.
// High-precision secret shapes only (reviewer-accepted precision contract):
// PEM blocks, Raven's own key material, labelled key/secret assignments
// (delimiter may be a newline), and common token prefixes. Deliberately NOT
// matched: bare unlabelled high-entropy strings — a bare 64-hex string may be
// a payload hash, an 88-char base58 string is a transaction signature, and a
// bare 32-byte base58 key is indistinguishable from a mint address. A missed
// secret lands only in the private operator destination (same as the old
// mailto path); a false refusal blocks exactly the stranger this form serves.
// The proactive form copy is the defense for the unlabelled class.
// Seed phrases ARE decidable: 12+ consecutive words all drawn from the fixed
// BIP39 list is not a prose shape (measured 0 false positives across the
// site's 59 prose-bearing files and adversarial legitimate samples).
const SECRET_PATTERNS = [
  /BEGIN [A-Z ]*PRIVATE KEY/i,
  /rvk_(alpha|beta)_[a-z0-9]/i,
  /\b(x-api-key|api[_-]?key|secret|seed phrase|password)\s*[:=\n]\s*\S{6,}/i,
  /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/,
  /\b(ghp|gho|ghs)_[A-Za-z0-9]{10,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
];

const BIP39_WORDS = require("./bip39-english.js");
// 11, not 12: an 11-of-12 fragment is still a full compromise (the missing
// word is checksum-constrained and trivially brute-forced). Measured corpus
// cost of threshold 11 is zero false positives; the prose cliff is at 7.
const BIP39_MIN_RUN = 11;

function containsSeedPhrase(text) {
  const tokens = text.toLowerCase().match(/[a-z]+/g) || [];
  let run = 0;
  for (const tok of tokens) {
    run = BIP39_WORDS.has(tok) ? run + 1 : 0;
    if (run >= BIP39_MIN_RUN) return true;
  }
  return false;
}

function validateSubmission(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const fields = {};
  for (const k of [...REQUIRED, ...OPTIONAL]) {
    let v = body[k];
    if (v === undefined || v === null) v = "";
    if (typeof v !== "string") return { ok: false, error: "invalid_field:" + k };
    v = v.trim();
    if (v.length > MAX_FIELD) return { ok: false, error: "field_too_long:" + k };
    fields[k] = v;
  }
  let evidence = [];
  if (body.evidence !== undefined) {
    if (!Array.isArray(body.evidence) || body.evidence.length > MAX_EVIDENCE_ITEMS ||
        body.evidence.some((x) => typeof x !== "string" || x.length > MAX_EVIDENCE_LEN)) {
      return { ok: false, error: "invalid_field:evidence" };
    }
    evidence = body.evidence.map((x) => x.trim()).filter(Boolean);
  }
  fields.evidence = evidence;
  fields.beta = body.beta === true;
  for (const k of REQUIRED) if (!fields[k]) return { ok: false, error: "missing_field:" + k };
  if (!EMAIL_RE.test(fields.email)) return { ok: false, error: "invalid_email" };
  for (const [k, v] of Object.entries(fields)) {
    const text = Array.isArray(v) ? v.join(" ") : String(v);
    for (const re of SECRET_PATTERNS) {
      if (re.test(text)) return { ok: false, error: "sensitive_content", field: k };
    }
    if (containsSeedPhrase(text)) return { ok: false, error: "sensitive_content", field: k };
  }
  return { ok: true, fields };
}

// Canonical JSON (sorted keys) so identical submissions hash identically.
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function caseIdFor(fields) {
  return "RA-" + createHash("sha256").update(canonical(fields), "utf8").digest("hex").slice(0, 10);
}

async function handleSubmission(req, res, deps = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetch || fetch;
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "method_not_allowed" });
  const v = validateSubmission(req.body);
  if (!v.ok) {
    const code = v.error === "sensitive_content" ? 422 : 400;
    return res.status(code).json({ ok: false, error: v.error });
  }
  const url = env.RAVEN_INTAKE_WEBHOOK_URL;
  if (!url) return res.status(503).json({ ok: false, error: "intake_not_configured" });
  const caseId = caseIdFor(v.fields);
  try {
    const resp = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caseId, submittedAt: new Date().toISOString(), fields: v.fields }),
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok !== true) return res.status(502).json({ ok: false, error: "delivery_failed" });
  } catch {
    return res.status(502).json({ ok: false, error: "delivery_failed" });
  }
  return res.status(200).json({ ok: true, caseId });
}

async function handler(req, res) {
  return handleSubmission(req, res);
}

module.exports = handler;
module.exports.default = handler;
module.exports.handleSubmission = handleSubmission;
module.exports.validateSubmission = validateSubmission;
module.exports.caseIdFor = caseIdFor;
