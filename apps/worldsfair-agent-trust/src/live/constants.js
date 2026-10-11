/**
 * Live-exchange constants (2026-10-11). Additive; the offline
 * Day-2 path in ../lib is unchanged.
 */
export const LIVE_PROTOCOL = "raven-agent-trust-live/0";
export const CARD_VERSION = "raven-agent-card/0";
export const EVIDENCE_CAPABILITY = "evidence.request:raven.receipt-v1";

/** The only verifier Agent A uses: the pinned public submodule, unchanged. */
export const VERIFIER_PIN =
  "raven-receipt-verifier@1b04356a275742752fb7afd8dfcc4269d462a778";

/** Every server in this package binds here and nowhere else. */
export const LOOPBACK_HOST = "127.0.0.1";

/** Agent A accepts an evidence.response only within this window (real clock). */
export const RESPONSE_FRESHNESS_WINDOW_MS = 30_000;
/** Tolerated forward clock skew between processes / hosts. */
export const CLOCK_SKEW_MS = 30_000;

export const DEFAULT_HTTP_TIMEOUT_MS = 5_000;
export const MAX_BODY_BYTES = 65_536;

/** Card evidenceSource labels. */
export const FIXTURE_SOURCE_LABEL = "retained_fixture";
export const LIVE_HOSTED_SOURCE_LABEL = "hosted_receipt_api_live";
export const LOOPBACK_STUB_SOURCE_LABEL = "hosted_receipt_api_loopback_stub";
export const CUSTOM_SOURCE_LABEL = "custom_evidence_provider";

/**
 * Live-path challenge binding: a receipt whose signed `timestamp` (receipt-v1
 * body field) is earlier than challenge.issuedAt minus this tolerance was not
 * acquired for this request and is refused (receipt_predates_challenge).
 */
export const CHALLENGE_BINDING_SKEW_MS = 5_000;
