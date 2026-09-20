
function applyIdentityBadge(status) {
  let el = document.getElementById("identity-badge");
  if (!el) {
    el = document.createElement("div");
    el.id = "identity-badge";
    el.setAttribute("role", "status");
    el.style.cssText = "position:sticky;top:0;z-index:50;padding:0.4rem 0.75rem;font:600 0.85rem/1.3 system-ui,sans-serif;text-align:center";
    document.body.prepend(el);
  }
  const s = String(status || "");
  if (s === "UNKNOWN" || s === "CONFLICT") {
    el.hidden = false;
    el.textContent = s === "UNKNOWN" ? "Identity UNKNOWN — fail-closed in production" : "Identity CONFLICT — claims disagree";
    el.style.background = s === "UNKNOWN" ? "#7a1f1f" : "#7a5a00";
    el.style.color = "#fff";
  } else {
    el.hidden = true;
  }
}
/**
 * Challenge 2 Judge UI — text-only XSS-safe; live SSE progress; display adapter via server ui payload.
 */
const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  "targetRow","targetBlurb","runBtn","recordedBtn","metaKv","corpusScopeNote","overall","summaryLine",
  "countKv","idKv","vectorList","failurePre","reproPre","copyBtn","downloadBtn","aboutBtn","aboutDialog",
  "aboutBody","progressBar","progressText","progressLog","sourceBanner","errorBanner","issuePanel",
  "liveRegion","alertRegion"
].map((id) => [id, $(id)]));

let targets = [], selected = null, lastReport = null, lastRepro = "", lastSource = null;
let runGeneration = 0, eventSource = null, runInFlight = false;

function textOnly(el, v) { el.textContent = v == null ? "" : String(v); }
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
function kv(dl, pairs) {
  clear(dl);
  for (const [k, v] of pairs) {
    const dt = document.createElement("dt"); textOnly(dt, k);
    const dd = document.createElement("dd"); textOnly(dd, v ?? "—");
    dl.append(dt, dd);
  }
}
function announce(msg, assertive = false) { textOnly(assertive ? els.alertRegion : els.liveRegion, msg); }
function showError(msg) { els.errorBanner.classList.remove("hidden"); textOnly(els.errorBanner, msg); announce(msg, true); }
function clearError() { els.errorBanner.classList.add("hidden"); textOnly(els.errorBanner, ""); }
function setSourceBanner(kind, message) {
  els.sourceBanner.classList.remove("hidden", "recorded", "stale", "error");
  if (!kind) { els.sourceBanner.classList.add("hidden"); textOnly(els.sourceBanner, ""); return; }
  els.sourceBanner.classList.add(kind); textOnly(els.sourceBanner, message);
}
function badgeClass(kind) {
  if (kind === "PASS") return "pass";
  if (kind === "BEHAVIORAL_DIVERGENCE") return "div";
  if (kind === "TIMEOUT") return "timeout";
  if (["TARGET_CRASH","INVALID_OUTPUT","OUTPUT_FLOOD","RUNNER_FAILURE"].includes(kind)) return "error";
  return "skip";
}

