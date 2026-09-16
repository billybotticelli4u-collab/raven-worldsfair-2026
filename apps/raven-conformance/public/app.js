const targetRow = document.getElementById("targetRow");
const targetBlurb = document.getElementById("targetBlurb");
const runBtn = document.getElementById("runBtn");
const metaKv = document.getElementById("metaKv");
const corpusWatch = document.getElementById("corpusWatch");
const overall = document.getElementById("overall");
const summaryLine = document.getElementById("summaryLine");
const idKv = document.getElementById("idKv");
const vectorList = document.getElementById("vectorList");
const failurePre = document.getElementById("failurePre");
const reproPre = document.getElementById("reproPre");
const copyBtn = document.getElementById("copyBtn");
const aboutBtn = document.getElementById("aboutBtn");
const aboutDialog = document.getElementById("aboutDialog");
const aboutBody = document.getElementById("aboutBody");

let targets = [];
let selected = null;
let lastReport = null;
let lastRepro = "";

function kv(dl, pairs) {
  dl.innerHTML = "";
  for (const [k, v] of pairs) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v ?? "—";
    dl.append(dt, dd);
  }
}

async function boot() {
  const [tRes, mRes] = await Promise.all([
    fetch("/api/targets").then((r) => r.json()),
    fetch("/api/meta").then((r) => r.json()),
  ]);
  targets = tRes.targets || [];
  targetRow.innerHTML = "";
  for (const t of targets) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = t.id;
    btn.dataset.id = t.id;
    btn.addEventListener("click", () => selectTarget(t.id));
    targetRow.appendChild(btn);
  }
  kv(metaKv, [
    ["Profile", `${mRes.profile.name} @ ${mRes.profile.version}`],
    ["Profile sha256", mRes.profile.sha256],
    ["Corpus", `${mRes.corpus.id} @ ${mRes.corpus.version}`],
    ["Corpus sha256", mRes.corpus.sha256],
    ["Vectors", String(mRes.corpus.vector_count)],
  ]);
}

function selectTarget(id) {
  selected = targets.find((t) => t.id === id) || null;
  for (const btn of targetRow.querySelectorAll("button")) {
    btn.classList.toggle("selected", btn.dataset.id === id);
  }
  runBtn.disabled = !selected;
  targetBlurb.textContent = selected
    ? `${selected.name}: ${selected.description}`
    : "Choose a target to load its claimed profile.";
}

async function runConformance() {
  if (!selected) return;
  runBtn.disabled = true;
  corpusWatch.textContent = `Running corpus against ${selected.id}…`;
  overall.textContent = "RUNNING";
  overall.className = "outcome";
  vectorList.innerHTML = "";
  failurePre.textContent = "Running…";
  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: selected.id }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.message || data.error);
    lastReport = data.report;
    renderReport(data.report);
  } catch (err) {
    overall.textContent = "ERROR";
    overall.className = "outcome bad";
    summaryLine.textContent = String(err);
    corpusWatch.textContent = "Run failed.";
  } finally {
    runBtn.disabled = !selected;
  }
}

function renderReport(report) {
  const ok = report.summary.overall === "CONFORMANT";
  overall.textContent = report.summary.overall;
  overall.className = ok ? "outcome ok" : "outcome bad";
  summaryLine.textContent = `${report.summary.pass} PASS · ${report.summary.divergence} DIVERGENCE · ${report.summary.harness_error || 0} HARNESS_ERROR · ${report.summary.test_count} vectors · divergent: ${(report.summary.divergent_vector_ids || []).join(", ") || "none"}`;
  corpusWatch.textContent = `Corpus ${report.corpus.id} executed. DIVERGENCE = observed ≠ expected only (not a security score).`;
  kv(idKv, [
    ["Run ID", report.run_id],
    ["Target", report.target.id],
    ["Claimed profile", report.target.claimed_conformance_profile],
    ["Target sha256", report.target.entry_sha256],
    ["Report digest", report.report_content_digest_sha256],
  ]);

  vectorList.innerHTML = "";
  for (const r of report.results) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "vec";
    const badge = document.createElement("span");
    badge.className = `badge ${r.status === "PASS" ? "pass" : "div"}`;
    badge.textContent = r.status;
    const detail = document.createElement("span");
    const label = document.createElement("strong");
    label.textContent = r.vector_id;
    const comparison = document.createElement("span");
    comparison.className = "muted";
    comparison.textContent = `expected ${r.expected.decision} · observed ${r.observed.decision ?? "null"}`;
    detail.append(label, document.createElement("br"), comparison);
    row.append(badge, detail);
    row.addEventListener("click", () => showEvidence(r, row));
    vectorList.appendChild(row);
  }

  const firstDiv = report.results.find((r) => r.status !== "PASS");
  if (firstDiv) {
    const firstBtn = vectorList.querySelector(".vec");
    // prefer divergence button
    for (const btn of vectorList.querySelectorAll(".vec")) {
      if (btn.textContent.includes(firstDiv.vector_id)) {
        showEvidence(firstDiv, btn);
        break;
      }
    }
  } else {
    failurePre.textContent = "All vectors PASS. No divergence evidence.";
  }

  lastRepro = report.reproduction.one_liner;
  reproPre.textContent = report.reproduction.clean_clone;
  copyBtn.disabled = false;
}

function showEvidence(r, rowEl) {
  for (const el of vectorList.querySelectorAll(".vec")) el.classList.remove("active");
  if (rowEl) rowEl.classList.add("active");
  failurePre.textContent = JSON.stringify(
    {
      vector_id: r.vector_id,
      description: r.description,
      status: r.status,
      expected: r.expected,
      observed: r.observed,
      evidence: r.evidence,
    },
    null,
    2,
  );
}

copyBtn.addEventListener("click", async () => {
  if (!lastRepro) return;
  try {
    await navigator.clipboard.writeText(lastRepro);
    copyBtn.textContent = "Copied";
    setTimeout(() => {
      copyBtn.textContent = "Copy reproduction command";
    }, 1200);
  } catch {
    copyBtn.textContent = "Copy failed — select text manually";
  }
});

runBtn.addEventListener("click", runConformance);

aboutBtn.addEventListener("click", async () => {
  const info = await fetch("/api/build-info").then((r) => r.json());
  aboutBody.innerHTML = `
    <p><strong>Commit:</strong> ${info.fairBuildCommit || "unknown"}<br/>
    <strong>Branch:</strong> ${info.fairBuildBranch || "unknown"}</p>
    <p>${info.buildStageNote}</p>
    <h3>${info.labels.fairBuilt}</h3>
    <ul>${(info.fairBuilt || []).map((x) => `<li>${x}</li>`).join("")}</ul>
    <h3>${info.labels.preexisting}</h3>
    <ul>${(info.preexisting || []).map((x) => `<li>${x}</li>`).join("")}</ul>
    <p class="muted">Contest start: ${info.officialContestStart.instant} (${info.officialContestStart.zone})</p>
  `;
  aboutDialog.showModal();
});

boot().catch((err) => {
  corpusWatch.textContent = `Boot failed: ${err}`;
});
