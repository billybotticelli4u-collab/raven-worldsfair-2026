import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readIdentity } from './lib/buildIdentity.js';
const appRoot = fileURLToPath(new URL('..', import.meta.url));
const info = readIdentity(appRoot, { useGenerated: false });
const out = { commit: info.fairBuildCommit, source: info.commitSource,
  identityStatus: info.identityStatus, identityClaims: info.identityClaims,
  identityWarnings: info.identityWarnings, publicFingerprint: info.publicFingerprint,
  writtenAt: new Date().toISOString() };
writeFileSync(path.join(appRoot, 'generated-build-info.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
