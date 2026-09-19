const ravenStateEl = document.getElementById("ravenState");
const ravenDetailEl = document.getElementById("ravenDetail");
const aOutcomeEl = document.getElementById("aOutcome");
const aDetailEl = document.getElementById("aDetail");
const bStatusEl = document.getElementById("bStatus");
const bClaimEl = document.getElementById("bClaim");
const evidenceIdEl = document.getElementById("evidenceId");
const disclosureIdEl = document.getElementById("disclosureId");
const timelineEl = document.getElementById("timeline");
const techPre = document.getElementById("techPre");
const aboutDialog = document.getElementById("aboutDialog");
const aboutBody = document.getElementById("aboutBody");

function setKv(el, rows) {
  el.innerHTML = "";
  for (const [k, v] of rows) {
    if (v == null || v === "") continue;
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = String(v);
    el.append(dt, dd);
  }
}

function clearUi() {
  ravenStateEl.textContent = "Evidence requested";
  ravenStateEl.className = "state busy";
  ravenDetailEl.textContent = "Waiting…";
  aOutcomeEl.textContent = "—";
  aOutcomeEl.className = "outcome";
  aDetailEl.textContent = "Evaluating…";
  bStatusEl.textContent = "Preparing claim…";
  bClaimEl.innerHTML = "";
  evidenceIdEl.innerHTML = "";
  disclosureIdEl.innerHTML = "";
  timelineEl.innerHTML = "";
}

