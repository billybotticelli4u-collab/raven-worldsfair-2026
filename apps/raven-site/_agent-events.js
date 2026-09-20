// Agent-intent events (privacy-friendly: event name + optional flag, nothing else).
// Uses the Vercel Web Analytics custom-events queue; degrades to no-op silently.
window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
function ravenTrack(name, data) { try { window.va("event", Object.assign({ name: name }, data || {})); } catch (e) { /* no-op */ } }
document.addEventListener("click", function (e) {
  const el = e.target.closest("[data-ev]");
  if (el) ravenTrack(el.getAttribute("data-ev"));
  const a = e.target.closest("a[href]");
  if (!a) return;
  const h = a.getAttribute("href") || "";
  if (h.endsWith("agents.json")) ravenTrack("open_agents_json");
  else if (h.endsWith("openapi.json")) ravenTrack("open_openapi");
  else if (h.endsWith("access.json")) ravenTrack("open_access_json");
  else if (h.indexOf("/pubkey") !== -1) ravenTrack("open_pubkey");
  else if (h.indexOf("request-access") !== -1) ravenTrack(h.indexOf("beta=1") !== -1 ? "request_holder_beta" : "request_access");
});
document.addEventListener("click", function (e) {
  const a = e.target.closest("a[href]"); if (!a) return;
  const h = a.getAttribute("href") || "";
  if (h.endsWith("workbench.html")) ravenTrack("open_workbench");
  else if (h.endsWith("evals.json")) ravenTrack("open_evals_json");
  else if (h.endsWith("evals.html")) ravenTrack("open_evals");
  else if (h.endsWith("llms.txt")) ravenTrack("open_llms_txt");
  else if (h.endsWith("llms-full.txt")) ravenTrack("open_llms_full");
});
