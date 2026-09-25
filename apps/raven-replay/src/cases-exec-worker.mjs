// Fixed-argv execution worker (forked by cases-server). No shell. No user paths.
// Parent sets RAVEN_OWNED_REGISTRY + NODE_OPTIONS --import adapter-observe-hook.mjs
// so CJS child_process is patched before this module and before the vendored SDK
// imports spawnSync. Vendor bytes are never edited.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const legacy = await import(pathToFileURL(path.join(here, 'cases.mjs')).href);
const sdkCases = await import(pathToFileURL(path.join(here, '../vendor/raven-replay-parser-sdk/src/cases.mjs')).href);

function fail(kind, message) {
  return { ok: false, kind, message };
}

function restoreRefs(refs) {
  if (refs === undefined) return undefined;
  if (!Array.isArray(refs)) return refs;
  return refs.map(r => r === null ? undefined : r);
}

async function handle(msg) {
  const { op, payload } = msg;
  try {
    if (op === 'create-legacy') {
      return { ok: true, data: legacy.createCase(payload.input_base64, { name: payload.name }) };
    }
    if (op === 'create-sdk') {
      return { ok: true, data: sdkCases.createCase(payload.input_base64, { name: payload.name, adapterId: payload.adapter_id }) };
    }
    if (op === 'run-legacy') {
      return { ok: true, data: legacy.runCases(payload.cases, { expectedCaseSha256s: restoreRefs(payload.expectedCaseSha256s) }) };
    }
    if (op === 'run-sdk') {
      return {
        ok: true,
        data: sdkCases.runCases(payload.cases, {
          expectedCaseSha256s: restoreRefs(payload.expectedCaseSha256s),
          detailed: Boolean(payload.detailed),
        }),
      };
    }
    return fail('REQUEST', 'Unknown worker op');
  } catch (error) {
    const kind = error?.kind === 'INVALID_CASE' || error?.kind === 'RUN_ERROR' ? error.kind : 'RUN_ERROR';
    return fail(kind, error?.message || 'Worker execution failure');
  }
}

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object' || msg.type !== 'exec') return;
  const result = await handle(msg);
  try { process.send({ type: 'result', id: msg.id, ...result }); }
  catch { /* parent gone */ }
});

process.send({ type: 'ready' });