function renderResult(result) {
  const claim = result.agentB?.claim || {};
  bStatusEl.textContent = result.agentB?.evidenceStatus === "received"
    ? "Claim + evidence supplied"
    : result.agentB?.note || "Claim path complete";
  setKv(bClaimEl, [
    ["Claim", claim.summary || claim.property],
    ["Mint", claim.mintAddress],
    ["Token program", claim.tokenProgramAddress],
    ["Chain", claim.chain],
    ["Claim id", claim.claimId],
  ]);

  const a = result.agentA || {};
  const verified = a.ravenState === "VERIFIED";
  ravenStateEl.textContent = a.ravenState || "—";
  ravenStateEl.className = "state " + (verified ? "ok" : "bad");
  ravenDetailEl.textContent = a.reason
    ? `Reason code: ${a.reason}`
    : (result.agentB?.note || "");

  const id = a.evidenceIdentity || {};
  setKv(evidenceIdEl, [
    ["Receipt id", id.receiptId],
    ["Mint on receipt", id.mintAddress],
    ["Signer", id.signerPublicKey ? id.signerPublicKey.slice(0, 24) + "…" : null],
    ["Slot", id.slot],
    ["Timestamp", id.timestamp],
  ]);

  const exchange = result.exchange || [];
  const verification = exchange.find((message) => message.type === "evidence.verification");
  const evidenceResponse = exchange.find((message) => message.type === "evidence.response");
  const disclosure =
    a.disclosure ||
    verification?.result?.disclosure ||
    null;
  const src = disclosure?.evidenceSource || evidenceResponse?.source || {};
  setKv(disclosureIdEl, [
    ["Live acquisition", disclosure ? String(disclosure.liveAcquisition === true) : String(src.liveAcquisition === true)],
    ["Evidence source", src.mode || "(none)"],
    ["Fixture", src.fixture || "(none)"],
    ["Evaluation time (verify clock)", disclosure?.evaluationTime || "(undisclosed)"],
    ["Evaluation time kind", disclosure?.evaluationTimeKind || "(undisclosed)"],
    ["Label", disclosure?.evaluationTimeLabel || "Deterministic fixture/demo evaluation time — not wall clock; not current Solana freshness"],
  ]);

  aOutcomeEl.textContent = a.decision || result.outcome || "—";
  aOutcomeEl.className = "outcome " + (a.decision === "PROCEED" ? "ok" : "bad");
  aDetailEl.textContent =
    a.decision === "PROCEED"
      ? "Downstream action may proceed — evidence independently verified."
      : "Downstream action refused — fail closed.";

  timelineEl.innerHTML = "";
  for (const step of a.timeline || []) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="s">${step.state}</span> — ${step.detail}`;
    timelineEl.append(li);
  }

  // Progressive disclosure: human labels first; axes only in details (still not raw dump by default)
  const axes = a.axes || {};
  techPre.textContent = [
    `Protocol: ${result.protocolVersion || "(legacy)"}`,
    `Exchange: ${exchange.map((message) => message.type).join(" -> ") || "(unavailable)"}`,
    ...exchange.map((message) =>
      `${message.type}: id=${message.messageId} replyTo=${message.replyTo || "(root)"}`
    ),
    `Path: ${result.path}`,
    `Decision: ${a.decision}`,
    `Raven state: ${a.ravenState}`,
    `Reason: ${a.reason}`,
    `Axes: valid=${axes.valid} keyTrusted=${axes.keyTrusted} stale=${axes.stale} subjectMatches=${axes.subjectMatches}`,
    `Integrity reasons: ${(axes.reasons || []).join(", ") || "(none)"}`,
    `Subject reasons: ${(axes.subjectReasons || []).join(", ") || "(none)"}`,
    `Verification response: ${JSON.stringify(verification?.result || null)}`,
    `Disclosure liveAcquisition: ${disclosure?.liveAcquisition}`,
    `Disclosure evaluationTime: ${disclosure?.evaluationTime}`,
    `Disclosure kind: ${disclosure?.evaluationTimeKind}`,
    `Agent B note: ${result.agentB?.note || ""}`,
  ].join("\n");
}

async function runPath(pathId) {
  clearUi();
  const buttons = document.querySelectorAll("button[data-path]");
  buttons.forEach((b) => (b.disabled = true));
  try {
    ravenStateEl.textContent = "Verifying…";
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: pathId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || "run_failed");
    renderResult(data);
  } catch (err) {
    ravenStateEl.textContent = "VERIFICATION FAILED";
    ravenStateEl.className = "state bad";
    aOutcomeEl.textContent = "REFUSE";
    aOutcomeEl.className = "outcome bad";
    aDetailEl.textContent = String(err.message || err);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

document.querySelectorAll("button[data-path]").forEach((btn) => {
  btn.addEventListener("click", () => runPath(btn.dataset.path));
});

document.getElementById("aboutBtn").addEventListener("click", async () => {
  const info = await fetch("/api/build-info").then((r) => r.json());
  aboutBody.innerHTML = `
    <p><strong>Official contest start:</strong> ${info.officialContestStart.instant}
      (${info.officialContestStart.zone})</p>
    <p><strong>Built during competition:</strong> Yes — Fair surface after contest start
      (PRE-EXISTING foundation vs FAIR WORK listed below).</p>
    <p><strong>Reported Fair commit:</strong>
      <span class="mono">${info.fairBuildCommit || "(unknown)"}</span>
      <br/><span class="muted">source: ${info.commitSource}</span></p>
    <h3>${info.labels.foundation}</h3>
    <ul>${info.preexistingFoundation.map((x) => `<li>${x}</li>`).join("")}</ul>
    <h3>${info.labels.fairApp}</h3>
    <ul>${info.fairWorkInThisApp.map((x) => `<li>${x}</li>`).join("")}</ul>
    <p class="muted">Branch: <span class="mono">${info.fairBuildBranch || "—"}</span></p>
  `;
  for (const text of ["Identity: " + info.identityStatus,
    "Warnings: " + (info.identityWarnings || []).join(", "),
    "Public UI fingerprint: " + (info.publicFingerprint?.sha256 || "unavailable"),
    info.identityLimit || "Commit not independently verified."]) {
    const p = document.createElement("p"); p.textContent = text; aboutBody.appendChild(p);
  }
  aboutDialog.showModal();
});

// Warm PATH A on load so judges see a complete interaction quickly
runPath("path_a_verified");
