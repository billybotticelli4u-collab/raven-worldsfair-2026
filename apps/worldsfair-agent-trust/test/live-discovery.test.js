import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import { networkInterfaces } from "node:os";
import { startRegistry } from "../src/live/registryServer.js";
import { startAgentB } from "../src/live/agentBServer.js";
import { cardSha256, evaluateProviderCard, makeCard } from "../src/live/cards.js";
import { createAgentA } from "../src/live/agentACore.js";
import { EVIDENCE_CAPABILITY, VERIFIER_PIN } from "../src/live/constants.js";
import { loopbackJson } from "../src/live/http.js";

async function population(t, variants) {
  const reg = await startRegistry();
  t.after(() => reg.close());
  const bs = {};
  for (const v of variants) {
    bs[v] = await startAgentB({ variant: v, registryUrl: reg.url });
    t.after(() => bs[v].close());
  }
  return { reg, bs };
}

test("discovery: Agent A finds eligible providers and skips wrong capability / bad pin", async (t) => {
  const { reg } = await population(t, ["honest", "tamperer", "wrong-capability", "bad-pin"]);
  const a = createAgentA({ registryUrl: reg.url });
  const d = await a.discover();
  const byId = Object.fromEntries(d.candidates.map((c) => [c.agentId, c]));
  assert.equal(d.candidates.length, 4);
  assert.equal(byId["agent-b-honest"].eligible, true);
  assert.equal(byId["agent-b-tamperer"].eligible, true);
  assert.deepEqual(byId["agent-b-wrong-capability"].reasons, ["capability_missing"]);
  assert.deepEqual(byId["agent-b-bad-pin"].reasons, ["verifier_pin_mismatch"]);
});

test("discovery: registry capability filter and self-registration identity", async (t) => {
  const { reg, bs } = await population(t, ["honest", "wrong-capability"]);
  const filtered = await loopbackJson(`${reg.url}/v0/agents?capability=${encodeURIComponent(EVIDENCE_CAPABILITY)}`);
  assert.deepEqual(filtered.json.agents.map((e) => e.card.agentId), ["agent-b-honest"]);
  assert.equal(filtered.json.agents[0].cardSha256, bs.honest.cardSha256);
  assert.equal(filtered.json.agents[0].cardSha256, await cardSha256(bs.honest.card));
  const dup = await loopbackJson(`${reg.url}/v0/register`, { method: "POST", body: { card: bs.honest.card } });
  assert.equal(dup.status, 409, "an agentId cannot be re-registered by someone else");
});

test("registry refuses cards whose endpoint is not 127.0.0.1", async (t) => {
  const reg = await startRegistry();
  t.after(() => reg.close());
  for (const endpoint of ["http://localhost:9", "http://0.0.0.0:9", "https://example.com", "http://10.0.0.1:80"]) {
    const card = makeCard({ agentId: "agent-x", role: "evidence-provider", endpoint, capabilities: [EVIDENCE_CAPABILITY], verifierPin: VERIFIER_PIN });
    const r = await loopbackJson(`${reg.url}/v0/register`, { method: "POST", body: { card } });
    assert.equal(r.status, 400, endpoint);
    assert.ok(r.json.reasons.includes("endpoint_not_loopback"));
  }
});

test("card evaluation: role, subject and shape reasons", () => {
  const base = { agentId: "agent-y", role: "evidence-provider", endpoint: "http://127.0.0.1:1", capabilities: [EVIDENCE_CAPABILITY], verifierPin: VERIFIER_PIN, subjects: [] };
  const subject = { chain: "solana-mainnet", mintAddress: "M", tokenProgramAddress: "T" };
  assert.deepEqual(evaluateProviderCard(makeCard(base), { subject }).reasons, ["subject_not_offered"]);
  assert.deepEqual(evaluateProviderCard(makeCard({ ...base, role: "evidence-consumer" })).reasons, ["role_not_provider"]);
  assert.ok(evaluateProviderCard({ nope: 1 }).reasons.includes("card_version_unsupported"));
  assert.deepEqual(evaluateProviderCard(null).reasons, ["card_not_object"]);
});

test("servers bind 127.0.0.1 only", async (t) => {
  const { reg, bs } = await population(t, ["honest"]);
  for (const h of [reg, bs.honest]) assert.equal(h.server.address().address, "127.0.0.1");
  const external = Object.values(networkInterfaces()).flat()
    .find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  if (!external) return t.diagnostic("no non-loopback IPv4 interface on this host; external-connect check skipped");
  const refused = await new Promise((resolve) => {
    const s = net.connect({ host: external, port: reg.port, timeout: 1500 });
    s.once("connect", () => { s.destroy(); resolve(false); });
    s.once("error", () => resolve(true));
    s.once("timeout", () => { s.destroy(); resolve(true); });
  });
  assert.equal(refused, true, "registry must not be reachable on a non-loopback interface");
});
