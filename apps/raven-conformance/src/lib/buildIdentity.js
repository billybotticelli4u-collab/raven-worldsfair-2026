import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const IDENTITY_LIMIT = 'Commit metadata is asserted, not proof that served bytes came from that commit. The fingerprint covers only the three public UI files, not backend code or deployment authenticity.';

export function publicFingerprint(appRoot) {
  const files = ['app.js', 'index.html', 'styles.css'].map(name => {
    const bytes = readFileSync(path.join(appRoot, 'public', name));
    return { path: '/' + name, bytes: bytes.length, sha256: sha256(bytes) };
  });
  return { schema: 'raven-public-files/1', files, sha256: sha256(JSON.stringify(files) + '\n') };
}

// Pure selection is shared by generation and serving. Shape validation is not authentication.
export function selectIdentity({ env = {}, gitCommit = null, generated = null } = {}) {
  const claims = [], warnings = [];
  const add = (source, value) => {
    if (value === undefined || value === null || value === '') return;
    if (typeof value !== 'string' || !/^[0-9a-fA-F]{40}$/.test(value)) {
      warnings.push('INVALID:' + source); return;
    }
    claims.push({ source, commit: value.toLowerCase() });
  };
  add('platform_asserted', env.VERCEL_GIT_COMMIT_SHA);
  add('git_checkout', gitCommit);
  add('generated_asserted', generated?.commit);
  add('operator_worldsfair', env.WORLDSFAIR_BUILD_COMMIT);
  add('operator_fair', env.FAIR_BUILD_COMMIT);
  const conflict = new Set(claims.map(c => c.commit)).size > 1;
  if (conflict) warnings.push('COMMIT_CLAIMS_DISAGREE');
  const selected = claims.find(c => !c.source.startsWith('operator_'));
  return {
    fairBuildCommit: selected?.commit ?? null,
    fairBuildBranch: null,
    commitSource: selected?.source ?? 'unavailable',
    identityStatus: conflict ? 'CONFLICT' : selected ? 'UNVERIFIED_ASSERTION' : 'UNKNOWN',
    identityClaims: claims, identityWarnings: warnings,
    identityLimit: IDENTITY_LIMIT,
  };
}

export function readIdentity(appRoot, { env = process.env, useGenerated = true } = {}) {
  let gitCommit = null, generated = null;
  const warnings = [];
  try { gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8', stdio: ['ignore','pipe','ignore'], timeout: 2000 }).trim(); } catch {}
  if (useGenerated) {
    try { generated = JSON.parse(readFileSync(path.join(appRoot, 'generated-build-info.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') warnings.push('GENERATED_UNREADABLE'); }
  }
  const info = selectIdentity({ env, gitCommit, generated });
  info.identityWarnings.push(...warnings);
  try {
    info.publicFingerprint = publicFingerprint(appRoot);
    if (generated?.publicFingerprint && generated.publicFingerprint.sha256 !== info.publicFingerprint.sha256) {
      info.identityWarnings.push('PUBLIC_FILES_CHANGED_SINCE_GENERATION');
      info.identityStatus = 'CONFLICT';
    }
  } catch { info.publicFingerprint = null; info.identityWarnings.push('PUBLIC_FILES_UNAVAILABLE'); }
  return info;
}
