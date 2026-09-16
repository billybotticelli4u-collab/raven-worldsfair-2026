/**
 * Isolation boundary for raven-conformance Challenge 1.
 *
 * Darwin: prefer sandbox-exec (Seatbelt) with deny-network + write confined
 * to a per-run ephemeral workdir. Linux/other: curated_demo — runner still
 * enforces timeout, output caps, env allowlist, process-group kill, but
 * MUST NOT claim verified sandbox enforcement.
 *
 * A Node child_process alone is NOT a security sandbox.
 */
import { spawnSync, spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_ROOT, CORPUS_DIR, PROFILES_DIR, REPORTS_DIR, TARGETS_DIR } from "./paths.js";

export const DEFAULT_TIMEOUT_MS = 3000;
export const DEFAULT_MAX_STDOUT_BYTES = 256 * 1024;
export const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
export const MAX_TIMEOUT_MS = 30000;
export const WATCHDOG_INTERVAL_MS = 50;

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
 * Minimal Seatbelt profile: deny network, deny writes outside workdir,
 * allow read of target script + node + workdir, deny write to corpus/profile/reports.
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
        details: "Seatbelt sandbox-exec with deny-network and write confined to ephemeral workdir",
        verified_controls: [
          "sandbox_exec_profile_applied",
          "deny_network",
          "deny_write_outside_workdir",
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
    return {
      mode: "curated_demo",
      verified: false,
      platform,
      details: `sandbox-exec unavailable or probe failed (${probe.reason}); runner enforces timeout/env/output caps only`,
      verified_controls: [
        "env_allowlist",
        "timeout_process_group_kill",
        "stdout_stderr_byte_caps",
        "ephemeral_workdir_cleanup",
      ],
      assumed_controls: [
        "network_denied_only_via_proxy_unset_not_kernel",
        "filesystem_writes_not_kernel_confined",
      ],
      probe_reason: probe.reason,
    };
  }
  return {
    mode: "curated_demo",
    verified: false,
    platform,
    details:
      "Non-Darwin host: sandbox-exec (Seatbelt) not available. Runner enforces timeout, process-group kill, env allowlist, output byte caps, ephemeral workdirs. NOT a verified security sandbox.",
    verified_controls: [
      "env_allowlist",
      "timeout_process_group_kill",
      "stdout_stderr_byte_caps",
      "ephemeral_workdir_cleanup",
    ],
    assumed_controls: [
      "network_denied_only_via_proxy_unset_not_kernel",
      "filesystem_writes_not_kernel_confined",
    ],
    probe_reason: "non_darwin",
  };
}

function killProcessGroup(pid) {
  if (!pid || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" });
      return;
    } catch {
      // fall through
    }
  }
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
    const boundedTimeoutMs = Number.isFinite(timeoutMs)
      ? Math.max(100, Math.min(MAX_TIMEOUT_MS, Math.trunc(timeoutMs)))
      : DEFAULT_TIMEOUT_MS;
    const detached = process.platform !== "win32";
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

    if (isolation.mode === "sandbox_exec" && isolation.verified) {
      profilePath = path.join(workDir, "seatbelt.sb");
      writeFileSync(
        profilePath,
        buildSeatbeltProfile({ workDir, targetScript: entryAbs, nodeBin }),
      );
      cmd = "sandbox-exec";
      args = ["-f", profilePath, nodeBin, entryAbs];
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
      detached, // own process group where supported for group kill
      windowsHide: true,
    });

    const watchdog = setInterval(() => {
      if (Date.now() - started < boundedTimeoutMs) return;
      killed = true;
      clearInterval(watchdog);
      killProcessGroup(child.pid);
    }, WATCHDOG_INTERVAL_MS);

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
      clearInterval(watchdog);
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
      clearInterval(watchdog);
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
