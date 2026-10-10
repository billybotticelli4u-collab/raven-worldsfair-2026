// Starts a registry + one Agent B, prints their pids/urls, then idles until
// killed. Used to prove children exit when their parent dies abruptly.
const { createFleet } = await import("../../src/live/orchestrator.js");
const fleet = createFleet();
const reg = await fleet.start("registry");
const b = await fleet.start("agent-b", { config: { variant: "honest", registryUrl: reg.url } });
process.stdout.write(JSON.stringify({ pids: [reg.pid, b.pid], urls: [reg.url, b.url] }) + "\n");
setInterval(() => {}, 1000);
