// HEAD/TREE live beside the final bundle, avoiding a commit containing its own hash.
const DELIVERY_BUNDLE = 'raven-c2-release-recipe-2026-09-19.bundle';
const DELIVERY_BRANCH = 'codex/c2-release-recipe-2026-09-19';

export function getDeliveryIdentity() {
  return {
    bundle: DELIVERY_BUNDLE,
    branch: DELIVERY_BRANCH,
    head: process.env.C2_DELIVERY_HEAD || null,
    tree: process.env.C2_DELIVERY_TREE || null,
  };
}

export function cleanCloneRecipe(targetId) {
  return [
    '# Verify the external ZIP hash and packet manifest before running these commands.',
    '# Run from the extracted delivery folder containing the bundle and DELIVERY-IDENTITY.json.',
    'set -e',
    `git clone --branch ${DELIVERY_BRANCH} ./${DELIVERY_BUNDLE} raven-worldsfair-2026`,
    'cd raven-worldsfair-2026',
    'git rev-parse HEAD',
    "git rev-parse 'HEAD^{tree}'",
    `node -e 'const fs=require("node:fs"),cp=require("node:child_process"),id=JSON.parse(fs.readFileSync("../DELIVERY-IDENTITY.json","utf8"));const head=cp.execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),tree=cp.execFileSync("git",["rev-parse","HEAD^{tree}"],{encoding:"utf8"}).trim();if(id.head!==head||id.tree!==tree||id.branch!=="${DELIVERY_BRANCH}"||id.bundle!=="${DELIVERY_BUNDLE}")throw Error("DELIVERY_IDENTITY_MISMATCH");'`,
    '# AUTHOR-REPORT.md beside the bundle records scope, checks and limitations.',
    'cd apps/raven-conformance',
    'npm test',
    `npm run conform -- --target ${targetId}`,
    '# BROKEN_SUBTLE intentionally returns exit 1 for V07/V08 divergence; reference returns 0.',
  ].join('\n');
}
