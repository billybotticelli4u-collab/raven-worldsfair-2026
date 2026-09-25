import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha } from './binding.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY_PATH = path.join(ROOT, 'adapters', 'registry.json');

export function packageRoot() { return ROOT; }

export function loadRegistry() {
  const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
  const reg = JSON.parse(raw);
  if (reg.schema !== 'raven-replay-adapter-registry/1') throw new Error('Unsupported registry schema');
  if (!Array.isArray(reg.adapters)) throw new Error('Registry adapters must be an array');
  return reg;
}

export function getAdapter(adapterId) {
  const reg = loadRegistry();
  const entry = reg.adapters.find((a) => a.id === adapterId);
  if (!entry) return null;
  // Entry may only name a relative path under adapters/; never absolute or .. escape.
  if (typeof entry.entrypoint !== 'string' || entry.entrypoint.includes('..') || path.isAbsolute(entry.entrypoint)) {
    throw new Error('Adapter entrypoint must be a relative path under adapters/');
  }
  const full = path.resolve(ROOT, 'adapters', entry.entrypoint);
  const adaptersRoot = path.resolve(ROOT, 'adapters') + path.sep;
  if (!full.startsWith(adaptersRoot) && full !== path.resolve(ROOT, 'adapters')) {
    throw new Error('Adapter entrypoint escapes adapters/');
  }
  if (!fs.existsSync(full)) throw new Error('Adapter entrypoint missing: ' + entry.entrypoint);
  const source_sha256 = sha(fs.readFileSync(full));
  return { ...entry, entrypoint_abs: full, source_sha256, registry_path: REGISTRY_PATH };
}

export function listAdapters() {
  return loadRegistry().adapters.map((a) => ({ id: a.id, label: a.label, output_contract: a.output_contract }));
}
