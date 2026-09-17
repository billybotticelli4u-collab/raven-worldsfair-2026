/**
 * Isolation boundary for raven-conformance Challenge 1.
 *
 * Darwin: prefer sandbox-exec (Seatbelt) with deny-network, broad file reads,
 * and writes allowed to workdir + temp/dev, with explicit app-root denials.
 * Linux (and non-Seatbelt hosts): Node --permission with realpath allow-fs-read
 * of the entry only; fs-write, child-process, and worker denied. Fail closed if
 * the permission model cannot be applied — never silently broaden permissions.
 * Network is measured separately; Node permission flags do NOT prove hostile
 * network containment.
 *
 * A Node child_process alone is NOT a security sandbox.
 */
import { spawnSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  chmodSync,
  realpathSync,
  readdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_ROOT, CORPUS_DIR, PROFILES_DIR, REPORTS_DIR, TARGETS_DIR } from "./paths.js";

export const DEFAULT_TIMEOUT_MS = 3000;
export const DEFAULT_MAX_STDOUT_BYTES = 256 * 1024;
export const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;

/** Env keys allowed into the target process (explicit allowlist). */
export const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "USER",
  "LOGNAME",
  "NODE_PATH",
];

export function restrictedEnv(extra = {}) {
  const env = {};
  for (const k of ENV_ALLOWLIST) {
    if (process.env[k]) env[k] = process.env[k];
  }
  // Deny proxy / credential leakage explicitly (empty or blocked).
  env.HTTP_PROXY = "";
  env.HTTPS_PROXY = "";
  env.http_proxy = "";
  env.https_proxy = "";
  env.ALL_PROXY = "";
  env.all_proxy = "";
  env.NO_PROXY = "*";
  env.NODE_OPTIONS = "";
  env.npm_config_registry = "";
  env.RAVEN_API_KEY = "";
  env.RAVEN_TOKEN = "";
  env.AWS_SECRET_ACCESS_KEY = "";
  env.AWS_ACCESS_KEY_ID = "";
  env.GITHUB_TOKEN = "";
  // Canary that hostile probes try to read — MUST NOT be present.
  // (Do not set RAVEN_CONFORMANCE_CANARY here.)
  Object.assign(env, extra);
  return env;
}

function sandboxExecAvailable() {
  if (process.platform !== "darwin") return false;
  try {
    const r = spawnSync("sandbox-exec", ["-n", "no-network", "/usr/bin/true"], {
      encoding: "utf8",
      timeout: 2000,
    });
    // -n no-network may or may not exist as named profile; try bare existence.
    if (r.error && r.error.code === "ENOENT") return false;
    // Check binary exists via which
    const which = spawnSync("which", ["sandbox-exec"], { encoding: "utf8" });
    return which.status === 0 && Boolean(which.stdout.trim());
  } catch {
    return false;
  }
}

/**
 * Minimal Seatbelt profile: deny network, allow broad reads and writes to
 * workdir + temp/dev, deny writes to app/corpus/profile/report roots.
 */
export function buildSeatbeltProfile({ workDir, targetScript, nodeBin }) {
  const absWork = path.resolve(workDir);
  const absTarget = path.resolve(targetScript);
  const absTargetDir = path.dirname(absTarget);
  const absNode = path.resolve(nodeBin);
  const absCorpus = path.resolve(CORPUS_DIR);
  const absProfiles = path.resolve(PROFILES_DIR);
  const absReports = path.resolve(REPORTS_DIR);
  const absApp = path.resolve(APP_ROOT);
  // Escape for SBPL string literals
  const q = (p) => p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  // Homebrew/Node needs broad file-read* (dyld, Cellar libs). Writes stay
  // confined to the ephemeral workdir + temp/dev. Explicit deny on
  // corpus/profile/reports/app roots. Network denied.
  return `(version 1)
(deny default)
(allow process*)
(allow signal)
(allow sysctl-read)
(allow mach*)
(allow iokit-open)
(allow file-read-metadata)
(allow file-read*)
(allow file-write*
  (subpath "${q(absWork)}")
  (subpath "/dev")
  (subpath "/private/tmp")
  (subpath "/tmp")
  (subpath "/private/var/folders")
)
(allow file-ioctl)
(allow pseudo-tty)
(deny file-write*
  (subpath "${q(absCorpus)}")
  (subpath "${q(absProfiles)}")
  (subpath "${q(absReports)}")
  (subpath "${q(absApp)}")
)
(deny network*)
; target=${q(absTarget)} targetDir=${q(absTargetDir)} node=${q(absNode)}
`;
}

