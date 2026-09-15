import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const PROFILES_DIR = path.join(APP_ROOT, "profiles");
export const CORPUS_DIR = path.join(APP_ROOT, "corpus");
export const TARGETS_DIR = path.join(APP_ROOT, "targets");
export const REPORTS_DIR = path.join(APP_ROOT, "reports");
