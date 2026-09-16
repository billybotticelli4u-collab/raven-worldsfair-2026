/**
 * Independent profile oracle.
 *
 * WHY THIS EXISTS
 * The conformance engine never executes the profile. It executes a corpus whose
 * expected ACCEPT/REJECT values are asserted by the same author as the reference
 * target. "CONFORMANT_REFERENCE passes the corpus" therefore proves agreement
 * between two artifacts written together — it does not prove either one encodes
 * raven-canonical-envelope/1.
 *
 * This oracle is derived ONLY from profiles/raven-canonical-envelope-1.json:
 * its allowed/required key lists, schema_value, digest_algorithm, and the prose
 * rules[] array. It does not import, read, or execute any target.
 *
 * LIMITATION (stated, not hidden): rule 6 ("digest !== sha256-hex of canonical
 * JSON(payload) with sorted keys and no insignificant whitespace") is prose. The
 * canonicalization below is an independent reading of that prose. Prose agreement
 * is weaker evidence than a spec-supplied canonicalization test vector; the
 * profile ships none. See FINDINGS.md U-1.
 */
import { createHash } from "node:crypto";

function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
    return out;
  }
  return value;
}

function digestOf(algorithm, text) {
  return createHash(algorithm).update(text, "utf8").digest("hex");
}

/**
 * Decide an envelope purely from profile data.
 * Returns { decision, reason, rule } where rule cites the profile rules[] index.
 */
export function oracleDecide(profileData, envelope) {
  const allowed = new Set(profileData.allowed_top_level_keys || []);
  const required = profileData.required_top_level_keys || [];
  const schemaValue = profileData.schema_value;
  const algorithm = profileData.digest_algorithm || "sha256";

  if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
    return { decision: "REJECT", reason: "envelope_not_object", rule: "rules[4]" };
  }
  for (const k of Object.keys(envelope)) {
    if (!allowed.has(k)) {
      return { decision: "REJECT", reason: `unexpected_top_level_field:${k}`, rule: "rules[0]" };
    }
  }
  for (const req of required) {
    if (!(req in envelope)) {
      return { decision: "REJECT", reason: `missing_required:${req}`, rule: "rules[1]" };
    }
  }
  if (envelope.schema !== schemaValue) {
    return { decision: "REJECT", reason: "schema_mismatch", rule: "rules[2]" };
  }
  if (typeof envelope.id !== "string" || envelope.id.length === 0) {
    return { decision: "REJECT", reason: "id_invalid", rule: "rules[3]" };
  }
  if (!envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) {
    return { decision: "REJECT", reason: "payload_not_object", rule: "rules[4]" };
  }
  const expected = digestOf(algorithm, canonicalJson(envelope.payload));
  if (envelope.digest !== expected) {
    return { decision: "REJECT", reason: "digest_mismatch", rule: "rules[5]" };
  }
  return { decision: "ACCEPT", reason: "all_rules_satisfied", rule: "rules[6]" };
}

/** Score every corpus vector's DECLARED expectation against the oracle. */
export function auditCorpusExpectations(profileData, corpusData) {
  const rows = [];
  for (const v of corpusData.vectors) {
    const o = oracleDecide(profileData, v.input);
    rows.push({
      vector_id: v.id,
      declared_expected: v.expected?.decision ?? null,
      oracle_decision: o.decision,
      oracle_reason: o.reason,
      profile_rule: o.rule,
      agrees: (v.expected?.decision ?? null) === o.decision,
    });
  }
  return rows;
}