export function createRunWorkdir(runId) {
  const base = path.join(os.tmpdir(), "raven-conformance-runs");
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(path.join(base, `${runId}-`));
  return dir;
}

export function cleanupWorkdir(dir) {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

/**
 * Probe whether sandbox-exec can run a trivial command with our profile.
 */
export function probeSandboxExec(workDir) {
  if (process.platform !== "darwin") {
    return {
      available: false,
      reason: `platform_${process.platform}_not_darwin`,
    };
  }
  const which = spawnSync("which", ["sandbox-exec"], { encoding: "utf8" });
  if (which.status !== 0) {
    return { available: false, reason: "sandbox_exec_binary_missing" };
  }
  // Probe must exercise Node under Seatbelt — /usr/bin/true alone is insufficient
  // (Homebrew Node needs broader reads; claiming verified without Node is false).
  const profilePath = path.join(workDir, "probe.sb");
  const nodeBin = process.execPath;
  const profile = buildSeatbeltProfile({
    workDir,
    targetScript: path.join(workDir, "probe-target-placeholder.mjs"),
    nodeBin,
  });
  writeFileSync(profilePath, profile);
  const r = spawnSync(
    "sandbox-exec",
    ["-f", profilePath, nodeBin, "-e", 'process.stdout.write("PROBE_OK")'],
    {
      encoding: "utf8",
      timeout: 5000,
      env: restrictedEnv({ TMPDIR: workDir, TMP: workDir, TEMP: workDir }),
    },
  );
  if (r.status === 0 && (r.stdout || "").includes("PROBE_OK")) {
    return { available: true, reason: "sandbox_exec_node_probe_ok" };
  }
  return {
    available: false,
    reason: `sandbox_exec_node_probe_failed:status=${r.status}:signal=${r.signal}:stderr=${(r.stderr || "").slice(0, 200)}`,
  };
}

/**
 * Probe whether Node's permission model can deny fs-write / child / worker
 * while still allowing a realpath-scoped fs-read of the entry. Fail closed
 * if any intended denial does not hold, or if the runtime cannot apply flags.
 */
export function probeNodePermissions(workDir) {
  if (process.platform === "win32") {
    return { available: false, reason: "unsupported_platform_win32" };
  }
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (!Number.isFinite(major) || major < 22) {
    return { available: false, reason: `node_permission_unsupported_version:${process.versions.node}` };
  }
  const probeDir = path.join(workDir, "perm-probe");
  try {
    mkdirSync(probeDir, { recursive: true });
  } catch (err) {
    return { available: false, reason: `probe_workdir_failed:${err}` };
  }
  const entry = path.join(probeDir, "entry.mjs");
  const outside = path.join(probeDir, "outside.txt");
  const marker = path.join(probeDir, "child-marker.txt");
  const workerMarker = marker + ".w";
  // Embed absolute paths in the generated script. File-mode Node puts the script
  // path in process.argv[1]; using argv[1]/[2] as out/marker overwrites entry.mjs.
  writeFileSync(
    entry,
    `import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Worker } from "node:worker_threads";
const out = ${JSON.stringify(outside)};
const marker = ${JSON.stringify(marker)};
const workerMarker = ${JSON.stringify(workerMarker)};
const result = { write: null, child: null, worker: null };
try { writeFileSync(out, "x"); result.write = "ok"; } catch (e) { result.write = e.code || String(e); }
try {
  const c = spawnSync(process.execPath, ["-e", "require('fs').writeFileSync(process.argv[1],'c')", marker], { encoding: "utf8" });
  if (c.error) result.child = c.error.code || String(c.error);
  else if (c.status === 0) result.child = "ok";
  else result.child = (c.stderr || "").includes("ERR_ACCESS_DENIED") ? "ERR_ACCESS_DENIED" : ("exit_" + c.status);
} catch (e) { result.child = e.code || String(e); }
try {
  await new Promise((resolve, reject) => {
    const w = new Worker(
      "require('fs').writeFileSync(require('worker_threads').workerData,'w');",
      { eval: true, workerData: workerMarker },
    );
    w.on("error", reject);
    w.on("exit", (code) => (code === 0 ? resolve() : reject(Object.assign(new Error("worker_exit_" + code), { code: "WORKER_EXIT" }))));
  });
  result.worker = "ok";
} catch (e) { result.worker = e.code || String(e); }
process.stdout.write(JSON.stringify(result));
`,
  );
  const entryHashBefore = createHash("sha256").update(readFileSync(entry)).digest("hex");
  let realEntry;
  try {
    realEntry = realpathSync(entry);
  } catch (err) {
    try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* */ }
    return { available: false, reason: `realpath_failed:${err}` };
  }
  const r = spawnSync(
    process.execPath,
    ["--permission", `--allow-fs-read=${realEntry}`, realEntry],
    { encoding: "utf8", timeout: 8000, cwd: probeDir },
  );
  if (r.error) {
    try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* */ }
    return { available: false, reason: `spawn_error:${r.error.message || r.error}` };
  }
  if (r.status !== 0) {
    try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* */ }
    return {
      available: false,
      reason: `probe_nonzero_exit:status=${r.status}:stderr=${(r.stderr || "").slice(0, 200)}`,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse((r.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "");
  } catch {
    try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* */ }
    return {
      available: false,
      reason: `probe_unparseable:status=${r.status}:stderr=${(r.stderr || "").slice(0, 200)}`,
    };
  }
  const denied = (v) => v === "ERR_ACCESS_DENIED";
  if (!denied(parsed.write) || !denied(parsed.child) || !denied(parsed.worker)) {
    try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* */ }
    return {
      available: false,
      reason: `probe_denials_incomplete:${JSON.stringify(parsed)}`,
      probe: parsed,
    };
  }
  if (existsSync(outside) || existsSync(marker) || existsSync(workerMarker)) {
    try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* */ }
    return { available: false, reason: "probe_side_effects_present", probe: parsed };
  }
  const entryHashAfterRestricted = createHash("sha256").update(readFileSync(entry)).digest("hex");
  if (entryHashAfterRestricted !== entryHashBefore) {
    try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* */ }
    return { available: false, reason: "probe_entry_mutated_under_restriction" };
  }
  // Positive control: same ops succeed without --permission; all markers must appear.
  const pos = spawnSync(process.execPath, [realEntry], {
    encoding: "utf8",
    timeout: 8000,
    cwd: probeDir,
  });
  if (pos.error) {
    try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* */ }
    return { available: false, reason: `positive_spawn_error:${pos.error.message || pos.error}` };
  }
  if (pos.status !== 0) {
    try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* */ }
    return {
      available: false,
      reason: `positive_nonzero_exit:status=${pos.status}:stderr=${(pos.stderr || "").slice(0, 200)}`,
    };
  }
  let posParsed;
  try {
    posParsed = JSON.parse((pos.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "");
  } catch {
    try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* */ }
    return { available: false, reason: "positive_control_unparseable", stderr: (pos.stderr || "").slice(0, 200) };
  }
  if (posParsed.write !== "ok" || posParsed.child !== "ok" || posParsed.worker !== "ok") {
    try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* */ }
    return { available: false, reason: `positive_control_incomplete:${JSON.stringify(posParsed)}` };
  }
  if (!existsSync(outside) || !existsSync(marker) || !existsSync(workerMarker)) {
    try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* */ }
    return {
      available: false,
      reason: `positive_markers_missing:write=${existsSync(outside)}:child=${existsSync(marker)}:worker=${existsSync(workerMarker)}`,
      positive: posParsed,
    };
  }
  const entryHashAfterPositive = createHash("sha256").update(readFileSync(entry)).digest("hex");
  if (entryHashAfterPositive !== entryHashBefore) {
    try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* */ }
    return { available: false, reason: "probe_entry_mutated_by_positive_control" };
  }
  // Cleanup: remove entire probe dir so no positive artifacts remain.
  try { rmSync(probeDir, { recursive: true, force: true }); } catch { /* */ }
  if (existsSync(probeDir)) {
    return { available: false, reason: "probe_cleanup_incomplete" };
  }
  return {
    available: true,
    reason: "node_permission_probe_ok",
    probe: parsed,
    positive: { write: posParsed.write, child: posParsed.child, worker: posParsed.worker },
    realpath_entry: realEntry,
    entry_sha256: entryHashBefore,
  };
}

