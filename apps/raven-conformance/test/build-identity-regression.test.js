import test from 'node:test';
import assert from 'node:assert/strict';
import { readBuildInfo } from '../src/lib/buildInfo.js';
test('operator assertion cannot override platform identity; disagreement is visible', () => {
 const names = ['VERCEL_GIT_COMMIT_SHA','WORLDSFAIR_BUILD_COMMIT','WORLDSFAIR_BUILD_BRANCH'];
 const saved = names.map(k => process.env[k]);
 try {
  process.env.VERCEL_GIT_COMMIT_SHA = 'b'.repeat(40);
  process.env.WORLDSFAIR_BUILD_COMMIT = 'a'.repeat(40);
  process.env.WORLDSFAIR_BUILD_BRANCH = 'invented-branch';
  const info = readBuildInfo();
  assert.equal(info.fairBuildCommit, 'b'.repeat(40));
  assert.equal(info.commitSource, 'platform_asserted');
  assert.equal(info.identityStatus, 'CONFLICT');
  assert.equal(info.fairBuildBranch, null);
 } finally { names.forEach((k,i) => saved[i] === undefined ? delete process.env[k] : process.env[k] = saved[i]); }
});
test('malformed operator input is not served as a commit', () => {
 const saved = process.env.WORLDSFAIR_BUILD_COMMIT;
 try {
  process.env.WORLDSFAIR_BUILD_COMMIT = '<not-a-commit>';
  const info = readBuildInfo();
  assert.notEqual(info.fairBuildCommit, '<not-a-commit>');
  assert.ok(info.identityWarnings.includes('INVALID:operator_worldsfair'));
 } finally { saved === undefined ? delete process.env.WORLDSFAIR_BUILD_COMMIT : process.env.WORLDSFAIR_BUILD_COMMIT = saved; }
});

import { selectIdentity, publicFingerprint, readIdentity } from '../src/lib/buildIdentity.js';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
test('operator-only assertion stays unknown; malformed platform falls through with warning', () => {
 const operator = selectIdentity({env: {WORLDSFAIR_BUILD_COMMIT: 'a'.repeat(40)}});
 assert.equal(operator.fairBuildCommit, null);
 assert.equal(operator.identityStatus, 'UNKNOWN');
 assert.deepEqual(operator.identityClaims, [{source:'operator_worldsfair',commit:'a'.repeat(40)}]);
 const fallback = selectIdentity({env:{VERCEL_GIT_COMMIT_SHA:'bad'},gitCommit:'b'.repeat(40)});
 assert.equal(fallback.commitSource,'git_checkout');
 assert.ok(fallback.identityWarnings.includes('INVALID:platform_asserted'));
});
test('matching claims are still not authenticated; stale generated commit conflicts', () => {
 const matched = selectIdentity({env:{VERCEL_GIT_COMMIT_SHA:'b'.repeat(40)},gitCommit:'b'.repeat(40)});
 assert.equal(matched.identityStatus,'UNVERIFIED_ASSERTION');
 assert.equal(selectIdentity({gitCommit:'b'.repeat(40),generated:{commit:'c'.repeat(40)}}).identityStatus,'CONFLICT');
});
test('public fingerprint is independently recomputable and detects a changed UI file', () => {
 const dir=mkdtempSync(path.join(tmpdir(),'raven-build-id-'));
 try {
  mkdirSync(path.join(dir,'public'));
  for(const file of ['app.js','index.html','styles.css']) writeFileSync(path.join(dir,'public',file),file);
  const before=publicFingerprint(dir);
  const hash=b=>createHash('sha256').update(b).digest('hex');
  for(const entry of before.files) assert.equal(entry.sha256,hash(readFileSync(path.join(dir,'public',entry.path))));
  assert.equal(before.sha256,hash(JSON.stringify(before.files)+'\n'));
  writeFileSync(path.join(dir,'generated-build-info.json'),JSON.stringify({commit:'b'.repeat(40),publicFingerprint:before}));
  assert.equal(readIdentity(dir,{env:{}}).commitSource,'generated_asserted');
  writeFileSync(path.join(dir,'public/app.js'),'changed');
  assert.notEqual(publicFingerprint(dir).sha256,before.sha256);
  assert.ok(readIdentity(dir,{env:{}}).identityWarnings.includes('PUBLIC_FILES_CHANGED_SINCE_GENERATION'));
 } finally {rmSync(dir,{recursive:true,force:true});}
});
