/**
 * raven-agent-card/0 — an agent's self-description. A card is a CLAIM made by
 * the agent, not a credential: discovery is not trust. Agent A still verifies
 * every receipt with the pinned verifier.
 */
import { CARD_VERSION, EVIDENCE_CAPABILITY, VERIFIER_PIN } from "./constants.js";
import { isLoopbackUrl } from "./http.js";
import { sha256Canonical } from "./canonical.js";

const AGENT_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

export function makeCard({ agentId, role, endpoint, capabilities, verifierPin, subjects = [], evidenceSource }) {
  return {
    cardVersion: CARD_VERSION,
    agentId,
    role,
    endpoint,
    capabilities: [...capabilities],
    verifierPin,
    subjects: subjects.map((s) => ({ ...s })),
    evidenceSource: evidenceSource ?? null,
  };
}

/** Structural validity only (says nothing about honesty). */
export function cardShapeReasons(card) {
  const reasons = [];
  if (!card || typeof card !== "object" || Array.isArray(card)) return ["card_not_object"];
  if (card.cardVersion !== CARD_VERSION) reasons.push("card_version_unsupported");
  if (typeof card.agentId !== "string" || !AGENT_ID.test(card.agentId)) reasons.push("agent_id_invalid");
  if (card.role !== "evidence-provider" && card.role !== "evidence-consumer") reasons.push("role_invalid");
  if (typeof card.endpoint !== "string" || !isLoopbackUrl(card.endpoint)) reasons.push("endpoint_not_loopback");
  if (!Array.isArray(card.capabilities) || !card.capabilities.every((c) => typeof c === "string")) {
    reasons.push("capabilities_invalid");
  }
  if (typeof card.verifierPin !== "string") reasons.push("verifier_pin_invalid");
  if (!Array.isArray(card.subjects)) reasons.push("subjects_invalid");
  return reasons;
}

export async function cardSha256(card) {
  return sha256Canonical(card);
}

/**
 * Agent A's eligibility rule for an evidence provider. Returns every reason
 * so the transcript shows why a card was skipped.
 */
export function evaluateProviderCard(card, { capability = EVIDENCE_CAPABILITY, subject } = {}) {
  const reasons = cardShapeReasons(card);
  if (reasons.length === 0) {
    if (card.role !== "evidence-provider") reasons.push("role_not_provider");
    if (!card.capabilities.includes(capability)) reasons.push("capability_missing");
    if (card.verifierPin !== VERIFIER_PIN) reasons.push("verifier_pin_mismatch");
    if (subject && !card.subjects.some((s) =>
      s && s.chain === subject.chain && s.mintAddress === subject.mintAddress &&
      s.tokenProgramAddress === subject.tokenProgramAddress)) {
      reasons.push("subject_not_offered");
    }
  }
  return { eligible: reasons.length === 0, reasons };
}
