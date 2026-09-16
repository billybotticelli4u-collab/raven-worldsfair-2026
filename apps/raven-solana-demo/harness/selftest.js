#!/usr/bin/env node
/**
 * Self-test — raven-solana-demo.
 *
 * Guards the demo against silent corpus/report manipulation that the harness
 * alone cannot catch (a harness run compares target output against whatever
 * corpus is on disk — a shrunken corpus still yields CONFORMANT):
 *
 *   1. corpus content digest recomputes to the declared value;
 *   2. vector count equals the frozen expectation below (update deliberately);
 *   3. every vector carries input + expected decision/version + rationale;
 *   4. the reference target is CONFORMANT on the full corpus;
 *   5. the two broken targets are DIVERGENT (accept-everything and
 *      stale-pre-v1-parser are both caught);
 *   6. profile digest matches the value frozen below (update deliberately).
 *
 * Exit 0 iff all hold. Run: npm test
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const sha256Hex = (b) => createHash("sha256").update(b).digest("hex");

// Frozen at corpus 1.1.0 / profile 0.2.0. If you intentionally change the
// corpus or profile, update these constants in the same commit.
const EXPECTED_VECTOR_COUNT = 26;
const EXPECTED_PROFILE_SHA256 = "bee001202b6e8db37e0145e1eca8c93adb620e97351847ceb48eb1c2a80d097c";

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
};

const corpusRaw = readFileSync(path.join(ROOT, "corpus", "raven-solana-txversion-demo-corpus-1.json"), "utf8");
const corpus = JSON.parse(corpusRaw);
const redigested = sha256Hex(
  JSON.stringify(
    { id: corpus.id, version: corpus.version, profile: corpus.profile, description: corpus.description, vectors: corpus.vectors },
    null,
    2
  ) + "\n"
);
check("corpus digest self-consistent", redigested === corpus.content_digest_sha256, `recomputed ${redigested} != declared ${corpus.content_digest_sha256}`);
check("vector count matches frozen expectation", corpus.vectors.length === EXPECTED_VECTOR_COUNT, `got ${corpus.vectors.length}, want ${EXPECTED_VECTOR_COUNT}`);
check(
  "every vector fully specified",
  corpus.vectors.every((v) => v.id && v.input && v.expected && typeof v.expected.decision === "string" && "version" in v.expected && v.rationale && v.requirement),
  "a vector lacks input/expected/rationale/requirement"
);

const profileSha = sha256Hex(readFileSync(path.join(ROOT, "profiles", "raven-solana-txversion-experimental-0.json")));
check("profile digest matches frozen expectation", profileSha === EXPECTED_PROFILE_SHA256, `got ${profileSha}`);

let out;
try {
  out = JSON.parse(
    execFileSync(process.execPath, [path.join(ROOT, "harness", "run.js"), "--all", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  );
} catch (e) {
  // harness exits 1 when any target is DIVERGENT — expected for the broken
  // targets; the JSON report is still on stdout.
  if (e.stdout) out = JSON.parse(e.stdout);
  else throw e;
}
const byId = Object.fromEntries(out.reports.map((r) => [r.target.id, r]));
check("SOL_CONFORMANT_REFERENCE is CONFORMANT", byId.SOL_CONFORMANT_REFERENCE?.summary.overall === "CONFORMANT", JSON.stringify(byId.SOL_CONFORMANT_REFERENCE?.summary));
check("SOL_BROKEN_OBVIOUS is DIVERGENT", byId.SOL_BROKEN_OBVIOUS?.summary.overall === "DIVERGENT", JSON.stringify(byId.SOL_BROKEN_OBVIOUS?.summary));
check("SOL_BROKEN_SUBTLE is DIVERGENT", byId.SOL_BROKEN_SUBTLE?.summary.overall === "DIVERGENT", JSON.stringify(byId.SOL_BROKEN_SUBTLE?.summary));

console.log(failures === 0 ? "\nself-test: all checks PASS" : `\nself-test: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
