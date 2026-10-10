/**
 * Child-process lifecycle shared by registry / Agent A / Agent B entries.
 * - prints exactly one READY line (JSON) on stdout once listening;
 * - exits when the parent closes stdin (parent crash => no stray), on
 *   SIGTERM/SIGINT, or after a hard lifetime cap.
 */
const DEFAULT_MAX_LIFETIME_MS = 120_000;

export function runAsChildProcess(role, start) {
  const maxLifetime = Number(process.env.RAVEN_LIVE_MAX_LIFETIME_MS || DEFAULT_MAX_LIFETIME_MS);
  let handle = null;
  let stopping = false;
  const stop = async (code) => {
    if (stopping) return;
    stopping = true;
    try {
      await handle?.close?.();
    } finally {
      process.exit(code);
    }
  };
  const timer = setTimeout(() => stop(3), Number.isFinite(maxLifetime) ? maxLifetime : DEFAULT_MAX_LIFETIME_MS);
  timer.unref();
  process.on("SIGTERM", () => stop(0));
  process.on("SIGINT", () => stop(0));
  process.stdin.on("end", () => stop(0));
  process.stdin.on("close", () => stop(0));
  process.stdin.resume();
  start()
    .then((h) => {
      handle = h;
      process.stdout.write(
        JSON.stringify({ event: "ready", role, agentId: h.agentId ?? role, url: h.url, pid: process.pid }) + "\n",
      );
    })
    .catch((err) => {
      process.stderr.write(`${role} failed to start: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
