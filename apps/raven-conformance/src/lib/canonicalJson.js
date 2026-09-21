/** Deterministic JSON: sorted keys, no whitespace. Matches verify-js discipline. */
export class CanonicalJsonError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CanonicalJsonError';
  }
}

export function canonicalJson(value) {
  const seen = new WeakSet();
  const enc = (v) => {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'string') return JSON.stringify(v);
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'number') {
      if (!Number.isFinite(v)) throw new CanonicalJsonError('non-finite number');
      return JSON.stringify(v);
    }
    if (t === 'bigint') throw new CanonicalJsonError('bigint');
    if (t === 'undefined' || t === 'function' || t === 'symbol') {
      throw new CanonicalJsonError(`unsupported ${t}`);
    }
    if (Array.isArray(v)) {
      if (seen.has(v)) throw new CanonicalJsonError('cycle');
      seen.add(v);
      const body = v.map(enc).join(',');
      seen.delete(v);
      return `[${body}]`;
    }
    const obj = v;
    if (seen.has(obj)) throw new CanonicalJsonError('cycle');
    seen.add(obj);
    const parts = [];
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${enc(obj[key])}`);
    }
    seen.delete(obj);
    return `{${parts.join(',')}}`;
  };
  return enc(value);
}
