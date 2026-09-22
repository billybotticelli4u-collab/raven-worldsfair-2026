import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { fetchSameOriginCredentialed, buildCredentialHeaders } from './lib/same-origin-credentialed-fetch.mjs';

const origin = new URL(process.argv[2]);
assert.ok(['http:', 'https:'].includes(origin.protocol));
const intendedOrigin = new URL(origin.origin + '/');
const cookie = process.env.VERIFY_JUDGE_COOKIE || "";
const bypass = process.env.VERIFY_JUDGE_PROTECTION_BYPASS || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "";
const credentialHeaders = buildCredentialHeaders({ cookie, bypass });
const headers = {
  // Non-credential headers only — bypass/cookie attached after same-origin check.
  // Suppress Vercel Live feedback.js HTML injection so public-file
  // fingerprints match built bytes (does not disable Deployment Protection).
  "x-vercel-skip-toolbar": "1",
};
const get = async route => {
 const response = await fetchSameOriginCredentialed(new URL(route, origin), {
   intendedOrigin,
   credentialHeaders,
   headers,
 });
 assert.equal(response.status, 200, `HTTP failure: ${route}`);
 return Buffer.from(await response.arrayBuffer());
};
const info = JSON.parse(await get('/api/build-info'));
assert.equal(info.publicFingerprint?.schema, 'raven-public-files/1');
assert.deepEqual(info.publicFingerprint.files.map(f => f.path), ['/app.js','/index.html','/styles.css']);
const hash = b => createHash('sha256').update(b).digest('hex');
for (const file of info.publicFingerprint.files) {
 const bytes = await get(file.path);
 assert.equal(bytes.length, file.bytes, file.path);
 assert.equal(hash(bytes), file.sha256, file.path);
}
assert.equal(hash(JSON.stringify(info.publicFingerprint.files) + '\n'), info.publicFingerprint.sha256);
console.log(JSON.stringify({status:'PUBLIC_FILES_MATCH', sha256:info.publicFingerprint.sha256,
 limitation:'Point-in-time consistency of three public files only. Does not authenticate source commit, backend, or server honesty.'},null,2));
