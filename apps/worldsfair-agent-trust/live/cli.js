/**
 * `npm run demo:live-solana` — CLI wrapper around fetchAndVerifyLiveReceipt.
 * Reads RAVEN_API_KEY (and optional RAVEN_API_BASE / RAVEN_LIVE_REPORT_DIR)
 * from the environment only. Every line written is redacted against the key.
 *
 * Exit codes: 0 PROCEED (and the local tamper was REFUSED)
 *             2 setup refused before any call (key unset, bad flag, bad base)
 *             3 live receipt obtained but REFUSED by verification / policy
 *             4 no receipt (HTTP error, timeout, network, call cap)
 *             5 self-check failed (tampered copy was not refused) or internal error
 */
import path from "node:path";
import { parseArgs } from "node:util";

import {
  DEFAULT_API_BASE,
  DEFAULT_REPORT_DIR,
  DEFAULT_SUBJECT,
  FRESHNESS_MAX_AGE_SECONDS,
  MAX_HTTP_CALLS_PER_RUN,
  RECEIPT_PATH,
  fetchAndVerifyLiveReceipt,
  pinnedSigner,
  redact,
  secretsFor,
  writeRunReport,
} from "./liveSolana.js";

const USAGE = `Usage: RAVEN_API_KEY=... npm run demo:live-solana [-- --mint <address>] [--token-program <address>] [--timeout-ms <ms>]

  Fetches ONE fresh Raven receipt-v1 for the mint (default: BONK, the fixture mint),
  verifies it offline against the pinned Raven key, and runs Agent A's policy.
  Environment: RAVEN_API_KEY (required), RAVEN_API_BASE (optional, default ${DEFAULT_API_BASE}),
               RAVEN_LIVE_REPORT_DIR (optional, default apps/worldsfair-agent-trust/live/runs/).`;

const CHECK_LABELS = [
  ["signatureByPinnedKey", "signature"],
  ["pinnedSigner", "pinned key"],
  ["payloadHash", "payload hash"],
  ["rulesSupportedValid", "rules"],
  ["mintMatchesRequest", "mint matches request"],
  ["tokenProgramMatchesRequest", "token program matches"],
  ["withinAgeBound", "fresh"],
  ["notInFuture", "not future-dated"],
];

function rome(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString("en-GB", { timeZone: "Europe/Rome", hour12: false }) + " Rome";
}

function relative(file) {
  const rel = path.relative(process.cwd(), file);
  return rel.startsWith("..") ? file : rel;
}

/**
 * @param {{argv?: string[], env?: Record<string,string|undefined>, stdout?: {write(s:string):unknown},
 *          stderr?: {write(s:string):unknown}, clock?: () => Date, fetchImpl?: typeof fetch}} io
 * @returns {Promise<number>} exit code
 */
