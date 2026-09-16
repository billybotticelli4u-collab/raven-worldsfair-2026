const targetRow = document.getElementById("targetRow");
const targetBlurb = document.getElementById("targetBlurb");
const taskSentence = document.getElementById("taskSentence");
const runBtn = document.getElementById("runBtn");
const recordedBtn = document.getElementById("recordedBtn");
const metaKv = document.getElementById("metaKv");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const progressLog = document.getElementById("progressLog");
const sourceBanner = document.getElementById("sourceBanner");
const errorBanner = document.getElementById("errorBanner");
const overall = document.getElementById("overall");
const summaryLine = document.getElementById("summaryLine");
const countKv = document.getElementById("countKv");
const idKv = document.getElementById("idKv");
const issuePanel = document.getElementById("issuePanel");
const vectorList = document.getElementById("vectorList");
const failurePre = document.getElementById("failurePre");
const reproPre = document.getElementById("reproPre");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const aboutBtn = document.getElementById("aboutBtn");
const aboutDialog = document.getElementById("aboutDialog");
const aboutBody = document.getElementById("aboutBody");
const liveRegion = document.getElementById("liveRegion");
const alertRegion = document.getElementById("alertRegion");

const state = {
  targets: [],
  selectedId: null,
  payload: null,
  eventSource: null,
  fallbackUsed: false,
};

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function setKv(dl, pairs) {
  clearChildren(dl);
  for (const [key, value] of pairs) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value ?? "—";
    dl.append(dt, dd);
  }
}

function announce(message, urgent = false) {
  const node = urgent ? alertRegion : liveRegion;
  node.textContent = "";
  window.setTimeout(() => {
    node.textContent = message;
  }, 0);
}

function badgeClass(kind) {
  switch (kind) {
    case "PASS":
      return "pass";
    case "TIMEOUT":
      return "timeout";
    case "BOUNDARY_HOLD":
    case "SKIPPED_VECTOR":
    case "UNVERIFIED":
      return "skip";
    case "TARGET_CRASH":
    case "RUNNER_FAILURE":
    case "INVALID_OUTPUT":
    case "OUTPUT_FLOOD":
    case "BOUNDARY_ESCAPE":
      return "error";
    default:
      return "div";
  }
}

function setOutcome(text, tone = "") {
  overall.textContent = text || "—";
  overall.className = ["outcome", tone].filter(Boolean).join(" ");
}

function resetProgress(message = "No live run yet.") {
  progressBar.style.width = "0%";
  progressText.textContent = message;
  clearChildren(progressLog);
}

function appendProgress(message) {
  const item = document.createElement("li");
  item.textContent = message;
  progressLog.appendChild(item);
}

function hideBanner(node, baseClass = "banner") {
  node.className = `${baseClass} hidden`;
  node.textContent = "";
}

function showBanner(node, message, variant = "") {
  node.className = ["banner", variant].filter(Boolean).join(" ");
  node.textContent = message;
}

function sourceLabel(source) {
  if (source === "recorded_demo_report") return "Recorded demo report";
  if (source === "saved_live_report") return "Saved live report";
  return "Live run";
}

function textOnlyNode(text) {
  const span = document.createElement("span");
  span.textContent = text ?? "";
  return span;
}

function textOnlyProbe(input) {
  const probe = document.createElement("div");
  probe.textContent = String(input ?? "");
  return {
    text: probe.textContent,
    childElementCount: probe.childElementCount,
  };
}

window.__ravenTextOnlyProbe = textOnlyProbe;

function renderTargets() {
  clearChildren(targetRow);
  for (const target of state.targets) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "target-card";
    btn.dataset.id = target.id;
    btn.setAttribute("aria-pressed", String(state.selectedId === target.id));

    const id = document.createElement("span");
    id.className = "tid";
    id.textContent = target.id;
    const name = document.createElement("span");
    name.className = "tname";
    name.textContent = target.name;
    const desc = document.createElement("span");
    desc.className = "tdesc";
    desc.textContent = target.description;

    btn.append(id, name, desc);
    btn.addEventListener("click", () => selectTarget(target.id));
    targetRow.appendChild(btn);
  }
}