async function boot() {
  clearError();
  try {
    const [tRes, mRes, health] = await Promise.all([
      fetch("/api/targets").then((r) => r.json()),
      fetch("/api/meta").then((r) => r.json()),
      fetch("/api/health").then((r) => r.json()).catch(() => ({ ok: false })),
    ]);
    if (!health.ok) showError("Engine health check failed — live runs may be unavailable.");
    targets = tRes.targets || [];
    clear(els.targetRow);
    for (const t of targets) {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "target-card"; btn.dataset.id = t.id;
      btn.setAttribute("aria-pressed", "false");
      for (const [cls, val] of [["tid", t.id], ["tname", t.name], ["tdesc", t.description]]) {
        const s = document.createElement("span"); s.className = cls; textOnly(s, val); btn.appendChild(s);
      }
      btn.addEventListener("click", () => selectTarget(t.id));
      els.targetRow.appendChild(btn);
    }
    kv(els.metaKv, [
      ["Profile", mRes.profile ? `${mRes.profile.name} @ ${mRes.profile.version}` : "—"],
      ["Profile sha256", mRes.profile?.sha256 || "—"],
      ["Corpus", mRes.corpus ? `${mRes.corpus.id} @ ${mRes.corpus.version}` : "—"],
      ["Corpus sha256", mRes.corpus?.sha256 || "—"],
      ["Vectors", String(mRes.corpus?.vector_count ?? "—")],
      ["Scope", mRes.corpus?.scope_note || "Raven-owned Fair demo corpus only"],
      ["UI contract", mRes.ui_contract || "—"],
    ]);
    if (mRes.corpus?.scope_note) textOnly(els.corpusScopeNote, "Corpus scope: " + mRes.corpus.scope_note);
    try {
      const saved = JSON.parse(sessionStorage.getItem("raven-conformance-last") || "null");
      if (saved?.report) {
        setSourceBanner("stale", "Showing previous-session result — not a fresh live run.");
        renderPayload(saved, { stale: true });
      }
    } catch { /* ignore */ }
  } catch (err) {
    showError("Boot failed — engine unavailable: " + err);
    textOnly(els.progressText, "Engine unavailable.");
  }
}

