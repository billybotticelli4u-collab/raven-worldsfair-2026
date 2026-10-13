/** Local presentation layer: use existing engines and policies, with no new verdict. */
import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runConformance, loadProfile, loadCorpus, loadDemoTargets } from '../raven-conformance/src/lib/runner.js';
import { adaptReport } from '../raven-conformance/src/lib/displayAdapter.js';
import { containedFile, HttpError, readJsonObject } from '../raven-conformance/src/lib/httpBoundary.js';
import { runVerticalSlice } from '../worldsfair-agent-trust/src/lib/runSlice.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PROFILE = 'raven-solana-txversion-experimental/0';
const PATHS = ['path_a_verified', 'path_b_tampered', 'path_b_wrong_subject', 'path_b_missing', 'path_b_exception'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };

export function assertRuntime(version = process.versions.node) {
  if (version !== '22.18.0') throw new Error('This local review candidate requires Node 22.18.0.');
}

function json(res, status, data) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

export function createOnboardingServer() {
  let active = null, activeDone = Promise.resolve(), closing = null;
  const connections = new Set();
  const server = http.createServer(async (req, res) => {
    const authority = `127.0.0.1:${server.address()?.port}`;
    // A local-only app must not accept cross-site mutations or DNS-rebinding hosts.
    if (req.headers.host !== authority) return json(res, 403, { error: 'loopback_host_required' });
    const origin = `http://${authority}`;
    if (req.method === 'POST' && (req.headers.origin && req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site')) {
      return json(res, 403, { error: 'same_origin_required' });
    }
    try {
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/api/setup') {
        const profile = loadProfile(PROFILE), corpus = loadCorpus(PROFILE);
        return json(res, 200, { profile: { id: PROFILE, version: profile.data.version, sha256: profile.digest }, corpus: { id: corpus.data.id, count: corpus.data.vectors.length, sha256: corpus.digest }, targets: loadDemoTargets(PROFILE).map(({ id, name }) => ({ id, name })), receiptPaths: PATHS });
      }
      if (req.method === 'POST' && ['/api/conformance', '/api/receipt'].includes(url.pathname)) {
        const body = await readJsonObject(req);
        if (closing) throw new HttpError(503, 'server_shutting_down');
        const key = url.pathname === '/api/conformance' ? 'target' : 'path';
        const allow = key === 'target' ? loadDemoTargets(PROFILE).map(t => t.id) : PATHS;
        if (Object.keys(body).length !== 1 || !allow.includes(body[key])) return json(res, 400, { error: 'choose_a_listed_example' });
        if (active) return json(res, 409, { error: 'run_in_progress' });
        const controller = new AbortController();
        active = controller;
        let settled;
        activeDone = new Promise(resolve => { settled = resolve; });
        const disconnected = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', disconnected);
        try {
          if (key === 'target') {
            const report = await runConformance(body.target, { profile: PROFILE, write: false, signal: controller.signal });
            const adapted = adaptReport(report, loadProfile(PROFILE).data);
            if (!adapted.ok) throw new Error(`report_display_refused:${adapted.reason}`);
            if (!res.destroyed) json(res, 200, { report, display: adapted.display });
          } else {
            const result = await runVerticalSlice(body.path);
            if (!res.destroyed) json(res, 200, result);
          }
        } finally {
          res.off('close', disconnected);
          active = null;
          settled();
        }
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method_not_allowed' });
      let root = path.join(ROOT, 'public');
      let name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      if (name.startsWith('/kit/')) { root = path.resolve(ROOT, '../kit-compare'); name = name.slice(4); }
      const file = path.resolve(root, `.${name}`);
      if (!containedFile(root, file)) return json(res, 404, { error: 'not_found' });
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
      res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.code : 'run_failed', message: String(error.message) });
    }
  });
  server.on('connection', socket => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.closeOnboarding = () => {
    if (closing) return closing;
    // Stop unfinished HTTP clients too, then await the engine's own abort cleanup.
    let closed;
    closing = new Promise(resolve => { closed = resolve; });
    const done = activeDone;
    active?.abort();
    server.close(closed);
    for (const socket of connections) socket.destroy();
    closing = Promise.all([closing, done]).then(() => undefined);
    return closing;
  };
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { assertRuntime(); } catch (error) { console.error(error.message); process.exit(2); }
  const port = Number(process.env.PORT || 8790);
  if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error('Invalid local port.'); process.exit(2); }
  const server = createOnboardingServer();
  server.once('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Raven local onboarding: http://127.0.0.1:${server.address().port}`));
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await server.closeOnboarding();
  });
}
