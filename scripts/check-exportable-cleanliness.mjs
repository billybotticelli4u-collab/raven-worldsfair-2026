#!/usr/bin/env node
/**
 * check-exportable-cleanliness.mjs
 *
 * CLAUDE-068 + CLAUDE-072 adversarial hardening (Billy implements; KIMI reviews).
 * Fail exportable artifacts that embed absolute filesystem paths.
 *
 * ============================================================================
 * SPEC (NORMATIVE where marked; else NON-NORMATIVE / PROPOSED)
 * ============================================================================
 *
 * Exit codes:
 *   0 = clean
 *   1 = absolute-path leak(s) found
 *   2 = usage / IO error
 *   3 = symlink refuse (O1): scan target contained a symlink; never silently skip
 *
 * Allowlist FILE (--allowlist <FILE>): one entry per line.
 *   - blank lines and # comments ignored
 *   - exact match of the RESOLVED offending string, OR
 *   - prefix match when the entry ends with `/` (matched against RESOLVED path)
 * No inline suppression comments.
 * Allowlist NEVER overrides home-identity (B1 raw-string identity check).
 *
 * B1 TWO INDEPENDENT CHECKS (NORMATIVE):
 *   (i)  resolved-path check — lexically normalise `.` and `..` (NEVER touch the
 *        filesystem; strings may come from other machines) and match allowlist
 *        against the RESOLVED value only.
 *   (ii) raw-string identity check — home-directory and username-bearing segments
 *        fail REGARDLESS of where they resolve, and are never allowlistable.
 *        Covers reverse-traversal that resolves INTO an allowlisted sandbox while
 *        the raw string still discloses a home path.
 *
 * B2 (NORMATIVE): walkJson visits object KEYS as well as values (path-keyed maps).
 *
 * O1 symlinks (NORMATIVE choice): REFUSE with exit 3, listing the symlink path.
 *     Do not follow; do not skip silently. (Alternative "follow and scan target"
 *     rejected for exportable cleanliness — following would bind to local FS of
 *     the scan host, which is the wrong machine for cross-host artifacts.)
 *
 * O2 case-insensitivity: home-identity and known FS roots matched case-insensitively
 *     (APFS / Windows reality). Mixed-case `/uSeRs/rObY/...` must fail.
 *
 * O3 base64 / encodings: OUT OF SCOPE (NON-NORMATIVE known blind spot). Opaque
 *     base64/hex blobs are not decoded. Documented by a corpus vector that is
 *     expected to PASS (exit 0) despite encoding a home path — intentional gap.
 *
 * O4 Windows / URL: `C:/x`, `C:\x`, UNC `\\server\share`, `file:///` URLs are
 *     treated as absolute filesystem path transport and subject to B1 (i)+(ii).
 *
 * Usage:
 *   node scripts/check-exportable-cleanliness.mjs <dir-or-file> [...]
 *   node scripts/check-exportable-cleanliness.mjs --allowlist <FILE> <dir-or-file> [...]
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
  "users",
  "home",
  "private",
  "var",
  "tmp",
  "opt",
  "etc",
  "usr",
  "workspace",
  "volumes",
  "system",
  "library",
  "applications",
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
const UNC_RE = /^\\\\[^\\\/]+[\\/]/;
const TILDE_RE = /^~[\\/]/;
const HOME_ENV_RE = /^\$HOME([\\/]|$)/i;
const USERPROFILE_RE = /%USERPROFILE%/i;
const HOMEPATH_RE = /%HOMEPATH%/i;
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** Home-root prefixes that carry username identity — never allowlistable (B1-ii).
 * Username token: non-empty, no whitespace (avoids prose false-positives like
 * "no /Users/ present" in fixture notes).
 */
