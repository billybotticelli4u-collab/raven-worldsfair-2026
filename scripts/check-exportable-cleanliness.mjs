#!/usr/bin/env node
/**
 * check-exportable-cleanliness.mjs
 *
 * CLAUDE-068: fail exportable artifacts that embed absolute filesystem paths.
 * Primary rule: absolute path strings generally (any path-like string beginning
 * with `/`), plus ~/ , $HOME, Windows drive paths, and legacy leak substrings.
 * Do NOT key primarily to /Users/ — /private/tmp and /var/folders must also fail.
 *
 * Allowlist FILE (--allowlist <FILE>): one entry per line.
 *   - blank lines and # comments ignored
 *   - exact match of the offending string, OR
 *   - prefix match when the entry ends with `/` (path-prefix allow)
 * No inline suppression comments.
 *
 * Usage:
 *   node scripts/check-exportable-cleanliness.mjs <dir-or-file> [...]
 *   node scripts/check-exportable-cleanliness.mjs --allowlist <FILE> <dir-or-file> [...]
 *
 * Exit 0 = clean. Exit 1 = leaks found. Exit 2 = usage/IO error.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEXT_EXT = new Set([
  ".json",
  ".md",
  ".txt",
  ".yaml",
  ".yml",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".html",
  ".htm",
  ".csv",
  ".tsv",
  ".xml",
  ".svg",
  ".css",
  ".map",
  ".toml",
  ".ini",
  ".env",
  ".sh",
  ".bash",
  ".zsh",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".sql",
  ".graphql",
  ".lock",
  ".npmrc",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".ndjson",
  ".log",
]);

const SKIP_DIR = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "coverage",
  ".turbo",
  ".cache",
]);

/** First path segments that are HTTP/app routes, not filesystem roots. */
const HTTP_ROUTE_ROOTS = new Set([
  "api",
  "health",
  "receipt",
  "worldsfair",
  "static",
  "assets",
  "pub",
  "public",
  "v1",
  "v2",
  "v3",
  "_next",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "index.html",
  "docs",
  "oauth",
  "auth",
  "login",
  "logout",
  "webhook",
  "webhooks",
  "graphql",
  "rpc",
  "rest",
  "cdn",
  "media",
  "img",
  "images",
  "css",
  "js",
  "fonts",
  "icon",
  "icons",
]);

/** Unix absolute roots that are always filesystem (CLAUDE-068 primary class). */
const FS_ROOTS = new Set([
  "Users",
  "home",
  "private",
  "var",
  "tmp",
  "opt",
  "etc",
  "usr",
  "workspace",
  "Volumes",
  "System",
  "Library",
  "Applications",
  "root",
  "sbin",
  "bin",
  "dev",
  "mnt",
  "media",
  "run",
  "srv",
  "data",
  "proc",
  "boot",
  "net",
]);

const WINDOWS_ABS_RE = /^[A-Za-z]:[\\/]/;
const TILDE_RE = /^~\//;
const HOME_ENV_RE = /^\$HOME(\/|$)/;
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function usage(msg) {
  if (msg) console.error(msg);
  console.error(
    "Usage: node scripts/check-exportable-cleanliness.mjs [--allowlist FILE] <dir-or-file> [...]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const targets = [];
  let allowlistPath = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--allowlist") {
      allowlistPath = argv[++i];
      if (!allowlistPath) usage("--allowlist requires a FILE");
      continue;
    }
    if (a === "--help" || a === "-h") usage();
    if (a.startsWith("-")) usage(`Unknown flag: ${a}`);
    targets.push(a);
  }
  if (targets.length === 0) usage("At least one directory or file is required");
  return { targets, allowlistPath };
}

function loadAllowlist(filePath) {
  if (!filePath) return { exact: new Set(), prefixes: [] };
  const text = fs.readFileSync(filePath, "utf8");
  const exact = new Set();
  const prefixes = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.endsWith("/") && line.length > 1) prefixes.push(line);
    else exact.add(line);
  }
  return { exact, prefixes };
}

function isAllowlisted(value, allow) {
  if (allow.exact.has(value)) return true;
  for (const p of allow.prefixes) {
    if (value.startsWith(p) || value === p.slice(0, -1)) return true;
  }
  return false;
}

/**
 * Return true if `s` looks like an absolute filesystem path (or home/Windows).
 * HTTP routes like /api/... are excluded unless they also match FS roots.
 */
function isAbsoluteFsPathLike(s) {
  if (typeof s !== "string" || s.length < 2) return false;

  if (TILDE_RE.test(s) || HOME_ENV_RE.test(s) || WINDOWS_ABS_RE.test(s)) {
    return true;
  }

  // URLs with schemes (https://, http://, data:, mailto:) — not FS paths.
  // file: URLs ARE treated as leaks (absolute path transport).
  if (URL_SCHEME_RE.test(s)) {
    if (/^file:/i.test(s)) return true;
    return false;
  }

  // JS/CSS comments begin with / but are not filesystem paths.
  if (s.startsWith("//") || s.startsWith("/*")) return false;

  if (!s.startsWith("/")) return false;

  // Single-segment like "/" or "/api" — route-ish unless FS root name.
  const trimmed = s.replace(/\/+$/, "") || "/";
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length === 0) return false;

  const first = parts[0];

  // Always flag known filesystem roots (incl. /private/tmp, /var/folders).
  if (FS_ROOTS.has(first)) return true;

  // Legacy leak substrings as absolute-path class (even mid-string handled below
  // via full-string start — primary is start-with-/ plus FS-like shape).
  if (
    s.startsWith("/Users/") ||
    s.startsWith("/home/") ||
    s.startsWith("/workspace/")
  ) {
    return true;
  }

  // Hostname-looking absolute path: /hostname.example.com/path
  if (
    parts.length >= 2 &&
    /^[A-Za-z0-9][A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(first)
  ) {
    return true;
  }

  // HTTP-ish first segment → not an FS path.
  if (HTTP_ROUTE_ROOTS.has(first)) return false;

  // Multi-segment absolute with a file-like basename or deep tree → FS-like.
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (/\.[A-Za-z0-9]{1,8}$/.test(last)) return true;
    if (parts.length >= 3) return true;
    // two segments, unknown root — treat as FS-like absolute (CLAUDE-068 prefer fail)
    return true;
  }

  // Single unknown segment "/something" — prefer not to flag (route-ish).
  return false;
}

