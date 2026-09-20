import { createHash, createPublicKey } from "node:crypto";

const CANONICAL_RULES_VERSION = /^raven-rules@[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const GIT_COMMIT = /^[0-9a-f]{40}$/;
const ENVIRONMENT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const OWNER_MARKER = /^[A-Za-z0-9._:-]{12,160}$/;

export const CANDIDATE_AUTHORIZATION_ENV = "RAVEN_CANARY_CANDIDATE_AUTHORIZED";
export const CANDIDATE_OWNER_APPROVAL_ENV = "RAVEN_CANARY_OWNER_APPROVAL_MARKER";
export const CANDIDATE_ENVIRONMENT_ENV = "RAVEN_CANARY_ENVIRONMENT";
export const CANDIDATE_ARTIFACT_COMMIT_ENV = "RAVEN_CANARY_ARTIFACT_COMMIT";
export const CANDIDATE_VECTOR_SET_ENV = "RAVEN_CANARY_VECTOR_SET_SHA256";
export const PRODUCTION_ORIGIN_AUTHORIZATION_ENV = "RAVEN_CANARY_PRODUCTION_ORIGIN_AUTHORIZED";
export const PRODUCTION_ORIGIN_OWNER_APPROVAL_ENV = "RAVEN_CANARY_PRODUCTION_ORIGIN_APPROVAL_MARKER";

const record = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};

const nonEmptyString = (value, label) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const canonicalJson = (value) => {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON cannot encode a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = record(value, "canonical JSON value");
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
};

const detachedFrozen = (value) => {
  const clone = JSON.parse(JSON.stringify(value));
  const freeze = (current) => {
    if (current && typeof current === "object" && !Object.isFrozen(current)) {
      for (const child of Object.values(current)) freeze(child);
      Object.freeze(current);
    }
    return current;
  };
  return freeze(clone);
};

const normalizedApiBase = (value, label) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be an explicit non-empty URL`);
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} must use http or https`);
  }
  return url.href.replace(/\/$/, "");
};

// Candidate targets are deliberately stricter than the legacy deployed target:
// no URL normalization, credentials, paths, query, fragments, ports, or
// trailing-dot host aliases are accepted. The exact source string must equal
// its canonical https origin and the committed authorization packet.
const strictCandidateOrigin = (value, label) => {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new Error(`${label} must be an explicit canonical https origin`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname.endsWith(".") ||
    url.origin !== value
  ) {
    throw new Error(`${label} must be an exact canonical https origin without credentials, path, query, fragment, port, or alias`);
  }
  return url.origin;
};

