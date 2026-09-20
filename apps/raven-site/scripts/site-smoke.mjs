#!/usr/bin/env node
// Blackbox smoke test: site + verifier surfaces. No secrets required;
// /verify only runs if the operator exports RAVEN_SMOKE_API_KEY.
const SITE = process.env.RAVEN_SITE_URL || "https://raven-launch-console.vercel.app";
const API = process.env.RAVEN_VERIFIER_URL || "https://raven-hosted-verifier.onrender.com";
let fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log("ok  -", name); }
  catch (e) { fail++; console.error("FAIL-", name, "->", e.message); }
};
const get = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error("HTTP " + r.status); return r; };

await check("site /", async () => {
  const t = await (await get(SITE + "/")).text();
  if (!t.includes("rvk_c2997e90215279c2")) throw new Error("keyId missing");
});
await check("site /request-access.html has form fields", async () => {
  const t = await (await get(SITE + "/request-access.html")).text();
  for (const id of ["name", "email", "project", "usecase", "volume", "beta", "token", "role", "decision"]) {
    if (!t.includes('id="' + id + '"')) throw new Error("missing field " + id);
  }
});
await check("site /agents.json valid + keyId", async () => {
  const j = await (await get(SITE + "/agents.json")).json();
  if (j.attestation.keyId !== "rvk_c2997e90215279c2") throw new Error("bad keyId");
});
await check("site /openapi.json valid", async () => {
  const j = await (await get(SITE + "/openapi.json")).json();
  if (!j.paths["/verify"]) throw new Error("no /verify path");
});
await check("site /security.html explains fail-closed + gaps", async () => {
  const t = await (await get(SITE + "/security.html")).text();
  if (!/[Ff]ail-closed/.test(t) || !t.includes("coverageGaps")) throw new Error("copy missing");
});
await check("site /receipts.html", async () => { await get(SITE + "/receipts.html"); });
await check("site /agents.html reachable", async () => { await get(SITE + "/agents.html"); });
await check("verifier /healthz", async () => {
  const j = await (await get(API + "/healthz")).json();
  if (j.status !== "ok") throw new Error("not ok");
});
await check("verifier /pubkey", async () => {
  const j = await (await get(API + "/pubkey")).json();
  if (j.keys[0].keyId !== "rvk_c2997e90215279c2") throw new Error("bad keyId");
});
if (process.env.RAVEN_SMOKE_API_KEY) {
  await check("verifier /verify (USDC, keyed)", async () => {
    const r = await fetch(API + "/verify", { method: "POST",
      headers: { "x-api-key": process.env.RAVEN_SMOKE_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ mintAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", tokenProgramAddress: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }) });
    const j = await r.json();
    if (j.verdict !== "risk" || !j.signature) throw new Error("unexpected verdict/signature");
  });
} else { console.log("skip- verifier /verify (no RAVEN_SMOKE_API_KEY)"); }
console.log(fail === 0 ? "\nSMOKE OK" : "\nSMOKE FAILED: " + fail);
process.exit(fail === 0 ? 0 : 1);