/** Also scan plain text for embedded absolute paths (not only whole-line). */
const EMBEDDED_ABS_RE =
  /(?:^|[\s"'`=(,:\[{])(\/(?:Users|home|private|var|tmp|opt|etc|usr|workspace|Volumes|System|Library|Applications|root)\/[^\s"'`)\],;}{]+|~\/[^\s"'`)\],;}{]+|\$HOME\/[^\s"'`)\],;}{]+|[A-Za-z]:\\[^\s"'`)\],;}{]+)/g;

function collectFromString(value, fieldPath, hits, allow) {
  if (typeof value !== "string") return;

  if (isAbsoluteFsPathLike(value) && !isAllowlisted(value, allow)) {
    hits.push({ fieldPath, value });
    return;
  }

  // Whole-string didn't match; scan for embedded FS abs paths in prose/code.
  EMBEDDED_ABS_RE.lastIndex = 0;
  let m;
  while ((m = EMBEDDED_ABS_RE.exec(value)) !== null) {
    const offending = m[1];
    if (!isAllowlisted(offending, allow)) {
      hits.push({ fieldPath, value: offending });
    }
  }
}

function walkJson(value, fieldPath, hits, allow) {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    collectFromString(value, fieldPath || "(root)", hits, allow);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) =>
      walkJson(v, fieldPath ? `${fieldPath}[${i}]` : `[${i}]`, hits, allow),
    );
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const next = fieldPath ? `${fieldPath}.${k}` : k;
      walkJson(v, next, hits, allow);
    }
  }
}

function isTextishFile(filePath) {
  const base = path.basename(filePath);
  if (base === "Dockerfile" || base === "Makefile" || base.startsWith(".")) {
    // still scan common text dotfiles by extension/name
  }
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  if (!ext && /^(README|LICENSE|CHANGELOG|NOTICE|IDENTITY|SHA256SUMS|MANIFEST)/i.test(base))
    return true;
  // Skip obvious binaries
  const bin = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".zip",
    ".gz",
    ".tgz",
    ".bz2",
    ".xz",
    ".wasm",
    ".bin",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".o",
    ".a",
    ".class",
    ".jar",
    ".woff",
    ".woff2",
    ".ttf",
    ".eot",
    ".mp4",
    ".mp3",
    ".mov",
    ".webm",
    ".sqlite",
    ".db",
    ".bundle",
  ]);
  if (bin.has(ext)) return false;
  // Unknown extension: sniff for NUL
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(512);
    const n = fs.readSync(fd, buf, 0, 512, 0);
    fs.closeSync(fd);
    if (buf.subarray(0, n).includes(0)) return false;
    return n > 0;
  } catch {
    return false;
  }
}

function listFiles(target) {
  const st = fs.statSync(target);
  if (st.isFile()) return [target];
  if (!st.isDirectory()) return [];
  const out = [];
  const stack = [target];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (SKIP_DIR.has(ent.name)) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.isFile()) out.push(p);
    }
  }
  return out;
}

function scanFile(filePath, allow) {
  const hits = [];
  if (!isTextishFile(filePath)) return hits;
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    console.error(`READ_ERROR ${filePath}: ${e.message}`);
    return hits;
  }

  if (path.extname(filePath).toLowerCase() === ".json") {
    try {
      const data = JSON.parse(text);
      walkJson(data, "", hits, allow);
      return hits;
    } catch {
      // fall through to line scan
    }
  }

  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    collectFromString(line, `line ${idx + 1}`, hits, allow);
  });
  return hits;
}

function main() {
  const { targets, allowlistPath } = parseArgs(process.argv.slice(2));
  let allow;
  try {
    allow = loadAllowlist(allowlistPath);
  } catch (e) {
    usage(`Failed to read allowlist: ${e.message}`);
  }

  const allHits = [];
  for (const t of targets) {
    const abs = path.resolve(t);
    if (!fs.existsSync(abs)) {
      console.error(`NOT_FOUND: ${abs}`);
      process.exit(2);
    }
    for (const file of listFiles(abs)) {
      const hits = scanFile(file, allow);
      for (const h of hits) {
        allHits.push({ file, ...h });
      }
    }
  }

  if (allHits.length === 0) {
    console.log("exportable-cleanliness: OK (no absolute filesystem paths)");
    process.exit(0);
  }

  console.error("exportable-cleanliness: FAIL — absolute path leak(s) found");
  for (const h of allHits) {
    console.error(`file: ${h.file}`);
    console.error(`field: ${h.fieldPath}`);
    console.error(`value: ${h.value}`);
    console.error("---");
  }
  console.error(`total: ${allHits.length}`);
  process.exit(1);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) main();

export {
  isAbsoluteFsPathLike,
  loadAllowlist,
  isAllowlisted,
  walkJson,
  scanFile,
};
