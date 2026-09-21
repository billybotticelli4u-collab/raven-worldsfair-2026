// HEAD/TREE live beside the final bundle, avoiding a commit containing its own hash.
const DELIVERY_BUNDLE = 'raven-c2-release-successor-2026-09-19.bundle';
const DELIVERY_BRANCH = 'codex/c2-release-successor-2026-09-19';
const SOLANA_DELIVERY_BUNDLE = 'raven-solana-profile-base-fa205f85.bundle';
const SOLANA_DELIVERY_BRANCH = 'codex/solana-profile-v1-2026-09-20';
const SOLANA_DELIVERY_PATCH = 'raven-solana-profile-v1.patch';

export function getDeliveryIdentity() {
  return {
    bundle: DELIVERY_BUNDLE,
    branch: DELIVERY_BRANCH,
    head: process.env.C2_DELIVERY_HEAD || null,
    tree: process.env.C2_DELIVERY_TREE || null,
  };
}

export function cleanCloneRecipe(targetId, profile = 'raven-canonical-envelope/1') {
  const isDefaultProfile = profile === 'raven-canonical-envelope/1';
  const bundle = isDefaultProfile ? DELIVERY_BUNDLE : SOLANA_DELIVERY_BUNDLE;
  const branch = isDefaultProfile ? DELIVERY_BRANCH : SOLANA_DELIVERY_BRANCH;
  const conformCommand = isDefaultProfile
    ? `npm run conform -- --target ${targetId}`
    : `npm run conform -- --profile ${profile} --target ${targetId}`;
  const outcomeNote = isDefaultProfile
    ? '# BROKEN_SUBTLE intentionally returns exit 1 for V07/V08 divergence; reference returns 0.'
    : '# SOL_BROKEN_SUBTLE intentionally returns exit 1 for V03/V16 divergence; reference returns 0.';
  const patchCommand = isDefaultProfile
    ? []
    : [`git apply --check ../${SOLANA_DELIVERY_PATCH}`, `git apply ../${SOLANA_DELIVERY_PATCH}`];
  return [
    '# Verify the external ZIP hash and packet manifest before running these commands.',
    '# Run from the extracted delivery folder containing the bundle and DELIVERY-IDENTITY.json.',
    'set -e',
    ...(isDefaultProfile ? [] : ['shasum -a 256 -c SHA256SUMS.txt']),
    `git clone --branch ${branch} ./${bundle} raven-worldsfair-2026`,
    'cd raven-worldsfair-2026',
    'git rev-parse HEAD',
    "git rev-parse 'HEAD^{tree}'",
    `node -e 'const fs=require("node:fs"),cp=require("node:child_process"),id=JSON.parse(fs.readFileSync("../DELIVERY-IDENTITY.json","utf8"));const head=cp.execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),tree=cp.execFileSync("git",["rev-parse","HEAD^{tree}"],{encoding:"utf8"}).trim();if(id.head!==head||id.tree!==tree||id.branch!=="${branch}"||id.bundle!=="${bundle}")throw Error("DELIVERY_IDENTITY_MISMATCH");'`,
    ...patchCommand,
    '# AUTHOR-REPORT.md beside the bundle records scope, checks and limitations.',
    'cd apps/raven-conformance',
    'npm test',
    conformCommand,
    outcomeNote,
  ].join('\n');
}