function selectTarget(id) {
  state.selectedId = id;
  const selected = state.targets.find((target) => target.id === id) || null;
  for (const btn of targetRow.querySelectorAll("button")) {
    const active = btn.dataset.id === id;
    btn.classList.toggle("selected", active);
    btn.setAttribute("aria-pressed", String(active));
  }
  runBtn.disabled = !selected;
  targetBlurb.textContent = selected
    ? `${selected.name}: ${selected.description}`
    : "Choose a target to load its claimed profile.";
  taskSentence.textContent = selected
    ? `Selected ${selected.id}. Run the deterministic corpus to display the engine report with live vector progress.`
    : "Pick one Raven-owned demo target and run the deterministic corpus against its claimed profile to see PASS / DIVERGENCE evidence in about 60 seconds.";
  if (selected) announce(`Selected target ${selected.id}.`);
}

function renderIssue(issue) {
  clearChildren(issuePanel);
  if (!issue) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "All vectors are PASS. No divergence, timeout, or error surfaced.";
    issuePanel.appendChild(p);
    return;
  }

  const kind = issue.display?.label || issue.status || "UNVERIFIED";
  const label = document.createElement("p");
  label.className = "label";
  label.textContent = `${kind} · first meaningful issue`;
  const title = document.createElement("p");
  title.textContent = `${issue.vector_id}: ${issue.description || "No description"}`;
  const plain = document.createElement("p");
  plain.className = "muted";
  plain.textContent = issue.display?.plainLanguage || "See evidence for engine output.";

  const compare = document.createElement("div");
  compare.className = "issue-compare";
  const expected = document.createElement("div");
  expected.className = "compare-box";
  const expectedStrong = document.createElement("strong");
  expectedStrong.textContent = "Expected";
  expected.append(expectedStrong, textOnlyNode(issue.expected?.decision ?? "—"));
  const observed = document.createElement("div");
  observed.className = "compare-box";
  const observedStrong = document.createElement("strong");
  observedStrong.textContent = "Observed";
  observed.append(observedStrong, textOnlyNode(issue.observed?.decision ?? issue.observed?.parseError ?? "null"));
  compare.append(expected, observed);

  const req = document.createElement("p");
  req.className = "muted small";
  req.textContent = issue.related_requirement || "See claimed profile rules.";

  issuePanel.append(label, title, plain, compare, req);
}

function showEvidence(result, rowEl = null) {
  for (const el of vectorList.querySelectorAll(".vec")) el.classList.remove("active");
  if (rowEl) rowEl.classList.add("active");
  failurePre.textContent = JSON.stringify(
    {
      vector_id: result.vector_id,
      description: result.description,
      status: result.status,
      display: result.display || null,
      expected: result.expected,
      observed: result.observed,
      evidence: result.evidence,
      related_requirement: result.related_requirement || null,
    },
    null,
    2,
  );
}

function renderVectors(results) {
  clearChildren(vectorList);
  for (const result of results) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "vec";

    const badge = document.createElement("span");
    badge.className = `badge ${badgeClass(result.display?.kind || result.status)}`;
    badge.textContent = result.display?.label || result.status || "UNVERIFIED";

    const body = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = result.vector_id;
    const meta = document.createElement("span");
    meta.className = "muted";
    meta.textContent = `${result.description || ""} · expected ${result.expected?.decision ?? "?"} · observed ${result.observed?.decision ?? result.observed?.parseError ?? "null"}`;
    body.append(strong, document.createElement("br"), meta);

    row.append(badge, body);
    row.addEventListener("click", () => {
      showEvidence(result, row);
      announce(`Showing evidence for ${result.vector_id}.`);
    });
    vectorList.appendChild(row);
  }
}

function renderAbout(info) {
  clearChildren(aboutBody);
  const intro = document.createElement("p");
  intro.textContent = `Commit: ${info.fairBuildCommit || "unknown"} · Branch: ${info.fairBuildBranch || "unknown"}`;
  const note = document.createElement("p");
  note.textContent = info.buildStageNote || "";
  const builtHeading = document.createElement("h3");
  builtHeading.textContent = info.labels?.fairBuilt || "Built during fair";
  const builtList = document.createElement("ul");
  for (const item of info.fairBuilt || []) {
    const li = document.createElement("li");
    li.textContent = item;
    builtList.appendChild(li);
  }
  const preHeading = document.createElement("h3");
  preHeading.textContent = info.labels?.preexisting || "Pre-existing";
  const preList = document.createElement("ul");
  for (const item of info.preexisting || []) {
    const li = document.createElement("li");
    li.textContent = item;
    preList.appendChild(li);
  }
  const contest = document.createElement("p");
  contest.className = "muted";
  contest.textContent = `Contest start: ${info.officialContestStart?.instant || "unknown"} (${info.officialContestStart?.zone || "unknown"})`;
  aboutBody.append(intro, note, builtHeading, builtList, preHeading, preList, contest);
}

