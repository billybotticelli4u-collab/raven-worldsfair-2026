/** Minimal loopback-only HTTP helpers for the live exchange. */
import http from "node:http";
import {
  DEFAULT_HTTP_TIMEOUT_MS,
  LOOPBACK_HOST,
  MAX_BODY_BYTES,
} from "./constants.js";

/**
 * Listen on 127.0.0.1. The HOST is not configurable. The port is: explicit
 * `port` argument, else env RAVEN_LIVE_PORT, else 0 (ephemeral).
 */
export function resolvePort(port) {
  const raw = port ?? process.env.RAVEN_LIVE_PORT ?? 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error("port_invalid");
  return n;
}

export function listenLoopback(handler, port) {
  const listenPort = resolvePort(port);
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, LOOPBACK_HOST, () => {
      const addr = server.address();
      if (!addr || typeof addr !== "object" || addr.address !== LOOPBACK_HOST) {
        server.close();
        reject(new Error("not_bound_to_loopback"));
        return;
      }
      resolve({
        server,
        url: `http://${LOOPBACK_HOST}:${addr.port}`,
        port: addr.port,
        close: () => closeServer(server),
      });
    });
  });
}

export function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

export async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("body_too_large");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw === "") return {};
  return JSON.parse(raw);
}

/** True only for http://127.0.0.1:<port>/... URLs. */
export function isLoopbackUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" && u.hostname === LOOPBACK_HOST && u.port !== "" &&
      u.username === "" && u.password === "";
  } catch {
    return false;
  }
}

/**
 * POST/GET JSON to a loopback peer. Refuses non-loopback targets, follows no
 * redirects, caps the response size and time.
 */
export async function loopbackJson(url, { method = "GET", body, timeoutMs = DEFAULT_HTTP_TIMEOUT_MS } = {}) {
  if (!isLoopbackUrl(url)) throw new Error("non_loopback_target_refused");
  const res = await fetch(url, {
    method,
    redirect: "error",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new Error("response_too_large");
  let json = null;
  try {
    json = text === "" ? null : JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
}
