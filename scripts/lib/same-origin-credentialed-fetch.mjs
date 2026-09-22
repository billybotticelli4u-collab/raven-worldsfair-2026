/**
 * Credentialed fetch that never forwards Cookie / protection-bypass
 * across an origin change. Redirects are followed manually and only
 * when Location stays on the intended origin; credentials are attached
 * only after the request URL origin is validated against intendedOrigin.
 */
export function originsEqual(a, b) {
  return a.protocol === b.protocol && a.hostname === b.hostname && String(a.port || defaultPort(a)) === String(b.port || defaultPort(b));
}

function defaultPort(u) {
  if (u.port) return u.port;
  return u.protocol === "https:" ? "443" : "80";
}

export function buildCredentialHeaders({ cookie, bypass, extra } = {}) {
  return {
    ...(cookie ? { cookie } : {}),
    ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
    ...(extra || {}),
  };
}

/**
 * @param {string|URL} url
 * @param {object} opts
 * @param {URL} opts.intendedOrigin - deployment origin credentials may target
 * @param {Record<string,string>} [opts.credentialHeaders] - cookie/bypass only
 * @param {Record<string,string>} [opts.headers] - non-credential headers (always sent)
 * @param {number} [opts.maxRedirects=5]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {AbortSignal} [opts.signal]
 */
export async function fetchSameOriginCredentialed(url, opts) {
  let {
    intendedOrigin,
    credentialHeaders = {},
    headers = {},
    maxRedirects = 5,
    fetchImpl = fetch,
    signal,
    method,
    body,
    redirect, // ignored — always manual
    ...rest
  } = opts;
  if (!intendedOrigin || typeof intendedOrigin.href !== "string") {
    throw new Error("intendedOrigin required");
  }
  let current = new URL(String(url));
  if (!originsEqual(current, intendedOrigin)) {
    throw new Error(
      `refusing credentialed request: url origin ${current.origin} != intended ${intendedOrigin.origin}`,
    );
  }
  let redirects = 0;
  while (true) {
    const creds = originsEqual(current, intendedOrigin) ? credentialHeaders : {};
    // Defense in depth: never attach creds if origin drifted.
    const requestHeaders = { ...headers, ...creds };
    const res = await fetchImpl(current, {
      ...rest,
      method,
      body,
      signal,
      headers: requestHeaders,
      redirect: "manual",
    });
    const status = res.status;
    if (status >= 300 && status < 400) {
      const loc = res.headers.get("location");
      if (!loc) {
        throw new Error(`redirect ${status} without Location from ${current.href}`);
      }
      const next = new URL(loc, current);
      if (!originsEqual(next, intendedOrigin)) {
        throw new Error(
          `refusing cross-origin redirect ${current.origin} -> ${next.origin} (credentials not forwarded)`,
        );
      }
      redirects += 1;
      if (redirects > maxRedirects) {
        throw new Error(`too many same-origin redirects (>${maxRedirects})`);
      }
      current = next;
      // 303 switches to GET; 301/302 historically may; keep body only for 307/308
      if (status === 303 || ((status === 301 || status === 302) && method && method !== "GET" && method !== "HEAD")) {
        method = "GET";
        body = undefined;
      }
      continue;
    }
    return res;
  }
}
