import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function fileSha256(path) {
  return sha256Hex(readFileSync(path));
}
