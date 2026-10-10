/**
 * Starts registry + agents as separate Node processes, waits for READY lines,
 * and guarantees shutdown (SIGTERM, then SIGKILL) with zero strays.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ENTRY = {
  registry: path.join(HERE, "registryServer.js"),
  "agent-a": path.join(HERE, "agentAServer.js"),
  "agent-b": path.join(HERE, "agentBServer.js"),
};

/** Minimal environment for a child: no inherited secrets unless asked. */
function childEnv({ config, apiKey }) {
  const env = {
    PATH: process.env.PATH ?? "",
    RAVEN_LIVE_AGENT_CONFIG: JSON.stringify(config ?? {}),
    RAVEN_LIVE_MAX_LIFETIME_MS: process.env.RAVEN_LIVE_MAX_LIFETIME_MS ?? "120000",
  };
  if (apiKey) env.RAVEN_API_KEY = apiKey;
  return env;
}

export function createFleet({ startTimeoutMs = 15_000 } = {}) {
  const children = [];

  function start(role, { config, apiKey } = {}) {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", ENTRY[role]],
      { stdio: ["pipe", "pipe", "pipe"], env: childEnv({ config, apiKey }) },
    );
    const record = { role, child, pid: child.pid, exited: false, stderr: "" };
    children.push(record);
    record.exitPromise = new Promise((res) => child.on("exit", () => { record.exited = true; res(); }));
    child.stderr.on("data", (d) => { record.stderr = (record.stderr + d.toString()).slice(-4000); });
    return new Promise((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error(`${role}_start_timeout`)), startTimeoutMs);
      child.stdout.on("data", (d) => {
        buf += d.toString();
        const nl = buf.indexOf("\n");
        if (nl === -1) return;
        clearTimeout(timer);
        try {
          const ready = JSON.parse(buf.slice(0, nl));
          if (ready.event !== "ready") throw new Error("bad_ready");
          record.url = ready.url;
          record.agentId = ready.agentId;
          resolve(record);
        } catch (e) {
          reject(e);
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`${role}_exited_${code}: ${record.stderr.trim().slice(0, 200)}`));
      });
    });
  }

  async function stopAll({ graceMs = 3_000 } = {}) {
    await Promise.all(children.map(async (r) => {
      if (r.exited) return;
      const done = r.exitPromise;
      try { r.child.stdin.end(); } catch { /* ignore */ }
      try { r.child.kill("SIGTERM"); } catch { /* ignore */ }
      const t = setTimeout(() => { try { r.child.kill("SIGKILL"); } catch { /* ignore */ } }, graceMs);
      await done;
      clearTimeout(t);
    }));
    return children.map((r) => ({ role: r.role, agentId: r.agentId ?? null, pid: r.pid, url: r.url ?? null, exited: r.exited }));
  }

  return { start, stopAll, children };
}

export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
