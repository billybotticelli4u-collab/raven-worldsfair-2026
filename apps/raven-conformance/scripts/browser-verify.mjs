import puppeteer from "puppeteer-core";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(__dirname, "..");
const EVIDENCE = path.join(APP, "evidence", "challenge2-judge-ui");
const PORT = Number(process.env.PORT || 8791);
const BASE = `http://127.0.0.1:${PORT}`;
const CHROME = process.env.CHROME_PATH || ["/usr/bin/google-chrome","/usr/bin/chromium"].find((p) => existsSync(p));
mkdirSync(EVIDENCE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await sleep(200);
  }
  throw new Error("server unhealthy");
}

function startServer() {
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: APP, env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: ["ignore","pipe","pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`[server] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[server:err] ${d}`));
  return child;
}

async function journey(page, targetId) {
  const actions = []; const t0 = Date.now();
  const mark = (a) => actions.push({ action: a, t_ms: Date.now() - t0 });
  await page.goto(BASE, { waitUntil: "networkidle0" }); mark("load_first_screen");
  await page.click(`[data-id="${targetId}"]`); mark(`select_${targetId}`);
  await page.waitForFunction(() => !document.getElementById("runBtn").disabled);
  await page.click("#runBtn"); mark("click_run");
  await page.waitForFunction(() => ["CONFORMANT","DIVERGENT","INCOMPLETE"].includes(document.getElementById("overall")?.textContent || ""), { timeout: 90000 });
  mark("result_visible");
  const progressEventCount = await page.$$eval("#progressLog li", (els) => els.length);
  if (progressEventCount < 1) throw new Error("no progress events");
  mark("progress_events_observed");
  const vec = await page.$("#vectorList .vec"); if (vec) await vec.click(); mark("inspect_evidence");
  await page.click("#downloadBtn"); mark("download_click");
  await page.click("#copyBtn"); mark("copy_repro");
  return {
    targetId,
    overall: await page.$eval("#overall", (el) => el.textContent.trim()),
    progressEventCount,
    elapsed_ms: Date.now() - t0,
    actions,
  };
}

const results = { started_at: new Date().toISOString(), journeys: [], checks: [], failed: [], unverified: [] };
const server = startServer();
try {
  await waitForServer();
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ["--no-sandbox","--disable-setuid-sandbox","--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(EVIDENCE, "desktop-first-screen.png"), fullPage: true });
  results.checks.push({ id: "desktop_first_screen_shot", status: "PASS" });

  const xss = await page.evaluate(() => {
    const hostile = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>`;
    const out = window.__ravenTextOnlyProbe(hostile);
    return { ...out, windowFlag: window.__xss || null };
  });
  const xssPass = xss.childElementCount === 0 && xss.windowFlag == null && xss.text.includes("<script>");
  results.checks.push({ id: "xss_text_only_hostile_markup", status: xssPass ? "PASS" : "FAIL", detail: xss });
  if (!xssPass) results.failed.push("xss_text_only_hostile_markup");

  for (const id of ["CONFORMANT_REFERENCE","BROKEN_OBVIOUS","BROKEN_SUBTLE"]) {
    const j = await journey(page, id);
    results.journeys.push(j);
    await page.screenshot({ path: path.join(EVIDENCE, `desktop-result-${id}.png`), fullPage: true });
    results.checks.push({ id: `journey_${id}`, status: "PASS", elapsed_ms: j.elapsed_ms, overall: j.overall, actions: j.actions.length });
  }

  const missing = await page.evaluate(async () => {
    const r = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target: "DOES_NOT_EXIST" }) });
    return { status: r.status, body: await r.json() };
  });
  const missingOk = missing.status === 400 && missing.body.error === "unknown_target";
  results.checks.push({ id: "missing_target_api", status: missingOk ? "PASS" : "FAIL", detail: missing });
  if (!missingOk) results.failed.push("missing_target_api");

  await page.click("#recordedBtn"); await sleep(800);
  const banner = await page.$eval("#sourceBanner", (el) => el.textContent);
  const recordedOk = /RECORDED DEMO REPORT/i.test(banner);
  results.checks.push({ id: "recorded_fallback_labeled", status: recordedOk ? "PASS" : "FAIL", banner });
  if (!recordedOk) results.failed.push("recorded_fallback_labeled");
  await page.screenshot({ path: path.join(EVIDENCE, "desktop-recorded-fallback.png"), fullPage: true });

  await page.click('[data-id="BROKEN_SUBTLE"]');
  await page.waitForFunction(() => !document.getElementById("runBtn").disabled);
  await page.click("#runBtn");
  await page.waitForFunction(() => document.getElementById("overall")?.textContent === "DIVERGENT", { timeout: 90000 });
  results.checks.push({ id: "retry_after_recorded", status: "PASS" });
  await page.screenshot({ path: path.join(EVIDENCE, "desktop-retry-after-recorded.png"), fullPage: true });

  await page.keyboard.press("Tab");
  await page.screenshot({ path: path.join(EVIDENCE, "desktop-focus.png") });
  results.checks.push({ id: "keyboard_tab_executed", status: "PASS" });

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.screenshot({ path: path.join(EVIDENCE, "mobile-first-screen.png"), fullPage: true });
  await page.click('[data-id="BROKEN_SUBTLE"]'); await page.click("#runBtn");
  await page.waitForFunction(() => document.getElementById("overall")?.textContent === "DIVERGENT", { timeout: 90000 });
  await page.screenshot({ path: path.join(EVIDENCE, "mobile-result-BROKEN_SUBTLE.png"), fullPage: true });
  results.checks.push({ id: "mobile_journey_BROKEN_SUBTLE", status: "PASS" });

  const subtle = results.journeys.find((j) => j.targetId === "BROKEN_SUBTLE");
  results.checks.push({ id: "scripted_subtle_timing", status: "PASS", elapsed_ms: subtle?.elapsed_ms, actions: subtle?.actions, note: "Scripted first-time journey — not user research." });

  await browser.close();
} catch (err) {
  results.failed.push(String(err));
  results.checks.push({ id: "browser_verify_uncaught", status: "FAIL", error: String(err) });
} finally {
  server.kill("SIGTERM");
}

const cli = spawnSync(process.execPath, ["src/cli.js", "--target", "BROKEN_SUBTLE"], { cwd: APP, encoding: "utf8", timeout: 90000 });
const cliOk = cli.status === 1 && /DIVERGENT|BEHAVIORAL_DIVERGENCE|DIVERGENCE/i.test(cli.stdout + cli.stderr);
results.checks.push({ id: "copied_command_cli_reproduction", status: cliOk ? "PASS" : "FAIL", exit: cli.status, stdout_tail: (cli.stdout || "").slice(-400) });
if (!cliOk) results.failed.push("copied_command_cli_reproduction");

results.finished_at = new Date().toISOString();
results.summary = {
  pass: results.checks.filter((c) => c.status === "PASS").length,
  fail: results.checks.filter((c) => c.status === "FAIL").length,
  unverified: results.unverified.length,
};
writeFileSync(path.join(EVIDENCE, "browser-verify-report.json"), JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results.summary, null, 2));
if (results.failed.length) { console.error("FAILED", results.failed); process.exitCode = 1; }
