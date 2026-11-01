// Test-only preload (node --import) for export-race.test.mjs. Synthetic only; never used by the CLI itself.
// GATE_AFTER=json|md : after the CLI writes that export, signal $GATE_DIR/reached (FIFO) and block on $GATE_DIR/go (FIFO).
// FAIL_AT=json|md    : write half of the bytes then throw ENOSPC (simulated; disk never filled).
import fs from "node:fs"; import { syncBuiltinESMExports } from "node:module"; import path from "node:path";
const a = process.argv; const cli = a[1] && a[1].endsWith("check-reader.mjs");
if (cli) {
  const pick = (f) => { const i = a.indexOf(f); return i > 0 ? path.resolve(a[i + 1]) : null; };
  const target = { json: pick("--out"), md: pick("--explain") };
  const orig = fs.writeFileSync;
  fs.writeFileSync = function (file, data, opts) {
    const p = typeof file === "string" ? path.resolve(file) : null;
    const kind = p && (p === target.json ? "json" : p === target.md ? "md" : null);
    // successor writes to a temp sibling first; treat "<target>.*.tmp" as that kind
    const tk = p && !kind ? (Object.entries(target).find(([, t]) => t && p.startsWith(t + ".") && p.endsWith(".tmp")) || [null])[0] : null;
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
  function gate(k) { const d = process.env.GATE_DIR; orig.call(fs, path.join(d, "reached"), k); fs.readFileSync(path.join(d, "go")); }
  syncBuiltinESMExports();
}
