// Reproduction has two routes. The public route (every report, the Judge UI) needs only the public
// repository and the commit this instance asserts it was built from; the sealed-delivery route
// (RELEASE-HANDOFF.md) binds a bundle to an external DELIVERY-IDENTITY.json, because a commit cannot
// contain its own hash. The delivery names stay here for the handoff and its tests.
const DELIVERY_BUNDLE = 'raven-c2-release-successor-2026-09-19.bundle';
const DELIVERY_BRANCH = 'codex/c2-release-successor-2026-09-19';
const SOLANA_DELIVERY_BUNDLE = 'raven-solana-coverage-repair.bundle';
const SOLANA_DELIVERY_BRANCH = 'codex/solana-coverage-repair-20260925';

export const PUBLIC_REPOSITORY = 'https://github.com/billybotticelli4u-collab/raven-worldsfair-2026.git';

export function getDeliveryIdentity() {
  return {
    bundle: DELIVERY_BUNDLE,
    branch: DELIVERY_BRANCH,
    head: process.env.C2_DELIVERY_HEAD || null,
    tree: process.env.C2_DELIVERY_TREE || null,
  };
}

export function getSolanaDeliveryIdentity() {
  return { bundle: SOLANA_DELIVERY_BUNDLE, branch: SOLANA_DELIVERY_BRANCH };
}

/**
 * The public reproduction recipe. `identity` is this instance's build identity
 * (readIdentity): when it names a commit the recipe pins it and states the claim's
 * source and status; when it does not, a shell guard stops the reader until they
 * take the commit from /api/build-info. Nothing here asserts that served bytes come
 * from that commit; the identity limit is printed with it.
 */
export function cleanCloneRecipe(targetId, profile = 'raven-canonical-envelope/1', identity = null) {
  const isDefaultProfile = profile === 'raven-canonical-envelope/1';
  const conformCommand = isDefaultProfile
    ? `npm run conform -- --target ${targetId}`
    : `npm run conform -- --profile ${profile} --target ${targetId}`;
  const outcomeNote = isDefaultProfile
    ? '# BROKEN_SUBTLE intentionally returns exit 1 for V07/V08 divergence; reference returns 0.'
    : '# SOL_BROKEN_SUBTLE intentionally returns exit 1 for V03/V10/V16 divergence; reference returns 0.';
  const commit = /^[0-9a-f]{40}$/.test(identity?.fairBuildCommit || '') ? identity.fairBuildCommit : null;
  const commitLines = commit
    ? [
        `# Build identity of this instance: ${identity.commitSource || 'unknown source'}, ${identity.identityStatus || 'UNKNOWN'} (asserted, not proof of served bytes; see /api/build-info).`,
        `FAIR_BUILD_COMMIT=${commit}`,
      ]
    : ['# This instance could not determine its build commit. Set it from /api/build-info (fairBuildCommit) before running.'];
  return [
    '# Reproduce from the public repository, pinned to the commit this instance asserts it was built from.',
    'set -e',
    ...commitLines,
    ': "${FAIR_BUILD_COMMIT:?set FAIR_BUILD_COMMIT to the fairBuildCommit shown by /api/build-info}"',
    `git clone ${PUBLIC_REPOSITORY} raven-worldsfair-2026`,
    'cd raven-worldsfair-2026',
    'git checkout --detach "$FAIR_BUILD_COMMIT"',
    'git rev-parse HEAD',
    "git rev-parse 'HEAD^{tree}'",
    'cd apps/raven-conformance',
    'npm test',
    conformCommand,
    outcomeNote,
    '# Holders of the sealed delivery can follow RELEASE-HANDOFF.md instead.',
  ].join('\n');
}