const HOME_ROOT_RE =
  /(?:^|[\\/\s"'`=(,:\[{])(?:Users|home)[\\/]([^\\/\s]+)(?=[\\/\s"'`)\],;}{]|$)/i;
const WIN_USERS_RE =
  /(?:^|[\\/\s"'`=(,:\[{])Users[\\/]([^\\/\s]+)(?=[\\/\s"'`)\],;}{]|$)/i;

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
    // Store lexically-resolved allowlist entries so prefix glue cannot hide.
    const resolved = lexicalResolve(line);
    if (line.endsWith("/") && line.length > 1) {
      const p = resolved.endsWith("/") ? resolved : resolved + "/";
      prefixes.push(p);
    } else {
      exact.add(resolved);
      // Also keep raw-trimmed exact for non-path allow entries (defensive).
      exact.add(line);
    }
  }
  return { exact, prefixes };
}

/**
 * Allowlist match applies to RESOLVED values only (B1-i).
 * Home-identity strings must never reach here as "allowed".
 */
function isAllowlisted(value, allow) {
  if (allow.exact.has(value)) return true;
  for (const p of allow.prefixes) {
    if (value.startsWith(p) || value === p.slice(0, -1)) return true;
  }
  return false;
}

/**
 * Decode common path obfuscations once (URL percent-encoding of . and /).
 * Does NOT decode base64 (O3 out of scope).
 */
function decodePathObfuscations(s) {
  let out = s;
  // Repeat a few times for double-encoding of dots/slashes only.
  for (let i = 0; i < 3; i++) {
    const next = out.replace(/%2e/gi, ".").replace(/%2f/gi, "/").replace(/%5c/gi, "\\");
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Lexical resolve: split on `/` and `\`, process `.` / `..`, NEVER touch FS.
 * Preserves a leading absolute marker (`/` or `C:` or UNC).
 */
function lexicalResolve(input) {
  if (typeof input !== "string" || input.length === 0) return input;

  let s = decodePathObfuscations(input);

  // file: URL → path portion
  if (/^file:/i.test(s)) {
    try {
      const u = new URL(s);
      // URL pathname is already percent-decoded by URL parser
      s = u.pathname || s;
      // Windows file:///C:/Users/... → /C:/Users/... — normalise
      if (/^\/[A-Za-z]:\//.test(s)) s = s.slice(1);
    } catch {
      s = s.replace(/^file:\/\//i, "").replace(/^file:/i, "");
    }
  }

  // UNC: \\server\share or //server/share — host must be hostname-like (no spaces).
  // Do NOT treat JS comments "// foo" as UNC.
  const isUnc =
    /^\\\\[^\\\/\s]+[\\\/]/.test(s) ||
    /^\/\/[^\/\s]+\//.test(s);
  const winDrive = s.match(/^([A-Za-z]:)[\\/]/);
  const isAbsUnix = s.startsWith("/");

  // Tokenise on any slash run (keeps empty segments visible then drops empties
  // except we collapse // interior empties like path.normalize lexical).
  const rawParts = s.split(/[\\/]+/);
  const stack = [];

  let prefix = "";
  if (isUnc) {
    // \\server\share\rest — keep server/share as immutable prefix
    // rawParts[0] may be "" for leading \\
    const parts = rawParts.filter((p, idx) => !(idx === 0 && p === ""));
    if (parts.length >= 2) {
      prefix = "\\\\" + parts[0] + "\\" + parts[1];
      for (let i = 2; i < parts.length; i++) {
        const p = parts[i];
        if (p === "" || p === ".") continue;
        if (p === "..") {
          if (stack.length) stack.pop();
          continue;
        }
        stack.push(p);
      }
      return stack.length ? prefix + "\\" + stack.join("\\") : prefix;
    }
  }

  if (winDrive) {
    prefix = winDrive[1];
    // drop drive token from parts
    if (rawParts[0] && /^[A-Za-z]:$/.test(rawParts[0])) {
      rawParts.shift();
    } else if (rawParts[0] && /^[A-Za-z]:/.test(rawParts[0])) {
      rawParts[0] = rawParts[0].slice(2);
      if (rawParts[0] === "") rawParts.shift();
    }
  }

  for (const p of rawParts) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (stack.length) stack.pop();
      // If absolute, cannot climb above root; if relative, keep ".."
      else if (!isAbsUnix && !winDrive && !isUnc) stack.push("..");
      continue;
    }
    stack.push(p);
  }

  if (winDrive) {
    return prefix + "\\" + stack.join("\\");
  }
  if (isAbsUnix) {
    return "/" + stack.join("/");
  }
  return stack.join("/") || ".";
}

/**
 * B1-(ii): home / username identity in a string — NEVER allowlistable.
 * Checked on RAW and on RESOLVED forms (and Unicode-normalised variants).
 */
function hasHomeIdentity(s) {
  if (typeof s !== "string" || s.length < 2) return false;

  const forms = [s];
  try {
    forms.push(s.normalize("NFC"), s.normalize("NFD"), s.normalize("NFKC"));
  } catch {
    /* ignore */
  }

  for (const form of forms) {
    if (TILDE_RE.test(form) || /(^|[\s"'`=(,:\[{])~\//.test(form)) return true;
    if (HOME_ENV_RE.test(form) || /\$HOME[\\/]/i.test(form)) return true;
    if (USERPROFILE_RE.test(form) || HOMEPATH_RE.test(form)) return true;
    if (HOME_ROOT_RE.test(form)) return true;
    if (WIN_USERS_RE.test(form)) return true;
    // Explicit home roots with username (also Windows backslash form)
    if (/\/Users\/[^\\/\s]+/i.test(form) || /\/home\/[^\\/\s]+/i.test(form)) return true;
    if (/\\Users\\[^\\/\s]+/i.test(form)) return true;
  }
  return false;
}

/**
 * Return true if `s` looks like an absolute filesystem path (or home/Windows).
 * HTTP routes like /api/... are excluded unless they also match FS roots.
 */
function isAbsoluteFsPathLike(s) {
  if (typeof s !== "string" || s.length < 2) return false;

  if (TILDE_RE.test(s) || HOME_ENV_RE.test(s) || WINDOWS_ABS_RE.test(s) || UNC_RE.test(s)) {
    return true;
  }
  // forward-slash UNC lookalike //server/share
  if (/^\/\/[^\/\s]+\//.test(s)) return true;

  // URLs with schemes (https://, http://, data:, mailto:) — not FS paths.
  // file: URLs ARE treated as leaks (absolute path transport).
  if (URL_SCHEME_RE.test(s)) {
    if (/^file:/i.test(s)) return true;
    return false;
  }

  // JS/CSS comments begin with / but are not filesystem paths.
  if (s.startsWith("//") || s.startsWith("/*")) return false;

  if (!s.startsWith("/")) return false;

  const trimmed = s.replace(/\/+$/, "") || "/";
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length === 0) return false;

  const first = parts[0];
  const firstLower = first.toLowerCase();

  // Always flag known filesystem roots (case-insensitive; O2).
  if (FS_ROOTS.has(firstLower)) return true;

  if (
    /^users$/i.test(first) ||
    /^home$/i.test(first) ||
    /^workspace$/i.test(first)
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
  if (HTTP_ROUTE_ROOTS.has(firstLower) || HTTP_ROUTE_ROOTS.has(first)) return false;

  // Multi-segment absolute with a file-like basename or deep tree → FS-like.
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (/\.[A-Za-z0-9]{1,8}$/.test(last)) return true;
    if (parts.length >= 3) return true;
    return true;
  }

  return false;
}

/**
 * Evaluate one candidate string under B1 (i)+(ii).
 * Returns true if a hit was recorded.
 */
function evaluateCandidate(value, fieldPath, hits, allow) {
  if (typeof value !== "string" || value.length < 1) return false;

  // JS/CSS comments are not filesystem paths.
  // Line comment: "//" then space/EOL. Do NOT skip UNC "//server/share/...".
  const trimmedLead = value.trimStart();
  if (/^\/\/(\s|$)/.test(trimmedLead) || trimmedLead.startsWith("/*")) return false;

  // B1-(ii) raw identity — never allowlistable
  if (hasHomeIdentity(value)) {
    hits.push({ fieldPath, value, reason: "home-identity-raw" });
    return true;
  }

  const resolved = lexicalResolve(value);

  // B1-(ii) also on resolved (e.g. after %2e%2e decode)
  if (resolved !== value && hasHomeIdentity(resolved)) {
    hits.push({ fieldPath, value, reason: "home-identity-resolved", resolved });
    return true;
  }

  // B1-(i) resolved-path check: classify on resolved (and raw if still path-like)
  const pathLike =
    isAbsoluteFsPathLike(resolved) || isAbsoluteFsPathLike(value);

  if (!pathLike) return false;

  // Allowlist ONLY against resolved value (prevents glued-prefix masking)
  if (isAllowlisted(resolved, allow)) return false;

  // Also: if raw equals an exact allowlisted sandbox root without traversal, OK
  // (already covered when resolved === raw).

  hits.push({
    fieldPath,
    value,
    reason: "resolved-not-allowlisted",
    resolved: resolved === value ? undefined : resolved,
  });
  return true;
}

/** Also scan plain text for embedded absolute paths (not only whole-line). */
const EMBEDDED_ABS_RE =
  /(?:^|[\s"'`=(,:\[{])(\/(?:Users|home)\/[^\s"'`)\],;}{]+|\/(?:private|var|tmp|opt|etc|usr|workspace|Volumes|System|Library|Applications|root)\/[^\s"'`)\],;}{]+|~\/[^\s"'`)\],;}{]+|\$HOME\/[^\s"'`)\],;}{]+|[A-Za-z]:\\[^\s"'`)\],;}{]+|\\\\[^\\\s"'`)\],;}{]+|%USERPROFILE%[^\s"'`)\],;}{]*|file:\/+\/[^\s"'`)\],;}{]+)/gi;

function collectFromString(value, fieldPath, hits, allow) {
  if (typeof value !== "string") return;

  // Whole-string evaluation first
  if (evaluateCandidate(value, fieldPath, hits, allow)) return;

  // Whole-string didn't hit; scan for embedded FS abs paths in prose/code.
  EMBEDDED_ABS_RE.lastIndex = 0;
  let m;
  const seen = new Set();
  while ((m = EMBEDDED_ABS_RE.exec(value)) !== null) {
    const offending = m[1];
    if (seen.has(offending)) continue;
    seen.add(offending);
    evaluateCandidate(offending, fieldPath, hits, allow);
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
      // B2: scan keys as well as values (path-keyed maps)
      const keyPath = fieldPath ? `${fieldPath}@key:${k}` : `@key:${k}`;
      collectFromString(k, keyPath, hits, allow);
      const next = fieldPath ? `${fieldPath}.${k}` : k;
      walkJson(v, next, hits, allow);
    }
  }
}

