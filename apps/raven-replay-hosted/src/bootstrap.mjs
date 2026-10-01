// Uploaded by the host, outside the snapshot. Verify snapshot source before
// importing any SDK module. The expected digest comes from operator configuration.
import { readFileSync, lstatSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
const sha = (x) => createHash("sha256").update(x).digest("hex");
const refuse = () => {
  throw Object.assign(new Error("ENGINE_IDENTITY_MISMATCH"), {
    code: "ENGINE_IDENTITY_MISMATCH",
  });
};
export function verifyEngine(root, expected) {
  try {
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected))
      refuse();
    const bytes = readFileSync(root + "/engine-pin.json");
    if (bytes.length > 256 * 1024 || sha(bytes) !== expected) refuse();
    const pin = JSON.parse(bytes);
    if (
      pin.node_version !== process.version ||
      !Array.isArray(pin.engine_files) ||
      pin.engine_files.length < 1 ||
      pin.engine_files.length > 1000
    )
      refuse();
    const seen = new Set();
    for (const item of pin.engine_files) {
      if (
        typeof item.path !== "string" ||
        !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(item.path) ||
        item.path.split("/").includes("..") ||
        seen.has(item.path)
      )
        refuse();
      seen.add(item.path);
      let full = root + "/app/engine";
      for (const part of item.path.split("/")) {
        full += "/" + part;
        if (lstatSync(full).isSymbolicLink()) refuse();
      }
      if (!lstatSync(full).isFile() || sha(readFileSync(full)) !== item.sha256)
        refuse();
    }
    return true;
  } catch {
    refuse();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    verifyEngine(
      "/vercel/sandbox",
      readFileSync("/vercel/sandbox/expected-engine-pin.txt", "utf8").trim(),
    );
    const { runWorkerFile } = await import("./worker.mjs");
    runWorkerFile();
  } catch {
    writeFileSync(
      "/vercel/sandbox/result.json",
      JSON.stringify({ ok: false, error: "ENGINE_IDENTITY_MISMATCH" }) + "\n",
      { flag: "wx" },
    );
  }
}
