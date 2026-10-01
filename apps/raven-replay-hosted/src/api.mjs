import {
  fetchTransaction,
  intakeDigest,
  IntakeError,
  decodeSignature,
} from "./intake.mjs";
import { MAX_REQUEST_BYTES, validateRequest, exact } from "./envelope.mjs";
import { runIsolated } from "./sandbox.mjs";
const inputErrors = new Set([
  "INVALID_REQUEST",
  "INVALID_OPERATION",
  "UNKNOWN_ADAPTER",
  "INVALID_CASE_NAME",
  "INVALID_TRANSACTION_BYTES",
  "UNSUPPORTED_DECODER_VERSION",
  "INVALID_CASE",
  "REFERENCE_REQUIRED",
  "REFERENCE_MISMATCH",
  "INTAKE_INPUT_MISMATCH",
  "INVALID_INTAKE",
  "INVALID_SIGNATURE",
]);
const serviceErrors = new Set([
  "RPC_CONFIGURATION",
  "RPC_RATE_LIMITED",
  "RPC_UNAVAILABLE",
  "RPC_RESPONSE_TOO_LARGE",
  "RPC_INVALID_RESPONSE",
  "RPC_TIMEOUT",
  "RPC_ERROR",
  "NETWORK_MISMATCH",
  "TRANSACTION_VERSION_MISMATCH",
  "SIGNATURE_MISMATCH",
  "EXECUTION_BROKEN",
  "CLEANUP_UNCONFIRMED",
]);
export const securityHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};
const reply = (status, body) =>
  Response.json(body, { status, headers: securityHeaders });
async function readJson(request) {
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)
  )
    throw new IntakeError("REQUEST_TOO_LARGE");
  if (!request.body) throw new IntakeError("INVALID_REQUEST");
  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) throw new IntakeError("REQUEST_TOO_LARGE");
      chunks.push(Buffer.from(value));
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks));
  } catch {
    throw new IntakeError("INVALID_REQUEST");
  }
}

// Budget control is mandatory and injected by the deployment adapter. The local
// development server uses an explicitly process-local limit; it is not advertised
// as a distributed public-service limit.
export function createApi({
  origin,
  fetchTransactionFn = (signature) =>
    fetchTransaction(signature, {
      rpcUrl:
        process.env.RAVEN_REPLAY_RPC_URL ||
        "https://api.mainnet-beta.solana.com",
    }),
  runIsolatedFn = runIsolated,
  acquirePermit,
} = {}) {
  return async function handle(request) {
    const path = new URL(request.url).pathname;
    if (!["/api/transaction", "/api/run"].includes(path))
      return reply(404, { ok: false, error: "NOT_FOUND" });
    if (request.method !== "POST") {
      const response = reply(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
      response.headers.set("allow", "POST");
      return response;
    }
    if (!origin || request.headers.get("origin") !== origin)
      return reply(403, { ok: false, error: "ORIGIN_REFUSED" });
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      return reply(415, { ok: false, error: "CONTENT_TYPE_REFUSED" });
    try {
      const body = await readJson(request);
      if (path === "/api/transaction") {
        if (!exact(body, ["signature"]))
          throw new IntakeError("INVALID_REQUEST");
        decodeSignature(body.signature);
      } else validateRequest(body);
      if (typeof acquirePermit !== "function")
        return reply(503, { ok: false, error: "HOST_NOT_CONFIGURED" });
      if (!(await acquirePermit({ path, request })))
        return reply(429, { ok: false, error: "RATE_LIMITED" });
      if (path === "/api/transaction") {
        const intake = await fetchTransactionFn(body.signature);
        return reply(200, {
          ok: true,
          intake,
          reference: intakeDigest(intake),
        });
      }
      return reply(200, await runIsolatedFn(body));
    } catch (error) {
      const code = error?.code;
      if (code === "REQUEST_TOO_LARGE")
        return reply(413, { ok: false, error: code });
      if (inputErrors.has(code)) return reply(400, { ok: false, error: code });
      if (code === "TRANSACTION_UNAVAILABLE")
        return reply(404, { ok: false, error: code });
      if (code === "UNSUPPORTED_TRANSACTION_VERSION")
        return reply(422, { ok: false, error: code });
      if (code === "HOST_NOT_CONFIGURED")
        return reply(503, { ok: false, error: code });
      if (serviceErrors.has(code))
        return reply(502, {
          ok: false,
          error: code,
          ...(code === "RPC_ERROR" &&
          Number.isInteger(error.rpcCode) &&
          error.rpcCode >= -2147483648 &&
          error.rpcCode <= 2147483647
            ? { rpcCode: error.rpcCode }
            : {}),
        });
      return reply(502, { ok: false, error: "SERVICE_UNAVAILABLE" });
    }
  };
}