function selectTarget(id) {
  selected = targets.find((t) => t.id === id) || null;
  for (const btn of els.targetRow.querySelectorAll("button")) {
    const on = btn.dataset.id === id;
    btn.classList.toggle("selected", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  els.runBtn.disabled = !selected || runInFlight;
  textOnly(els.targetBlurb, selected
    ? `${selected.name}: ${selected.description} · claimed profile ${selected.claimed_conformance_profile || "—"}`
    : "Choose a target to load its claimed profile.");
}

function setRunningUi(on) {
  runInFlight = on;
  els.runBtn.disabled = on || !selected;
  els.recordedBtn.disabled = on;
  els.progressText.classList.toggle("loading-pulse", on);
}
function resetProgress() {
  clear(els.progressLog); els.progressBar.style.width = "0%";
  textOnly(els.progressText, "Starting live run…");
}
function appendProgress(line) {
  const li = document.createElement("li"); textOnly(li, line);
  els.progressLog.appendChild(li); els.progressLog.scrollTop = els.progressLog.scrollHeight;
}
function abortStream() { if (eventSource) { eventSource.close(); eventSource = null; } }

async function runConformanceLive() {
  if (!selected || runInFlight) return;
  clearError(); abortStream();
  const gen = ++runGeneration;
  resetProgress(); setRunningUi(true); setSourceBanner(null);
  textOnly(els.overall, "RUNNING"); els.overall.className = "outcome run";
  textOnly(els.summaryLine, "Live run against " + selected.id + "…");
  clear(els.vectorList); textOnly(els.failurePre, "Live run in progress…");
  clear(els.issuePanel);
  const wait = document.createElement("p"); wait.className = "muted";
  textOnly(wait, "Waiting for first vector event…"); els.issuePanel.appendChild(wait);
  announce("Starting live conformance run for " + selected.id);

  eventSource = new EventSource("/api/run-stream?target=" + encodeURIComponent(selected.id));
  eventSource.addEventListener("status", (ev) => {
    if (gen !== runGeneration) return;
    try {
      const data = JSON.parse(ev.data);
      textOnly(els.progressText, "Started live run for " + data.target);
      appendProgress("started " + data.target + " @ " + data.at);
    } catch { /* ignore */ }
  });
  eventSource.addEventListener("progress", (ev) => {
    if (gen !== runGeneration) return;
    try {
      const data = JSON.parse(ev.data);
      const pct = data.total ? Math.round((data.index / data.total) * 100) : 0;
      els.progressBar.style.width = pct + "%";
      const label = data.display?.label || data.status;
      textOnly(els.progressText, `Vector ${data.index}/${data.total}: ${data.vector_id} → ${label}`);
      appendProgress(`${data.index}/${data.total} ${data.vector_id} ${label}`);
    } catch { /* ignore */ }
  });
  eventSource.addEventListener("complete", (ev) => {
    if (gen !== runGeneration) return;
    try {
      const data = JSON.parse(ev.data);
      els.progressBar.style.width = "100%";
      textOnly(els.progressText, "Live run complete.");
      setSourceBanner(null);
      renderPayload(data, { source: "live_run" });
      try { sessionStorage.setItem("raven-conformance-last", JSON.stringify(data)); } catch { /* quota */ }
      announce("Run complete: " + (data.report?.summary?.overall || "done"));
    } catch (err) { showError("Malformed complete event: " + err); }
    finally { setRunningUi(false); abortStream(); }
  });
  eventSource.addEventListener("error", (ev) => {
    if (gen !== runGeneration) return;
    if (!runInFlight && !ev.data) return;
    if (ev.data) {
      try {
        const data = JSON.parse(ev.data);
        showError("Run failed: " + (data.message || data.error || "unknown"));
        textOnly(els.overall, "ERROR"); els.overall.className = "outcome bad";
        textOnly(els.summaryLine, data.message || data.error || "Run failed");
      } catch { showError("Run failed (unparseable error event)."); }
      setRunningUi(false); abortStream(); textOnly(els.progressText, "Live run failed.");
      return;
    }
    if (runInFlight && eventSource && eventSource.readyState === EventSource.CLOSED) {
      showError("Connection lost during run — result unverified. Retry the live run.");
      textOnly(els.overall, "UNVERIFIED"); els.overall.className = "outcome warn";
      textOnly(els.summaryLine, "Connection lost — not labeled PASS.");
      textOnly(els.progressText, "Connection lost.");
      setRunningUi(false); eventSource = null;
    }
  });
}

function renderPayload(data, opts = {}) {
  const report = data.report, ui = data.ui;
  if (!report) {
    showError("Malformed report payload — missing report.");
    textOnly(els.overall, "ERROR"); els.overall.className = "outcome bad"; return;
  }
  if (ui?.error) showError("Report could not be adapted for UI: " + ui.error + ". Not labeled PASS.");
  lastReport = report; lastSource = opts.source || data.source || "unknown";
  lastRepro = report.reproduction?.clean_clone || report.reproduction?.one_liner || "";
  const overallVal = report.summary?.overall || "UNVERIFIED";
  textOnly(els.overall, overallVal);
  els.overall.className = overallVal === "CONFORMANT" ? "outcome ok" : overallVal === "INCOMPLETE" ? "outcome warn" : "outcome bad";
  const c = ui?.counts || {};
  const divCount = report.summary?.divergence ?? report.summary?.behavioral_divergence ?? "?";
  textOnly(els.summaryLine,
    `Engine: ${report.summary?.pass ?? "?"} PASS · ${divCount} DIVERGENCE · ${report.summary?.test_count ?? "?"} vectors` +
    (opts.stale ? " · STALE session result" : "") +
    (report.isolation?.mode ? " · isolation " + report.isolation.mode : ""));
  kv(els.countKv, [
    ["Display PASS", String(c.pass ?? "—")],
    ["Behavioral divergence", String(c.behavioral_divergence ?? "—")],
    ["Timeout", String(c.timeout ?? "—")],
    ["Crash / invalid / flood", String((c.target_crash || 0) + (c.invalid_output || 0) + (c.output_flood || 0))],
    ["Skipped", String(c.skipped ?? "—")],
    ["Runner failure / incomplete", String((c.runner_failure || 0) + (c.incomplete || 0))],
    ["Execution-error vector IDs", (ui?.execution_error_vector_ids || []).join(", ") || "—"],
    ["Behavioral vector IDs", (ui?.behavioral_divergence_vector_ids || []).join(", ") || "—"],
  ]);
  kv(els.idKv, [
    ["Run ID", report.run_id || "—"],
    ["Target", report.target?.id || "—"],
    ["Claimed profile", report.target?.claimed_conformance_profile || report.claimed_profile?.name || "—"],
    ["Target sha256", report.target?.entry_sha256 || "—"],
    ["Report digest", report.report_content_digest_sha256 || "—"],
    ["Isolation", report.isolation ? (report.isolation.mode + (report.isolation.verified ? " (verified)" : " (disclosed)")) : "—"],
    ["Source", lastSource],
  ]);
  renderIssue(ui?.first_issue || null);
  renderVectors(ui?.results || report.results || []);
  if (ui?.empty) showError("Empty result set — not labeled PASS.");
  if (ui?.presentation_banner) {
    if (ui.all_error || ui.empty) showError(ui.presentation_banner);
    else announce(ui.presentation_banner, true);
  } else if (ui?.all_error) {
    const ids = (ui.execution_error_vector_ids || []).join(", ") || "(unlisted)";
    showError("ALL EXECUTION FAILURES — affected vectors: " + ids + ". Not behavioral mismatches; never PASS.");
  }
  if (ui?.mixed_execution_and_behavioral && !ui?.all_error) {
    announce(
      "Mixed run — execution errors: " +
        (ui.execution_error_vector_ids || []).join(", ") +
        " · behavioral: " +
        (ui.behavioral_divergence_vector_ids || []).join(", "),
      true,
    );
  }
  if (report.reproduction?.clean_clone) textOnly(els.reproPre, report.reproduction.clean_clone);
  else if (data.replay_command) textOnly(els.reproPre, data.replay_command);
  else textOnly(els.reproPre, lastRepro || "No reproduction command in report.");
  if (!lastRepro && data.replay_command) lastRepro = data.replay_command;
  els.copyBtn.disabled = !lastRepro; els.downloadBtn.disabled = !report;
}

function renderIssue(issue) {
  clear(els.issuePanel);
  if (!issue) {
    const p = document.createElement("p"); p.className = "muted";
    textOnly(p, "No divergence / timeout / error — all displayed vectors PASS (or empty).");
    els.issuePanel.appendChild(p);
    textOnly(els.failurePre, "All vectors PASS (or no issue rows)."); return;
  }
  const add = (label, value) => {
    const lab = document.createElement("div"); lab.className = "label"; textOnly(lab, label);
    const val = document.createElement("div"); textOnly(val, value); els.issuePanel.append(lab, val);
  };
  add("Vector", `${issue.vector_id || ""} — ${issue.description || ""}`);
  add("Display status", issue.display?.label || issue.status || "—");
  add("Plain language", issue.display?.plainLanguage || "—");
  add("Related requirement", issue.related_requirement || "—");
  const compare = document.createElement("div"); compare.className = "issue-compare";
  for (const [title, obj] of [["Expected", issue.expected], ["Observed", issue.observed]]) {
    const box = document.createElement("div"); box.className = "compare-box";
    const t = document.createElement("strong"); textOnly(t, title);
    const b = document.createElement("div"); textOnly(b, JSON.stringify(obj ?? {}, null, 2));
    box.append(t, b); compare.appendChild(box);
  }
  els.issuePanel.appendChild(compare); showEvidence(issue, null);
}

function renderVectors(results) {
  clear(els.vectorList);
  if (!results.length) {
    const empty = document.createElement("p"); empty.className = "muted";
    textOnly(empty, "No vector rows in report."); els.vectorList.appendChild(empty); return;
  }
  for (const r of results) {
    const row = document.createElement("button");
    row.type = "button"; row.className = "vec"; row.setAttribute("role", "listitem");
    const kind = r.display?.kind || (r.status === "PASS" ? "PASS" : "BEHAVIORAL_DIVERGENCE");
    const label = r.display?.label || r.status || "UNVERIFIED";
    const badge = document.createElement("span"); badge.className = "badge " + badgeClass(kind); textOnly(badge, label);
    const body = document.createElement("span");
    const strong = document.createElement("strong"); textOnly(strong, r.vector_id || "(missing id)");
    body.appendChild(strong); body.appendChild(document.createElement("br"));
    const meta = document.createElement("span"); meta.className = "muted";
    textOnly(meta, `expected ${r.expected?.decision ?? "?"} · observed ${r.observed?.decision ?? "null"}`);
    body.appendChild(meta); row.append(badge, body);
    row.addEventListener("click", () => showEvidence(r, row));
    els.vectorList.appendChild(row);
  }
}

function showEvidence(r, rowEl) {
  for (const el of els.vectorList.querySelectorAll(".vec")) el.classList.remove("active");
  if (rowEl) rowEl.classList.add("active");
  textOnly(els.failurePre, JSON.stringify({
    vector_id: r.vector_id, description: r.description, engine_status: r.status, display: r.display,
    expected: r.expected, observed: r.observed, related_requirement: r.related_requirement, evidence: r.evidence,
  }, null, 2));
}

async function loadRecorded() {
  if (runInFlight) return;
  clearError(); abortStream(); runGeneration += 1;
  textOnly(els.progressText, "Loading recorded report (not a live run)…");
  try {
    const res = await fetch("/api/recorded/BROKEN_SUBTLE");
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || res.statusText);
    setSourceBanner("recorded",
      `${data.recorded_label || "RECORDED"} · file ${data.immutable_identity?.file || "?"} · run_id ${data.immutable_identity?.run_id || "n/a"} · digest ${data.immutable_identity?.report_content_digest_sha256 || "n/a"}`);
    renderPayload(data, { source: "recorded_report" });
    announce("Loaded recorded demo report — not a live run.");
  } catch (err) { showError("Recorded report load failed: " + err); }
}

els.copyBtn.addEventListener("click", async () => {
  if (!lastRepro) return;
  try {
    await navigator.clipboard.writeText(lastRepro);
    textOnly(els.copyBtn, "Copied"); announce("Reproduction command copied");
    setTimeout(() => textOnly(els.copyBtn, "Copy reproduction command"), 1200);
  } catch { textOnly(els.copyBtn, "Copy failed — select text manually"); }
});

els.downloadBtn.addEventListener("click", async () => {
  if (!lastReport) return;
  const runId = lastReport.run_id;
  try {
    if (runId && lastSource === "live_run") {
      const res = await fetch("/api/report/" + encodeURIComponent(runId));
      if (res.ok) {
        const blob = await res.blob();
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = runId + ".json";
        a.click(); URL.revokeObjectURL(a.href); announce("Report download started"); return;
      }
    }
    const blob = new Blob([JSON.stringify(lastReport, null, 2) + "\n"], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = (runId || "raven-conformance-report") + ".json"; a.click(); URL.revokeObjectURL(a.href);
    announce("Report download started (client blob)");
  } catch (err) { showError("Download failed: " + err); }
});

els.runBtn.addEventListener("click", runConformanceLive);
els.recordedBtn.addEventListener("click", loadRecorded);
els.aboutBtn.addEventListener("click", async () => {
  try {
    const info = await fetch("/api/build-info").then((r) => r.json());
    clear(els.aboutBody);
    const addP = (text) => { const p = document.createElement("p"); textOnly(p, text); els.aboutBody.appendChild(p); };
    addP("Reported commit: " + (info.fairBuildCommit || "unknown"));
    addP("Identity: " + info.identityStatus + " / " + info.commitSource);
    applyIdentityBadge(info.identityStatus);
    addP("Warnings: " + (info.identityWarnings || []).join(", "));
    addP("Public UI fingerprint: " + (info.publicFingerprint?.sha256 || "unavailable"));
    addP(info.identityLimit || "Commit not independently verified.");
    addP(info.buildStageNote || "");
    for (const [title, items] of [[info.labels?.fairBuilt || "FAIR-BUILT", info.fairBuilt || []], [info.labels?.preexisting || "PRE-EXISTING", info.preexisting || []]]) {
      const h = document.createElement("h3"); textOnly(h, title); els.aboutBody.appendChild(h);
      const ul = document.createElement("ul");
      for (const x of items) { const li = document.createElement("li"); textOnly(li, x); ul.appendChild(li); }
      els.aboutBody.appendChild(ul);
    }
    addP(`Contest start: ${info.officialContestStart?.instant || "?"} (${info.officialContestStart?.zone || "?"})`);
    els.aboutDialog.showModal();
  } catch (err) { showError("Build info unavailable: " + err); }
});

window.__ravenTextOnlyProbe = function (hostile) {
  const probe = document.createElement("div"); probe.id = "xssProbe"; document.body.appendChild(probe);
  textOnly(probe, hostile);
  return { text: probe.textContent, html: probe.innerHTML, childElementCount: probe.childElementCount };
};

boot().catch((err) => showError("Boot failed: " + err));