function isTextishFile(filePath) {
  const base = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  if (!ext && /^(README|LICENSE|CHANGELOG|NOTICE|IDENTITY|SHA256SUMS|MANIFEST)/i.test(base))
    return true;
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

/**
 * List files under target. Symlinks are NEVER followed or skipped silently (O1):
 * they are accumulated in `symlinks` for exit-3 refuse.
 */
function listFiles(target, symlinks) {
  let st;
  try {
    st = fs.lstatSync(target);
  } catch {
    return [];
  }
  if (st.isSymbolicLink()) {
    symlinks.push(target);
    return [];
  }
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
      if (ent.isSymbolicLink()) {
        symlinks.push(p);
        continue;
      }
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
  const symlinks = [];
  for (const t of targets) {
    const abs = path.resolve(t);
    if (!fs.existsSync(abs) && !fs.lstatSync && true) {
      // existsSync follows; use try lstat for dangling
    }
    let exists = false;
    try {
      fs.lstatSync(abs);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      console.error(`NOT_FOUND: ${abs}`);
      process.exit(2);
    }
    for (const file of listFiles(abs, symlinks)) {
      const hits = scanFile(file, allow);
      for (const h of hits) {
        allHits.push({ file, ...h });
      }
    }
  }

  if (symlinks.length > 0) {
    console.error(
      "exportable-cleanliness: SYMLINK_REFUSE — symlink(s) in scan target (O1; exit 3)",
    );
    for (const s of symlinks) {
      console.error(`symlink: ${s}`);
    }
    console.error(`symlink_total: ${symlinks.length}`);
    process.exit(3);
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
    if (h.resolved) console.error(`resolved: ${h.resolved}`);
    if (h.reason) console.error(`reason: ${h.reason}`);
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
  lexicalResolve,
  hasHomeIdentity,
  evaluateCandidate,
  decodePathObfuscations,
  collectFromString,
};
