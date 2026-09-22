import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

export const HTTP_LIMITS = Object.freeze({ bodyBytes: 65536, bodyTimeoutMs: 5000, minTargetTimeoutMs: 100, maxTargetTimeoutMs: 10000 });

export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

// Count received bytes as well as Content-Length; chunked bodies have no length header.
export function readJsonObject(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    const timer = setTimeout(() => fail(new HttpError(408, 'request_timeout')), HTTP_LIMITS.bodyTimeoutMs);
    timer.unref();
    function cleanup() {
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', aborted);
    }
    function fail(err) { cleanup(); req.pause(); reject(err); }
    function data(chunk) {
      size += chunk.length;
      if (size > HTTP_LIMITS.bodyBytes) return fail(new HttpError(413, 'request_too_large'));
      chunks.push(chunk);
    }
    function end() {
      cleanup();
      let body;
      try { body = JSON.parse(Buffer.concat(chunks, size).toString('utf8') || '{}'); }
      catch { reject(new HttpError(400, 'invalid_json')); return; }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        reject(new HttpError(400, 'invalid_request')); return;
      }
      resolve(body);
    }
    function error() { fail(new HttpError(400, 'request_aborted')); }
    function aborted() { error(); }
    if (Number(req.headers['content-length']) > HTTP_LIMITS.bodyBytes) {
      fail(new HttpError(413, 'request_too_large')); return;
    }
    req.on('data', data); req.once('end', end); req.once('error', error); req.once('aborted', aborted);
  });
}

export function validateRunOptions(body) {
  if (body.profile !== undefined && (typeof body.profile !== 'string' || body.profile.length < 1 || body.profile.length > 128)) {
    throw new HttpError(400, 'invalid_profile');
  }
  if (body.run_id !== undefined && (typeof body.run_id !== 'string' || !/^run_[A-Za-z0-9]{1,64}$/.test(body.run_id))) {
    throw new HttpError(400, 'invalid_run_id');
  }
  if (body.timeout_ms !== undefined && (!Number.isInteger(body.timeout_ms) || body.timeout_ms < HTTP_LIMITS.minTargetTimeoutMs || body.timeout_ms > HTTP_LIMITS.maxTargetTimeoutMs)) {
    throw new HttpError(400, 'invalid_timeout');
  }
}

export function decodeId(raw) {
  try { return decodeURIComponent(raw); }
  catch { throw new HttpError(400, 'invalid_path_encoding'); }
}

// Read-only local app assets, never adjacent directories, directories or symlinks.
// The app's own files remain trusted; this is not protection against a local writer.
export function containedFile(root, file) {
  try {
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
    if (!lstatSync(file).isFile()) return false;
    const actual = path.relative(realpathSync(root), realpathSync(file));
    return actual !== '..' && !actual.startsWith(`..${path.sep}`) && !path.isAbsolute(actual);
  } catch { return false; }
}

export function localReplayPath(appRoot, input) {
  if (typeof input !== 'string' || input.length > 4096 || input.includes('\0')) throw new HttpError(400, 'invalid_report_path');
  const file = path.resolve(appRoot, input);
  const roots = ['reports', 'examples'].map(name => path.join(appRoot, name));
  if (path.extname(file) !== '.json' || !roots.some(root => path.dirname(file) === root && containedFile(root, file))) {
    throw new HttpError(400, 'invalid_report_path');
  }
  return file;
}