export async function runLiveSolanaCli(io = {}) {
  const env = io.env ?? {};
  const rawKey = typeof env.RAVEN_API_KEY === "string" ? env.RAVEN_API_KEY : undefined;
  const secrets = secretsFor(rawKey);
  const out = (line = "") => io.stdout?.write(redact(line, secrets) + "\n");
  const err = (line = "") => io.stderr?.write(redact(line, secrets) + "\n");

  let values;
  try {
    ({ values } = parseArgs({
      args: io.argv ?? [],
      options: {
        mint: { type: "string" },
        "token-program": { type: "string" },
        "timeout-ms": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    // Never echo the offending argument: it could be a pasted key.
    err("Unrecognised arguments (not shown). Only --mint, --token-program, --timeout-ms and --help are accepted.");
    err(USAGE);
    return 2;
  }
  if (values.help) {
    out(USAGE);
    return 0;
  }

  if (rawKey === undefined || rawKey.trim() === "") {
    err("REFUSED before any network call: RAVEN_API_KEY is not set.");
    err("Set it in this terminal first, e.g.:  read -rs RAVEN_API_KEY && export RAVEN_API_KEY");
    err("then run:  npm run demo:live-solana");
    return 2;
  }

  const apiBaseOverride = typeof env.RAVEN_API_BASE === "string" && env.RAVEN_API_BASE !== "";
  const mint = values.mint ?? DEFAULT_SUBJECT.mintAddress;
  const tokenProgram = values["token-program"] ?? DEFAULT_SUBJECT.tokenProgramAddress;

  let pin;
  try {
    pin = pinnedSigner();
  } catch (e) {
    err(`REFUSED: ${e.message}`);
    return 5;
  }

  let result;
  try {
    result = await fetchAndVerifyLiveReceipt({
      apiBase: env.RAVEN_API_BASE,
      apiKey: rawKey,
      mint,
      tokenProgram,
      timeoutMs: values["timeout-ms"],
      clock: io.clock,
      fetchImpl: io.fetchImpl,
    });
  } catch {
    err("Internal error; no decision was made (details withheld so no secret can leak).");
    return 5;
  }

  if (result.error?.kind === "config") {
    err(`REFUSED before any network call: ${result.error.message}`);
    return 2;
  }

  const stub = result.report?.api?.loopbackStub === true;
  out(`Raven Agent Trust - LIVE Solana check${stub ? "  [LOCAL STUB - not the hosted Raven API]" : ""}`);
  out(`  Token mint:     ${mint}${values.mint ? "" : " (BONK, the fixture mint)"}`);
  out(`  Token program:  ${tokenProgram}`);
  out(`  Raven API:      ${apiBaseOverride ? env.RAVEN_API_BASE : DEFAULT_API_BASE}${RECEIPT_PATH}${apiBaseOverride ? "  (RAVEN_API_BASE override)" : ""}`);
  out(`  Pinned signer:  ${pin.keyId} (from the repo's pinned verifier; not fetched live)`);
  out("");

  let reportPath = null;
  if (result.report) {
    try {
      reportPath = writeRunReport(result.report, {
        dir: env.RAVEN_LIVE_REPORT_DIR || DEFAULT_REPORT_DIR,
        apiKey: rawKey,
      });
    } catch {
      err("Warning: could not write the run report.");
    }
  }

  if (result.error) {
    out("Live receipt from Raven API: NOT OBTAINED -> no PROCEED");
    err(`FAILED: ${result.error.message}`);
    out(`HTTP calls used: ${result.httpCalls} of ${MAX_HTTP_CALLS_PER_RUN} (hard cap).`);
    if (reportPath) out(`Run report (unsigned): ${relative(reportPath)}`);
    return 4;
  }

  const v = result.verification;
  const r = result.report.receipt ?? {};
  const f = v.liveGates.freshness;
  const label = stub ? "Receipt from LOCAL STUB" : "Live receipt from Raven API";
  out(`${label}: ${v.ravenState} -> ${result.decision}${result.decision === "PROCEED" ? "" : `  (reason: ${result.reason})`}`);
  out(`  receiptId:   ${r.receiptId ?? "missing"}`);
  out(`  payloadHash: ${r.payloadHash ?? "missing"}`);
  out(`  observed slot ${r.slot ?? "?"}, issued ${r.timestamp ?? "?"} (${r.timestamp ? rome(r.timestamp) : "?"})`);
  out(`  age ${f.ageSeconds === null ? "unknown" : `${Math.round(f.ageSeconds)}s`}; freshness bound ${f.boundSeconds ?? FRESHNESS_MAX_AGE_SECONDS}s`);
  out(`  checks: ${CHECK_LABELS.map(([k, l]) => `${l} ${v.liveGates.checks[k] ? "OK" : "FAIL"}`).join(", ")}`);
  out(`  Agent A policy: ${v.agentA.decision} (${v.agentA.reason})`);
  const t = result.tamperControl;
  out(`Same receipt, one field changed (${t.field} ${t.from} -> ${t.to}): ${t.decision}${t.decision === "REFUSE" ? `  (reason: ${t.reason})` : ""}`);
  out("");
  out(`HTTP calls used: ${result.httpCalls} of ${MAX_HTTP_CALLS_PER_RUN} (hard cap).`);
  if (reportPath) out(`Run report (unsigned): ${relative(reportPath)}`);
  out("Limits: a valid signature is evidence, not authorization; this is one token's measured scope, not a safety verdict; the Raven API is alpha.");

  if (t.decision !== "REFUSE") {
    err("SELF-CHECK FAILED: the locally tampered copy was not refused. Do not rely on this run.");
    return 5;
  }
  return result.decision === "PROCEED" ? 0 : 3;
}
