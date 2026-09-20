/** Customer-owned proceed gate over verifyReceiptV1ForSubject axes.
 *  CUSTOMER POLICY — not a Raven verdict.
 */
export function customerMayProceed(result) {
  if (!result || typeof result !== "object") return false;
  return Boolean(
    result.valid &&
    result.keyTrusted &&
    !result.stale &&
    result.subjectMatches === true &&
    result.rulesStatus === "supported_valid"
  );
}

export async function verifyAndMaybeProceed(receipt, expectedSubject, options) {
  const mod = await importVerifier();
  const result = mod.verifyReceiptV1ForSubject(receipt, expectedSubject, options);
  return { result, proceed: customerMayProceed(result) };
}

async function importVerifier() {
  const path = new URL("../../packages/verify-js/src/verifyReceiptV1ForSubject.ts", import.meta.url);
  return import(path.href);
}
