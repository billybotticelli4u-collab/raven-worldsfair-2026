/** Classify identity / EXPECTED_COMMIT rows for verify-judge-url (D6 / CODEX B1). */

export function hostOf(baseUrl) {
  try {
    return new URL(baseUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isLoopbackHost(host) {
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/**
 * @returns {{ buildInfo: { klass?: string, ok: boolean, detail: string },
 *             expectedCommit: { klass?: string, ok: boolean, detail: string, name: string },
 *             buildInfoName: string }}
 */
export function classifyIdentityChecks({
  baseUrl,
  expectedCommit,
  identityStatus,
  deployedCommit,
  shapeOk,
  allowlistedIdentity,
  commitShapeOk,
}) {
  const host = hostOf(baseUrl);
  const loopback = isLoopbackHost(host);
  const expected = (expectedCommit || "").trim().toLowerCase();
  const id = identityStatus == null ? null : String(identityStatus);
  const commit =
    deployedCommit == null || deployedCommit === ""
      ? null
      : String(deployedCommit).toLowerCase();

  // Local unbound state (loopback only). Two real shapes of `npm start` on a
  // developer machine (CODEX B2):
  //   - plain extracted package: identityStatus UNKNOWN (or null), commit null;
  //   - git checkout: identityStatus UNVERIFIED_ASSERTION, commit = HEAD (40-hex).
  // CONFLICT, CORRUPTED, or a malformed commit never qualify.
  // Exact pairs only (CODEX B2 re-review): mixed tuples such as UNKNOWN+40-hex,
  // UNVERIFIED_ASSERTION+null, or null+40-hex are NOT local shapes and never soft-pass.
  const extractedPackageShape = (id === null || id === "UNKNOWN") && commit === null;
  const gitCheckoutShape = id === "UNVERIFIED_ASSERTION" && /^[0-9a-f]{40}$/.test(commit || "");
  const localUnboundState = loopback && (extractedPackageShape || gitCheckoutShape);

  const identityOk = !!(shapeOk && allowlistedIdentity && commitShapeOk);
  const detail = `host=${host || "?"} product-shape=${shapeOk ? "ok" : "bad"} identityStatus=${id} commit=${commit}`;

  let buildInfo;
  if (localUnboundState && shapeOk && !expected) {
    buildInfo = {
      ok: true,
      klass: "LOCAL-UNBOUND",
      detail: detail + " (local unbound)",
    };
  } else if (!expected && !loopback) {
    // Remote + unset EXPECTED_COMMIT: never soft-pass via LOCAL-UNBOUND.
    buildInfo = {
      ok: identityOk,
      detail:
        detail +
        (identityOk
          ? " (remote requires EXPECTED_COMMIT)"
          : " (remote unbound/corrupt — FAIL)"),
    };
    if (!identityOk) {
      /* keep ok false */
    } else {
      // Shape+identity look production-valid but commit binding missing → still fail the pair via expectedCommit row.
      buildInfo = { ok: true, detail: detail + " (remote; commit pin checked next)" };
    }
  } else if (localUnboundState && shapeOk && expected && commit === null) {
    // Local unbound server with no commit but operator pinned one → identity row fails closed.
    buildInfo = { ok: false, detail: detail + " (local unbound cannot satisfy pinned EXPECTED_COMMIT)" };
  } else {
    buildInfo = { ok: identityOk, detail };
  }

  let expectedRow;
  const expectedName = expected
    ? "EXPECTED_COMMIT matches fairBuildCommit"
    : "EXPECTED_COMMIT binding";
  if (!expected) {
    if (loopback && localUnboundState) {
      expectedRow = {
        name: expectedName,
        ok: true,
        klass: "LOCAL-UNBOUND",
        detail:
          "EXPECTED_COMMIT unset — local unbound (CI/owner gate must pin 40-hex on non-loopback)",
      };
    } else if (loopback && !localUnboundState) {
      expectedRow = {
        name: expectedName,
        ok: false,
        detail:
          "EXPECTED_COMMIT unset on loopback but identityStatus/commit are not a well-formed local state (UNKNOWN/null or UNVERIFIED_ASSERTION + 40-hex)",
      };
    } else {
      expectedRow = {
        name: expectedName,
        ok: false,
        detail:
          "EXPECTED_COMMIT unset — refuse unbound pass on non-loopback host",
      };
    }
  } else if (!/^[0-9a-f]{40}$/.test(expected)) {
    expectedRow = {
      name: expectedName,
      ok: false,
      detail: `EXPECTED_COMMIT not 40-hex: ${expected}`,
    };
  } else {
    expectedRow = {
      name: "EXPECTED_COMMIT matches fairBuildCommit",
      ok: commit === expected,
      detail: `expected=${expected} actual=${commit}`,
    };
  }

  return {
    buildInfoName: "GET /api/build-info shape + allowlisted identity + commit",
    buildInfo,
    expectedCommit: expectedRow,
  };
}