/**
 * Build Node argv applying --permission with realpath-scoped allow-fs-read.
 * Throws if realpath cannot be resolved (fail closed).
 */
export function buildNodePermissionArgs(entryAbs) {
  let realEntry;
  try {
    realEntry = realpathSync(entryAbs);
  } catch (err) {
    const e = new Error(`permission_realpath_failed:${err.message || err}`);
    e.code = "PERMISSION_REALPATH_FAILED";
    throw e;
  }
  if (!existsSync(realEntry)) {
    const e = new Error(`permission_entry_missing:${realEntry}`);
    e.code = "PERMISSION_ENTRY_MISSING";
    throw e;
  }
  return {
    nodeBin: process.execPath,
    args: ["--permission", `--allow-fs-read=${realEntry}`, realEntry],
    realEntry,
  };
}

/**
 * Resolve isolation mode for this host + run.
 */
export function resolveIsolation(workDir) {
  const platform = process.platform;
  if (platform === "darwin") {
    const probe = probeSandboxExec(workDir);
    if (probe.available) {
      return {
        mode: "sandbox_exec",
        verified: true,
        platform,
        details: "Seatbelt sandbox-exec denies network, permits broad file reads; writes allowed to ephemeral workdir, /dev, /private/tmp, /tmp, /private/var/folders; writes to app/corpus/profile/report roots denied. Ordinary OS permissions still apply.",
        verified_controls: [
          "sandbox_exec_profile_applied",
          "deny_network",
          "write_allowlist_workdir_dev_tmp_with_app_root_denials",
          "env_allowlist",
          "timeout_process_group_kill",
          "stdout_stderr_byte_caps",
        ],
        assumed_controls: [
          "memory_ulimit_soft_not_kernel_enforced_unless_wrapper_applied",
        ],
        probe_reason: probe.reason,
      };
    }
    // Seatbelt unavailable: fall through to Node --permission (same as Linux),
    // never silently run unrestricted. Seatbelt policy bytes remain unchanged.
  }
  // Non-Seatbelt path (Linux, and Darwin when sandbox-exec probe failed).
  const probe = probeNodePermissions(workDir);
  if (!probe.available) {
    return {
      mode: "unavailable",
      verified: false,
      fail_closed: true,
      platform,
      details:
        `Node --permission model unavailable or probe failed (${probe.reason}). Refusing to spawn targets without permission flags — no silent fallback to broader permissions. Network is not claimed contained.`,
      verified_controls: [],
      assumed_controls: [
        "network_not_restricted_by_node_permission_model",
        "not_os_kernel_sandbox",
      ],
      probe_reason: probe.reason,
    };
  }
  return {
    mode: "node_permissions",
    verified: true,
    fail_closed: false,
    platform,
    details:
      "Node --permission applied: allow-fs-read limited to realpath(entry); fs-write, child-process, and worker denied. Timeout, process-group kill, env allowlist, output caps, ephemeral workdirs also enforced. NOT an OS/kernel sandbox. Network is NOT denied by the Node permission model — measure separately.",
    verified_controls: [
      "node_permission_flag_applied",
      "allow_fs_read_entry_realpath_only",
      "deny_fs_write_via_node_permission",
      "deny_child_process_via_node_permission",
      "deny_worker_via_node_permission",
      "env_allowlist",
      "timeout_process_group_kill",
      "stdout_stderr_byte_caps",
      "ephemeral_workdir_cleanup",
    ],
    assumed_controls: [
      "network_not_restricted_by_node_permission_model",
      "not_os_kernel_sandbox",
      "memory_ulimit_soft_not_kernel_enforced_unless_wrapper_applied",
    ],
    probe_reason: probe.reason,
  };
}