// Used only for production-origin exclusion. Removing a terminal DNS dot here
// closes the trailing-dot alias even if a future config accidentally relaxes
// the strict candidate-origin parser.
const originIdentity = (value, label) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${label} must use http or https`);
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  return `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ""}`;
};

const validPublicKeyBase64 = (value) => {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) return false;
  const der = Buffer.from(value, "base64");
  if (der.length !== 44 || der.toString("base64") !== value) return false;
  try {
    return createPublicKey({ key: der, format: "der", type: "spki" }).asymmetricKeyType === "ed25519";
  } catch {
    return false;
  }
};

const requireExactEnv = (env, name, expected, label) => {
  if (env[name] !== expected) throw new Error(`${label} (${name}) must equal the approved packet exactly`);
};

const candidateBuildInfoProjection = (buildInfo) => {
  const body = record(buildInfo, "candidate /buildinfo response");
  const receipt = record(body.receipt, "candidate /buildinfo receipt");
  const attestation = record(body.attestation, "candidate /buildinfo attestation");
  return {
    service: nonEmptyString(body.service, "candidate /buildinfo service"),
    commit: nonEmptyString(body.commit, "candidate /buildinfo commit"),
    receipt: {
      domain: nonEmptyString(receipt.domain, "candidate /buildinfo receipt.domain"),
      version: nonEmptyString(receipt.version, "candidate /buildinfo receipt.version"),
      producerProfile: nonEmptyString(receipt.producerProfile, "candidate /buildinfo receipt.producerProfile"),
      rulesVersion: nonEmptyString(receipt.rulesVersion, "candidate /buildinfo receipt.rulesVersion"),
      findingTaxonomyVersion: nonEmptyString(receipt.findingTaxonomyVersion, "candidate /buildinfo receipt.findingTaxonomyVersion"),
    },
    attestation: {
      schema: nonEmptyString(attestation.schema, "candidate /buildinfo attestation.schema"),
      replaySchema: nonEmptyString(attestation.replaySchema, "candidate /buildinfo attestation.replaySchema"),
      version: nonEmptyString(attestation.version, "candidate /buildinfo attestation.version"),
    },
    signerKeyId: nonEmptyString(body.signerKeyId, "candidate /buildinfo signerKeyId"),
  };
};

export const candidateBuildInfoFingerprint = (buildInfo) =>
  `sha256:${createHash("sha256").update(canonicalJson(candidateBuildInfoProjection(buildInfo)), "utf8").digest("hex")}`;

const validateCandidatePacket = ({ config, name, profile, env, deployedApiBase, deployedSiteBase }) => {
  const packet = record(profile.candidateAuthorization, `canary profile ${name} candidateAuthorization`);
  if (packet.status !== "authorized") {
    throw new Error(`canary profile ${name} candidate authorization packet is not authorized`);
  }
  if (packet.authorizationOwner !== "Glen" || packet.authorizationOwner !== profile.authorizationOwner) {
    throw new Error(`canary profile ${name} candidate authorization owner must be Glen`);
  }
  if (!ENVIRONMENT_NAME.test(packet.approvedEnvironment ?? "")) {
    throw new Error(`canary profile ${name} has an invalid approved environment`);
  }
  if (!OWNER_MARKER.test(packet.ownerApprovalMarker ?? "")) {
    throw new Error(`canary profile ${name} has an invalid owner approval marker`);
  }

  const approvedApiOrigin = strictCandidateOrigin(packet.approvedApiOrigin, `canary profile ${name} approved API origin`);
  const approvedSiteOrigin = strictCandidateOrigin(packet.approvedSiteOrigin, `canary profile ${name} approved site origin`);
  const productionOrigins = [
    originIdentity(deployedApiBase, "canary config apiBase"),
    originIdentity(deployedSiteBase, "canary config siteBase"),
  ];
  const candidateOrigins = [
    originIdentity(approvedApiOrigin, `canary profile ${name} approved API origin`),
    originIdentity(approvedSiteOrigin, `canary profile ${name} approved site origin`),
  ];
  if (candidateOrigins.some((target) => productionOrigins.includes(target))) {
    if (packet.allowProductionOrigins !== true) {
      throw new Error(`canary profile ${name} refuses a production origin without a separately authorized production-origin packet`);
    }
    if (!OWNER_MARKER.test(packet.productionOriginOwnerApprovalMarker ?? "")) {
      throw new Error(`canary profile ${name} has an invalid production-origin owner approval marker`);
    }
    requireExactEnv(env, PRODUCTION_ORIGIN_AUTHORIZATION_ENV, "true", "production-origin authorization");
    requireExactEnv(
      env,
      PRODUCTION_ORIGIN_OWNER_APPROVAL_ENV,
      packet.productionOriginOwnerApprovalMarker,
      "production-origin owner approval marker",
    );
  } else if (packet.allowProductionOrigins !== false) {
    throw new Error(`canary profile ${name} must explicitly disable production origins when its target is isolated`);
  }

  const artifact = record(packet.artifact, `canary profile ${name} artifact`);
  if (!GIT_COMMIT.test(artifact.commit ?? "")) {
    throw new Error(`canary profile ${name} has an invalid candidate artifact commit`);
  }
  if (!SHA256.test(artifact.buildInfoSha256 ?? "")) {
    throw new Error(`canary profile ${name} has an invalid candidate buildinfo fingerprint`);
  }
  const vectorSet = record(packet.fixtureVectorSet, `canary profile ${name} fixture vector set`);
  if (typeof vectorSet.id !== "string" || vectorSet.id.length === 0 || !SHA256.test(vectorSet.sha256 ?? "")) {
    throw new Error(`canary profile ${name} has an invalid fixture/vector expectation set`);
  }
  const signer = record(packet.expectedSigner, `canary profile ${name} expected signer`);
  if (typeof signer.keyId !== "string" || signer.keyId.length === 0 || !validPublicKeyBase64(signer.publicKeyBase64)) {
    throw new Error(`canary profile ${name} has an invalid expected candidate signer`);
  }
  if (signer.keyId === config.expectedKeyId || signer.publicKeyBase64 === config.expectedPublicKeyBase64) {
    throw new Error(`canary profile ${name} must bind a signer distinct from the deployed production signer`);
  }

  const expectedBuildInfo = record(packet.expectedBuildInfo, `canary profile ${name} expected buildinfo`);
  const expectedReceipt = record(expectedBuildInfo.receipt, `canary profile ${name} expected buildinfo receipt`);
  const expectedAttestation = record(expectedBuildInfo.attestation, `canary profile ${name} expected buildinfo attestation`);
  if (
    expectedBuildInfo.service !== "raven-hosted-verifier" ||
    expectedBuildInfo.signerKeyId !== signer.keyId ||
    expectedReceipt.domain !== "raven-receipt" ||
    expectedReceipt.version !== "v1" ||
    expectedReceipt.producerProfile !== name ||
    expectedReceipt.rulesVersion !== profile.expectedRulesVersion ||
    typeof expectedReceipt.findingTaxonomyVersion !== "string" ||
    expectedReceipt.findingTaxonomyVersion.length === 0 ||
    typeof expectedAttestation.schema !== "string" ||
    expectedAttestation.schema.length === 0 ||
    expectedAttestation.replaySchema !== "raven-replay-v4" ||
    typeof expectedAttestation.version !== "string" ||
    expectedAttestation.version.length === 0
  ) {
    throw new Error(`canary profile ${name} expected buildinfo does not bind the candidate rules/profile artifact`);
  }

  requireExactEnv(env, CANDIDATE_AUTHORIZATION_ENV, "true", "candidate-canary authorization");
  requireExactEnv(env, CANDIDATE_OWNER_APPROVAL_ENV, packet.ownerApprovalMarker, "candidate owner approval marker");
  requireExactEnv(env, CANDIDATE_ENVIRONMENT_ENV, packet.approvedEnvironment, "candidate environment");
  requireExactEnv(env, CANDIDATE_ARTIFACT_COMMIT_ENV, artifact.commit, "candidate artifact commit");
  requireExactEnv(env, CANDIDATE_VECTOR_SET_ENV, vectorSet.sha256, "candidate fixture/vector set");

  const apiBase = strictCandidateOrigin(env.RAVEN_API_BASE, "RAVEN_API_BASE");
  const siteBase = strictCandidateOrigin(env.RAVEN_SITE_BASE, "RAVEN_SITE_BASE");
  if (apiBase !== approvedApiOrigin || siteBase !== approvedSiteOrigin) {
    throw new Error(`canary profile ${name} target must equal the approved isolated API and site origins exactly`);
  }

  return { packet: detachedFrozen(packet), apiBase, siteBase };
};

/**
 * Validates the actual public build identity before a candidate canary sends a
 * keyed request. The build-info fingerprint covers the exact public identity
 * projection, including commit, rules/profile, replay identity, and signer.
 */
export function assertCandidateBuildInfo(profile, buildInfo) {
  const packet = profile?.candidateAuthorization;
  if (!packet) throw new Error("candidate buildinfo validation requires a selected candidate profile");
  const actual = candidateBuildInfoProjection(buildInfo);
  const expected = record(packet.expectedBuildInfo, "candidate expected buildinfo");
  const { commit: _commit, ...actualWithoutCommit } = actual;
  if (actual.commit !== packet.artifact.commit) {
    throw new Error("candidate /buildinfo commit does not match the approved artifact commit");
  }
  if (canonicalJson(actualWithoutCommit) !== canonicalJson(expected)) {
    throw new Error("candidate /buildinfo identity does not match the approved profile/rules/signer packet");
  }
  if (candidateBuildInfoFingerprint(actual) !== packet.artifact.buildInfoSha256) {
    throw new Error("candidate /buildinfo fingerprint does not match the approved artifact");
  }
  return detachedFrozen(actual);
}

/**
 * The canary binds a reviewed, immutable local vector-set file by its raw-byte
 * SHA-256. This check occurs before any remote candidate request; changing the
 * semantic vector set without changing the packet stops the canary.
 */
export function assertCandidateVectorSet(profile, vectorSet, sha256) {
  const packet = profile?.candidateAuthorization;
  if (!packet) throw new Error("candidate vector-set validation requires a selected candidate profile");
  const manifest = record(vectorSet, "candidate vector-set manifest");
  if (
    manifest.schema !== "raven-canary-vector-set/1" ||
    manifest.rulesVersion !== profile.expectedRulesVersion ||
    manifest.vectorSetId !== packet.fixtureVectorSet.id ||
    !Array.isArray(manifest.requiredVectorIds) ||
    manifest.requiredVectorIds.length === 0 ||
    !manifest.requiredVectorIds.every((id) => typeof id === "string" && id.length > 0) ||
    new Set(manifest.requiredVectorIds).size !== manifest.requiredVectorIds.length
  ) {
    throw new Error("candidate vector-set manifest does not match the selected rules/profile contract");
  }
  if (!SHA256.test(sha256) || sha256 !== packet.fixtureVectorSet.sha256) {
    throw new Error("candidate vector-set fingerprint does not match the approved packet");
  }
  return detachedFrozen(manifest);
}

// Profile selection is deliberately pure so CI can prove that the existing
// deployed profile remains the default and candidate issuance cannot be
// selected accidentally by editing a rules expectation in place.
export function selectCanaryProfile(config, env = process.env) {
  record(config, "canary config");
  if (typeof config.defaultProfile !== "string" || config.defaultProfile.length === 0) {
    throw new Error("canary config defaultProfile is missing");
  }
  record(config.profiles, "canary config profiles");

  const hasExplicitProfile = Object.prototype.hasOwnProperty.call(env, "RAVEN_CANARY_PROFILE");
  const name = hasExplicitProfile ? env.RAVEN_CANARY_PROFILE : config.defaultProfile;
  if (typeof name !== "string" || name.length === 0 || name !== name.trim()) {
    throw new Error("RAVEN_CANARY_PROFILE must be an exact non-empty profile name when set");
  }
  const profile = config.profiles[name];
  record(profile, `canary profile ${name}`);
  if (!CANONICAL_RULES_VERSION.test(profile.expectedRulesVersion ?? "")) {
    throw new Error(`canary profile ${name} has a malformed expectedRulesVersion`);
  }
  if (typeof profile.requireKeyed !== "boolean" || typeof profile.authorizationRequired !== "boolean") {
    throw new Error(`canary profile ${name} has an invalid gate configuration`);
  }
  if (name === config.defaultProfile && config.expectedRulesVersion !== profile.expectedRulesVersion) {
    throw new Error("legacy expectedRulesVersion must match the deployed default profile");
  }

  const deployedApiBase = normalizedApiBase(config.apiBase, "canary config apiBase");
  const deployedSiteBase = normalizedApiBase(config.siteBase, "canary config siteBase");
  let apiBase;
  let siteBase;
  let candidateAuthorization = null;
  let expectedSigner;

  if (profile.authorizationRequired) {
    if (profile.authorizationOwner !== "Glen") {
      throw new Error(`canary profile ${name} does not name the required authorization owner`);
    }
    const selected = validateCandidatePacket({ config, name, profile, env, deployedApiBase, deployedSiteBase });
    apiBase = selected.apiBase;
    siteBase = selected.siteBase;
    candidateAuthorization = selected.packet;
    expectedSigner = candidateAuthorization.expectedSigner;
  } else {
    apiBase = env.RAVEN_API_BASE
      ? normalizedApiBase(env.RAVEN_API_BASE, "RAVEN_API_BASE")
      : deployedApiBase;
    siteBase = env.RAVEN_SITE_BASE
      ? normalizedApiBase(env.RAVEN_SITE_BASE, "RAVEN_SITE_BASE")
      : deployedSiteBase;
    expectedSigner = {
      keyId: nonEmptyString(config.expectedKeyId, "canary config expectedKeyId"),
      publicKeyBase64: nonEmptyString(config.expectedPublicKeyBase64, "canary config expectedPublicKeyBase64"),
    };
  }

  return detachedFrozen({
    name,
    expectedRulesVersion: profile.expectedRulesVersion,
    requireKeyed: profile.requireKeyed,
    authorizationRequired: profile.authorizationRequired,
    authorizationOwner: profile.authorizationOwner ?? null,
    expectedSigner,
    candidateAuthorization,
    apiBase,
    siteBase,
  });
}