function renderPayload(payload, banner = null) {
  state.payload = payload;
  const report = payload.report;
  const ui = payload.ui || {};
  const counts = ui.counts || report.summary?.counts || {};
  const overallTone = report.summary?.overall === "CONFORMANT"
    ? "ok"
    : report.summary?.overall === "INCOMPLETE"
      ? "warn"
      : "bad";

  if (banner) showBanner(sourceBanner, banner.message, banner.variant);
  else hideBanner(sourceBanner);
  hideBanner(errorBanner, "banner error");

  setOutcome(report.summary?.overall || "—", overallTone);
  summaryLine.textContent = `${report.summary?.pass ?? 0} PASS · ${report.summary?.divergence ?? 0} BEHAVIORAL_DIVERGENCE · ${report.summary?.test_count ?? 0} vectors`;
  setKv(countKv, [
    ["PASS", String(counts.PASS ?? report.summary?.pass ?? 0)],
    ["Behavioral divergence", String(counts.BEHAVIORAL_DIVERGENCE ?? report.summary?.divergence ?? 0)],
    ["Timeout", String(counts.TIMEOUT ?? 0)],
    ["Invalid output", String(counts.INVALID_OUTPUT ?? 0)],
    ["Crash", String(counts.TARGET_CRASH ?? 0)],
    ["Output flood", String(counts.OUTPUT_FLOOD ?? 0)],
    ["Incomplete", String(counts.INCOMPLETE ?? 0)],
  ]);
  setKv(idKv, [
    ["Run ID", report.run_id],
    ["Source", sourceLabel(payload.source)],
    ["Target", report.target?.id],
    ["Claimed profile", report.target?.claimed_conformance_profile],
    ["Isolation", report.isolation?.mode ? `${report.isolation.mode} (verified=${report.isolation.verified})` : "—"],
    ["Report digest", report.report_content_digest_sha256],
  ]);

  renderIssue(ui.first_issue || null);
  const results = ui.results || (report.results || []);
  renderVectors(results);
  const preferred = ui.first_issue ? results.find((item) => item.vector_id === ui.first_issue.vector_id) : results[0];
  if (preferred) {
    const firstRow = Array.from(vectorList.querySelectorAll(".vec")).find((row) => row.textContent.includes(preferred.vector_id));
    showEvidence(preferred, firstRow || null);
  } else {
    failurePre.textContent = "No vector evidence available.";
  }

  reproPre.textContent = report.reproduction?.clean_clone || report.reproduction?.one_liner || "No reproduction command available.";
  copyBtn.disabled = !report.reproduction?.one_liner;
  downloadBtn.disabled = !report;

  announce(`${sourceLabel(payload.source)} ready. Overall ${report.summary?.overall || "unknown"}.`);
}

function setRunningState(running) {
  runBtn.disabled = running || !state.selectedId;
  recordedBtn.disabled = running;
}

async function runViaPost(fallbackMessage = null) {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: state.selectedId }),
  });
  const payload = await res.json();
  if (!res.ok || payload.error) throw new Error(payload.message || payload.error || `HTTP ${res.status}`);
  renderPayload(payload, fallbackMessage ? { message: fallbackMessage, variant: "stale" } : null);
  progressBar.style.width = "100%";
  progressText.textContent = fallbackMessage ? "Live stream fell back to one-shot run." : "Live run complete.";
}

function closeStream() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