function killProcessGroup(pid) {
  if (!pid || pid <= 0) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

/**
 * Spawn target under isolation.
 * @returns {Promise<object>} exec result with flood/timeout/crash flags
 */
export function spawnIsolated({
  entryAbs,
  inputObj,
  workDir,
  isolation,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxStdout = DEFAULT_MAX_STDOUT_BYTES,
  maxStderr = DEFAULT_MAX_STDERR_BYTES,
  envExtra = {},
  injectCanary = false,
}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const env = restrictedEnv(envExtra);
    // Optionally inject canary ONLY into parent test harness — never into target
    // unless injectCanary (should stay false for normal runs).
    if (injectCanary) {
      env.RAVEN_CONFORMANCE_CANARY = "LEAK_ME_IF_YOU_CAN";
    }
    // Ensure TMPDIR points inside workdir so target temp writes stay local when possible.
    env.TMPDIR = workDir;
    env.TMP = workDir;
    env.TEMP = workDir;

    const nodeBin = process.execPath;
    let cmd = nodeBin;
    let args = [entryAbs];
    let profilePath = null;

    // Fail closed: never spawn without the intended restriction when isolation
    // declares fail_closed / unavailable (unsupported permission runtime).
    if (isolation.fail_closed || isolation.mode === "unavailable") {
      resolve({
        timedOut: false,
        flooded: false,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: `isolation_fail_closed:${isolation.probe_reason || isolation.details || "unavailable"}`,
        durationMs: Date.now() - started,
        observed: null,
        parseError: "spawn_error",
        pid: null,
        isolation_mode_used: isolation.mode,
        spawn_error: `isolation_fail_closed:${isolation.probe_reason || "unavailable"}`,
      });
      return;
    }

    if (isolation.mode === "sandbox_exec" && isolation.verified) {
      profilePath = path.join(workDir, "seatbelt.sb");
      writeFileSync(
        profilePath,
        buildSeatbeltProfile({ workDir, targetScript: entryAbs, nodeBin }),
      );
      cmd = "sandbox-exec";
      args = ["-f", profilePath, nodeBin, entryAbs];
    } else if (isolation.mode === "node_permissions") {
      // Linux / non-Seatbelt: apply Node permission model with realpath allow.
      // Do not silently omit --permission.
      try {
        const built = buildNodePermissionArgs(entryAbs);
        cmd = built.nodeBin;
        args = built.args;
      } catch (err) {
        resolve({
          timedOut: false,
          flooded: false,
          exitCode: null,
          signal: null,
          stdout: "",
          stderr: String(err),
          durationMs: Date.now() - started,
          observed: null,
          parseError: "spawn_error",
          pid: null,
          isolation_mode_used: isolation.mode,
          spawn_error: String(err.message || err),
        });
        return;
      }
    } else {
      // Unknown mode — fail closed rather than unrestricted spawn.
      resolve({
        timedOut: false,
        flooded: false,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: `isolation_unknown_mode:${isolation.mode}`,
        durationMs: Date.now() - started,
        observed: null,
        parseError: "spawn_error",
        pid: null,
        isolation_mode_used: isolation.mode,
        spawn_error: `isolation_unknown_mode:${isolation.mode}`,
      });
      return;
    }

    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let flooded = false;
    let killed = false;
    let spawnError = null;

    const child = spawn(cmd, args, {
      cwd: workDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true, // own process group for group kill
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      killed = true;
      killProcessGroup(child.pid);
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      if (flooded) return;
      stdout = Buffer.concat([stdout, d]);
      if (stdout.length > maxStdout) {
        flooded = true;
        stdout = stdout.subarray(0, maxStdout);
        killProcessGroup(child.pid);
      }
    });
    child.stderr.on("data", (d) => {
      if (flooded) return;
      stderr = Buffer.concat([stderr, d]);
      if (stderr.length > maxStderr) {
        flooded = true;
        stderr = stderr.subarray(0, maxStderr);
        killProcessGroup(child.pid);
      }
    });

    child.on("error", (err) => {
      spawnError = err;
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      // Reap any leftover group members
      killProcessGroup(child.pid);

      const stdoutStr = stdout.toString("utf8");
      const stderrStr = stderr.toString("utf8");
      let observed = null;
      let parseError = null;

      if (spawnError) {
        parseError = "spawn_error";
      } else if (flooded) {
        parseError = "output_flood";
      } else if (killed) {
        parseError = "timeout";
      } else {
        const line = stdoutStr.trim().split(/\r?\n/).filter(Boolean).pop() || "";
        try {
          observed = JSON.parse(line);
          if (!observed || typeof observed.decision !== "string") {
            parseError = "missing_decision";
            observed = null;
          }
        } catch {
          parseError = "unparseable_stdout";
        }
      }

      resolve({
        timedOut: killed && !flooded,
        flooded,
        exitCode: code,
        signal: signal || null,
        stdout: stdoutStr,
        stderr: stderrStr + (spawnError ? String(spawnError) : ""),
        durationMs: Date.now() - started,
        observed,
        parseError,
        pid: child.pid,
        isolation_mode_used: isolation.mode,
        spawn_error: spawnError ? String(spawnError.message || spawnError) : null,
      });
    });

    try {
      child.stdin.write(JSON.stringify(inputObj));
      child.stdin.end();
    } catch (err) {
      clearTimeout(timer);
      killProcessGroup(child.pid);
      resolve({
        timedOut: false,
        flooded: false,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: String(err),
        durationMs: Date.now() - started,
        observed: null,
        parseError: "stdin_error",
        pid: child.pid,
        isolation_mode_used: isolation.mode,
        spawn_error: String(err),
      });
    }
  });
}

/**
 * Soft memory/process limit disclosure. ulimit via shell is best-effort and
 * not claimed as verified kernel confinement on all hosts.
 */
export function softLimitsDisclosure() {
  return {
    memory_soft_limit: "unverified",
    note: "No portable Node API for cgroup/RLimit without shell wrapper; Challenge 1 documents soft limits as unverified unless Darwin sandbox-exec profile applies. Do not claim ulimit enforcement without measurement.",
  };
}
