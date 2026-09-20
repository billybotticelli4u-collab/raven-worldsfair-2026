import { readIdentity } from "./buildIdentity.js";

/** Production-like runtime: Vercel or NODE_ENV=production. */
export function isProductionRuntime(env = process.env) {
  return env.VERCEL === "1" || env.NODE_ENV === "production";
}

export function identityBlocksServing(identity) {
  return identity?.identityStatus === "UNKNOWN";
}

/**
 * Routes allowed while identity is UNKNOWN in production.
 * Everything else → 503 identity_unavailable.
 */
export function isIdentityExemptPath(pathname) {
  return pathname === "/api/health" || pathname === "/api/build-info";
}

export function identityUnavailableBody(identity) {
  return {
    error: "identity_unavailable",
    message:
      "Production serving is fail-closed until a non-UNKNOWN build identity is available (git checkout or platform commit).",
    identityStatus: identity?.identityStatus ?? "UNKNOWN",
  };
}

export function healthIdentityField(identity, env = process.env) {
  if (isProductionRuntime(env) && identityBlocksServing(identity)) {
    return "unavailable";
  }
  return identity?.identityStatus ?? "unknown";
}

export function loadServingIdentity(appRoot, env = process.env) {
  // Test/diagnostics only: force UNKNOWN regardless of git checkout.
  if (env.RAVEN_FORCE_IDENTITY_UNKNOWN === "1") {
    return {
      identityStatus: "UNKNOWN",
      fairBuildCommit: null,
      commitSource: "unavailable",
      identityClaims: [],
      identityWarnings: ["FORCED_UNKNOWN_FOR_TEST"],
    };
  }
  return readIdentity(appRoot, { env });
}