async function runLive() {
  if (!state.selectedId) return;
  closeStream();
  state.fallbackUsed = false;
  hideBanner(sourceBanner);
  hideBanner(errorBanner, "banner error");
  resetProgress(`Connecting live stream for ${state.selectedId}…`);
  setOutcome("RUNNING", "run loading-pulse");
  summaryLine.textContent = "Waiting for live progress…";
  countKv.textContent = "";
  idKv.textContent = "";
  issuePanel.textContent = "";
  vectorList.textContent = "";
  failurePre.textContent = "Waiting for vector evidence…";
  reproPre.textContent = "Run conformance to populate.";
  copyBtn.disabled = true;
  downloadBtn.disabled = true;
  setRunningState(true);

  if (!("EventSource" in window)) {
    try {
      await runViaPost("Browser lacks EventSource; showing completed live report.");
    } finally {
      setRunningState(false);
    }
    return;
  }

  let finished = false;
  let completed = 0;
  const stream = new EventSource(`/api/run-stream?target=${encodeURIComponent(state.selectedId)}`);
  state.eventSource = stream;

  stream.onmessage = async (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "run_started") {
      appendProgress(`Run ${payload.run_id} started for ${payload.target}.`);
      progressText.textContent = `Running ${payload.target}…`;
      announce(`Run started for ${payload.target}.`);
      return;
    }

    if (payload.type === "vector_finished") {
      completed = payload.index || completed + 1;
      const total = payload.total || completed;
      progressBar.style.width = `${Math.max(0, Math.min(100, Math.round((completed / total) * 100)))}%`;
      progressText.textContent = `${completed} of ${total} vectors completed.`;
      appendProgress(`${payload.vector_id}: ${payload.display?.label || payload.status}`);
      return;
    }

    if (payload.type === "run_finished") {
      finished = true;
      progressBar.style.width = "100%";
      progressText.textContent = "Live run complete.";
      renderPayload(payload.payload);
      closeStream();
      setRunningState(false);
      return;
    }

    if (payload.type === "error") {
      throw new Error(payload.message || payload.code || "stream_error");
    }
  };

  stream.onerror = async () => {
    closeStream();
    if (finished || state.fallbackUsed) {
      setRunningState(false);
      return;
    }
    state.fallbackUsed = true;
    try {
      await runViaPost("Live progress connection closed; showing completed live report.");
    } catch (err) {
      showBanner(errorBanner, String(err), "error");
      setOutcome("ERROR", "bad");
      summaryLine.textContent = String(err);
      announce(`Run failed: ${err}`, true);
    } finally {
      setRunningState(false);
    }
  };
}

async function loadRecorded() {
  hideBanner(errorBanner, "banner error");
  const list = await fetch("/api/recorded").then((res) => res.json());
  const options = list.recorded || [];
  const preferred = options.find((entry) => entry.id === "BROKEN_SUBTLE") || options[0];
  if (!preferred) throw new Error("No recorded reports available.");
  const payload = await fetch(`/api/recorded/${encodeURIComponent(preferred.id)}`).then((res) => res.json());
  if (payload.error) throw new Error(payload.message || payload.error);
  resetProgress("Recorded demo report loaded.");
  renderPayload(payload, { message: "RECORDED DEMO REPORT — immutable fallback, not a freshly executed run.", variant: "recorded" });
  announce("Recorded demo report loaded.");
}

copyBtn.addEventListener("click", async () => {
  const oneLiner = state.payload?.report?.reproduction?.one_liner;
  if (!oneLiner) return;
  try {
    await navigator.clipboard.writeText(oneLiner);
    copyBtn.textContent = "Copied";
    window.setTimeout(() => {
      copyBtn.textContent = "Copy reproduction command";
    }, 1200);
    announce("Copied reproduction command.");
  } catch {
    copyBtn.textContent = "Copy failed — select text manually";
    announce("Copy failed. Select the reproduction text manually.", true);
  }
});

downloadBtn.addEventListener("click", () => {
  if (!state.payload?.report) return;
  const blob = new Blob([JSON.stringify(state.payload.report, null, 2) + "\n"], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.payload.report.run_id || "raven-conformance-report"}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  announce("Downloaded report JSON.");
});

runBtn.addEventListener("click", () => {
  runLive().catch((err) => {
    setRunningState(false);
    closeStream();
    showBanner(errorBanner, String(err), "error");
    setOutcome("ERROR", "bad");
    summaryLine.textContent = String(err);
    announce(`Run failed: ${err}`, true);
  });
});

recordedBtn.addEventListener("click", () => {
  loadRecorded().catch((err) => {
    showBanner(errorBanner, String(err), "error");
    announce(`Recorded fallback failed: ${err}`, true);
  });
});

aboutBtn.addEventListener("click", async () => {
  const info = await fetch("/api/build-info").then((res) => res.json());
  renderAbout(info);
  aboutDialog.showModal();
});

boot().catch((err) => {
  showBanner(errorBanner, `Boot failed: ${err}`, "error");
  announce(`Boot failed: ${err}`, true);
});

async function boot() {
  const [targetsResponse, meta] = await Promise.all([
    fetch("/api/targets").then((res) => res.json()),
    fetch("/api/meta").then((res) => res.json()),
  ]);
  state.targets = targetsResponse.targets || [];
  renderTargets();
  setKv(metaKv, [
    ["Profile", `${meta.profile.name} @ ${meta.profile.version}`],
    ["Profile sha256", meta.profile.sha256],
    ["Corpus", `${meta.corpus.id} @ ${meta.corpus.version}`],
    ["Corpus sha256", meta.corpus.sha256],
    ["Vectors", String(meta.corpus.vector_count)],
  ]);
  resetProgress();
  setRunningState(false);
  if (state.targets[0]) selectTarget(state.targets[0].id);
}
