/**
 * JSON normalisation for Replay adapter outputs.
 * Digests establish consistency, not publisher authentication.
 *
 * C4 design choice (bounded): **Option A — JSON data only at the case/hash API
 * boundary.** Native Map, Uint8Array (and other TypedArrays), and bigint are
 * REJECTED here. Adapters must emit JSON-ready plain data (the Kit adapter
 * already projects bytes to plain `{$type:"bytes",...}` objects). Plain JSON
 * objects that happen to spell `$type` tags are ordinary objects — there is no
 * native↔JSON lookalike collision because natives never enter canonicalisation.
 *
 * Policy (bound into cases via comparison_policy_sha256):
 * - Objects: sort keys recursively for digests; preserve every own enumerable string key
 *   (including "__proto__", "constructor", "prototype"). Ordinary {} plus defineProperty
 *   for "__proto__" so the key is retained (ordinary assignment would invoke the setter).
 * - Arrays: order-sensitive.
 * - Native Map / Uint8Array / bigint / ArrayBuffer views: rejected at this boundary.
 * - undefined / function / symbol / non-finite number: rejected (not silently dropped).
 * - null / boolean / string / finite number: JSON literals.
 * Excluded from decoded comparison when policy.exclude_fields lists dotted paths
 * (e.g. signatures map values) — exclusions must be named, never silent.
 */

export function normalizeValue(value, depth = 0) {
  if (depth > 32) throw new Error('Normalisation depth exceeded');
  if (value === null) return null;
  const t = typeof value;
  if (t === 'boolean' || t === 'string') return value;
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new Error('Non-finite number is not JSON-normalisable');
    return value;
  }
  if (t === 'bigint') {
    throw new Error('Native bigint refused at case/hash API boundary (C4 Option A — JSON data only); emit a plain object if needed');
  }
  if (t === 'undefined' || t === 'function' || t === 'symbol') {
    throw new Error('Value type not JSON-normalisable: ' + t);
  }
  if (value instanceof Uint8Array) {
    throw new Error('Native Uint8Array refused at case/hash API boundary (C4 Option A — JSON data only); emit {$type:"bytes",...} plain object');
  }
  if (ArrayBuffer.isView(value)) {
    throw new Error('Native ArrayBuffer view refused at case/hash API boundary (C4 Option A — JSON data only)');
  }
  if (Array.isArray(value)) return value.map((v) => normalizeValue(v, depth + 1));

  // Map before plain-object branch (Map prototype !== Object.prototype).
  if (value instanceof Map) {
    throw new Error('Native Map refused at case/hash API boundary (C4 Option A — JSON data only); emit a plain object if needed');
  }

  if (t === 'object') {
    const proto = Object.getPrototypeOf(value);
    // Accept ordinary objects and null-prototype objects only.
    if (proto !== Object.prototype && proto !== null) {
      throw new Error('Unsupported object prototype for normalisation');
    }
    // Ordinary object so isDeepStrictEqual matches JSON.parse round-trips.
    // Assign "__proto__" via defineProperty so it becomes an own data property
    // (ordinary o["__proto__"]= would invoke the prototype setter and drop the key).
    const o = {};
    for (const k of Object.keys(value).sort()) {
      const nv = normalizeValue(value[k], depth + 1);
      if (k === '__proto__') {
        Object.defineProperty(o, '__proto__', {
          value: nv, enumerable: true, writable: true, configurable: true,
        });
      } else {
        o[k] = nv;
      }
    }
    return o;
  }
  throw new Error('Unsupported value');
}

export function canonical(value) {
  const n = normalizeValue(value);
  return stringifyCanonical(n);
}

function stringifyCanonical(n) {
  if (n === null || typeof n === 'boolean' || typeof n === 'string') return JSON.stringify(n);
  if (typeof n === 'number') return JSON.stringify(n);
  if (Array.isArray(n)) return '[' + n.map(stringifyCanonical).join(',') + ']';
  if (n && typeof n === 'object') {
    return '{' + Object.keys(n).sort().map((k) => JSON.stringify(k) + ':' + stringifyCanonical(n[k])).join(',') + '}';
  }
  throw new Error('Canonical stringify failed');
}

export function omitPaths(value, paths) {
  if (!paths || paths.length === 0) return value;
  const clone = structuredClone(value);
  for (const p of paths) {
    const parts = p.split('.');
    let cur = clone;
    for (let i = 0; i < parts.length - 1; i++) {
      if (cur == null || typeof cur !== 'object') { cur = null; break; }
      cur = cur[parts[i]];
    }
    if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
  }
  return clone;
}
