// Features 1+2: discovery + live proof requests between separate local
// processes (127.0.0.1 only). Offline evidence; no credentials; no network.
const { runLiveDemo } = await import("../apps/worldsfair-agent-trust/src/live/liveDemo.js");
const ok = await runLiveDemo({ json: process.argv.includes("--json") });
process.exitCode = ok ? 0 : 1;
