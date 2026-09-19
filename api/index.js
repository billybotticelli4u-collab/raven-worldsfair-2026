/**
 * Vercel entry for apps/raven-conformance (Raven Conformance — Judge UI).
 *
 * Zero-change wrapper around the reviewed app. It does not import, patch,
 * re-implement or shadow any route. It does two things:
 *
 *   1. Relocates the app tree to a writable directory. Vercel Functions mount
 *      the deployment read-only (only /tmp is writable) and the reviewed runner
 *      writes reports/<run_id>.json beside the app (src/lib/paths.js), which
 *      /api/report/<run_id> and /api/replay then read back.
 *   2. Imports the unchanged src/server.js. That module calls
 *      http.createServer(...).listen(); the Vercel Node.js runtime captures the
 *      server on import, binds it on a loopback port and proxies every request
 *      to it with the original req.url and the raw request body intact
 *      (@vercel/node "Server handler" shape). Nothing is exported from here.
 *
 * Wiring lives in vercel.json: rewrites /api/(.*) -> /api/index, and
 * functions["api/index.js"].includeFiles = "apps/raven-conformance/**" so the
 * corpus, profile, targets, examples, interface and public files travel with
 * the function. Static files are served from apps/raven-conformance/public.
 *
 * Build identity is untouched: src/lib/buildIdentity.js selects
 * VERCEL_GIT_COMMIT_SHA as "platform_asserted"; the public-file fingerprint is
 * computed from the relocated copies, which are byte-identical to the served
 * static files (scripts/verify-public-build.mjs recomputes it over HTTP).
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE_ROOT = path.resolve(fileURLToPath(new URL("../apps/raven-conformance/", import.meta.url)));
const RUNTIME_ROOT = path.resolve(
  process.env.RAVEN_CONFORMANCE_RUNTIME_ROOT || path.join(os.tmpdir(), "raven-conformance-runtime"),
);
// Not needed to serve or run; skipped to keep the cold-start copy small.
const SKIP_TOP_LEVEL = new Set(["evidence", "test", "node_modules"]);

if (RUNTIME_ROOT === SOURCE_ROOT || SOURCE_ROOT.startsWith(RUNTIME_ROOT + path.sep)) {
  throw new Error(`refusing to relocate onto the source tree: ${RUNTIME_ROOT}`);
}

rmSync(RUNTIME_ROOT, { recursive: true, force: true });
cpSync(SOURCE_ROOT, RUNTIME_ROOT, {
  recursive: true,
  filter: (src) => !SKIP_TOP_LEVEL.has(path.relative(SOURCE_ROOT, src).split(path.sep)[0]),
});
mkdirSync(path.join(RUNTIME_ROOT, "reports"), { recursive: true });

// The reviewed server: creates the http.Server and calls listen() itself.
await import(pathToFileURL(path.join(RUNTIME_ROOT, "src", "server.js")).href);
