// Test-only preload (node --import) for export-race.test.mjs. Synthetic only; never used by the CLI itself.
// GATE_AFTER=json|md : after the CLI writes that export, signal $GATE_DIR/reached (FIFO) and block on $GATE_DIR/go (FIFO).
// TMP_MODE_LOG=file  : append "<kind> <octal mode> <basename length>" of each temp export right after its bytes are written.
// FAIL_AT=json|md    : write half of the bytes then throw ENOSPC (simulated; disk never filled).
import fs from "node:fs"; import { syncBuiltinESMExports } from "node:module"; import path from "node:path";
const a = process.argv; const cli = a[1] && a[1].endsWith("check-reader.mjs");
if (cli) {
  const pick = (f) => { const i = a.indexOf(f); return i > 0 ? path.resolve(a[i + 1]) : null; };
  const target = { json: pick("--out"), md: pick("--explain") };
  const orig = fs.writeFileSync; let tmpSeen = 0;
  fs.writeFileSync = function (file, data, opts) {
    const p = typeof file === "string" ? path.resolve(file) : null;
    const kind = p && (p === target.json ? "json" : p === target.md ? "md" : null);
    // the CLI writes a bounded temp sibling (.reader-kit-export-<hex>.tmp) in the
    // target's directory first; JSON is always published before Markdown, so the
    // n-th temp write is classified by order.
    const isTmp = p && !kind && /^\.reader-kit-export-[0-9a-f]{24}\.tmp$/.test(path.basename(p));
    const tk = isTmp ? (tmpSeen++ === 0 ? "json" : "md") : null;
    if (isTmp && process.env.TMP_MODE_LOG) {
      const r0 = orig.call(fs, file, data, opts);
      fs.appendFileSync(process.env.TMP_MODE_LOG, `${tk} ${(fs.statSync(file).mode & 0o7777).toString(8)} ${path.basename(p).length}\n`);
      return r0;
    }
    const k = kind || tk;
    if (k && process.env.FAIL_AT === k) {
      const b = Buffer.from(data); orig.call(fs, file, b.subarray(0, b.length >> 1), opts);
      const e = new Error(`ENOSPC: no space left on device (simulated), write '${file}'`); e.code = "ENOSPC"; e.syscall = "write"; throw e;
    }
    const r = orig.call(fs, file, data, opts);
    if (k && kind && process.env.GATE_AFTER === k) gate(k);
    return r;
  };
  // gate on rename too (successor publishes via rename)
  const oren = fs.renameSync;
  fs.renameSync = function (from, to) { const r = oren.call(fs, from, to); const p = path.resolve(String(to)); const k = p === target.json ? "json" : p === target.md ? "md" : null; if (k && process.env.GATE_AFTER === k) gate(k); return r; };
  // GATE_AFTER=readjson : W-1 limit control. Pause right after the CLI's final
  // re-read of its JSON report (before it re-reads the Markdown).
  const ord = fs.readFileSync; let readGated = false;
  fs.readFileSync = function (file, ...rest) { const r = ord.call(fs, file, ...rest); if (!readGated && process.env.GATE_AFTER === "readjson" && typeof file === "string" && path.resolve(file) === target.json) { readGated = true; gate("readjson"); } return r; };
  function gate(k) { const d = process.env.GATE_DIR; orig.call(fs, path.join(d, "reached"), k); ord.call(fs, path.join(d, "go")); }
  syncBuiltinESMExports();
}
