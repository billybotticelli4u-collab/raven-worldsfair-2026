// Child probe: makes ONE startAgentB attempt that the registry rejects, closes
// nothing itself, and must then exit naturally (no leaked listener).
// argv: <registryUrl> <agentId>
import { startAgentB } from "../../src/live/agentBServer.js";

const [registryUrl, agentId] = process.argv.slice(2);
try {
  await startAgentB({ variant: "honest", agentId, registryUrl });
  console.log("UNEXPECTED_STARTED");
} catch (err) {
  console.log(`REJECTED ${err instanceof Error ? err.message : String(err)}`);
}
