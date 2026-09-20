#!/usr/bin/env node
// Static-site integrity tests. Run: node test.mjs (from apps/raven-site).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { formatIssuedAt, formatReceiptAge, renderEvidenceCards } from "./_evidence-cards.mjs";
import {
  assertCandidateBuildInfo,
  assertCandidateVectorSet,
  candidateBuildInfoFingerprint,
  selectCanaryProfile,
} from "./scripts/canary-profile.mjs";
const dir = dirname(fileURLToPath(import.meta.url));
let fail = 0;
const t = (name, fn) => { try { fn(); console.log("ok  -", name); } catch (e) { fail++; console.error("FAIL-", name, "->", e.message); } };

class FakeNode {
  constructor(tagName) {
    this.tagName = tagName;
    this.childNodes = [];
    this.className = "";
    this.dateTime = "";
    this._textContent = "";
  }
  set textContent(value) {
    this._textContent = String(value);
    this.childNodes = [];
  }
  get textContent() {
    return this._textContent + this.childNodes.map((child) => child.textContent).join("");
  }
  appendChild(child) {
    this.childNodes.push(child);
    return child;
  }
  replaceChildren(...children) {
    this._textContent = "";
    this.childNodes = children;
  }
}

const fakeEvidenceDocument = (sourceText) => {
  const cards = new FakeNode("div");
  const source = new FakeNode("script");
  source.textContent = sourceText;
  const createdTags = [];
  return {
    cards,
    createdTags,
    createElement(tagName) {
      createdTags.push(tagName);
      return new FakeNode(tagName);
    },
    createTextNode(value) {
      const node = new FakeNode("#text");
      node.textContent = value;
      return node;
    },
    getElementById(id) {
      return id === "cards" ? cards : id === "evidence-data" ? source : null;
    },
  };
};

t("public receipt surfaces present archived evidence honestly and use one safe renderer", () => {
  const homepage = readFileSync(join(dir, "index.template.html"), "utf8");
  const receipts = readFileSync(join(dir, "receipts.template.html"), "utf8");
  const workbench = readFileSync(join(dir, "workbench.html"), "utf8");
  const examples = readFileSync(join(dir, "examples.html"), "utf8");
  const agents = readFileSync(join(dir, "agents.html"), "utf8");
  const rendererPath = join(dir, "_evidence-cards.mjs");
  const renderer = readFileSync(rendererPath, "utf8");

  for (const [name, template] of [["homepage", homepage], ["receipts", receipts]]) {
    if (!/archived compact receipt views/i.test(template)) throw new Error(name + " lacks honest compact-view wording");
    if (!/issued date(?:s)?, observed slot(?:s)?, and current age(?:s)?/i.test(template)) throw new Error(name + " lacks visible evidence-age promise");
    if (/from the live (?:Raven )?verifier|unedited (?:responses|signed)|Fresh pump\.fun|Fresh launch/i.test(template))
      throw new Error(name + " retains a stale live/fresh/unedited claim");
    if (!template.includes('src="_evidence-cards.mjs"')) throw new Error(name + " does not use the shared evidence renderer");
    if (!/Archived receipt views could not be displayed/.test(template)) throw new Error(name + " lacks a module-failure fallback");
    if (/card\.innerHTML/.test(template)) throw new Error(name + " retains an inline card renderer");
  }
  if (/\.innerHTML\s*=|insertAdjacentHTML|document\.write/.test(renderer)) throw new Error("renderer uses an HTML string sink");
  if (!/\.textContent\s*=/.test(renderer)) throw new Error("renderer does not build untrusted fields with textContent");

  const now = Date.parse("2026-06-06T12:00:00.000Z");
  if (formatIssuedAt("2026-06-04T00:00:00.000Z") !== "2026-06-04 00:00 UTC") throw new Error("issued date formatting");
  if (formatReceiptAge("2026-06-04T00:00:00.000Z", now) !== "2 days old") throw new Error("receipt age formatting");
  if (formatReceiptAge("not-a-date", now) !== "age unavailable") throw new Error("invalid date fallback");
  if (formatReceiptAge("2026-06-07T00:00:00.000Z", now) !== "clock mismatch") throw new Error("future date fallback");

  const hostile = '<img src=x onerror="globalThis.pwned=1">';
  const fakeDocument = fakeEvidenceDocument(JSON.stringify({ usdc: {
    verdict: hostile,
    mintAddress: hostile,
    findingCodes: [hostile],
    coverageGaps: [hostile],
    keyId: hostile,
  } }));
  renderEvidenceCards(fakeDocument, now);
  if (!fakeDocument.cards.textContent.includes(hostile)) throw new Error("hostile field was not preserved as text");
  if (fakeDocument.createdTags.includes("img")) throw new Error("hostile field created an HTML element");
  for (const expected of ["outcome unavailable", "issued date unavailable", "age unavailable", "slot unavailable"])
    if (!fakeDocument.cards.textContent.includes(expected)) throw new Error("missing rendered fallback: " + expected);
  if (!fakeDocument.cards.textContent.includes("Open captured hosted response JSON")) throw new Error("raw response link label missing");
  const cardLinks = [];
  const collectLinks = (node) => {
    if (node.tagName === "a") cardLinks.push(node);
    for (const child of node.childNodes) collectLinks(child);
  };
  collectLinks(fakeDocument.cards);
  if (!cardLinks.some((link) => link.href === "evidence/usdc.json")) throw new Error("card raw-response href missing");

  for (const key of ["usdc", "risk-pump", "fresh-pump"]) {
    const rawPath = join(dir, "evidence", key + ".json");
    const compactPath = join(dir, "evidence", key + ".compact.json");
    if (!existsSync(rawPath)) throw new Error("captured response missing for " + key);
    const raw = JSON.parse(readFileSync(rawPath, "utf8"));
    const compact = JSON.parse(readFileSync(compactPath, "utf8"));
    const pairs = [
      ["mintAddress", raw.rpc?.mintAddress, compact.mintAddress],
      ["observedSlot", raw.rpc?.observedSlot, compact.observedSlot],
      ["verdict", raw.verdict, compact.verdict],
      ["findingCodes", raw.findingCodes, compact.findingCodes],
      ["coverageGaps", raw.coverageGaps, compact.coverageGaps],
      ["engineVersion", raw.engineVersion, compact.engineVersion],
      ["issuedAt", raw.issuedAt, compact.issuedAt],
      ["replayHash", raw.replayHash, compact.replayHash],
      ["officialAttestationHash", raw.officialAttestationHash, compact.officialAttestationHash],
      ["keyId", raw.keyId, compact.keyId],
      ["signature", raw.signature, compact.signature],
      ["attestationPublicKey", raw.attestationPublicKey, compact.attestationPublicKey],
      ["signatureAlg", raw.signatureAlg, compact.signatureAlg],
    ];
    for (const [field, rawValue, compactValue] of pairs)
      if (JSON.stringify(rawValue) !== JSON.stringify(compactValue)) throw new Error(`${key} raw/compact mismatch: ${field}`);
  }
  if (!/historical captured responses do not contain every replay-preimage field/i.test(receipts))
    throw new Error("receipts page overstates replayHash recomputation from captured responses");
  if (!receipts.includes('href="receipt-test-vector.json"')) throw new Error("verification vector link missing");
  if (/full versions on \/receipts/i.test(workbench) || /Full receipts with verify-yourself steps/i.test(examples))
    throw new Error("inbound page still calls compact receipt views full receipts");
  if (/Recompute replayHash from the response fields/i.test(workbench + agents))
    throw new Error("public guidance still treats an arbitrary response as a complete replay preimage");
  if (!workbench.includes('href="evidence/usdc.json"')) throw new Error("workbench captured-response link missing");
  if (!/captured hosted response/i.test(examples)) throw new Error("examples page does not describe linked artifacts accurately");
  if (!/compact or captured examples are not complete replay-preimage packets/i.test(agents))
    throw new Error("agent FAQ lacks replay-preimage boundary");

  const malformed = fakeEvidenceDocument("{");
  renderEvidenceCards(malformed, now);
  if (!/temporarily unavailable/.test(malformed.cards.textContent)) throw new Error("malformed evidence fallback missing");
  const empty = fakeEvidenceDocument("{}");
  renderEvidenceCards(empty, now);
  if (!/No archived evidence is available/.test(empty.cards.textContent)) throw new Error("empty evidence fallback missing");
});

t("receipt surfaces have responsive touch targets and strict page-scoped CSP", () => {
  const template = readFileSync(join(dir, "index.template.html"), "utf8");
  const receipts = readFileSync(join(dir, "receipts.template.html"), "utf8");
  const css = readFileSync(join(dir, "_index-style.css"), "utf8");
  const config = JSON.parse(readFileSync(join(dir, "vercel.json"), "utf8"));

  if (!template.includes('href="_index-style.css"')) throw new Error("homepage stylesheet is not externalized");
  if (/<style(?:\s|>)/i.test(template) || /\sstyle=/.test(template)) throw new Error("homepage retains inline styles");
  if (!receipts.includes('href="_receipts-style.css"')) throw new Error("receipts stylesheet is not externalized");
  if (/<style(?:\s|>)/i.test(receipts) || /\sstyle=/.test(receipts)) throw new Error("receipts page retains inline styles");
  if (!/@media\s*\(max-width:\s*700px\)/.test(css)) throw new Error("narrow header layout missing");
  if (!/\.primary-nav a[^}]*min-height:\s*44px/s.test(css)) throw new Error("navigation touch targets are below 44px");

  const headers = config.headers || [];
  const global = headers.find((entry) => entry.source === "/(.*)");
  const homepage = headers.find((entry) => entry.source === "/");
  const receiptsPage = headers.find((entry) => entry.source === "/receipts.html");
  if (!global || !homepage || !receiptsPage) throw new Error("global or receipt-surface header rule missing");
  const globalNames = new Set(global.headers.map((header) => header.key.toLowerCase()));
  for (const name of ["x-content-type-options", "referrer-policy", "permissions-policy", "x-frame-options"])
    if (!globalNames.has(name)) throw new Error("missing security header " + name);
  for (const [name, entry] of [["homepage", homepage], ["receipts", receiptsPage]]) {
    const csp = entry.headers.find((header) => header.key.toLowerCase() === "content-security-policy")?.value || "";
    if (!csp.includes("default-src 'self'") || !csp.includes("object-src 'none'") || !csp.includes("frame-ancestors 'none'"))
      throw new Error(name + " CSP lacks strict baseline directives");
    if (csp.includes("'unsafe-inline'") || csp.includes("'unsafe-eval'")) throw new Error(name + " CSP permits unsafe inline/eval");
  }
});

// Deploy-time artifact test. The repo-content tests above prove the four raw
// captured responses EXIST in the tree and are LINKED by the receipt surfaces;
// none of them prove they are actually UPLOADED. A bare `evidence/` line in
// .vercelignore shipped a site where all four linked URLs 404'd while every
// repo-content test stayed green. This replicates Vercel's gitignore-style
// ignore semantics against the literal ignore file so the deployed surface is
// checked, not just the working tree.
const vercelIgnoreRules = (text) =>
  text
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim() !== "" && !line.startsWith("#"))
    .map((line) => {
      const negated = line.startsWith("!");
      let pattern = negated ? line.slice(1) : line;
      const dirOnly = pattern.endsWith("/");
      if (dirOnly) pattern = pattern.slice(0, -1);
      return { negated, pattern, dirOnly, anchored: pattern.includes("/") };
    });

// `*` and `?` never cross a path separator, matching gitignore wildcards.
const globToRegExp = (pattern) =>
  new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]") + "$");

const ruleMatches = (rule, candidate, isDir) => {
  if (rule.dirOnly && !isDir) return false;
  return globToRegExp(rule.pattern).test(rule.anchored ? candidate : candidate.split("/").pop());
};

// Last matching rule wins, EXCEPT that gitignore cannot re-include a path
// whose parent directory is itself excluded — the reason `evidence/` had to
// become `evidence/*` for the negations below it to take effect at all.
const isIgnoredByVercel = (rules, path) => {
  const segments = path.split("/");
  const decide = (candidate, isDir) => {
    let ignored = false;
    for (const rule of rules) if (ruleMatches(rule, candidate, isDir)) ignored = !rule.negated;
    return ignored;
  };
  for (let i = 1; i < segments.length; i++)
    if (decide(segments.slice(0, i).join("/"), true)) return true;
  return decide(path, false);
};

t("deployed artifacts: .vercelignore uploads every linked raw evidence response", () => {
  const rules = vercelIgnoreRules(readFileSync(join(dir, ".vercelignore"), "utf8"));

  // Sanity anchors: the matcher must actually discriminate, or the assertions
  // below would pass against a no-op implementation.
  if (isIgnoredByVercel(rules, "index.html")) throw new Error("matcher wrongly excludes index.html");
  if (!isIgnoredByVercel(rules, "build.js")) throw new Error("matcher fails to honour a plain filename exclude");
  if (!isIgnoredByVercel(rules, "operator/templates/beta-key-issued.md"))
    throw new Error("matcher fails to honour a directory exclude");

  // (a) Every raw response linked by _evidence-cards.mjs and workbench.html
  // must survive the ignore rules, or the public receipt links 404 on deploy.
  for (const key of ["usdc", "risk-pump", "fresh-pump"]) {
    const path = "evidence/" + key + ".json";
    if (!existsSync(join(dir, path))) throw new Error("linked raw response missing from tree: " + path);
    if (isIgnoredByVercel(rules, path))
      throw new Error(".vercelignore excludes a publicly linked raw response from the deploy: " + path);
  }

  // (b) The compact siblings are read only by build.js at build time and are
  // never fetched at runtime, so they must stay out of the deployed bundle.
  for (const path of ["evidence/usdc.compact.json", "evidence/risk-pump.compact.json"]) {
    if (!existsSync(join(dir, path))) throw new Error("build-time compact input missing from tree: " + path);
    if (!isIgnoredByVercel(rules, path))
      throw new Error(".vercelignore now ships a build-time-only compact receipt: " + path);
  }
});

// Owner ruling 2026-08-18: the receipt outcome enum is grade-shaped
// ("pass" is a verdict word), so public display surfaces must never render
// the raw enum or the collapsed-token example mint. The protocol schema keeps
// the enum (frozen); this gate keys on the VALUE SET in served pages, because
// phrase-based copy gates cannot see a JSON value or a <span class="mono">
// token. Embedded receipt artifacts (<script id="evidence-data">) are signed
// wire data and are stripped before matching — the ban is on RENDERING the
// enum as display copy, not on serving the signed artifacts themselves.
t("public pages never render the raw outcome enum, grade phrasing, or the collapsed-example mint", () => {
  const BANNED = [
    "pass_with_info_finding",
    "pass-grade",
    "86nn5dX7Qt6BiXu8SpncvaqJacFbU5hUmP3M3LKHpump",
  ];
  const pages = [
    "index.html", "receipts.html", "demo.html", "demo-kit.html",
    "agents.html", "workbench.html", "examples.html", "evals.html",
    "pricing.html", "agent-pack.html",
  ];
  for (const page of pages) {
    const html = readFileSync(join(dir, page), "utf8")
      .replace(/<script id="evidence-data"[^>]*>[\s\S]*?<\/script>/g, "");
    for (const token of BANNED)
      if (html.includes(token))
        throw new Error(page + " renders a banned outcome value outside embedded receipt data: " + token);
  }
});

t("agents.json is valid JSON with required fields", () => {
  const j = JSON.parse(readFileSync(join(dir, "agents.json")));
  if (j.name !== "Raven") throw new Error("name");
  for (const c of ["verify_token", "signed_attestation", "coverage_gaps", "mcp_tool", "hosted_api", "acp_provider", "holder_beta"])
    if (!j.capabilities.includes(c)) throw new Error("capability " + c);
  if (j.attestation.domain !== "raven-receipt" || j.attestation.version !== "v1") throw new Error("receipt-v1 identity");
  if (j.attestation.legacyV2?.keyId !== "rvk_c2997e90215279c2") throw new Error("legacy v2 keyId");
  for (const f of ["payloadHash", "receiptId", "signerPublicKey", "signature"])
    if (!j.attestation.receiptFields?.includes(f)) throw new Error("receipt-v1 field " + f);
  if (j.mcp.install !== "npx -y raven-verify-mcp") throw new Error("mcp install");
});
t("openapi.json is valid JSON with the contract", () => {
  const j = JSON.parse(readFileSync(join(dir, "openapi.json")));
  const req = j.paths["/verify"].post.requestBody.content["application/json"].schema.required;
  if (!req.includes("mintAddress") || !req.includes("tokenProgramAddress")) throw new Error("required fields");
  if (!j.paths["/pubkey"] || !j.paths["/healthz"] || !j.paths["/readyz"] || !j.paths["/receipt/v1"]) throw new Error("paths");
  const header = j.paths["/receipt/v1"].post.responses["200"].headers["Raven-RPC-Core-Status"];
  if (!/unauthenticated operational provenance/i.test(header.description)) throw new Error("RPC status header trust boundary");
});
t("Level-1 rollback requires false plus restart or redeploy", () => {
  const runbook = readFileSync(join(dir, "../launchguard-acp/deploy/HOSTED-VERIFIER-DEPLOY-RUNBOOK.md"), "utf8");
  if (!/Changing `RAVEN_ENABLE_RPC_CORROBORATION` does not affect an already-running\s+process\./i.test(runbook)) throw new Error("boot-time config wording");
  if (!/Rollback requires setting it to `false` and then restarting or\s+redeploying through the approved hosting process\./i.test(runbook)) throw new Error("rollback restart/redeploy wording");
  if (!/environment edit alone\s+does not disable corroboration in a running process/i.test(runbook)) throw new Error("env-only rollback wording");
});
t("hosted-verifier deploy runbook carries a superseded historical-snapshot banner", () => {
  const runbook = readFileSync(join(dir, "../launchguard-acp/deploy/HOSTED-VERIFIER-DEPLOY-RUNBOOK.md"), "utf8");
  if (!runbook.startsWith("> **HISTORICAL SNAPSHOT")) throw new Error("missing historical snapshot banner at top of file");
  if (!/superseded for current production operations/i.test(runbook)) throw new Error("missing superseded-for-production statement");
  if (!runbook.includes("../../../docs/raven/RAVEN_PRODUCTION_DEPLOYMENT_RUNBOOK.md")) throw new Error("missing relative successor link");
  if (!/Superseded by: docs\/raven\/RAVEN_PRODUCTION_DEPLOYMENT_RUNBOOK\.md/.test(runbook)) throw new Error("missing control-block superseded-by line");
  if (!existsSync(join(dir, "../../docs/raven/RAVEN_PRODUCTION_DEPLOYMENT_RUNBOOK.md"))) throw new Error("successor runbook link target does not exist");
});
t("access.json is valid JSON with 4 tiers", () => {
  const j = JSON.parse(readFileSync(join(dir, "access.json")));
  if (j.tiers.length !== 4) throw new Error("tiers " + j.tiers.length);
});
t("no secrets in static files", () => {
  const bad = [/rvk_alpha_[a-z0-9]/i, /rvk_beta_[a-z0-9]/i, /BEGIN (EC |RSA |)PRIVATE KEY/, /RAVEN_API_KEYS\s*=\s*\S/, /RAVEN_V2_SIGNING_KEY\s*=\s*\S/, /helius|quicknode|alchemy\.com\/v2/i];
  for (const f of readdirSync(dir)) {
    if (f === "test.mjs") continue; // contains deliberate secret-pattern fixtures
    if (!/\.(html|json|m?js|css|svg|md)$/.test(f)) continue;
    const s = readFileSync(join(dir, f), "utf8");
    for (const re of bad) if (re.test(s)) throw new Error(f + " matches " + re);
  }
});
t("request-access form has all feedback fields", () => {
  const s = readFileSync(join(dir, "request-access.html"), "utf8");
  for (const id of ["name", "email", "project", "usecase", "volume", "beta", "token", "role", "decision", "evother"])
    if (!s.includes('id="' + id + '"')) throw new Error("missing " + id);
  if (!s.includes('class="ev"')) throw new Error("missing evidence checkboxes");
});
t("public pages carry the correct keyId", () => {
  for (const f of ["index.html", "security.html", "agents.html"]) {
    if (!readFileSync(join(dir, f), "utf8").includes("rvk_c2997e90215279c2")) throw new Error(f);
  }
});
t("security page explains fail-closed + coverage gaps", () => {
  const s = readFileSync(join(dir, "security.html"), "utf8");
  if (!/[Ff]ail-closed/.test(s)) throw new Error("fail-closed missing");
  if (!s.includes("coverageGaps")) throw new Error("coverageGaps missing");
});
t("vulnerability reporting route exists and is linked (RFC 9116)", () => {
  // The packed canonical verifier's SECURITY.md promises a private reporting
  // route; this is the route. If the file or the link disappears, the package
  // promise dangles — this pin must fail.
  const st = readFileSync(join(dir, ".well-known", "security.txt"), "utf8");
  for (const field of ["Contact:", "Expires:", "Canonical:", "Policy:"])
    if (!st.includes(field)) throw new Error("security.txt missing " + field);
  // Field VALIDITY, not just presence: an empty Contact or an expired Expires
  // satisfies substring checks while the route silently rots. An expired file
  // is RFC-invalid, so expiry must fail the suite before it happens, not on it.
  const contact = /^Contact:[ \t]*(\S.*)$/m.exec(st);
  if (!contact || !contact[1].trim()) throw new Error("security.txt Contact has no value");
  const expires = /^Expires:[ \t]*(\S+)$/m.exec(st);
  if (!expires || Number.isNaN(Date.parse(expires[1]))) throw new Error("security.txt Expires does not parse");
  const RENEW_WITHIN_DAYS = 30;
  if (Date.parse(expires[1]) - Date.now() < RENEW_WITHIN_DAYS * 86400000)
    throw new Error("security.txt Expires is within " + RENEW_WITHIN_DAYS + " days — renew the file");
  if (!/never (include|share|send|paste)/i.test(st)) throw new Error("security.txt lacks the no-secrets instruction");
  const s = readFileSync(join(dir, "security.html"), "utf8");
  if (!s.includes(".well-known/security.txt")) throw new Error("security.html does not link the security.txt route");
  if (!/[Rr]eport a vulnerability/.test(s)) throw new Error("security.html lacks the reporting section");
});
// Owner-ratified public contact addresses (owner decision 2026-08-19). Any
// other email-shaped token on a public contact surface is an unreviewed
// contact route — the allowlist fails where a single-string denylist would
// let a *different* personal mailbox sail through.
const RATIFIED_CONTACTS = new Set([
  "security@ravenattest.com", "access@ravenattest.com",
  "partners@ravenattest.com", "raven@ravenattest.com",
]);
// Not contact routes: annotated example placeholders (form input hints).
// Obfuscated spellings are deliberately NOT enumerated — they are not working
// mailto targets, so they cannot route a stranger anywhere.
const CONTACT_PLACEHOLDERS = new Set(["you@project.xyz"]);
const assertContactAllowlist = (file, body) => {
  for (const m of body.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    const addr = m[0].toLowerCase();
    if (!RATIFIED_CONTACTS.has(addr) && !CONTACT_PLACEHOLDERS.has(addr))
      throw new Error(file + " carries unratified contact address " + m[0]);
  }
};
t("security reporting route terminates at the ratified address, never a personal mailbox", () => {
  // Owner-ratified route: security@ravenattest.com. The chain a stranger
  // follows — package SECURITY.md -> security.html / security.txt -> mailbox —
  // must end at the organisation address, not a personal one. Scope note:
  // request-access.html's access fallback is PR #171's surface, not this pin's.
  const st = readFileSync(join(dir, ".well-known", "security.txt"), "utf8");
  const contactMatch = /^Contact:[ \t]*(\S.*)$/m.exec(st);
  if (!contactMatch) throw new Error("security.txt Contact field is missing or empty");
  if (contactMatch[1].trim() !== "mailto:security@ravenattest.com")
    throw new Error("security.txt Contact is not the ratified security@ravenattest.com route");
  const s = readFileSync(join(dir, "security.html"), "utf8");
  if (!s.includes("security@ravenattest.com")) throw new Error("security.html does not expose security@ravenattest.com");
  // index.template.html/index.html are where the Gmail lived until the
  // contact migration removed it — assert the bad state cannot return to the
  // surface this change actually cleaned, not just the surfaces it added.
  for (const f of [".well-known/security.txt", "security.html", "contact.html", "index.template.html", "index.html"]) {
    const body = readFileSync(join(dir, ...f.split("/")), "utf8");
    if (/glendean03@gmail\.com/i.test(body))
      throw new Error(f + " still publishes the personal Gmail on the security/contact surface");
    assertContactAllowlist(f, body);
  }
});
t("contact page exists, routes by purpose, and carries the no-secrets instruction", () => {
  const c = readFileSync(join(dir, "contact.html"), "utf8");
  for (const addr of ["security@ravenattest.com", "access@ravenattest.com", "partners@ravenattest.com", "raven@ravenattest.com"])
    if (!c.includes(addr)) throw new Error("contact.html missing " + addr);
  for (const link of [".well-known/security.txt", "security.html", "request-access.html"])
    if (!c.includes('href="' + link + '"')) throw new Error("contact.html does not link " + link);
  if (!/never (include|share|send|paste)/i.test(c))
    throw new Error("contact.html lacks the no-secrets instruction");
});
t("security.html teaches the receipt-v1 recipe as primary; /pubkey never bootstraps trust", () => {
  const s = readFileSync(join(dir, "security.html"), "utf8");
  // The primary recipe is receipt-v1 (POST /receipt/v1): payloadHash, receiptId
  // binding, the raven-receipt/v1 signing domain, and a public v1 test vector.
  for (const needle of ["payloadHash", "receiptId", "raven-receipt", "receipt-v1-test-vector.json"])
    if (!s.includes(needle)) throw new Error("security.html missing receipt-v1 recipe element: " + needle);
  // The retired same-host bootstrap instruction must not return, in any wording.
  // ("GET https://…" is the endpoint documentation block, not an instruction.)
  if (/(fetch|fetched|retrieve|download|obtain|get(?!\s+https?:\/\/))[^<>]{0,60}\/pubkey/i.test(s) ||
      /\/pubkey[^<>]{0,60}(never hardcoded|as (the|your) (trust|source|root))/i.test(s))
    throw new Error("security.html instructs taking the trust key from same-host /pubkey");
  // v2 material may remain only under explicit legacy framing.
  if (/officialAttestationHash/.test(s) && !/[Ll]egacy/.test(s))
    throw new Error("security.html carries the v2 recipe without legacy framing");
});
t("receipt-v1 public test vector exists, parses, and is self-consistent", () => {
  const v = JSON.parse(readFileSync(join(dir, "receipt-v1-test-vector.json")));
  const r = v.receipt;
  if (!r || typeof r !== "object") throw new Error("missing receipt object");
  if (!/^sha256:[0-9a-f]{64}$/.test(r.payloadHash ?? "")) throw new Error("payloadHash shape");
  if (r.receiptId !== "raven-receipt-v1:" + r.payloadHash) throw new Error("receiptId does not bind payloadHash");
  if (!r.signature || !r.signerPublicKey) throw new Error("signature material missing");
  if (!Array.isArray(r.coverageGaps)) throw new Error("coverageGaps missing");
  if (!/cross-check/i.test(JSON.stringify(v)) || !/pin/i.test(JSON.stringify(v)))
    throw new Error("vector must frame /pubkey as cross-check and the pin as the trust decision");
  // Cryptographic assertion, not just structure: the vector a stranger is told
  // to trust must actually verify. Minimal independent canonical-JSON
  // (sorted keys, whitespace-free) — a second implementation, not the
  // producer's own module.
  const canonical = (x) => Array.isArray(x)
    ? "[" + x.map(canonical).join(",") + "]"
    : x && typeof x === "object"
      ? "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canonical(x[k])).join(",") + "}"
      : JSON.stringify(x);
  const { signature, signerPublicKey, payloadHash, receiptId, ...body } = r;
  const recomputed = "sha256:" + createHash("sha256").update(canonical(body), "utf8").digest("hex");
  if (recomputed !== payloadHash) throw new Error("vector payloadHash does not recompute from its body");
  const signedBytes = canonical({ domain: "raven-receipt", version: "v1", payloadHash });
  const pub = createPublicKey({ key: Buffer.from(signerPublicKey, "base64"), format: "der", type: "spki" });
  if (pub.asymmetricKeyType !== "ed25519") throw new Error("vector signer key is not ed25519");
  if (!verify(null, Buffer.from(signedBytes, "utf8"), pub, Buffer.from(signature, "base64")))
    throw new Error("vector signature does not verify");
});
t("Scout never says safe; uses the honest phrase", () => {
  const s = readFileSync(join(dir, "request-access.html"), "utf8");
  if (!s.includes("not enough evidence for a full pass")) throw new Error("phrase missing");
  if (!s.includes('never says "safe"')) throw new Error("never-safe rule missing");
});

t("evals.json valid with 8 evals and no auth secrets", () => {
  const j = JSON.parse(readFileSync(join(dir, "evals.json")));
  if (j.evals.length < 8) throw new Error("evals " + j.evals.length);
  if (JSON.stringify(j).match(/rvk_alpha|rvk_beta_[a-z0-9]{8,}/i)) throw new Error("secret-like string");
});
t("llms.txt + llms-full.txt + workbench.html + evals.html exist", () => {
  for (const f of ["llms.txt", "llms-full.txt", "workbench.html", "evals.html"])
    readFileSync(join(dir, f));
});
t("workbench carries keyId and the copy artifacts", () => {
  const s = readFileSync(join(dir, "workbench.html"), "utf8");
  if (!s.includes("rvk_c2997e90215279c2")) throw new Error("keyId");
  for (const ev of ["copy_curl_verify", "copy_mcp_config", "copy_acp_offering", "copy_signature_verify"])
    if (!s.includes(ev)) throw new Error("missing event " + ev);
});
t("internal links resolve to existing files", () => {
  /* existsSync imported at top */
  for (const page of ["index.html", "agents.html", "workbench.html", "evals.html", "security.html", "receipts.html", "pricing.html", "mcp.html", "contact.html"]) {
    const s = readFileSync(join(dir, page), "utf8");
    const links = [...s.matchAll(/href="([a-z0-9_.-]+\.(?:html|json|txt|svg|css|js))"/gi)].map((m) => m[1]);
    for (const l of links) if (!existsSync(join(dir, l))) throw new Error(page + " -> " + l + " missing");
  }
});

t("receipts page explains signature verification", () => {
  const s = readFileSync(join(dir, "receipts.html"), "utf8");
  if (!s.includes("/pubkey") || !/ed25519/.test(s) || !s.includes("replayHash")) throw new Error("verify steps missing");
});
t("agents.html carries the 8 AEO answers + FAQ JSON-LD + comparison", () => {
  const s = readFileSync(join(dir, "agents.html"), "utf8");
  for (const id of ["q-what", "q-when", "q-inputs", "q-output", "q-different", "q-refuses", "q-verify", "q-pay"])
    if (!s.includes('id="' + id + '"')) throw new Error("missing " + id);
  if (!s.includes("application/ld+json") || !s.includes("FAQPage")) throw new Error("JSON-LD missing");
  if (!s.includes("generic rug scanner (factual)")) throw new Error("comparison missing");
});

t("pricing page includes all four tiers", () => {
  const s = readFileSync(join(dir, "pricing.html"), "utf8");
  for (const k of ["MCP (local)", "Hosted signed API", "ACP job", "Holder-beta"]) if (!s.includes(k)) throw new Error("missing tier " + k);
});
t("no investment-advice or price-prediction language on public pages", () => {
  const forbidden = [/guaranteed returns/i, /investment returns/i, /price target/i, /will go up/i, /to the moon/i, /buy now/i, /\bprofit\b/i, /financial freedom/i, /we predict|price prediction service|predicts the price/i];
  for (const f of readdirSync(dir)) {
    if (!/\.(html|json|txt)$/.test(f)) continue;
    const s = readFileSync(join(dir, f), "utf8");
    for (const re of forbidden) if (re.test(s) && !/language-policy/.test(f)) throw new Error(f + " matches " + re);
  }
});
t("payment rail stated without investment framing", () => {
  const a = JSON.parse(readFileSync(join(dir, "agents.json")));
  if (!a.capabilities.includes("machine_receipts")) throw new Error("machine_receipts missing");
  if (!/USDC/.test(a.payment_rail) || !/not an investment/i.test(a.payment_rail)) throw new Error("payment_rail wording");
});
t("form captures preferred access path", () => {
  const s = readFileSync(join(dir, "request-access.html"), "utf8");
  if (!s.includes('id="path"') || !s.includes("Preferred access path")) throw new Error("path field missing");
});

// --- deterministic access intake (SJ1 PR B) ---
t("request-access form posts to the deterministic intake endpoint, mailto retained as fallback", () => {
  const s = readFileSync(join(dir, "request-access.html"), "utf8");
  if (!s.includes('"/api/request-access"')) throw new Error("form does not post to /api/request-access");
  if (!/mailto:access@ravenattest\.com/i.test(s)) throw new Error("mailto fallback removed or not the ratified access@ravenattest.com route");
  // Owner decision 2026-08-19: access@ravenattest.com is the only human-access
  // fallback — the personal Gmail leaves the access surface (and must not
  // return). Access and security stay separate mailboxes by design.
  if (/glendean03@gmail\.com/i.test(s)) throw new Error("personal Gmail still published as the access fallback");
});
t("access surface contact addresses are allowlisted to the ratified four", () => {
  // Allowlist, not denylist: a different personal mailbox must fail too, and
  // the intake backend is part of the access surface a fallback could hide in.
  assertContactAllowlist("request-access.html", readFileSync(join(dir, "request-access.html"), "utf8"));
  assertContactAllowlist("api/request-access.js", readFileSync(join(dir, "api", "request-access.js"), "utf8"));
});
t("request-access form forbids credentials and secrets proactively", () => {
  const s = readFileSync(join(dir, "request-access.html"), "utf8");
  // Proactive = visible on the form before submission, not only in the 422
  // rejection message (which a user only sees if the gate already caught them).
  if (!/never (include|share|paste|send)[^<]{0,90}(key|secret|seed|wallet)/i.test(s)) throw new Error("no proactive no-secrets instruction on the form");
  if (/GitHub submissions are public/i.test(s)) throw new Error("vestigial GitHub submission copy remains — no GitHub route exists");
});

// --- operator console tests ---
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync as wfs, rmSync } from "node:fs";
import { tmpdir } from "node:os";

t("operator templates exist", () => {
  for (const f of ["verdict-reply-risk.md", "verdict-reply-warning.md", "verdict-reply-pass-with-gaps.md", "verdict-reply-unknowable.md", "beta-key-issued.md", "follow-up-3-days.md", "access-declined-out-of-scope.md"])
    readFileSync(join(dir, "operator", "templates", f));
});
t("operator skills exist (9)", () => {
  const skills = readdirSync(join(dir, "operator", "skills")).filter((f) => f.endsWith(".md"));
  if (skills.length < 9) throw new Error("only " + skills.length);
});
t("operator context pack has no secrets", () => {
  const s = readFileSync(join(dir, "operator", "RAVEN_OPERATOR_CONTEXT.md"), "utf8");
  for (const re of [/rvk_alpha_[a-z0-9]/i, /rvk_beta_[a-z0-9]{8,}/i, /BEGIN [A-Z ]*PRIVATE KEY/, /bearer\s+[a-z0-9_\-\.]{24,}/i]) if (re.test(s)) throw new Error("matches " + re);
});
t("verdict reply templates never claim safe", () => {
  for (const f of readdirSync(join(dir, "operator", "templates"))) {
    const s = readFileSync(join(dir, "operator", "templates", f), "utf8");
    if (/is safe|completely safe|100% safe|\bsafe to\b/i.test(s)) throw new Error(f + " claims safe");
    if (/you should (buy|sell)|buy now/i.test(s)) throw new Error(f + " gives advice");
  }
});
t("feedback classifier returns expected buckets", () => {
  const r1 = execSync('node scripts/raven-feedback-classifier.mjs --evidence "deployer history"', { cwd: dir }).toString();
  if (!JSON.parse(r1).sanctionedEngineWork || JSON.parse(r1).bucket !== "deployer history") throw new Error("evidence bucket wrong");
  const r2 = execSync('node scripts/raven-feedback-classifier.mjs --usecase "give me buy signals before pumps"', { cwd: dir }).toString();
  if (!JSON.parse(r2).outOfScope) throw new Error("out-of-scope not flagged");
  const r3 = execSync('node scripts/raven-feedback-classifier.mjs --usecase "the docs were confusing"', { cwd: dir }).toString();
  if (JSON.parse(r3).bucket !== "docs/onboarding") throw new Error("docs bucket wrong");
});
t("problem-hunt runs without private data", () => {
  const out = execSync("node scripts/raven-problem-hunt.mjs", { cwd: dir }).toString();
  if (!out.includes("Recommended next action")) throw new Error("no recommendation section");
  if (/rvk_(alpha|beta)_[a-z0-9]{6,}/i.test(out)) throw new Error("key leaked");
});
t("daily brief generator runs (no secrets needed)", () => {
  const out = execSync("node scripts/generate-raven-daily-brief.mjs", { cwd: dir }).toString();
  if (!out.includes("Raven Daily Brief")) throw new Error("no brief");
  if (/rvk_(alpha)_[a-z0-9]{6,}/i.test(out)) throw new Error("key leaked");
});
t("change-review passes on the real tree and catches a planted secret", () => {
  execSync("node scripts/raven-change-review.mjs", { cwd: dir });
  const tmp = mkdtempSync(join(tmpdir(), "raven-fixture-"));
  wfs(join(tmp, "leak.html"), "key: rvk_alpha_deadbeefdeadbeef");
  let caught = false;
  try { execSync("node scripts/raven-change-review.mjs " + tmp, { cwd: dir, stdio: "pipe" }); }
  catch { caught = true; }
  rmSync(tmp, { recursive: true, force: true });
  if (!caught) throw new Error("planted secret NOT caught");
});
t("copy-trading references only inside guardrail files", () => {
  const allow = /RAVEN_FOCUS|RECEIPT-SPRINT|DECISION_POLICY|OPERATOR_CONTEXT|PROBLEM_HUNTING|access-declined|feedback-classifier|change-review|README|REVENUE_MODEL|agent-runtime-policy|agent-portability|test\.mjs/;
  const walk = (d) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, f.name);
      if (/private|node_modules/.test(p)) continue;
      if (f.isDirectory()) { walk(p); continue; }
      if (!/\.(html|md|js|mjs|json|txt)$/.test(f.name)) continue;
      if (/copy.?trad/i.test(readFileSync(p, "utf8")) && !allow.test(p)) throw new Error(p + " references copy-trading");
    }
  };
  walk(dir);
});

// --- crypto agility tests ---
t("key-policy.json valid, correct keyId/alg, no secret patterns", () => {
  const s = readFileSync(join(dir, "key-policy.json"), "utf8");
  const j = JSON.parse(s);
  if (j.currentReceipt?.domain !== "raven-receipt" || j.currentReceipt?.version !== "v1") throw new Error("receipt-v1 identity");
  if (j.legacyV2?.keyId !== "rvk_c2997e90215279c2") throw new Error("legacy v2 keyId");
  if (j.currentSignatureAlgorithm !== "ed25519") throw new Error("alg");
  if (!j.publicKeyEndpoint.endsWith("/pubkey")) throw new Error("endpoint");
  for (const re of [/rvk_(alpha|beta)_[a-z0-9]{6,}/i, /BEGIN [A-Z ]*PRIVATE KEY/, /bearer\s+[a-z0-9_\-\.]{24,}/i, /seed phrase|mnemonic/i]) if (re.test(s)) throw new Error("secret-like " + re);
});
t("receipts page mentions long-term verification + key binding", () => {
  const s = readFileSync(join(dir, "receipts.html"), "utf8");
  if (!s.includes("Long-term verification")) throw new Error("section missing");
  if (!/old receipts remain verifiable against the key that signed them/i.test(s)) throw new Error("binding language missing");
});
t("security page mentions cryptographic agility", () => {
  if (!readFileSync(join(dir, "security.html"), "utf8").includes("Cryptographic agility")) throw new Error("missing");
});
t("agents.json + llms-full.txt reference the key policy", () => {
  const a = JSON.parse(readFileSync(join(dir, "agents.json")));
  if (!a.attestation.keyPolicyUrl?.includes("key-policy.json")) throw new Error("agents.json");
  if (!a.capabilities.includes("crypto_agility") || !a.capabilities.includes("key_policy")) throw new Error("capabilities");
  if (!readFileSync(join(dir, "llms-full.txt"), "utf8").includes("key-policy.json")) throw new Error("llms-full");
});
t("no public page claims post-quantum security", () => {
  for (const f of readdirSync(dir)) {
    if (!/\.(html|json|txt|md)$/.test(f)) continue;
    const s = readFileSync(join(dir, f), "utf8");
    if (/post-quantum secure|quantum-proof|quantum-safe guarantee/i.test(s) && !/key-policy|language-policy|RAVEN_KEY_POLICY|rubrics/.test(f)) throw new Error(f + " overclaims");
  }
});
t("no macro/asset-call language on public pages", () => {
  for (const f of readdirSync(dir)) {
    if (!/\.(html|json|txt|md)$/.test(f)) continue;
    const s = readFileSync(join(dir, f), "utf8");
    for (const re of [/dollar collapse/i, /buy (gold|bitcoin)/i, /quantum will break bitcoin/i, /portfolio advice/i]) if (re.test(s) && !/RAVEN_CRYPTO_AGILITY|raven-skill|raven\.skill|raven-agent|ABUSE_RUNBOOK|abuse|decision-policy|RAVEN_DECISION_POLICY|language-policy|rubrics|launchguard-readiness|key-policy|anti-slop|test\.mjs/.test(f)) throw new Error(f + " " + re);
  }
});

// --- agent workbench pack + receipt storage tests ---
t("workbench pack files exist", () => {
  for (const f of ["agent-pack.html", "raven-agent-context.md", "raven-agent-skill.md", "prompt-recipes.json", "demo-kit.html"]) readFileSync(join(dir, f));
});
t("receipt storage files exist", () => {
  for (const f of ["receipt-storage.html", "receipt-schema.json", "receipt-wire-schema.json", "receipt-storage-adapters.json", "receipt-memory-policy.md", "delegate-key-policy.html", "feedback-for-agents.html"]) readFileSync(join(dir, f));
});
t("prompt-recipes valid: 12 recipes, refusal rules, no keys", () => {
  const s = readFileSync(join(dir, "prompt-recipes.json"), "utf8");
  const j = JSON.parse(s);
  if (j.recipes.length < 12) throw new Error("recipes " + j.recipes.length);
  for (const r of j.recipes) if (!r.refusal_rules) throw new Error(r.name + " no refusal_rules");
  if (/rvk_(alpha|beta)_[a-z0-9]{6,}|BEGIN [A-Z ]*PRIVATE KEY/i.test(s)) throw new Error("secret-like");
});
t("skill file: receipt-v1 fields + no invented verdict + full-pass phrase + banned advice", () => {
  const s = readFileSync(join(dir, "raven-agent-skill.md"), "utf8");
  for (const f of ["payloadHash", "receiptId", "signerPublicKey"]) if (!s.includes(f)) throw new Error(f);
  if (!/Receipt-v1 has no verdict\/authorization field/i.test(s)) throw new Error("receipt-v1 verdict boundary");
  if (!s.includes("not enough evidence for a full pass")) throw new Error("phrase");
  if (!/trading advice; price prediction/i.test(s)) throw new Error("banned actions");
});
t("receipt-schema requires the verification fields", () => {
  const j = JSON.parse(readFileSync(join(dir, "receipt-schema.json")));
  for (const f of ["keyId", "replayHash", "officialAttestationHash", "observedSlot", "engineVersion", "coverageGaps", "rawResponse"]) if (!j.required.includes(f)) throw new Error("missing required " + f);
  if (!/storage envelope/i.test(j.title + j.description)) throw new Error("storage-envelope disambiguation missing");
  if (!j.description.includes("receipt-wire-schema.json")) throw new Error("no pointer to wire schema");
});
t("wire schema matches the actual vector receipt (F1)", () => {
  const schema = JSON.parse(readFileSync(join(dir, "receipt-wire-schema.json")));
  const r = JSON.parse(readFileSync(join(dir, "receipt-test-vector.json"))).receipt;
  for (const f of schema.required) if (!(f in r)) throw new Error("vector receipt missing required " + f);
  if (schema.properties.unsigned !== false) throw new Error("schema must forbid receipt.unsigned");
  if ("unsigned" in r) throw new Error("vector receipt contains unsigned");
  if (!schema.properties.verdict.enum.includes(r.verdict)) throw new Error("verdict not in enum");
  if (schema.additionalProperties !== true) throw new Error("must stay forward-compatible (additionalProperties true)");
});
t("wire schema is discoverable (llms.txt + agents.json)", () => {
  if (!readFileSync(join(dir, "llms.txt"), "utf8").includes("receipt-wire-schema.json")) throw new Error("llms.txt");
  const a = JSON.parse(readFileSync(join(dir, "agents.json")));
  if (!a.attestation.legacyV2?.wireReceiptSchema?.includes("receipt-wire-schema.json")) throw new Error("agents.json legacy v2 attestation");
  if (!a.attestation.testVector?.includes("receipt-v1-test-vector.json")) throw new Error("agents.json receipt-v1 vector");
});
t("memory policy: raw truth, never safe, full-pass phrase, verify-before-use, storage-optional", () => {
  const s = readFileSync(join(dir, "receipt-memory-policy.md"), "utf8");
  for (const p of ["source of truth", "Never call a token safe", "not enough evidence for a full pass", "unusable", "never alters the signed receipt or separate"]) if (!s.includes(p)) throw new Error("missing: " + p);
});
t("adapters all documented_only; walrus optional, no live claim", () => {
  const j = JSON.parse(readFileSync(join(dir, "receipt-storage-adapters.json")));
  for (const a of j.adapters) if (a.status !== "documented_only") throw new Error(a.name + " not documented_only");
  const w = j.adapters.find((a) => a.name === "walrus_harbor_optional");
  if (!/No production integration exists/i.test(w.notes) || !/server-side proxy REQUIRED/i.test(w.secrets_required + w.notes)) throw new Error("walrus wording");
});
t("delegate key policy: no keys in browser/repos/memory", () => {
  const s = readFileSync(join(dir, "delegate-key-policy.html"), "utf8");
  for (const p of ["No API keys in browser code", "No API keys in public repos", "agent memory"]) if (!s.includes(p)) throw new Error("missing: " + p);
});
t("agents.json + llms-full reference pack and storage; workbench links pack", () => {
  const a = JSON.parse(readFileSync(join(dir, "agents.json")));
  if (!a.agent_workbench?.pack || !a.receipt_storage?.schema) throw new Error("agents.json refs");
  for (const c of ["agent_workbench_pack", "prompt_recipes", "receipt_verification", "human_escalation_policy"]) if (!a.capabilities.includes(c)) throw new Error("cap " + c);
  const lf = readFileSync(join(dir, "llms-full.txt"), "utf8");
  if (!lf.includes("Agent workbench usage") || !lf.includes("receipt-memory-policy.md")) throw new Error("llms-full");
  if (!readFileSync(join(dir, "workbench.html"), "utf8").includes("agent-pack.html")) throw new Error("workbench link");
});
t("form captures receipt storage / agent memory need", () => {
  const s = readFileSync(join(dir, "request-access.html"), "utf8");
  if (!s.includes('id="storage"') || !s.includes("Receipt storage/agent memory")) throw new Error("storage field missing");
});

// --- posture / skill / quality-ledger tests ---
t("raven-skill.md exists with full-pass phrase + forbidden claims + error handling", () => {
  const s = readFileSync(join(dir, "raven-skill.md"), "utf8");
  for (const p of ["not enough evidence for a full pass", "FORBIDDEN CLAIMS", "ERROR HANDLING", "rvk_c2997e90215279c2"]) if (!s.includes(p)) throw new Error("missing " + p);
});
t("receipts page: cryptographic posture + storage + key rotation", () => {
  const s = readFileSync(join(dir, "receipts.html"), "utf8");
  for (const p of ["Cryptographic posture", "Receipt storage for agents", "original keyId", "not replacement truth"]) if (!s.includes(p)) throw new Error("missing " + p);
});
t("security page has cryptographic posture", () => {
  if (!readFileSync(join(dir, "security.html"), "utf8").includes("Cryptographic posture")) throw new Error("missing");
});
t("workbench contains handoff policy", () => {
  const s = readFileSync(join(dir, "workbench.html"), "utf8");
  if (!s.includes("Agent handoff") || !/risk/.test(s)) throw new Error("missing");
});
t("quality ledger on evals page with invariants + limitations", () => {
  const s = readFileSync(join(dir, "evals.html"), "utf8");
  for (const p of ["Quality Ledger", "Known limitations", "USDC returns"]) if (!s.includes(p)) throw new Error("missing " + p);
});
t("agents.json: handoff_policy + skill_file + quality_ledger + posture caps", () => {
  const a = JSON.parse(readFileSync(join(dir, "agents.json")));
  if (!a.handoff_policy?.risk || !a.skill_file?.includes("raven-skill.md") || !a.quality_ledger) throw new Error("fields");
  for (const c of ["receipt_storage_guidance", "cryptographic_posture", "handoff_policy"]) if (!a.capabilities.includes(c)) throw new Error("cap " + c);
});
t("no yield/prediction-market language on public pages", () => {
  for (const f of readdirSync(dir)) {
    if (!/\.(html|json|txt|md)$/.test(f)) continue;
    const s = readFileSync(join(dir, f), "utf8");
    for (const re of [/yield farming/i, /\bAPY\b/, /expected return/i, /prediction market/i, /private banker/i]) if (re.test(s) && !/raven-skill|test\.mjs/.test(f)) throw new Error(f + " " + re);
  }
});

// --- consolidation pass tests ---
t("new JSON artifacts all valid", () => {
  for (const f of ["key-policy.json","payment-policy.json","evidence-sources.json","receipt-storage.json","quality-ledger.json","examples.json"]) JSON.parse(readFileSync(join(dir, f)));
});
t("new md + html files exist", () => {
  for (const f of ["raven.skill.md","AGENTS.md","RAVEN_KEY_POLICY.md","ABUSE_RUNBOOK.md","QUALITY_LEDGER.md","INTEGRATOR_FEEDBACK_TEMPLATE.md","skills.html","key-policy.html","payment-policy.html","evidence-sources.html","quality-ledger.html","abuse.html","examples.html","integrator-feedback.html"]) readFileSync(join(dir, f));
});
t("key policy page: Ed25519 + rotation + no quantum fear", () => {
  const s = readFileSync(join(dir, "key-policy.html"), "utf8");
  if (!s.includes("Ed25519") || !/rotation remains explicit/i.test(s) || !/rotation never silently rewrites historical receipts/i.test(readFileSync(join(dir, "security.html"), "utf8"))) throw new Error("content");
  if (/quantum (will|is going to) break|urgent.*quantum/i.test(s)) throw new Error("fear language");
});
t("payment policy: USDC/ACP + not investment + no yield", () => {
  const j = JSON.parse(readFileSync(join(dir, "payment-policy.json")));
  if (j.rails.acp.settlement.indexOf("USDC") < 0) throw new Error("USDC");
  if (!j.hard_limits.includes("not an investment product") || !j.hard_limits.includes("no yield")) throw new Error("limits");
});
t("evidence registry: exclusions + fail-closed", () => {
  const j = JSON.parse(readFileSync(join(dir, "evidence-sources.json")));
  for (const x of ["social sentiment","price prediction"]) if (!j.excluded_by_design.includes(x)) throw new Error(x);
  if (!/fails closed/i.test(j.note)) throw new Error("fail-closed");
});
t("abuse page: prompt injection + rpcUrl/issuerIdentity rejection + no executable skills", () => {
  const s = readFileSync(join(dir, "abuse.html"), "utf8");
  for (const p of ["Prompt injection","rpcUrl","issuerIdentity","executable"]) if (!s.includes(p)) throw new Error(p);
});
t("receipt-storage.json: never store secrets + append-only", () => {
  const j = JSON.parse(readFileSync(join(dir, "receipt-storage.json")));
  if (!j.never_store.includes("API keys")) throw new Error("never_store");
  if (!j.retention.some((r) => /append-only/i.test(r))) throw new Error("append-only");
});
t("skills page: full-pass phrase + per-tool blocks + quick commands", () => {
  const s = readFileSync(join(dir, "skills.html"), "utf8");
  for (const p of ["not enough evidence for a full pass","Claude Code","raven-escalate-on-gaps"]) if (!s.includes(p)) throw new Error(p);
});
t("agents.json consolidated: 20 caps + payment block + registries", () => {
  const a = JSON.parse(readFileSync(join(dir, "agents.json")));
  for (const c of ["key_agility","receipt_archive_pattern","evidence_source_registry"]) if (!a.capabilities.includes(c)) throw new Error(c);
  if (a.payment.investment_product !== false || a.payment.yield !== false || a.payment.custody !== false) throw new Error("payment flags");
  if (!a.trust_policy.evidence_source_registry) throw new Error("registry ref");
});
t("quality-ledger.json: no fake history, rules present", () => {
  const j = JSON.parse(readFileSync(join(dir, "quality-ledger.json")));
  if (!j.rules.some((r) => /failing eval becomes a build order/.test(r))) throw new Error("rules");
  if (!j.latestPublicBlackboxRun.date) throw new Error("run date");
});

// --- decision/status policy tests ---
t("decision-policy.json + status-policy.json valid with required rules", () => {
  const d = JSON.parse(readFileSync(join(dir, "decision-policy.json")));
  if (d.verdictActions.risk !== "block or escalate") throw new Error("risk");
  if (!/escalation|approval/i.test(d.verdictActions.warning)) throw new Error("warning");
  if (!/do not proceed as verified/.test(d.verdictActions.unknowable)) throw new Error("unknowable");
  if (!d.prohibitedClaims.includes("safe")) throw new Error("prohibited");
  if (!/treasury, investment, trading, legal, or portfolio advice/.test(d.noFinancialAdvice)) throw new Error("nofa");
  if (d.staleReceiptRule.recommended_defaults.pre_trade_spend_listing !== "re-verify immediately") throw new Error("stale");
  const s = JSON.parse(readFileSync(join(dir, "status-policy.json")));
  if (!/Render/.test(s.components.hosted_verifier)) throw new Error("render");
  if (!s.hard_rules.some((r) => /rpcUrl/.test(r)) || !s.hard_rules.some((r) => /issuerIdentity/.test(r))) throw new Error("rejections");
});
t("policy pages + md exist; agents.json links them", () => {
  for (const f of ["decision-policy.html", "status-policy.html", "RAVEN_DECISION_POLICY.md"]) readFileSync(join(dir, f));
  const a = JSON.parse(readFileSync(join(dir, "agents.json")));
  if (!a.decision_policy?.includes("decision-policy.json") || !a.status_policy?.includes("status-policy.json")) throw new Error("links");
  for (const c of ["decision_policy", "stale_receipt_policy", "operational_dependency_disclosure", "governance_preflight"]) if (!a.capabilities.includes(c)) throw new Error(c);
});
t("skill carries preflight order + staleness + liquidity refusal", () => {
  const s = readFileSync(join(dir, "raven.skill.md"), "utf8");
  for (const p of ["BEFORE ACTING ON A TOKEN", "staleness", "liquidity quality without pool evidence", "not enough evidence for a full pass"]) if (!s.includes(p)) throw new Error(p);
});
t("governance Q&A present; trust machinery visible", () => {
  const d = readFileSync(join(dir, "decision-policy.html"), "utf8");
  if (!d.includes("governance-constrained") || !d.includes("buy or hold")) throw new Error("QA");
  if (!readFileSync(join(dir, "quality-ledger.html"), "utf8").includes("Visible trust machinery")) throw new Error("machinery");
});
t("no finance-product references on public pages", () => {
  for (const f of readdirSync(dir)) {
    if (!/\.(html|json|txt|md)$/.test(f)) continue;
    const s = readFileSync(join(dir, f), "utf8");
    for (const re of [/\bSTRC\b/, /\bStrive\b/, /preferred equity/i, /dividend/i, /treasury strategy/i, /battery storage/i]) if (re.test(s) && !/test\.mjs/.test(f)) throw new Error(f + " " + re);
  }
});

t("receipt test vector valid and self-consistent", () => {
  const v = JSON.parse(readFileSync(join(dir, "receipt-test-vector.json")));
  if (v.pubkey_response.keys[0].keyId !== v.receipt.keyId) throw new Error("keyId mismatch");
  if (v.expected.officialAttestationHash !== v.receipt.officialAttestationHash) throw new Error("hash mismatch");
});
t("abuse page grounded in real incidents; payment policy names x402 as documented-only", () => {
  if (!readFileSync(join(dir, "abuse.html"), "utf8").includes("real incidents")) throw new Error("incidents");
  const p = JSON.parse(readFileSync(join(dir, "payment-policy.json")));
  if (!/DOCUMENTED ONLY/.test(p.future_rails.x402)) throw new Error("x402 claim risk");
});
t("runnable examples parse and refuse unsafe language", () => {
  const g = readFileSync(join(dir, "examples/preflight-gate.mjs"), "utf8");
  if (!g.includes("not enough evidence for a full pass")) throw new Error("phrase");
  if (/\bsafe\b/i.test(g)) throw new Error("'safe' in example");
});

// --- curated ChatGPT pass tests ---
t("runtime/language/readiness/rubrics JSONs valid with required fields", () => {
  const r = JSON.parse(readFileSync(join(dir, "agent-runtime-policy.json")));
  if (r.requiresWalletAccess !== false || r.submitsTransactions !== false) throw new Error("runtime flags");
  const l = JSON.parse(readFileSync(join(dir, "language-policy.json")));
  if (!l.bannedPhrases.includes("safe") || l.requiredPhrases.gapsRemain !== "not enough evidence for a full pass") throw new Error("language");
  const rd = JSON.parse(readFileSync(join(dir, "launchguard-readiness.json")));
  if (!rd.pilotPackage.day0 || !rd.checklist.some((c) => /policy changes/.test(c.q))) throw new Error("readiness");
  const ru = JSON.parse(readFileSync(join(dir, "rubrics.json")));
  if (ru.rubrics.length < 13) throw new Error("rubrics " + ru.rubrics.length);
});
t("key policy: no quantum claims, retiring state, rotation triggers, trust margin", () => {
  const k = JSON.parse(readFileSync(join(dir, "key-policy.json")));
  if (k.quantumSafeClaim !== false || k.postQuantumClaim !== false) throw new Error("claims");
  if (!k.keyStates.retiring || !k.rotationTriggers || !k.trustMargin) throw new Error("fields");
  if (!k.futureMigrationPrinciples.some((p) => /additive/i.test(p))) throw new Error("additive");
});
t("skill has the 12-step procedure incl. runtime policy + buy/sell refusal", () => {
  const s = readFileSync(join(dir, "raven.skill.md"), "utf8");
  if (!s.includes("12. Re-verify before any delayed material action")) throw new Error("12 steps");
  if (!s.includes("agent-runtime-policy")) throw new Error("runtime ref");
  if (!/does not provide trading,\s*\ninvestment, treasury, legal, tax, or portfolio advice|does not provide trading,\ninvestment/.test(s) && !s.includes("treasury, legal, tax, or portfolio advice")) throw new Error("refusal");
});
t("workbench has action-context selector; agents page has LaunchGuard positioning", () => {
  const w = readFileSync(join(dir, "workbench.html"), "utf8");
  if (!w.includes('id="actx"') || !w.includes("Re-verify at execution time")) throw new Error("selector");
  const a = readFileSync(join(dir, "agents.html"), "utf8");
  for (const p of ["preflight receipt before agent action", "Harness, not hype", "Cheap deterministic preflight", "no wallet signer access"]) if (!a.includes(p)) throw new Error(p);
});
t("decision policy: material actions + extended escalation triggers", () => {
  const d = JSON.parse(readFileSync(join(dir, "decision-policy.json")));
  if (!d.materialActionExamples.includes("publish token as verified")) throw new Error("materials");
  if (!d.humanEscalationTriggers.includes("signature verification failure")) throw new Error("triggers");
});
t("agents.json links the four new policies with 30 caps", () => {
  const a = JSON.parse(readFileSync(join(dir, "agents.json")));
  for (const f of ["runtime_policy", "language_policy", "readiness_checklist", "rubrics"]) if (!a[f]) throw new Error(f);
  if (a.trust_policy.no_wallet_signer_access !== true) throw new Error("wallet flag");
});

// --- portability/rollout/surfaces tests ---
t("portability/rollout/surfaces JSONs valid with required fields", () => {
  const p = JSON.parse(readFileSync(join(dir, "agent-portability.json")));
  if (p.portableArtifact !== "signed_receipt" || !p.forbiddenSurfacesAsAuthority.includes("screenshot")) throw new Error("portability");
  if (!p.contextEngineering.ignoredOrRejectedContext.some((c) => /rpcUrl/.test(c))) throw new Error("context");
  const r = JSON.parse(readFileSync(join(dir, "launchguard-rollout.json")));
  for (const ph of ["shadow", "advisory", "enforced", "tuning"]) if (!r.phases[ph]) throw new Error("phase " + ph);
  const d = JSON.parse(readFileSync(join(dir, "deployment-surfaces.json")));
  if (Object.keys(d.surfaces).length < 6) throw new Error("surfaces");
});
t("runtime entitlements + decision final-authority + memory policy fields", () => {
  const r = JSON.parse(readFileSync(join(dir, "agent-runtime-policy.json")));
  if (!r.forbiddenPermissions.some((x) => /wallet signer/.test(x)) || !r.forbiddenPermissions.some((x) => /LLM to override/.test(x))) throw new Error("entitlements");
  const dp = JSON.parse(readFileSync(join(dir, "decision-policy.json")));
  if (dp.finalDecisionOwner !== "integrator_policy" || dp.ravenMakesBusinessDecision !== false) throw new Error("authority");
  const rs = JSON.parse(readFileSync(join(dir, "receipt-storage.json")));
  if (rs.memoryPolicy.summaryIsNotAuthority !== true || !rs.memoryPolicy.requiredStoredFields.includes("decisionPolicyVersion")) throw new Error("memory");
});
t("copy: workflow/bot/agent contract + context rule + agency + SPADE loop", () => {
  const a = readFileSync(join(dir, "agents.html"), "utf8");
  if (!a.includes("Not every integration has to be an agent")) throw new Error("contract copy");
  const l = JSON.parse(readFileSync(join(dir, "language-policy.json")));
  if (!/only the signed receipt states what Raven actually checked/.test(l.contextRule)) throw new Error("context rule");
  if (!readFileSync(join(dir, "decision-policy.html"), "utf8").includes("Final authority")) throw new Error("agency");
  if (!readFileSync(join(dir, "launchguard-readiness.html"), "utf8").includes("Integration loop")) throw new Error("loop");
  const sk = readFileSync(join(dir, "raven.skill.md"), "utf8");
  if (!sk.includes("CONTEXT IS NOT EVIDENCE") || !sk.includes("memory is not authority")) throw new Error("skill");
});
t("no transcript brand names as Raven claims", () => {
  for (const f of readdirSync(dir)) {
    if (!/\.(html|json|txt)$/.test(f)) continue;
    const s = readFileSync(join(dir, f), "utf8");
    for (const re of [/Qualcomm/i, /\bCopilot\b/i, /BlackRock/i, /Aladdin/i, /\bNPU\b/, /Agent 365/i]) if (re.test(s)) throw new Error(f + " " + re);
  }
});

// --- quality-gate / anti-slop / drills tests ---
t("anti-slop + drills JSONs valid with core boundaries", () => {
  const s = JSON.parse(readFileSync(join(dir, "anti-slop-policy.json")));
  if (!s.llmForbiddenActions.some((x) => /upgrade a verdict/.test(x))) throw new Error("upgrade");
  if (s.summaryContract.summaryIsAuthority !== false || !s.summaryContract.requiredSummaryFields.includes("coverageGaps")) throw new Error("summary");
  if (s.generatedCodePolicy.generatedCodeTrustLevel !== "untrusted_until_tests_pass") throw new Error("codegate");
  const d = JSON.parse(readFileSync(join(dir, "failure-drills.json")));
  if (d.drills.length < 15) throw new Error("drills " + d.drills.length);
  for (const n of ["tampered receipt", "stale receipt", "verifier unavailable", "prompt injection", "screenshot-only verification"]) if (!d.drills.some((x) => x.name === n)) throw new Error(n);
});
t("quality ledger: good/bad metrics + neutrality + deterministic-first", () => {
  const q = JSON.parse(readFileSync(join(dir, "quality-ledger.json")));
  if (!q.badMetrics.includes("tokensConsumed") || !q.badMetrics.includes("numberOfAgentSteps")) throw new Error("bad");
  if (!q.goodMetrics.includes("externalReceiptReuseCount")) throw new Error("good");
  if (q.modelNeutrality.verdictDependsOnLLM !== false) throw new Error("neutrality");
  if (!/stays deterministic/.test(q.deterministicFirst.rule)) throw new Error("deterministic");
});
t("portability: discovery is not verification; rubrics: 16 incl. tamper-tested", () => {
  const p = JSON.parse(readFileSync(join(dir, "agent-portability.json")));
  if (!/never VERIFY/.test(p.contextEngineering.discoveryIsNotVerification)) throw new Error("discovery");
  const r = JSON.parse(readFileSync(join(dir, "rubrics.json")));
  if (r.rubrics.length < 16 || !r.rubrics.some((x) => x.id === "tamper_rejection_tested")) throw new Error("rubrics");
});
t("agents page: right sequence + prohibited sequence + harness line", () => {
  const a = readFileSync(join(dir, "agents.html"), "utf8");
  for (const p of ["verification sequence", "Prohibited sequence", "not a model wrapper", "verification harness"]) if (!a.includes(p)) throw new Error(p);
});

t("portability multi-agent rules + ledger cost/latency folds", () => {
  const p = JSON.parse(readFileSync(join(dir, "agent-portability.json")));
  if (!/exact signed receipt JSON/.test(p.multiAgentRules.handoff)) throw new Error("handoff");
  if (!/decision policy win/.test(p.multiAgentRules.disagreement)) throw new Error("disagree");
  if (!p.driftControls.some((x) => /verdict flips/.test(x))) throw new Error("drift");
  const q = JSON.parse(readFileSync(join(dir, "quality-ledger.json")));
  if (!/evidence per action, not tokens consumed/.test(q.costLatency.principle)) throw new Error("principle");
  if (!q.costLatency.costGuidance.some((x) => /deterministic function/.test(x))) throw new Error("cost");
});

t("threat model: input boundary + STRIDE + tool separation", () => {
  const tm = JSON.parse(readFileSync(join(dir, "agent-threat-model.json")));
  for (const r of ["rpcUrl", "issuerIdentity"]) if (!tm.inputBoundary.rejectedInputs.includes(r)) throw new Error(r);
  if (!tm.strideMapping.denialOfService.some((x) => /loop/.test(x))) throw new Error("stride");
  if (!/never be called solely/.test(tm.toolSeparation.rule)) throw new Error("separation");
  const h = readFileSync(join(dir, "agent-threat-model.html"), "utf8");
  for (const p of ["candidate evidence, not trusted evidence", "STRIDE", "never run solely"]) if (!h.includes(p)) throw new Error(p);
});
t("decision policy: fail-closed states + approval limits; status resilience; 20 drills", () => {
  const d = JSON.parse(readFileSync(join(dir, "decision-policy.json")));
  if (d.failClosedStates.signature_verification_failed !== "block") throw new Error("sigfail");
  if (!/cannot make an invalid, unsigned, tampered/.test(d.humanApprovalLimits)) throw new Error("approval");
  const st = JSON.parse(readFileSync(join(dir, "status-policy.json")));
  if (!/safety controls/.test(st.resilience.rateLimitsAreSafetyControls)) throw new Error("ratelimit");
  const f = JSON.parse(readFileSync(join(dir, "failure-drills.json")));
  if (f.drills.length < 20) throw new Error("drills " + f.drills.length);
  for (const n of ["verification DoS loop", "quota exhaustion (429)", "context-poisoned website", "long-running task drift", "batch verification abuse"]) if (!f.drills.some((x) => x.name === n)) throw new Error(n);
  const q = JSON.parse(readFileSync(join(dir, "quality-ledger.json")));
  if (!q.securityOutcomeMetrics.includes("contextPoisoningDrillPassRate")) throw new Error("secmetrics");
});

t("supply-chain policy: untrusted package output + honest provenance + no AI release authority", () => {
  const sc = JSON.parse(readFileSync(join(dir, "supply-chain-policy.json")));
  if (!/package name is not/.test(sc.principle)) throw new Error("principle");
  if (!sc.dependencyRules.some((x) => /untrusted text/.test(x))) throw new Error("pkgout");
  for (const n of ["npm provenance attestation", "SBOM", "reproducible builds"]) if (!sc.buildProvenance.notYetImplemented.includes(n)) throw new Error(n);
  if (!sc.aiCodingAgentRules.forbidden.some((x) => /publish npm/.test(x))) throw new Error("publish");
  if (!sc.releaseBlockers.some((x) => /AI-only approval/.test(x))) throw new Error("aionly");
  const h = readFileSync(join(dir, "supply-chain-policy.html"), "utf8");
  for (const p of ["a package name is not", "Not yet implemented", "no release authority"]) if (!h.includes(p)) throw new Error(p);
});
t("receipt scope + 25 drills incl. supply chain", () => {
  const tm = JSON.parse(readFileSync(join(dir, "agent-threat-model.json")));
  if (!tm.receiptScope.rules.some((x) => /does not cover another mint/.test(x))) throw new Error("scope");
  if (!tm.receiptScope.rules.some((x) => /liquidity inference is forbidden/.test(x))) throw new Error("pool");
  const f = JSON.parse(readFileSync(join(dir, "failure-drills.json")));
  if (f.drills.length < 25) throw new Error("drills " + f.drills.length);
  for (const n of ["dependency confusion", "AI install-fix obedience", "lockfile deletion", "package tarball secret", "AI-only release approval"]) if (!f.drills.some((x) => x.name === n)) throw new Error(n);
});

t("mcp boundary: transport-not-authz + agent-card + judge limits; 30 drills", () => {
  const m = JSON.parse(readFileSync(join(dir, "mcp-security-boundary-policy.json")));
  if (!m.mcpIsNot.includes("an authorization model") || !m.mcpIsNot.includes("a wallet signer")) throw new Error("isnot");
  if (!m.rules.some((x) => /unknown MCP servers are blocked/.test(x))) throw new Error("unknown");
  if (!/capability claim, not a credential/.test(m.agentCardTrust.principle)) throw new Error("card");
  if (!/cannot override a deterministic verdict/.test(m.orchestrationLimits.judgeLimit)) throw new Error("judge");
  const d = JSON.parse(readFileSync(join(dir, "decision-policy.json")));
  if (!/cannot override signed findings/.test(d.judgeModelLimit) || !/Legacy v2 verdict\/keyId/.test(d.judgeModelLimit)) throw new Error("dp-judge");
  const sc = JSON.parse(readFileSync(join(dir, "supply-chain-policy.json")));
  if (!/not a security proof/.test(sc.modelRuntimeRule)) throw new Error("modelcard");
  if (!/not implemented/.test(sc.sourceReviewSignals.rule)) throw new Error("vsr");
  const f = JSON.parse(readFileSync(join(dir, "failure-drills.json")));
  if (f.drills.length < 30) throw new Error("drills " + f.drills.length);
  for (const n of ["agent secret-read attempt", "persistent memory poisoning", "unknown MCP server", "tool output claims a verdict", "judge/human override of deterministic failure"]) if (!f.drills.some((x) => x.name === n)) throw new Error(n);
  const tm = JSON.parse(readFileSync(join(dir, "agent-threat-model.json")));
  if (!/every word in that sentence is a security boundary/.test(tm.agentAnatomy)) throw new Error("anatomy");
});

t("research boundary: not-verification + clarification + compression + writer; 34 drills", () => {
  const ar = JSON.parse(readFileSync(join(dir, "agentic-research-boundary-policy.json")));
  if (!ar.researchIsNot.includes("verification")) throw new Error("isnot");
  if (!ar.clarificationRules.rules.some((x) => /never infer a mint/.test(x))) throw new Error("mint");
  if (!ar.contextEngineeringRules.some((x) => /never drop current receipt-v1 invariants/.test(x))) throw new Error("compress");
  if (!ar.writerRules.some((x) => /writer is not verifier/.test(x))) throw new Error("writer");
  if (!ar.citationRules.some((x) => /not verification/.test(x))) throw new Error("cite");
  const h = readFileSync(join(dir, "agentic-research-boundary-policy.html"), "utf8");
  for (const ph of ["Research is not verification", "Never infer a missing mint", "never drop current receipt-v1 invariants"]) if (!h.includes(ph)) throw new Error(ph);
  const f = JSON.parse(readFileSync(join(dir, "failure-drills.json")));
  if (f.drills.length < 34) throw new Error("drills " + f.drills.length);
  for (const n of ["missing mint clarification", "stale RAG summary", "context compression drops invariants", "premature completion"]) if (!f.drills.some((x) => x.name === n)) throw new Error(n);
  const p = JSON.parse(readFileSync(join(dir, "agent-portability.json")));
  if (!/never drop/.test(p.contextEngineering.stateNotContext) || !/receipt-v1/.test(p.contextEngineering.stateNotContext)) throw new Error("portability");
});

t("transaction boundary: receipt-first + scope match + not-verification list; 42 drills", () => {
  const tb = JSON.parse(readFileSync(join(dir, "transaction-boundary-policy.json")));
  if (!/receipt first, transaction second/i.test(tb.corePrinciple)) throw new Error("principle");
  if (!tb.notVerification.some((x) => /simulation/.test(x))) throw new Error("sim");
  if (!/does not cover the action/.test(tb.scopeMatchRule.rule)) throw new Error("scope");
  const h = readFileSync(join(dir, "transaction-boundary-policy.html"), "utf8");
  for (const ph of ["Receipt first, transaction second", "scope must match receipt scope", "PROHIBITED"]) if (!h.includes(ph)) throw new Error(ph);
  const f = JSON.parse(readFileSync(join(dir, "failure-drills.json")));
  if (f.drills.length !== 42) throw new Error("drills " + f.drills.length);
  for (const n of ["unsigned transaction without receipt", "simulation treated as verification", "receipt/transaction scope mismatch", "stale receipt before signing", "signer requested before policy", "scheduled catch-up", "skill mutation weakens policy", "plugin output missing receipt"]) if (!f.drills.some((x) => x.name === n)) throw new Error(n);
});
t("ops folds: hooks + scheduled rule + skill governance + workbench + llms router", () => {
  const d = JSON.parse(readFileSync(join(dir, "decision-policy.json")));
  if (!/deterministic gates, not LLM authority/.test(d.deterministicHooks.principle)) throw new Error("hooks");
  const ds = JSON.parse(readFileSync(join(dir, "deployment-surfaces.json")));
  if (!/not proof of freshness/.test(ds.scheduledAgentRule)) throw new Error("sched");
  if (!/no LLM/.test(ds.executionModes.backend_script)) throw new Error("backend");
  const sc = JSON.parse(readFileSync(join(dir, "supply-chain-policy.json")));
  if (!sc.skillGovernance.rules.some((x) => /weaken signature verification/.test(x))) throw new Error("skill");
  const w = readFileSync(join(dir, "workbench.html"), "utf8");
  if (!w.includes("review console, not an execution console")) throw new Error("workbench");
  const l = readFileSync(join(dir, "llms.txt"), "utf8");
  if (!/Agent router/.test(l) || !/receipt first, transaction second/.test(l)) throw new Error("router");
});

t("RWA caveat + brand-claim rule + positioning", () => {
  const ev = JSON.parse(readFileSync(join(dir, "evidence-sources.json")));
  if (!/does NOT prove legal redeemability/.test(ev.assetBackedLimitation.rule)) throw new Error("rwa");
  if (!/coverage gaps/.test(ev.assetBackedLimitation.coverageGapRule)) throw new Error("gap");
  const tm = JSON.parse(readFileSync(join(dir, "agent-threat-model.json")));
  if (!/not verification/.test(tm.brandClaimRule)) throw new Error("brand");
  const a = JSON.parse(readFileSync(join(dir, "agents.json")));
  // Positioning must still place Raven strictly before the action, and must now
  // also disclaim deciding/authorizing (receipt-first surface semantics).
  if (!/before action/.test(a.positioning)) throw new Error("positioning");
  if (!/does not decide and does not authorize/.test(a.positioning)) throw new Error("positioning authority disclaimer");
});

t("canary hardening: candidate target, artifact, owner, signer, and vector packet are all fail-closed", () => {
  const c = readFileSync(join(dir, "scripts", "canary.mjs"), "utf8");
  // Production mode must FAIL (not skip) when the key is missing.
  if (!c.includes("CANARY_REQUIRE_KEYED")) throw new Error("REQUIRE_KEYED gate missing");
  if (!/REQUIRE_KEYED[\s\S]{0,200}check\("RAVEN_API_KEY present/.test(c)) throw new Error("missing-key must be a FAIL check in required mode");
  // /pubkey check must compare key material, not just keyId.
  if (!c.includes("EXPECTED_PUBLIC_KEY_BASE64")) throw new Error("pubkey material compare missing");
  const cfg = JSON.parse(readFileSync(join(dir, "scripts", "canary-config.json")));
  if (!/^[A-Za-z0-9+/]+=*$/.test(cfg.expectedPublicKeyBase64 ?? "")) throw new Error("expectedPublicKeyBase64 missing/malformed in config");
  if (Buffer.from(cfg.expectedPublicKeyBase64, "base64").length !== 44) throw new Error("expected SPKI ed25519 key is 44 bytes DER");
  if (cfg.expectedRulesVersion !== "raven-rules@1.1.3") throw new Error("legacy deployed rules expectation changed");
  if (cfg.schema !== "raven-canary-config/2") throw new Error("candidate packet config schema missing");
  const deployed = selectCanaryProfile(cfg, {});
  if (deployed.name !== "deployed-1.1.3" || deployed.expectedRulesVersion !== "raven-rules@1.1.3")
    throw new Error("deployed 1.1.3 is not the default profile");
  if (deployed.authorizationRequired) throw new Error("deployed profile must not masquerade as candidate activation");
  const pending = cfg.profiles["candidate-1.1.4"].candidateAuthorization;
  if (pending.status !== "pending" || pending.approvedApiOrigin !== null || pending.artifact.commit !== null)
    throw new Error("committed candidate authorization packet must remain inactive/pending");

  const mustReject = (config, env, label) => {
    try { selectCanaryProfile(config, env); }
    catch { return; }
    throw new Error(`${label} was accepted`);
  };
  mustReject(cfg, { RAVEN_CANARY_PROFILE: "candidate-1.1.4" }, "profile-only candidate");
  mustReject(cfg, {
    RAVEN_CANARY_PROFILE: "candidate-1.1.4",
    RAVEN_CANARY_CANDIDATE_AUTHORIZED: "true",
  }, "pending candidate packet");

  // A complete packet is constructed only in this deterministic unit test.
  // The committed config deliberately contains no target, artifact, signer, or
  // approval marker that could activate a real candidate canary.
  const authorizedCfg = JSON.parse(JSON.stringify(cfg));
  const packet = authorizedCfg.profiles["candidate-1.1.4"].candidateAuthorization;
  const vectorBytes = readFileSync(join(dir, "scripts", "canary-1.1.4-vector-set.json"));
  const vectorSet = JSON.parse(vectorBytes.toString("utf8"));
  const vectorSetSha256 = `sha256:${createHash("sha256").update(vectorBytes).digest("hex")}`;
  if (
    vectorSet.schema !== "raven-canary-vector-set/1" ||
    vectorSet.source !== "RAVEN_VERIFICATION_CONTRACT_1_1_4_VECTOR_MANIFEST.json" ||
    vectorSet.vectorSetId !== "raven-rules-1.1.4-certification-v1" ||
    vectorSet.requiredVectorIds.length !== 73 ||
    vectorSetSha256 !== "sha256:a20e7b3bcbcaf90e5b5f727f6eae07c8db66d62c6d331e05e23496a089032d85"
  ) throw new Error("candidate vector set does not exactly match the declared certification corpus");
  for (const id of ["I114_HIDDEN_ATTEMPT", "I114_MUTATE_POST_ADMISSION", "X_BASE64_CANONICALITY", "X_LONE_SURROGATE", "A_UNKNOWN_ORIGIN"])
    if (!vectorSet.requiredVectorIds.includes(id)) throw new Error(`candidate vector set missing ${id}`);

  packet.status = "authorized";
  packet.approvedEnvironment = "isolated-staging";
  packet.approvedApiOrigin = "https://candidate-api.example";
  packet.approvedSiteOrigin = "https://candidate-site.example";
  packet.ownerApprovalMarker = "glen-candidate-1.1.4-test-approval";
  packet.expectedSigner = {
    keyId: "rvk_candidate_1_1_4_test",
    publicKeyBase64: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      Buffer.alloc(32, 7),
    ]).toString("base64"),
  };
  packet.expectedBuildInfo = {
    service: "raven-hosted-verifier",
    receipt: {
      domain: "raven-receipt",
      version: "v1",
      producerProfile: "candidate-1.1.4",
      rulesVersion: "raven-rules@1.1.4",
      findingTaxonomyVersion: "raven-taxonomy@1.0.0",
    },
    attestation: {
      schema: "raven-official-attestation/v2",
      replaySchema: "raven-replay-v4",
      version: "v2",
    },
    signerKeyId: packet.expectedSigner.keyId,
  };
  packet.artifact.commit = "a".repeat(40);
  packet.fixtureVectorSet.sha256 = vectorSetSha256;
  const buildInfo = {
    service: packet.expectedBuildInfo.service,
    commit: packet.artifact.commit,
    receipt: packet.expectedBuildInfo.receipt,
    attestation: packet.expectedBuildInfo.attestation,
    signerKeyId: packet.expectedSigner.keyId,
  };
  packet.artifact.buildInfoSha256 = candidateBuildInfoFingerprint(buildInfo);
  const completeEnv = {
    RAVEN_CANARY_PROFILE: "candidate-1.1.4",
    RAVEN_CANARY_CANDIDATE_AUTHORIZED: "true",
    RAVEN_CANARY_OWNER_APPROVAL_MARKER: packet.ownerApprovalMarker,
    RAVEN_CANARY_ENVIRONMENT: packet.approvedEnvironment,
    RAVEN_CANARY_ARTIFACT_COMMIT: packet.artifact.commit,
    RAVEN_CANARY_VECTOR_SET_SHA256: packet.fixtureVectorSet.sha256,
    RAVEN_API_BASE: packet.approvedApiOrigin,
    RAVEN_SITE_BASE: packet.approvedSiteOrigin,
  };
  const candidate = selectCanaryProfile(authorizedCfg, completeEnv);
  if (candidate.expectedRulesVersion !== "raven-rules@1.1.4" || !candidate.requireKeyed)
    throw new Error("authorized candidate profile is not pinned/keyed");
  if (candidate.authorizationOwner !== "Glen" || candidate.apiBase !== packet.approvedApiOrigin || candidate.siteBase !== packet.approvedSiteOrigin)
    throw new Error("authorized candidate packet lost its exact target/owner binding");
  assertCandidateBuildInfo(candidate, buildInfo);
  assertCandidateVectorSet(candidate, vectorSet, vectorSetSha256);

  const alteredBuildInfo = JSON.parse(JSON.stringify(buildInfo));
  alteredBuildInfo.commit = "b".repeat(40);
  let alteredBuildAccepted = false;
  try { assertCandidateBuildInfo(candidate, alteredBuildInfo); alteredBuildAccepted = true; } catch { /* required */ }
  if (alteredBuildAccepted) throw new Error("mismatched build identity was accepted");

  const wrongArtifactEnv = { ...completeEnv, RAVEN_CANARY_ARTIFACT_COMMIT: "b".repeat(40) };
  mustReject(authorizedCfg, wrongArtifactEnv, "correct profile with wrong artifact");
  const wrongVectorEnv = { ...completeEnv, RAVEN_CANARY_VECTOR_SET_SHA256: `sha256:${"b".repeat(64)}` };
  mustReject(authorizedCfg, wrongVectorEnv, "correct profile with wrong vector set");
  const wrongOwnerEnv = { ...completeEnv, RAVEN_CANARY_OWNER_APPROVAL_MARKER: "not-the-approved-owner-marker" };
  mustReject(authorizedCfg, wrongOwnerEnv, "correct profile with wrong owner marker");
  const nonCanonicalSignerCfg = JSON.parse(JSON.stringify(authorizedCfg));
  const nonCanonicalSigner = nonCanonicalSignerCfg.profiles["candidate-1.1.4"].candidateAuthorization.expectedSigner;
  const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const finalDataIndex = base64Alphabet.indexOf(nonCanonicalSigner.publicKeyBase64.at(-2));
  nonCanonicalSigner.publicKeyBase64 = `${nonCanonicalSigner.publicKeyBase64.slice(0, -2)}${base64Alphabet[(finalDataIndex & 0b111100) | 1]}=`;
  mustReject(nonCanonicalSignerCfg, completeEnv, "non-canonical candidate signer Base64");

  // Exact allowlisting rejects the reproduced arbitrary target and every
  // alias/credential/query/path form before the canary can issue a request.
  for (const [label, apiBase] of [
    ["unknown target", "https://unrecognized.example"],
    ["production target", cfg.apiBase],
    ["trailing-dot production alias", "https://raven-hosted-verifier.onrender.com."],
    ["credential target", "https://x-api-key@candidate-api.example"],
    ["query target", "https://candidate-api.example?x=1"],
    ["path target", "https://candidate-api.example/path"],
    ["percent-encoded alias", "https://candidate-api.example%2e"],
  ]) {
    mustReject(authorizedCfg, { ...completeEnv, RAVEN_API_BASE: apiBase }, label);
  }
  mustReject(authorizedCfg, { ...completeEnv, RAVEN_SITE_BASE: "https://unrecognized-site.example" }, "unknown site target");

  // Canary-only and producer-only acknowledgments cannot select the candidate
  // together; the target's /buildinfo must independently report the closed
  // candidate producer profile before a keyed call can occur.
  const producerOnly = selectCanaryProfile(authorizedCfg, {
    RAVEN_PRODUCER_RULES_PROFILE: "candidate-1.1.4",
    RAVEN_PRODUCER_RULES_1_1_4_AUTHORIZED: "true",
  });
  if (producerOnly.name !== "deployed-1.1.3") throw new Error("producer-only environment selected candidate canary");
  const canaryOnly = selectCanaryProfile(authorizedCfg, { RAVEN_CANARY_CANDIDATE_AUTHORIZED: "true" });
  if (canaryOnly.name !== "deployed-1.1.3") throw new Error("canary-only environment selected candidate canary");
  const deployedBuildInfo = JSON.parse(JSON.stringify(buildInfo));
  deployedBuildInfo.receipt.producerProfile = "deployed-1.1.3";
  deployedBuildInfo.receipt.rulesVersion = "raven-rules@1.1.3";
  let canaryWithoutCandidateProducerAccepted = false;
  try { assertCandidateBuildInfo(candidate, deployedBuildInfo); canaryWithoutCandidateProducerAccepted = true; } catch { /* required */ }
  if (canaryWithoutCandidateProducerAccepted) throw new Error("canary-only authorization accepted deployed producer buildinfo");

  // Production targets need a second, distinct packet and runtime marker.
  const productionPacketCfg = JSON.parse(JSON.stringify(authorizedCfg));
  const productionPacket = productionPacketCfg.profiles["candidate-1.1.4"].candidateAuthorization;
  productionPacket.approvedApiOrigin = cfg.apiBase;
  productionPacket.approvedSiteOrigin = cfg.siteBase;
  productionPacket.allowProductionOrigins = true;
  productionPacket.productionOriginOwnerApprovalMarker = "glen-production-origin-test-approval";
  const productionEnv = {
    ...completeEnv,
    RAVEN_API_BASE: cfg.apiBase,
    RAVEN_SITE_BASE: cfg.siteBase,
  };
  mustReject(productionPacketCfg, productionEnv, "production target without separate authorization");
  const productionSelected = selectCanaryProfile(productionPacketCfg, {
    ...productionEnv,
    RAVEN_CANARY_PRODUCTION_ORIGIN_AUTHORIZED: "true",
    RAVEN_CANARY_PRODUCTION_ORIGIN_APPROVAL_MARKER: productionPacket.productionOriginOwnerApprovalMarker,
  });
  if (productionSelected.apiBase !== cfg.apiBase) throw new Error("separately authorized production target was not selected exactly");

  if ((c.match(/redirect: "error"/g) ?? []).length < 3) throw new Error("canary fetches must refuse redirects");
  const cleanRoom = readFileSync(join(dir, "scripts", "verify-test-vector.mjs"), "utf8");
  if (!cleanRoom.includes('redirect: "error"')) throw new Error("clean-room vector fetch follows redirects");
  // Workflow must run the canary in required-keyed mode.
  const wf = readFileSync(join(dir, "..", "..", ".github", "workflows", "raven-canary.yml"), "utf8");
  if (!/CANARY_REQUIRE_KEYED:\s*"true"/.test(wf)) throw new Error("workflow must set CANARY_REQUIRE_KEYED=true");
  if (/RAVEN_CANARY_PROFILE/.test(wf)) throw new Error("production workflow must retain the implicit deployed profile");
});

t("canary release identity: manual dispatch is bound to main and immutable github.sha", () => {
  const wf = readFileSync(join(dir, "..", "..", ".github", "workflows", "raven-canary.yml"), "utf8");
  // No operator-supplied SHA anywhere: manual dispatch stays input-free.
  if (!/workflow_dispatch:\s*\{\}/.test(wf)) throw new Error("workflow_dispatch must remain input-free");
  if (/inputs:/.test(wf)) throw new Error("no workflow input may supply an expected commit");
  // Manual dispatch runs only from merged main. The boundary guard must use
  // the runner-provided GITHUB_REF environment variable, never a ${{ github.ref }}
  // expression interpolated into the shell of the secret-bearing job.
  if (!/github\.event_name == 'workflow_dispatch'[\s\S]{0,200}run:\s*test "\$GITHUB_REF" = "refs\/heads\/main"/.test(wf))
    throw new Error("manual dispatch is not bound to refs/heads/main via $GITHUB_REF");
  if (/run:[^\n]*\$\{\{\s*github\.ref\s*\}\}/.test(wf))
    throw new Error("github.ref must not be interpolated into a run: shell");
  // The expected commit is the immutable github.sha of the run itself.
  if (!/RAVEN_CANARY_EXPECT_COMMIT:\s*\$\{\{ github\.event_name == 'workflow_dispatch' && github\.sha \|\| '' \}\}/.test(wf))
    throw new Error("expected commit is not bound to immutable github.sha");
  const c = readFileSync(join(dir, "scripts", "canary.mjs"), "utf8");
  if (!c.includes("RAVEN_CANARY_EXPECT_COMMIT")) throw new Error("canary does not read the expected commit");
  if (!c.includes("pre-probe /buildinfo identity is well-formed")) throw new Error("pre-probe identity read missing");
  if (!c.includes("post-probe /buildinfo identity unchanged (same commit and startedAt)")) throw new Error("post-probe stability check missing");
  if (!c.includes("startedAt")) throw new Error("process-start binding missing");
});

// ---- release-identity child-process regressions (local mock, no live target) ----
// These invoke the canary EXACTLY as production does — `node <path>/canary.mjs`
// as the main module — against an in-process mock of the API and site bases.
// They prove the run is not a silent no-op (probes execute, CANARY OK on a
// stable matching fixture) and that the identity gate bites (nonzero exit on a
// wrong commit, a malformed or missing /buildinfo, or a mid-run process
// change). No live workflow run and no production request is involved.
const tAsync = async (name, fn) => { try { await fn(); console.log("ok  -", name); } catch (e) { fail++; console.error("FAIL-", name, "->", e.message); } };

await tAsync("canary release identity: direct execution against a local mock binds the deployed process", async () => {
  const canaryCfg = JSON.parse(readFileSync(join(dir, "scripts", "canary-config.json")));
  const vectorBytes = readFileSync(join(dir, "receipt-test-vector.json"));
  const schemaBytes = readFileSync(join(dir, "receipt-wire-schema.json"));
  const GOOD = "c".repeat(40);
  const WRONG = "d".repeat(40);
  const T1 = "2026-08-02T00:00:00.000Z";
  const T2 = "2026-08-02T01:00:00.000Z";
  const buildinfo = (commit, startedAt) => ({
    service: "raven-hosted-verifier",
    commit,
    startedAt,
    receipt: { domain: "raven-receipt", version: "v1", producerProfile: "deployed-1.1.3", rulesVersion: "raven-rules@1.1.3", findingTaxonomyVersion: "raven-taxonomy@1.0.0" },
    attestation: { schema: "raven-official-attestation-v2", replaySchema: "raven-replay-v4", version: "v2" },
    signerKeyId: canaryCfg.expectedKeyId,
  });

  // /buildinfo responses are consumed in order; the last one repeats.
  const startMock = async (buildinfoResponses) => {
    let reads = 0;
    const server = createServer((req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(typeof body === "string" ? body : JSON.stringify(body));
      };
      if (req.url === "/buildinfo") {
        const r = buildinfoResponses[Math.min(reads++, buildinfoResponses.length - 1)];
        send(r.status, r.body);
      } else if (req.url === "/healthz") send(200, { status: "ok" });
      else if (req.url === "/pubkey") send(200, { keys: [{ keyId: canaryCfg.expectedKeyId, publicKeyBase64: canaryCfg.expectedPublicKeyBase64 }] });
      else if (req.url === "/receipt-test-vector.json") { res.writeHead(200, { "content-type": "application/json" }); res.end(vectorBytes); }
      else if (req.url === "/receipt-wire-schema.json") { res.writeHead(200, { "content-type": "application/json" }); res.end(schemaBytes); }
      else send(404, { error: "not found" });
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    return { server, base: `http://127.0.0.1:${server.address().port}` };
  };

  const runCanary = (base, expectCommit) => new Promise((resolve, reject) => {
    const env = { ...process.env, RAVEN_API_BASE: base, RAVEN_SITE_BASE: base };
    delete env.RAVEN_API_KEY;
    delete env.CANARY_REQUIRE_KEYED;
    delete env.RAVEN_CANARY_PROFILE;
    if (expectCommit) env.RAVEN_CANARY_EXPECT_COMMIT = expectCommit;
    else delete env.RAVEN_CANARY_EXPECT_COMMIT;
    const child = spawn(process.execPath, [join(dir, "scripts", "canary.mjs")], { env });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("error", reject);
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("canary child timed out")); }, 60000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });

  const withMock = async (responses, fn) => {
    const { server, base } = await startMock(responses);
    try { await fn(base); } finally { server.close(); }
  };

  // Positive control / not-a-no-op: a stable matching fixture must run the
  // real probes and reach CANARY OK with exit 0.
  await withMock([{ status: 200, body: buildinfo(GOOD, T1) }], async (base) => {
    const r = await runCanary(base, GOOD);
    if (r.code !== 0) throw new Error(`stable matching fixture exited ${r.code}: ${r.out.trim().split("\n").pop()}`);
    for (const marker of [
      "PASS - pre-probe /buildinfo identity is well-formed",
      "PASS - deployed commit matches the workflow commit (github.sha)",
      "PASS - healthz responds OK",
      "PASS - live test vector passes clean-room verification",
      "PASS - post-probe /buildinfo identity unchanged (same commit and startedAt)",
      "CANARY OK",
    ]) if (!r.out.includes(marker)) throw new Error(`missing marker ${JSON.stringify(marker)} — probes did not execute`);
  });

  // Wrong expected commit (manual post-deploy gate) must fail nonzero.
  await withMock([{ status: 200, body: buildinfo(GOOD, T1) }], async (base) => {
    const r = await runCanary(base, WRONG);
    if (r.code === 0) throw new Error("wrong-SHA run exited 0");
    if (!r.out.includes("FAIL - deployed commit matches the workflow commit")) throw new Error("wrong-SHA run did not fail the identity check");
  });

  // Malformed /buildinfo must fail nonzero.
  await withMock([{ status: 200, body: { commit: "not-a-sha", startedAt: T1 } }], async (base) => {
    const r = await runCanary(base, GOOD);
    if (r.code === 0) throw new Error("malformed /buildinfo run exited 0");
    if (!r.out.includes("FAIL - pre-probe /buildinfo identity is well-formed")) throw new Error("malformed /buildinfo was not rejected");
  });

  // Missing /buildinfo must fail nonzero.
  await withMock([{ status: 404, body: { error: "gone" } }], async (base) => {
    const r = await runCanary(base, GOOD);
    if (r.code === 0) throw new Error("missing /buildinfo run exited 0");
  });

  // Same commit with a changed startedAt mid-run (process restart) must fail
  // nonzero, binding the behavioral result to one stable process.
  await withMock([
    { status: 200, body: buildinfo(GOOD, T1) },
    { status: 200, body: buildinfo(GOOD, T2) },
  ], async (base) => {
    const r = await runCanary(base, GOOD);
    if (r.code === 0) throw new Error("changed-startedAt run exited 0");
    if (!r.out.includes("FAIL - post-probe /buildinfo identity unchanged")) throw new Error("mid-run process change was not caught");
  });
});

// ---------------------------------------------------------------------------
// Receipt-first semantic consistency gate.
//
// This exists so two specific regressions cannot come back quietly:
//   (a) advice to install the deprecated raven-solana-agent-kit-plugin, and
//   (b) language that presents a Raven output as authorization to act.
// Both were live on the public surface before fix/public-surface-receipt-semantics.
// Mentioning the deprecated package as historical/supply-chain fact is allowed;
// telling a reader to INSTALL it is not.
// ---------------------------------------------------------------------------

const PUBLIC_TEXT_FILES = () =>
  readdirSync(dir).filter((f) => /\.(html|json|txt|md)$/.test(f));

const DEPRECATED_INSTALL = /\b(npm|pnpm|yarn|bun)\s+(install|add|i)\s+[^\n]{0,40}raven-solana-agent-kit-plugin/i;
const CANONICAL_PLUGIN = "plugin-raven-verify";

t("llms.txt leads with receipt-v1 and carries no deprecated install advice", () => {
  const s = readFileSync(join(dir, "llms.txt"), "utf8");
  if (DEPRECATED_INSTALL.test(s)) throw new Error("llms.txt still advises installing the deprecated agent-kit plugin");
  if (!s.includes(CANONICAL_PLUGIN)) throw new Error("llms.txt must point at " + CANONICAL_PLUGIN);
  if (/Map verdict to action/i.test(s)) throw new Error("verdict-to-action router line returned");
  if (!/\/receipt\/v1/.test(s)) throw new Error("llms.txt must present /receipt/v1");
  if (!/legacy compatibility/i.test(s)) throw new Error("llms.txt must mark POST /verify legacy compatibility");
  // Receipt framing must lead, not trail: it belongs in the opening paragraph.
  const head = s.slice(0, 600);
  if (!/evidence receipt/i.test(head)) throw new Error("llms.txt must lead with evidence receipts");
  if (!/coverage gap/i.test(head)) throw new Error("llms.txt lead must state declared coverage gaps");
  if (!/(pin|pins|pinned)\b/i.test(head)) throw new Error("llms.txt lead must state the consumer independently pins the key");
});

t("openapi: receipt/v1 is primary and fully specified; /verify marked legacy", () => {
  const j = JSON.parse(readFileSync(join(dir, "openapi.json")));
  const d = j.info.description;
  if (/^\s*Verdicts:/i.test(d)) throw new Error("info.description still leads with Verdicts:");
  if (!/evidence receipt/i.test(d)) throw new Error("info.description must lead with evidence receipts");

  const r = j.paths["/receipt/v1"].post;
  if (!/primary/i.test(r.summary)) throw new Error("/receipt/v1 must be summarised as the primary path");
  if (!r.requestBody?.content?.["application/json"]?.schema?.required?.includes("mintAddress"))
    throw new Error("/receipt/v1 must specify its request schema");
  if (!r.responses["200"].content?.["application/json"]?.schema)
    throw new Error("/receipt/v1 must specify the signed-success shape");
  if (!r.security?.[0]?.ApiKey) throw new Error("/receipt/v1 must declare auth");

  const refusal = r.responses["422"];
  if (!/unsigned/i.test(refusal.description)) throw new Error("422 must state the refusal is unsigned");
  const reason = refusal.content["application/json"].schema.$ref;
  if (!reason) throw new Error("422 must reference the refusal schema");
  const ru = j.components.schemas.ReceiptUnavailable;
  if (!ru.properties.error.enum.includes("receipt_unavailable")) throw new Error("422 error code");
  for (const code of ["underlying_verification_unknowable", "observed_slot_unavailable", "holder_provenance_invalid"])
    if (!ru.properties.reason.enum.includes(code)) throw new Error("missing refusal reason " + code);

  // The five axes must be documented and kept apart.
  for (const axis of [/integrity/i, /signer trust/i, /freshness/i, /coverage/i, /consumer policy/i])
    if (!axis.test(r.description)) throw new Error("receipt/v1 description must separate axis " + axis);

  const v = j.paths["/verify"].post;
  if (!/legacy/i.test(v.summary)) throw new Error("/verify summary must say legacy");
  if (!/legacy compatibility/i.test(v.description)) throw new Error("/verify description must say legacy compatibility");
});

t("no deprecated install advice anywhere on the public surface", () => {
  for (const f of PUBLIC_TEXT_FILES()) {
    const s = readFileSync(join(dir, f), "utf8");
    if (DEPRECATED_INSTALL.test(s)) throw new Error(f + " advises installing the deprecated agent-kit plugin");
  }
});

t("no public surface presents a Raven output as authorization", () => {
  const banned = [
    /Raven\s+(authorizes|authorises|approves|permits|greenlights)\b/i,
    /verdict\s*(=|->|→|:)\s*(authoriz|authoris|approv|permission|permit)/i,
    /(receipt|verdict|attestation)\s+(authorizes|authorises|approves|permits)\s+(the\s+)?(action|trade|transaction)/i,
    /safe\s+to\s+(trade|buy|ape|proceed)/i,
  ];
  // A phrase quoted in order to forbid it is not a claim. Raven's own policy
  // pages deliberately carry wrong-example and prohibited-phrase lists, so a
  // match only counts when it is NOT framed as something to avoid.
  const NEGATED = /(wrong|forbidden|prohibit|banned|never|do not|don't|must not|avoid|anti[- ]?pattern|refuse|reject|instead of|not authoriz)/i;
  const isNegated = (text, index) => NEGATED.test(text.slice(Math.max(0, index - 160), index));
  for (const f of PUBLIC_TEXT_FILES()) {
    const s = readFileSync(join(dir, f), "utf8");
    for (const re of banned) {
      const m = re.exec(s);
      if (m && !isNegated(s, m.index)) throw new Error(f + " implies authorization: " + JSON.stringify(m[0]));
    }
  }
});

t("decision policy keeps the axes separate and disclaims authorization", () => {
  const j = JSON.parse(readFileSync(join(dir, "decision-policy.json")));
  if (j.receiptIsNotAuthorization !== true) throw new Error("receiptIsNotAuthorization must be true");
  if (!Array.isArray(j.axesNeverCollapsed) || j.axesNeverCollapsed.length < 6)
    throw new Error("axesNeverCollapsed must enumerate at least six axes");
  if (!/not Raven authorizations/i.test(j.verdictActionsAreIntegratorPolicy ?? ""))
    throw new Error("verdictActions must be framed as integrator policy, not Raven authorization");
  if (j.ravenMakesBusinessDecision !== false) throw new Error("ravenMakesBusinessDecision must stay false");
  if (j.finalDecisionOwner !== "integrator_policy") throw new Error("finalDecisionOwner must stay integrator_policy");
});

t("site hero and agent manifest use evidence-receipt language", () => {
  const tpl = readFileSync(join(dir, "index.template.html"), "utf8");
  const html = readFileSync(join(dir, "index.html"), "utf8");
  for (const [label, s] of [["index.template.html", tpl], ["index.html", html]]) {
    if (!/evidence receipt/i.test(s)) throw new Error(label + " hero must use evidence-receipt language");
    if (/We'll return a <span class="mono">signed<\/span> Raven verdict/i.test(s))
      throw new Error(label + " still leads with a verdict promise");
  }
  const a = JSON.parse(readFileSync(join(dir, "agents.json")));
  if (!/evidence receipt/i.test(a.description)) throw new Error("agents.json description must lead with evidence receipts");
  if (!/does not decide and does not authorize/i.test(a.positioning))
    throw new Error("agents.json positioning must disclaim deciding and authorizing");
});

t("public surfaces use the canonical ravenattest.com host, never the platform subdomain", () => {
  // ravenattest.com and raven-launch-console.vercel.app serve the same
  // deployment (byte-identical sampled 2026-08-20), so every primary route a
  // stranger or agent is told to follow must name the canonical domain. The
  // platform subdomain is ops-facing only: smoke/canary harness defaults and
  // the internal operator context keep it deliberately.
  const PUBLIC = [
    "llms.txt", "llms-full.txt", "agents.json", "evals.json", "openapi.json",
    "access.json", "receipt-schema.json", "receipt-wire-schema.json",
    "quality-ledger.json", "prompt-recipes.json", "demo.html", "demo-kit.html",
    "agent-pack.html", "skills.html", "index.html", "index.template.html",
    "receipts.html", "receipts.template.html", "security.html",
    "request-access.html", "thanks.html", "contact.html", "pricing.html",
    "operator/templates/access-declined-out-of-scope.md",
    "operator/templates/beta-key-issued.md",
    "operator/templates/verdict-reply-pass-with-gaps.md",
    "operator/templates/verdict-reply-risk.md",
    "operator/templates/verdict-reply-warning.md",
  ];
  for (const f of PUBLIC) {
    const s = readFileSync(join(dir, f), "utf8");
    if (s.includes("raven-launch-console.vercel.app"))
      throw new Error(f + " sends strangers to the platform subdomain instead of ravenattest.com");
  }
});

t("/contact resolves as a durable public route", () => {
  // /contact.html was the only resolving form (measured 404 on /contact,
  // 2026-08-20). The redirect makes the clean form durable without renaming
  // the file every internal link already uses.
  const v = JSON.parse(readFileSync(join(dir, "vercel.json"), "utf8"));
  const r = (v.redirects || []).find((x) => x.source === "/contact");
  if (!r || r.destination !== "/contact.html" || r.permanent !== true)
    throw new Error("vercel.json must permanently redirect /contact -> /contact.html");
});

t("public lead copy never presents Raven's deliverable as a verdict", () => {
  // Evidence-not-verdict doctrine: the receipt carries an engine outcome field,
  // but public lead/hero copy must not frame what a stranger receives as a
  // "verdict". Field names inside schemas and signed artifacts are untouched.
  const checks = [
    ["index.template.html", /signed verdicts/i],
    ["index.html", /signed verdicts/i],
    ["demo-kit.html", /signed verdicts/i],
    ["receipts.template.html", /Every Raven verdict/i],
    ["receipts.html", /Every Raven verdict/i],
    ["evals.json", /signed verdict/i],
    ["evidence-sources.json", /unsigned verdict/i],
    // Machine-readable self-description (JSON-LD) and lead prose on the
    // homepage: the deliverable is a signed evidence receipt, not a verdict.
    ["index.template.html", /deterministic verdict/i],
    ["index.html", /deterministic verdict/i],
    ["index.template.html", /verify a verdict/i],
    ["index.html", /verify a verdict/i],
    ["index.template.html", /verdicts are for/i],
    ["index.html", /verdicts are for/i],
    ["thanks.html", /signed verdict/i],
  ];
  for (const [f, re] of checks) {
    const s = readFileSync(join(dir, f), "utf8").replace(/<script id="evidence-data"[^>]*>[\s\S]*?<\/script>/g, "");
    if (re.test(s)) throw new Error(f + " lead copy frames Raven's deliverable as a verdict");
  }
});

t("access loop states what happens, what is needed, what is never asked, and the expectation", () => {
  // A pilot prospect must know the whole loop BEFORE submitting, not infer it
  // from the confirmation page afterwards. The response expectation is the
  // owner-ratified 48-hour floor (2026-08-20, Option C); the pin keeps form
  // page and confirmation page from drifting apart — change both, or neither.
  const form = readFileSync(join(dir, "request-access.html"), "utf8");
  const thanks = readFileSync(join(dir, "thanks.html"), "utf8");
  for (const [label, s] of [["request-access.html", form], ["thanks.html", thanks]]) {
    if (!/within 48 hours/i.test(s)) throw new Error(label + " lost the response-expectation copy");
    if (!/never ask/i.test(s)) throw new Error(label + " lost the never-ask-for-secrets commitment");
  }
  if (!/What happens after you submit/i.test(form)) throw new Error("form page does not state the post-submit loop");
  if (!/What we need/i.test(form)) throw new Error("form page lost the requested-information clause");
  if (!/Acknowledgement/i.test(form)) throw new Error("form page lost the acknowledgement clause");
  if (!/no newsletter/i.test(form)) throw new Error("form page lost the no-newsletter/no-list commitment");
  if (!/A human/i.test(form) || !/A human/i.test(thanks)) throw new Error("human-review copy missing");
  if (!/sample signed receipt/i.test(form)) throw new Error("form page no longer promises the sample receipt");
});

t("changed surfaces pin signer trust independently; /pubkey is discovery only", () => {
  // A consumer-pinned key or verified trust bundle establishes trust.
  // /pubkey is operational discovery/cross-check: network material is
  // acceptable only when it matches or chains from the independent pin.
  const CORRECTED = ["llms.txt", "llms-full.txt", "openapi.json", "decision-policy.json", "decision-policy.html", "security.html", "request-access.html"];
  for (const f of CORRECTED) {
    const s = readFileSync(join(dir, f), "utf8");
    if (/against\s+(GET\s+)?\/pubkey/i.test(s))
      throw new Error(f + " instructs verification against same-host /pubkey as if it established trust");
  }
  const full = readFileSync(join(dir, "llms-full.txt"), "utf8");
  if (!/consumer-pinned key or verified trust\s+bundle/i.test(full))
    throw new Error("llms-full.txt must state trust comes from a consumer-pinned key or verified trust bundle");
  if (!/discovery\/cross-check only/i.test(full))
    throw new Error("llms-full.txt must frame /pubkey as discovery/cross-check only");
  const api = readFileSync(join(dir, "openapi.json"), "utf8");
  if (!/independently pinned signer key/i.test(api))
    throw new Error("openapi.json must direct signature verification at an independently pinned signer key");
});

t("receipt authority is limited to what Raven signed; conflicts escalate", () => {
  const CORRECTED = ["llms-full.txt", "decision-policy.json", "decision-policy.html"];
  for (const f of CORRECTED) {
    const s = readFileSync(join(dir, f), "utf8");
    if (/receipt\s+wins\s+over/i.test(s) || /conflict\s*=\s*(the\s+)?(signed\s+)?receipt\s+wins/i.test(s))
      throw new Error(f + " lets a signed receipt override conflicting context/memory");
    if (/receipt is the source of truth/i.test(s))
      throw new Error(f + " calls a receipt the source of truth for external reality");
  }
  const j = JSON.parse(readFileSync(join(dir, "decision-policy.json")));
  for (const k of ["context_conflict", "memory_conflict"]) {
    const v = j.failClosedStates[k] ?? "";
    if (!/re-observe/i.test(v) || !/escalate/i.test(v))
      throw new Error("failClosedStates." + k + " must require re-observation/re-verification or escalation");
    if (!/attests only to what Raven signed/i.test(v))
      throw new Error("failClosedStates." + k + " must limit receipt authority to what Raven signed");
  }
});

t("llms.txt labels plugin-raven-verify as the ElizaOS adapter, not the canonical verifier", () => {
  const s = readFileSync(join(dir, "llms.txt"), "utf8");
  if (/plugin-raven-verify[\s\S]{0,120}canonical/i.test(s) || /canonical[\s\S]{0,120}plugin-raven-verify/i.test(s))
    throw new Error("llms.txt presents the ElizaOS adapter as canonical; the canonical receipt-verifier public package name is not yet ratified");
  if (!/ElizaOS adapter/i.test(s))
    throw new Error("llms.txt must label plugin-raven-verify as the current ElizaOS adapter");
  if (/@raven\/verify-js/i.test(s))
    throw new Error("llms.txt must not reference @raven/verify-js in any form; the @raven npm scope is unverified and no implementation or documentation may depend on it");
});

t("llms.txt names the ratified canonical verifier and marks it not yet published", () => {
  const s = readFileSync(join(dir, "llms.txt"), "utf8");
  if (!/raven-receipt-verifier/.test(s))
    throw new Error("llms.txt must name raven-receipt-verifier (canonical name ratified by owner 2026-08-18)");
  const i = s.indexOf("raven-receipt-verifier");
  const around = s.slice(Math.max(0, i - 300), i + 300);
  if (!/not yet published/i.test(around))
    throw new Error("llms.txt must mark raven-receipt-verifier as not yet published until publication actually occurs");
});

// ---------------------------------------------------------------------------
// Public-claim surface gate (bounded public-claim repair, 2026-08-03).
// Enforced semantics:
//   1. signing is endpoint-accurate: every ISSUED receipt is signed; when the
//      evidence cannot be established Raven refuses with an explicit UNSIGNED
//      refusal envelope — so "signs every response" is never said;
//   2. a valid signature establishes integrity and control of the signing key
//      — attribution to Raven additionally requires an independently
//      established signer key or trust chain, so integrity is never collapsed
//      into "authenticity" and verification is never "no trust required";
//   3. same-host /pubkey is discovery/cross-check material only, accepted when
//      it matches or chains from an independent pin — never the pin itself.
// Exemptions are occurrence-bound: exact file + exact literal context + exact
// occurrence count. No negation heuristics — a moved, deleted, duplicated, or
// meaning-flipped occurrence fails its pin. The two live pins are prohibition
// sentences (supply-chain policy telling readers NOT to assume authenticity);
// no affirmative claim is exempted anywhere.
// ---------------------------------------------------------------------------

const CLAIM_BANNED = [
  { id: "universal-signing", re: /signs (every|all) (response|responses|request|requests|verification|verifications|verdict|verdicts|reply|replies)\b/i },
  { id: "response-ships-signed", re: /every response (is|ships as|returns|yields|produces|comes with)\b[^.\n]{0,80}\b(signed|signature|receipt)\b/i },
  { id: "every-reply-signed", re: /every (reply|response)\b[^.\n]{0,60}\b(carr(?:y|ies)|ships?|bears?|comes with|includes?)\b[^.\n]{0,40}\b(signature|signed|receipt)\b/i },
  { id: "verification-yields-receipt", re: /every verification (yields|produces|returns)\b[^.\n]{0,60}\breceipt\b/i },
  { id: "authenticity-from-integrity", re: /\b(establishes?|proves?)\b[^.\n]{0,40}\bauthentic/i },
  { id: "attribution-from-integrity", re: /\bvalid signature\b[^.\n]{0,60}\b(came from|comes from|attribut\w*|genuinely|authentic\w*)/i },
  { id: "no-trust-required", re: /no trust required/i },
  { id: "verify-against-pubkey", re: /\b(verify|verified|verification)\b[^.\n]{0,120}\b(against|via|vs\.?)\b(?:(?!\bpin)[^.\n]){0,30}\/pubkey\b/i },
  { id: "match-against-pubkey", re: /\b(match|matching|compare)\b[^.\n]{0,25}\bagainst\b(?:(?!\bpin)[^.\n]){0,15}\/pubkey\b/i },
  { id: "keyid-match-pubkey", re: /\bkeyId\b[^.\n]{0,25}\bmatch(?:ed|es)?\b[^.\n]{0,25}\/pubkey\b|\/pubkey\b[^.\n]{0,30}\bmatch(?:ed|es)?\b[^.\n]{0,15}\bkeyId\b/i },
  { id: "pubkey-recipe-root", re: /GET\s+\/pubkey\s*(?:->|→)[^.\n]{0,50}\b(?:keyId|match|verify|recompute)/i },
  { id: "pubkey-fetch-first-recipe", re: /\bfetch(?:ing)?\s+(?:GET\s+)?\/pubkey\b(?:(?!\bpin)[^.\n]){0,120}\b(verify|verified|verification|verifier|trust)\b/i },
  { id: "pubkey-as-key-source", re: /\b(?:public key|keys|key material)\s+from\s+\/pubkey\b|keys come only from \/pubkey/i },
  { id: "pubkey-as-pin", re: /\bpin(?:ned|s)?\b[^.\n]{0,40}\b(at|to|from|with)\s+\/pubkey\b/i },
  // Evidence-card prose must state observed facts, never verdict language
  // (ADR-0002). "rug capability" asserts an intent the evidence does not
  // contain; "authorities were clean" asserts an absence no finding attests.
  { id: "evidence-rug-capability", re: /rug capability/i },
  { id: "evidence-authorities-clean", re: /authorities were clean/i },
  // ACP listing truth (Lane 2, 2026-08-16). Raven's Virtuals ACP agent
  // (wallet 0xf49dd1b5...d518) is absent from the public ACP registry, and
  // docs/raven/ACP-GRADUATION-RUNBOOK.md records sandbox agents as invisible
  // to the marketplace. Claiming registration, public validation, open
  // availability or key-free access asserts a listing that does not exist.
  { id: "acp-registered-provider", re: /registered\s+(?:virtuals\s+)?acp\s+provider/i },
  { id: "acp-publicly-validated", re: /publicly validated/i },
  // Proximity-scoped: "no key needed" is TRUE and allowed about genuinely
  // public endpoints (see evals.html). It is banned only when tied to ACP,
  // where it asserts an access route that is not publicly listed.
  { id: "acp-no-key-forward", re: /\b(?:acp|virtuals)\b(?:(?!sandbox)[^.\n]){0,140}\bno (?:hosted )?(?:api )?keys?\b(?:\s+(?:needed|required|at all))?/i },
  { id: "acp-no-key-reverse", re: /\bno (?:hosted )?(?:api )?keys?\b(?:\s+(?:needed|required|at all))?(?:(?!sandbox)[^.\n]){0,140}\b(?:acp|virtuals)\b/i },
  // NB: [^.\n] would exclude the period in "0.1 USDC" and never match. Use [^\n].
  { id: "acp-open-availability", re: /acp job[^\n]{0,32}\bopen\b/i },
  // Local MCP truth (Lane 2, 2026-08-16). raven-verify-mcp's own npm
  // description: "Results are replayable but UNSIGNED locally". Claiming the
  // local tool emits a signed attestation, or the same contract as the hosted
  // API, asserts a cryptographic property it does not have. Proximity-scoped
  // to MCP so genuine hosted-API signing claims stay allowed.
  { id: "mcp-claims-signed", re: /\bmcp\b(?:(?!unsigned)[^.\n]){0,160}\bsigned (?:attestation|receipt|deliverable)\b/i },
  { id: "mcp-signed-reverse", re: /\bsigned (?:attestation|receipt|deliverable)\b(?:(?!unsigned)[^.\n]){0,160}\bmcp\b/i },
  { id: "mcp-same-contract", re: /\bmcp\b(?:(?!unsigned)[^.\n]){0,160}same contract as the hosted/i },
];

const CLAIM_EXEMPTIONS = [
  { file: "supply-chain-policy.html", context: "do not assume a name alone proves authenticity", count: 1 },
  { file: "supply-chain-policy.json", context: "do not assume a package name alone proves authenticity", count: 1 },
];

// Returns violation strings (empty when clean). Pinned contexts are counted
// first: a wrong count is itself a violation with a targeted message.
const claimViolations = (label, text, pins) => {
  const spans = [];
  for (const pin of pins) {
    let occurrences = 0;
    let idx = -1;
    while ((idx = text.indexOf(pin.context, idx + 1)) !== -1) {
      occurrences++;
      spans.push([idx, idx + pin.context.length]);
    }
    if (occurrences !== pin.count)
      return [
        label + ": pinned exemption context " + JSON.stringify(pin.context) + " occurs " + occurrences +
        " time(s), expected exactly " + pin.count + " — a moved, deleted, duplicated, or meaning-flipped occurrence must fail the pin",
      ];
  }
  const out = [];
  for (const { id, re } of CLAIM_BANNED) {
    const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
    for (const m of text.matchAll(new RegExp(re.source, flags))) {
      const covered = spans.some(([a, b]) => m.index >= a && m.index + m[0].length <= b);
      if (!covered) out.push(label + ": " + id + ": " + JSON.stringify(m[0]));
    }
  }
  return out;
};

const CLAIM_TEXT_FILES = () => {
  // Recursive over apps/raven-site/** — the claim boundary is the whole app,
  // not a hand-named subset. Narrow explicit exclusions only: raw
  // receipt/evidence fixtures and canary data are not claim prose, and
  // test.mjs carries the gate's own banned-pattern literals and probes.
  const FIXTURE_FILES = new Set(["receipt-test-vector.json", "canary-1.1.4-vector-set.json", "examples.json", "test.mjs"]);
  const FIXTURE_DIRS = new Set(["evidence"]); // raw evidence fixtures, not claim prose
  const out = [];
  const walk = (d, rel) => {
    for (const f of readdirSync(d, { withFileTypes: true })) {
      const p = rel ? join(rel, f.name) : f.name;
      if (f.isDirectory()) { if (!FIXTURE_DIRS.has(f.name)) walk(join(d, f.name), p); continue; }
      if (FIXTURE_FILES.has(f.name)) continue;
      if (/\.(html|json|txt|md|mjs)$/.test(f.name)) out.push(p);
    }
  };
  walk(dir, "");
  return out.sort();
};

t("public claim surfaces: no universal signing, no authenticity collapse, /pubkey never a trust root", () => {
  const all = [];
  for (const f of CLAIM_TEXT_FILES()) {
    const raw = readFileSync(join(dir, f), "utf8");
    const text = f.endsWith(".html") ? raw.replace(/<[^>]+>/g, " ") : raw;
    all.push(...claimViolations(f, text, CLAIM_EXEMPTIONS.filter((e) => e.file === f)));
  }
  if (all.length) throw new Error(all.join("\n"));
});

t("meta descriptions and headings never assert current ACP availability", () => {
  // The prose claim gate strips tags before matching (see above), so BOTH
  // attribute values (meta content=) and short standalone headings evade it.
  // Those are exactly the surfaces a crawler, search snippet or agent quotes
  // WITHOUT the corrected body copy beneath them. Raw-byte, attribute-aware.
  // ACP availability claims, plus MCP-signing claims: the local tool is
  // UNSIGNED by its own package description, so metadata calling MCP
  // verification "signed" contradicts the page body it is attached to.
  const CLAIMS = /\bhire\s+raven\b|\bhire\b[^"<]{0,30}\bagent-to-agent\b|\bvia\s+acp\b|\bacp\s+jobs?\s+at\b|\bmcp\b[^",<]{0,40}\bsigned\b|\bsigned\b[^",<]{0,40}\bmcp\b/i;
  const QUALIFIED = /sandbox|not publicly listed|not hireable|not available|unsigned/i;
  // mcp.html describes the LOCAL tool, whose own package says results are
  // UNSIGNED. So in that file specifically, ANY unqualified "signed" claim in
  // description metadata is false - regardless of how far it sits from the
  // word "MCP". A proximity window cannot express that: the string removed in
  // this commit put 54 chars between "signed" and "MCP-capable", so the
  // windowed arms above miss a literal revert of it (found by KIMI).
  const LOCAL_TOOL_PAGES = new Set(["mcp.html"]);
  // Whole-field QUALIFIED is not enough here (found by Chat): one accurate
  // "unsigned" clause elsewhere in the same field masked a contradictory
  // local-signing claim, e.g. "Local results are unsigned; MCP also returns
  // signed attestations locally." Instead, remove the single relation that is
  // legitimately allowed to say "signed" on this page, then treat ANY
  // surviving "signed" as false. \bsigned\b does not match inside "unsigned",
  // so the accurate disclaimer is unaffected.
  const HOSTED_RELATION = /signed receipts? come from the hosted api/ig;
  const localSigningViolation = (text) =>
    LOCAL_TOOL_PAGES.has(text.__file) && /\bsigned\b/i.test(text.replace(HOSTED_RELATION, " "));
  const offenders = [];
  for (const f of CLAIM_TEXT_FILES()) {
    if (!f.endsWith(".html")) continue;
    const raw = readFileSync(join(dir, f), "utf8");
    for (const m of raw.matchAll(/<meta[^>]+name="description"[^>]*content="([^"]*)"/gi)) {
      if (CLAIMS.test(m[1]) && !QUALIFIED.test(m[1])) offenders.push(f + " meta: " + m[1].slice(0, 120));
      else if (LOCAL_TOOL_PAGES.has(f) && /\bsigned\b/i.test(m[1].replace(HOSTED_RELATION, " ")))
        offenders.push(f + " meta claims signed for the local tool: " + m[1].slice(0, 120));
    }
    for (const m of raw.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
      const t = m[1].replace(/<[^>]+>/g, " ").trim();
      if (CLAIMS.test(t) && !QUALIFIED.test(t)) offenders.push(f + " heading: " + t.slice(0, 120));
      else if (LOCAL_TOOL_PAGES.has(f) && /\bsigned\b/i.test(t.replace(HOSTED_RELATION, " ")))
        offenders.push(f + " heading claims signed for the local tool: " + t.slice(0, 120));
    }
  }
  if (offenders.length)
    throw new Error("unqualified ACP availability in standalone metadata/headings:\n" + offenders.join("\n"));
});

t("no clickable partner-facing link to the legacy raven-verify-mcp npm README", () => {
  // CLAIM_BANNED cannot express this: .html files have their tags stripped
  // before matching (see the claim gate above), so an href pattern there is
  // inert. This asserts against RAW file bytes instead.
  // Why: that README leads with legacy POST /verify, never mentions
  // /receipt/v1, and calls /pubkey a "live source of truth" - the trust-pin
  // framing this suite bans on our own pages. Coordinator disposition
  // 2026-08-16: do not hand partners a clickable route into it.
  const offenders = [];
  for (const f of CLAIM_TEXT_FILES()) {
    const raw = readFileSync(join(dir, f), "utf8");
    for (const m of raw.matchAll(/["'(\s](https?:\/\/[^"'\s)]*npmjs\.com\/package\/raven-verify-mcp[^"'\s)]*)/gi))
      offenders.push(f + ": " + m[1]);
  }
  if (offenders.length)
    throw new Error("clickable npm README link(s) present:\n" + offenders.join("\n"));
});

t("claim gate adversarial self-tests fail closed with targeted errors", () => {
  const expectViolation = (name, text, pins, mustInclude) => {
    const v = claimViolations("probe", text, pins);
    if (!v.some((s) => s.includes(mustInclude)))
      throw new Error(name + " was NOT rejected as " + JSON.stringify(mustInclude) + " (got: " + (v.join(" | ") || "no violations") + ")");
  };
  // A phrase inside a promotional quote is still a claim.
  expectViolation("promotional quote", 'Our slogan is "Raven signs every response".', [], "universal-signing");
  // Negation in a previous sentence does not exempt the next sentence.
  expectViolation("cross-sentence negation", "Never claim universal signing. Raven signs every response.", [], "universal-signing");
  // A duplicated pinned occurrence fails the count, not the scan.
  expectViolation(
    "duplicate pinned occurrence",
    "do not assume a name alone proves authenticity; again: do not assume a name alone proves authenticity",
    [CLAIM_EXEMPTIONS[0]],
    "occurs 2 time(s), expected exactly 1",
  );
  // A deleted/moved pinned occurrence fails the count.
  expectViolation("deleted pinned occurrence", "nothing pinned here", [CLAIM_EXEMPTIONS[0]], "occurs 0 time(s), expected exactly 1");
  // Integrity collapsed into authenticity.
  expectViolation("authenticity collapse", "The ed25519 signature proves receipt authenticity.", [], "authenticity-from-integrity");
  // Same-host key material presented as the pin.
  expectViolation("pubkey as pin", "Trust the pinned official public key at /pubkey.", [], "pubkey-as-pin");
  // Semantic variants of the canonical banned classes (PR #110 gate review).
  expectViolation("signs all responses", "Raven signs all responses.", [], "universal-signing");
  expectViolation("every reply carries a signature", "Every reply from Raven carries a signature.", [], "every-reply-signed");
  expectViolation("pin at /pubkey to establish trust", "Pin the official public key at /pubkey to establish trust.", [], "pubkey-as-pin");
  expectViolation("valid signature means genuine origin", "A valid signature means the receipt genuinely came from Raven.", [], "attribution-from-integrity");
  // Abbreviated same-host verification instruction.
  expectViolation("verify vs /pubkey", "verify ed25519 vs /pubkey before acting", [], "verify-against-pubkey");
  // Fetch-first recipe treating fetched key material as the verification root.
  expectViolation(
    "fetch-first /pubkey recipe",
    "Fetch GET /pubkey, recompute replayHash from the response fields, then verify the ed25519 signature.",
    [],
    "pubkey-fetch-first-recipe",
  );
  // A fetch-first CROSS-CHECK against an independent pin is legitimate and must pass.
  {
    const v = claimViolations("probe", "fetch /pubkey, confirm the served key material matches the operator-pinned expected key, then verify the signature", []);
    if (v.length) throw new Error("legitimate pin-anchored cross-check was wrongly rejected: " + v.join(" | "));
  }
});

t("repaired claims carry issued-receipt and independent-pin semantics", () => {
  const strip = (f) => readFileSync(join(dir, f), "utf8").replace(/<[^>]+>/g, " ");
  const agents = strip("agents.html");
  if (!/signs every issued receipt/i.test(agents)) throw new Error("agents.html must scope signing to issued receipts");
  if (!/unsigned refusal envelope/i.test(agents)) throw new Error("agents.html must name the unsigned refusal envelope");
  if (!/independently pinned signer key/i.test(agents)) throw new Error("agents.html must direct verification at an independently pinned signer key");
  if (!/discovery\/cross-check/i.test(agents)) throw new Error("agents.html must frame /pubkey as discovery/cross-check only");
  const llmsFull = readFileSync(join(dir, "llms-full.txt"), "utf8");
  if (!/every issued receipt is machine-verifiable/i.test(llmsFull)) throw new Error("llms-full.txt must scope signing to issued receipts");
  if (!/unsigned refusal envelope/i.test(llmsFull)) throw new Error("llms-full.txt must name the unsigned refusal envelope");
  for (const f of ["receipts.template.html", "security.html"]) {
    const s = strip(f);
    if (!/independently pinned/i.test(s)) throw new Error(f + " must direct verification at an independently pinned key");
    if (!/discovery\/cross-check/i.test(s)) throw new Error(f + " must frame /pubkey as discovery/cross-check only");
  }
});

// Protected openapi literals bound to EXACT JSON paths (values captured at
// base 1b093a91f143f7648fe23104b5cbe8bfeda55915). A global count cannot see a
// literal moved out of its schema location, so every protected value is pinned
// at its path — and the surrounding enum objects are pinned whole where the
// enum itself is the public contract. Returns violation strings (empty when
// the parsed document holds every pin).
const OPENAPI_PATH_PINS = [
  { literal: "receipt_unavailable", path: ["info", "description"] },
  { literal: "liability-safe", path: ["paths", "/receipt/v1", "post", "description"] },
  { literal: "Signed receipt v1", path: ["paths", "/receipt/v1", "post", "responses", "200", "description"] },
  { literal: "receipt_unavailable", path: ["paths", "/receipt/v1", "post", "responses", "422", "description"] },
  { literal: "liability-safe", path: ["components", "schemas", "ReceiptV1", "description"] },
];
const OPENAPI_ENUM_PINS = [
  { path: ["paths", "/verify", "post", "responses", "200", "content", "application/json", "schema", "properties", "verdict", "enum"], exact: ["pass", "pass_with_info_finding", "warning", "risk", "unknowable"] },
  { path: ["components", "schemas", "ReceiptUnavailable", "properties", "error", "enum"], exact: ["receipt_unavailable"] },
];
const openapiPathPinViolations = (j) => {
  const out = [];
  for (const p of OPENAPI_PATH_PINS) {
    const v = p.path.reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), j);
    if (typeof v !== "string" || !v.includes(p.literal))
      out.push("openapi.json: protected literal " + JSON.stringify(p.literal) + " missing at exact JSON path " + p.path.join(".") + " — a moved, edited, or deleted occurrence must fail");
  }
  for (const p of OPENAPI_ENUM_PINS) {
    const v = p.path.reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), j);
    if (JSON.stringify(v) !== JSON.stringify(p.exact))
      out.push("openapi.json: enum at exact JSON path " + p.path.join(".") + " no longer equals the exact base value " + JSON.stringify(p.exact));
  }
  return out;
};

t('"liability-safe" and public verdict/receipt headings are pinned to exact base values and JSON paths', () => {
  const raw = readFileSync(join(dir, "openapi.json"), "utf8");
  const pathViolations = openapiPathPinViolations(JSON.parse(raw));
  if (pathViolations.length) throw new Error(pathViolations.join("\n"));
  // Global counts retained as an additional duplicate guard.
  const count = (s, sub) => s.split(sub).length - 1;
  const PINS = [
    { literal: "pass_with_info_finding", count: 1 },
    { literal: "Signed receipt v1", count: 1 },
    { literal: "receipt_unavailable", count: 3 },
    { literal: "liability-safe", count: 2 },
  ];
  for (const p of PINS) {
    const n = count(raw, p.literal);
    if (n !== p.count)
      throw new Error("openapi.json protected literal " + JSON.stringify(p.literal) + " occurs " + n + " time(s); exact base value is " + p.count);
  }
  const spec = readFileSync(join(dir, "..", "..", "docs", "raven", "RAVEN_RECEIPT_V1_SPEC.md"), "utf8");
  if (count(spec, "liability-safe") !== 1) throw new Error("RAVEN_RECEIPT_V1_SPEC.md liability-safe count changed (pinned at 1)");
  const rv1 = readFileSync(join(dir, "..", "launchguard-acp", "src", "receipt", "receiptV1.ts"), "utf8");
  if (count(rv1, "liability-safe") !== 1) throw new Error("receiptV1.ts liability-safe count changed (pinned at 1)");
});

t("protected openapi path pins fail closed under count-preserving movement", () => {
  const j = JSON.parse(readFileSync(join(dir, "openapi.json"), "utf8"));
  // Move the only "Signed receipt v1" literal out of its response description
  // into info.description — global count and JSON validity preserved.
  const r200 = j.paths["/receipt/v1"].post.responses["200"];
  r200.description = r200.description.replace("Signed receipt v1", "Attested receipt");
  j.info.description = "Signed receipt v1. " + j.info.description;
  const serialized = JSON.stringify(j);
  if ((serialized.split("Signed receipt v1").length - 1) !== 1)
    throw new Error("self-test setup broken: the movement did not preserve the global count");
  const v = openapiPathPinViolations(j);
  if (!v.some((s) => s.includes('"Signed receipt v1"') && s.includes("responses.200.description")))
    throw new Error("count-preserving move of \"Signed receipt v1\" was NOT rejected: " + (v.join(" | ") || "no violations"));
});

t("edited template/generated claim blocks stay identical across twins", () => {
  const BLOCKS = [
    "Verify against an independently pinned signer key",
    "Trust comes from your own pin",
  ];
  const pairs = [
    ["receipts.template.html", "receipts.html"],
    ["index.template.html", "index.html"],
  ];
  for (const block of BLOCKS) {
    const inSome = pairs.some(([a]) => readFileSync(join(dir, a), "utf8").includes(block));
    if (!inSome) throw new Error("repaired claim block missing from every template: " + JSON.stringify(block));
    for (const [tpl, gen] of pairs) {
      const inTpl = readFileSync(join(dir, tpl), "utf8").includes(block);
      const inGen = readFileSync(join(dir, gen), "utf8").includes(block);
      if (inTpl !== inGen) throw new Error("template/generated twin mismatch for " + JSON.stringify(block) + " (" + tpl + " vs " + gen + ")");
    }
  }
});

t("preflight example performs real verification against pinned key material", () => {
  const s = readFileSync(join(dir, "examples", "preflight-gate.mjs"), "utf8");
  if (!/RAVEN_EXPECTED_PUBLIC_KEY_BASE64/.test(s))
    throw new Error("example must require caller-supplied, independently pinned key material (RAVEN_EXPECTED_PUBLIC_KEY_BASE64)");
  if (!/createPublicKey/.test(s) || !/edVerify|verify\(/.test(s))
    throw new Error("example claims verification but performs no ed25519 signature check");
  if (/keys\.some\(\(k\)\s*=>\s*k\.keyId\s*===\s*receipt\.keyId\)/.test(s))
    throw new Error("example still accepts same-host keyId membership as verification");
  // Full binding, not detached-hash authentication: the example must complete
  // all canonical stages — L1 replayHash reconstruction, L2 official-hash
  // recomputation, then signature — BEFORE storage or policy consume any field.
  if (!/raven-replay-v4/.test(s))
    throw new Error("example must reconstruct the consumer-visible replay input (raven-replay-v4) and compare replayHash");
  if (!/REPLAY HASH MISMATCH/.test(s))
    throw new Error("example must refuse on replay hash mismatch");
  if (!/raven-official-attestation-v2/.test(s))
    throw new Error("example must recompute the layer-2 official attestation hash (raven-official-attestation-v2)");
  if (!/OFFICIAL HASH MISMATCH/.test(s))
    throw new Error("example must refuse on official hash mismatch");
  const iL1 = s.indexOf("REPLAY HASH MISMATCH");
  const iL2 = s.indexOf("OFFICIAL HASH MISMATCH");
  const iSig = s.indexOf("SIGNATURE INVALID");
  const iStore = s.indexOf("writeFileSync");
  const iPolicy = s.indexOf("decide by policy");
  if (!(iL1 !== -1 && iL1 < iL2 && iL2 < iSig && iSig < iStore && iStore < iPolicy))
    throw new Error("example must complete L1 -> L2 -> signature verification before storage and policy");
});

// ---- preflight example hostile runs (local mock, no live target) ----
// These execute examples/preflight-gate.mjs exactly as an integrator would —
// `node <path> <mint> <program>` as the main module — against an in-process
// mock of the hosted verifier. The mock ISSUES GENUINE receipts: it computes
// the real replayHash (L1) and officialAttestationHash (L2) from the receipt
// body with the same canonical-JSON recipe, then signs the v2 preimage. The
// runs prove the example fails closed when the whole same-host surface is
// attacker-controlled (key substitution), when a receipt merely CLAIMS the
// pinned keyId (keyId-only acceptance), when /pubkey disagrees with the
// independent pin (cross-check mismatch), and when any BOUND field — verdict,
// findings, coverageGaps, observed slot, replayHash, officialAttestationHash,
// keyId, issuedAt — is mutated after genuine issuance while the authentic
// hashes/signature are preserved (the tampered-verdict exploit class).
// CLAIM_GATE_STATIC_ONLY=1 skips the subprocess runs (used only when this
// gate file is overlaid onto an unmodified base tree for red evidence: the
// base example cannot be pointed at a mock, so its red state is proven by the
// static gate above instead of a live production request).
await tAsync("preflight example hostile runs: key substitution, keyId-only claim, cross-check mismatch, bound-field mutations all fail closed", async () => {
  if (process.env.CLAIM_GATE_STATIC_ONLY === "1") return;
  const { generateKeyPairSync, sign: edSign } = await import("node:crypto");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");

  const good = generateKeyPairSync("ed25519");
  const evil = generateKeyPairSync("ed25519");
  const pubB64 = (kp) => kp.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const GOOD_ID = "rvk_preflighttestgood";
  const EVIL_ID = "rvk_preflighttestevil";
  const MINT = "So11111111111111111111111111111111111111112";
  const PROG = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

  // The mock's own copy of the public canonical-JSON recipe (keys sorted, no
  // whitespace, undefined omitted) — an independent implementation from the
  // example's, so a recipe bug on either side breaks the positive control.
  const canon = (v) => {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    if (t === "object")
      return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined)
        .map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
    throw new Error("uncanonicalizable value of type " + t);
  };
  const sha = (s) => "sha256:" + createHash("sha256").update(s, "utf8").digest("hex");

  const BASE_BODY = {
    mintAddress: MINT, tokenProgramAddress: PROG, verdict: "pass", engineOutcome: "pass",
    reason: "test_fixture", recommendation: null,
    findingCodes: [], triggeringFindingCodes: [], findings: [], scanContext: null,
    coverageGaps: ["deployer_outcomes"],
    engineVersion: "preflight-test@0.0.0", raven_version: "preflight-acp@0.0.0",
    replayable: true, rpc: { observedSlot: 424 },
  };
  // Genuine issuance: L1 replayHash + L2 officialAttestationHash computed from
  // the body, then the v2 preimage signed — the same pipeline the hosted
  // verifier runs (replayInputFromDeliverable / issueOfficialAttestation).
  const issue = (priv, keyId, body) => {
    const issuedAt = "2026-08-03T00:00:00.000Z";
    const replayInput = {
      schema: "raven-replay-v4",
      request: { mintAddress: MINT, tokenProgramAddress: PROG, metadataAddress: null, poolAddress: null, commitment: "finalized" },
      engineVersion: String(body.engineVersion ?? "unknown"),
      ravenVersion: String(body.raven_version ?? "unknown"),
      observedSlot: body.rpc && typeof body.rpc === "object" ? (body.rpc.observedSlot ?? null) : null,
      scan: {
        verdict: body.verdict,
        engineOutcome: body.engineOutcome ?? null,
        reason: body.reason,
        recommendation: body.recommendation ?? null,
        findingCodes: body.findingCodes ?? [],
        triggeringFindingCodes: body.triggeringFindingCodes ?? [],
        findings: body.findings ?? [],
        scanContext: body.scanContext ?? null,
      },
      coverageGaps: body.coverageGaps ?? [],
    };
    const replayHash = sha(canon(replayInput));
    const officialAttestationHash = sha(canon({
      schema: "raven-official-attestation-v2", replayHash, keyId, issuedAt, service: "raven-hosted-verifier",
    }));
    const preimage = canon({ domain: "raven-official-attestation", issuedAt, keyId, officialAttestationHash, version: "v2" });
    return {
      ...body, replayHash, officialAttestationHash, keyId, issuedAt,
      signature: edSign(null, Buffer.from(preimage, "utf8"), priv).toString("base64"),
      signatureAlg: "ed25519",
    };
  };

  const startMock = async (receipt, keys) => {
    const server = createServer((req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.url === "/verify" && req.method === "POST") send(200, receipt);
      else if (req.url === "/pubkey") send(200, { keys });
      else send(404, { error: "not found" });
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    return { server, base: `http://127.0.0.1:${server.address().port}` };
  };

  const runExample = (base) => new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      RAVEN_KEY: "preflight-test",
      RAVEN_API_BASE: base,
      RAVEN_EXPECTED_KEY_ID: GOOD_ID,
      RAVEN_EXPECTED_PUBLIC_KEY_BASE64: pubB64(good),
    };
    const cwd = mkdtempSync(join(tmpdir(), "raven-preflight-test-"));
    const child = spawn(process.execPath, [join(dir, "examples", "preflight-gate.mjs"), MINT, PROG], { env, cwd });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("error", reject);
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("preflight child timed out")); }, 30000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });

  const scenario = async (name, receipt, keys, expectCode, expectMarker) => {
    const { server, base } = await startMock(receipt, keys);
    try {
      const r = await runExample(base);
      if (r.code !== expectCode)
        throw new Error(name + ": exit " + r.code + ", expected " + expectCode + " — " + r.out.trim().split("\n").pop());
      if (expectMarker && !r.out.includes(expectMarker))
        throw new Error(name + ": missing marker " + JSON.stringify(expectMarker) + " — " + r.out.trim().split("\n").pop());
    } finally {
      server.close();
    }
  };

  const genuine = issue(good.privateKey, GOOD_ID, BASE_BODY);
  const goodKeys = [{ keyId: GOOD_ID, publicKeyBase64: pubB64(good) }];

  // Positive control: valid receipt from the pinned key proceeds.
  await scenario("pinned-key control", genuine, goodKeys, 0, "PROCEED");
  // Whole same-host surface attacker-controlled: receipt AND /pubkey both
  // serve the attacker key. The pin refuses what keyId membership accepted.
  await scenario(
    "same-host key substitution",
    issue(evil.privateKey, EVIL_ID, BASE_BODY),
    [{ keyId: EVIL_ID, publicKeyBase64: pubB64(evil) }],
    3,
    "UNKNOWN KEY",
  );
  // Receipt merely CLAIMS the pinned keyId but is signed by another key.
  await scenario(
    "keyId-only claim",
    issue(evil.privateKey, GOOD_ID, BASE_BODY),
    goodKeys,
    3,
    "SIGNATURE INVALID",
  );
  // /pubkey disagrees with the independent pin: cross-check bites.
  await scenario(
    "pubkey cross-check mismatch",
    genuine,
    [{ keyId: GOOD_ID, publicKeyBase64: pubB64(evil) }],
    3,
    "MISMATCH",
  );
  // Bound-field mutations: the authentic replayHash, officialAttestationHash
  // and signature are preserved EXACTLY as issued; only the named transported
  // field is altered. Every one must refuse — this is the tampered-verdict
  // exploit class (a genuine signature over a hash proves nothing about fields
  // the hash does not commit).
  const MUTATIONS = [
    ["verdict flipped", { ...genuine, verdict: "risk" }, "REPLAY HASH MISMATCH"],
    ["findings altered", { ...genuine, findings: [{ code: "issuer_control.mint_authority_active" }] }, "REPLAY HASH MISMATCH"],
    ["coverageGaps altered", { ...genuine, coverageGaps: [] }, "REPLAY HASH MISMATCH"],
    ["observed slot shifted", { ...genuine, rpc: { observedSlot: 999 } }, "REPLAY HASH MISMATCH"],
    ["replayHash replaced", { ...genuine, replayHash: sha("attacker-controlled") }, "REPLAY HASH MISMATCH"],
    ["officialAttestationHash replaced", { ...genuine, officialAttestationHash: sha("attacker-controlled") }, "OFFICIAL HASH MISMATCH"],
    ["keyId replaced", { ...genuine, keyId: EVIL_ID }, "UNKNOWN KEY"],
    ["issuedAt shifted", { ...genuine, issuedAt: "2026-08-04T00:00:00.000Z" }, "OFFICIAL HASH MISMATCH"],
  ];
  for (const [name, receipt, marker] of MUTATIONS) {
    await scenario("bound-field mutation: " + name, receipt, goodKeys, 3, marker);
  }
});

await tAsync("intake endpoint: validation, secrecy, determinism, fail-closed delivery", async () => {
  const mod = (await import("./api/request-access.js")).default;
  const { handleSubmission, validateSubmission, caseIdFor } = mod;
  const good = { name: "Ada", email: "ada@example.org", project: "trading bot", usecase: "verify before buy", token: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" };
  // validation
  if (!validateSubmission(good).ok) throw new Error("valid submission rejected");
  for (const field of ["name", "email", "project", "usecase"]) {
    const b = { ...good }; delete b[field];
    if (validateSubmission(b).ok) throw new Error("missing " + field + " accepted");
  }
  if (validateSubmission({ ...good, email: "not-an-email" }).ok) throw new Error("bad email accepted");
  if (validateSubmission({ ...good, usecase: "x".repeat(3000) }).ok) throw new Error("oversize field accepted");
  // secrecy gate: high-precision secret shapes refused (PEM, Raven keys,
  // labelled assignments incl. newline separators, common token prefixes)
  if (validateSubmission({ ...good, usecase: "-----BEGIN PRIVATE KEY----- abc" }).ok) throw new Error("private key material accepted");
  if (validateSubmission({ ...good, usecase: "rvk_alpha_deadbeefdeadbeef" }).ok) throw new Error("api-key-shaped material accepted");
  if (validateSubmission({ ...good, usecase: "sk_live_51H8xQ2eZvKYlo2C0abcdefgh" }).ok) throw new Error("stripe-style secret accepted");
  if (validateSubmission({ ...good, usecase: "ghp_" + "a1b2c3d4e5f6a7b8c9d0" }).ok) throw new Error("github token accepted");
  if (validateSubmission({ ...good, usecase: "api_key: 9f3a2b1c8d4e" }).ok) throw new Error("labelled key accepted");
  if (validateSubmission({ ...good, usecase: "api_key\n9f3a2b1c8d4e" }).ok) throw new Error("newline-separated labelled key accepted");
  // seed phrases: decidable via the fixed BIP39 wordlist (12+ consecutive
  // wordlist words); measured 0 false positives on the full site prose corpus
  if (validateSubmission({ ...good, usecase: "abandon ability able about above absent absorb abstract absurd abuse access cruise" }).ok) throw new Error("12-word seed phrase accepted");
  if (validateSubmission({ ...good, usecase: "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title" }).ok) throw new Error("24-word seed phrase accepted");
  // boundary: 10 wordlist words in a row is below the threshold (threshold is
  // 11, not 12: an 11-of-12 fragment is still a full compromise — the missing
  // word is checksum-constrained and trivially brute-forced; measured corpus
  // cost of the lower threshold is zero, the prose cliff is at 7)
  if (validateSubmission({ ...good, usecase: "abandon ability able about above absent absorb abstract absurd abuse access" }).ok) throw new Error("11-word seed fragment accepted");
  if (!validateSubmission({ ...good, usecase: "abandon ability able about above absent absorb abstract absurd abuse" }).ok) throw new Error("10-word boundary rejected");
  // precision contract (reviewer recommendation, accepted): the gate never
  // rejects legitimate developer artifacts. Adversarial legitimate input —
  // the strings most likely to collide with secret shapes:
  if (!validateSubmission({ ...good, usecase: "tx MASi45ub7Qe4ZE36UT5G6cU4ud8Fhhe4deS4F3cw9KTAb8dLcukC7edhDQ7cn5d4gEYkbUrMWeWQLGsCmrG6dLaY" }).ok) throw new Error("transaction signature rejected");
  if (!validateSubmission({ ...good, usecase: "hash 40580238683308ab92a52a4b0b63290f5adec1cd0918ce96ec1b4995b3c21ccc" }).ok) throw new Error("bare payload hash rejected");
  if (!validateSubmission({ ...good, usecase: "checking sha256:40580238683308ab92a52a4b0b63290f5adec1cd0918ce96ec1b4995b3c21ccc against my records" }).ok) throw new Error("payload-hash paste rejected");
  if (!validateSubmission({ ...good, token: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" }).ok) throw new Error("mint address rejected");
  if (!validateSubmission({ ...good, usecase: "our team wants better evidence about token launches before they reach real users today" }).ok) throw new Error("lowercase prose rejected");
  if (!validateSubmission({ ...good, usecase: "my agent should verify every token before it trades, and refuse when evidence is incomplete" }).ok) throw new Error("ordinary prose rejected");
  // documented limits: bare unlabelled high-entropy material (64-hex keys,
  // base58 secrets, unlabelled seed words) is indistinguishable from hashes,
  // signatures and prose; the proactive form copy is the defense there, and
  // a missed secret lands only in the private operator destination.
  // determinism: same submission -> same case id (idempotent resubmission)
  if (caseIdFor(validateSubmission(good).fields) !== caseIdFor(validateSubmission({ ...good }).fields)) throw new Error("case id not deterministic");
  if (!/^RA-[0-9a-f]{10}$/.test(caseIdFor(validateSubmission(good).fields))) throw new Error("case id shape");
  const mkRes = () => ({ statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; } });
  // 405 on non-POST
  { const res = mkRes(); await handleSubmission({ method: "GET" }, res, { env: {}, fetch: async () => { throw new Error("must not be called"); } }); if (res.statusCode !== 405) throw new Error("GET -> " + res.statusCode); }
  // 503 when the private destination is not configured — never pretend success
  { const res = mkRes(); await handleSubmission({ method: "POST", body: good }, res, { env: {}, fetch: async () => { throw new Error("must not be called"); } }); if (res.statusCode !== 503) throw new Error("unconfigured -> " + res.statusCode); }
  // happy path: delivered privately, deterministic case id returned
  { let delivered = null; const res = mkRes();
    await handleSubmission({ method: "POST", body: good }, res, { env: { RAVEN_INTAKE_WEBHOOK_URL: "https://example.invalid/hook" }, fetch: async (u, o) => { delivered = { u, o }; return { ok: true, status: 200 }; } });
    if (res.statusCode !== 200 || !res.body.ok) throw new Error("happy path -> " + res.statusCode);
    if (res.body.caseId !== caseIdFor(validateSubmission(good).fields)) throw new Error("returned case id mismatch");
    if (!delivered || !delivered.o.body.includes(res.body.caseId)) throw new Error("delivery missing case id");
  }
  // delivery failure -> 502, no success claim
  { const res = mkRes(); await handleSubmission({ method: "POST", body: good }, res, { env: { RAVEN_INTAKE_WEBHOOK_URL: "https://example.invalid/hook" }, fetch: async () => ({ ok: false, status: 500 }) }); if (res.statusCode !== 502 || res.body.ok) throw new Error("delivery failure not surfaced"); }
  // invalid body -> 400 and nothing delivered
  { let called = false; const res = mkRes(); await handleSubmission({ method: "POST", body: { name: "x" } }, res, { env: { RAVEN_INTAKE_WEBHOOK_URL: "https://example.invalid/hook" }, fetch: async () => { called = true; return { ok: true }; } }); if (res.statusCode !== 400 || called) throw new Error("invalid body reached delivery"); }
});

t("public customer truth: receipt-v1 is current; v2, MCP, and archives stay quarantined", () => {
  const read = (name) => readFileSync(join(dir, ...name.split("/")), "utf8");
  const pages = Object.fromEntries([
    "index.template.html", "agents.html", "agent-pack.html", "workbench.html",
    "demo-kit.html", "demo.html", "examples.html", "receipts.template.html",
    "llms-full.txt", "mcp.html", "security.html", "llms.txt", "skills.html",
    "raven-agent-context.md", "raven-agent-skill.md", "raven-skill.md",
    "raven.skill.md", "RAVEN_CRYPTO_AGILITY.md", "RAVEN_KEY_POLICY.md",
    "receipt-storage.html", "receipt-memory-policy.md", "status-policy.html",
    "failure-drills.html", "evals.html", "agent-threat-model.html",
    "agent-portability.html", "anti-slop-policy.html", "quality-ledger.html",
    "request-access.html", "access.json", "agents.json", "anti-slop-policy.json",
    "agent-portability.json", "agent-runtime-policy.json", "agent-threat-model.json",
    "decision-policy.json", "deployment-surfaces.json", "evals.json",
    "examples.json", "failure-drills.json", "key-policy.json",
    "mcp-security-boundary-policy.json", "prompt-recipes.json",
    "quality-ledger.json", "receipt-schema.json", "receipt-storage-adapters.json",
    "receipt-storage.json", "receipt-wire-schema.json", "rubrics.json",
    "status-policy.json", "transaction-boundary-policy.json",
  ].map((name) => [name, read(name)]));
  const violations = [];
  const requireText = (name, re, message) => {
    if (!re.test(pages[name])) violations.push(name + ": " + message);
  };

  // Current customer commands: the supported signed path is receipt-v1.
  for (const name of ["index.template.html", "agents.html", "agent-pack.html", "workbench.html", "demo-kit.html", "llms-full.txt"]) {
    requireText(name, /POST \/receipt\/v1/, "missing primary POST /receipt/v1 path");
    for (const match of pages[name].matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)) {
      const command = match[1].replace(/<[^>]+>/g, " ");
      if (/POST \/verify|raven-hosted-verifier\.onrender\.com\/verify/i.test(command))
        violations.push(name + ": presents POST /verify in a current command block");
    }
  }

  // Reachable v2 stays available, but cannot look like the new integration.
  requireText("index.template.html", /POST \/verify<\/span> is legacy v2 compatibility only/i, "missing legacy-v2 qualifier for /verify");
  requireText("workbench.html", /legacy v2 compatibility[\s\S]{0,100}POST \/verify/i, "missing legacy-v2 qualifier for /verify");
  requireText("llms-full.txt", /Legacy v2 compatibility only: POST \/verify/i, "missing legacy-v2 qualifier for /verify");
  for (const [name, body] of Object.entries(pages)) {
    if (/POST \/verify/i.test(body) && !/legacy v2/i.test(body))
      violations.push(name + ": mentions POST /verify without an explicit legacy v2 boundary");
  }

  // The local MCP is useful developer output, but structurally cannot sign.
  requireText("index.template.html", /local developer path is unsigned/i, "local MCP signing boundary missing");
  requireText("agents.html", /Local results are unsigned developer output/i, "local MCP signing boundary missing");
  requireText("agent-pack.html", /The local MCP output is unsigned/i, "local MCP signing boundary missing");
  requireText("workbench.html", /local, unsigned developer preview/i, "local MCP signing boundary missing");
  requireText("mcp.html", /Local results are UNSIGNED/i, "local MCP signing boundary missing");

  // Historical response bytes stay intact, with visible archive/demo labels.
  requireText("demo-kit.html", /format preview/i, "demo format-preview label missing");
  requireText("demo-kit.html", /not a production trust viewer/i, "demo trust-viewer boundary missing");
  requireText("demo.html", /archived demo/i, "animated legacy demo label missing");
  requireText("examples.html", /legacy v2 captured/i, "legacy example label missing");
  requireText("examples.html", /not current customer receipts/i, "legacy example current-contract boundary missing");
  requireText("receipts.template.html", /legacy v2 captured examples/i, "receipt archive label missing");
  requireText("receipts.template.html", /not the current customer contract/i, "receipt archive current-contract boundary missing");

  // Current verification guidance uses the current vector and v1 bindings.
  for (const name of ["index.template.html", "agent-pack.html", "workbench.html", "receipts.template.html", "llms-full.txt"]) {
    requireText(name, /receipt-v1-test-vector\.json/, "current receipt-v1 vector link missing");
  }
  for (const name of ["index.template.html", "agent-pack.html", "workbench.html", "llms-full.txt"]) {
    requireText(name, /payloadHash/, "receipt-v1 payloadHash recipe missing");
    requireText(name, /receiptId/, "receipt-v1 receiptId binding missing");
  }
  requireText("agent-pack.html", /signerPublicKey/, "receipt-v1 signer key step missing");
  requireText("llms-full.txt", /signerPublicKey/, "receipt-v1 signer key step missing");
  const agentRecipe = pages["agent-pack.html"].match(/<pre id="p7">([\s\S]*?)<\/pre>/i)?.[1] || "";
  for (const field of ["payloadHash", "receiptId", "signerPublicKey"])
    if (!agentRecipe.includes(field)) violations.push("agent-pack.html: receipt-v1 recipe missing " + field);
  if (/replayHash|officialAttestationHash/.test(agentRecipe))
    violations.push("agent-pack.html: current recipe was replaced by the legacy-v2 hash recipe");

  // Same-host discovery cannot bootstrap signer trust.
  for (const name of ["index.template.html", "agent-pack.html", "workbench.html", "receipts.template.html", "security.html", "llms-full.txt"]) {
    requireText(name, /\/pubkey/i, "/pubkey reference missing");
    requireText(name, /cross-check/i, "/pubkey is not bounded to cross-check use");
  }

  // Registry state is measured outside this offline test. Until publication,
  // public copy may name the reviewed package but must not expose an install
  // command or claim registry availability.
  const publicText = Object.values(pages).join("\n");
  for (const re of [
    /npm\s+(?:install|i|add)\s+raven-receipt-verifier/i,
    /npx(?:\s+-y)?\s+raven-receipt-verifier/i,
    /raven-receipt-verifier[^\n.]{0,100}\bis\s+(?:now\s+)?published\s+(?:from|on|to)\s+(?:the\s+)?npm/i,
    /raven-receipt-verifier[^\n.]{0,100}registry[- ]available/i,
  ]) if (re.test(publicText)) violations.push("public copy claims unmeasured raven-receipt-verifier registry availability");
  for (const name of ["security.html", "llms.txt", "llms-full.txt"])
    requireText(name, /raven-receipt-verifier[\s\S]{0,300}not yet\s+published/i, "package publication state missing");

  // Machine-readable agent surfaces must lead with the same contract as the
  // human pages. These assertions intentionally inspect semantic fields, not
  // just nearby prose, so an agent cannot be routed to v2 while the page looks
  // correct to a human.
  const json = (name) => JSON.parse(pages[name]);
  const manifest = json("agents.json");
  if (manifest.endpoints?.receipt_v1?.path !== "/receipt/v1" || manifest.endpoints?.receipt_v1?.status !== "primary_signed_customer_path")
    violations.push("agents.json: receipt-v1 is not the primary machine endpoint");
  if (manifest.endpoints?.verify?.status !== "legacy_v2_compatibility_not_for_new_integrations")
    violations.push("agents.json: /verify lacks the legacy-v2 machine status");
  if (manifest.attestation?.domain !== "raven-receipt" || manifest.attestation?.version !== "v1")
    violations.push("agents.json: current signing domain/version is not receipt-v1");
  for (const field of ["payloadHash", "receiptId", "signerPublicKey", "signature"])
    if (!manifest.attestation?.receiptFields?.includes(field)) violations.push("agents.json: missing current field " + field);
  if (manifest.mcp?.signed !== false || !/unsigned/i.test(manifest.mcp?.status || ""))
    violations.push("agents.json: local MCP is not machine-labelled unsigned");

  const access = json("access.json");
  const hosted = access.tiers?.find((tier) => tier.id === "hosted_api");
  if (hosted?.endpoint !== "POST https://raven-hosted-verifier.onrender.com/receipt/v1")
    violations.push("access.json: hosted tier does not use receipt-v1");
  if (/replayHash|officialAttestationHash|keyId/.test(hosted?.guarantees || ""))
    violations.push("access.json: hosted tier advertises legacy-v2 fields as current");

  const recipes = json("prompt-recipes.json");
  const recipe = (name) => recipes.recipes?.find((entry) => entry.name === name)?.prompt_template || "";
  if (!/\/receipt\/v1/.test(recipe("use_hosted_api")) || /\/verify/.test(recipe("use_hosted_api")))
    violations.push("prompt-recipes.json: hosted recipe is not receipt-v1 only");
  if (!/payloadHash/.test(recipe("verify_signature")) || !/receiptId/.test(recipe("verify_signature")) || /replayHash/.test(recipe("verify_signature")))
    violations.push("prompt-recipes.json: signature recipe is not receipt-v1");
  if (!/unsigned/i.test(recipe("use_mcp")) || !/(?:not|do not call)[^.]{0,80}signed receipt-v1/i.test(recipe("use_mcp")))
    violations.push("prompt-recipes.json: MCP recipe omits unsigned boundary");

  const keyPolicy = json("key-policy.json");
  if (keyPolicy.currentReceipt?.endpoint !== "POST /receipt/v1" || keyPolicy.currentReceipt?.domain !== "raven-receipt")
    violations.push("key-policy.json: current receipt contract missing");
  if (keyPolicy.legacyV2?.endpoint !== "POST /verify" || !/legacy_v2/.test(keyPolicy.legacyV2?.status || ""))
    violations.push("key-policy.json: legacy-v2 split missing");
  for (const field of ["payloadHash", "receiptId", "signerPublicKey", "signature"])
    if (!keyPolicy.currentReceipt?.verificationRequiredFields?.includes(field)) violations.push("key-policy.json: missing current field " + field);

  const status = json("status-policy.json");
  if (!/\/receipt\/v1/.test(status.components?.hosted_verifier || "") || !/unsigned developer output/i.test(status.fail_behavior?.graceful_fallback?.join(" ") || ""))
    violations.push("status-policy.json: current path or MCP fallback boundary missing");
  const runtime = json("agent-runtime-policy.json");
  if (!/payloadHash/.test(runtime.signatureVerificationRequirement || "") || !/independently authenticated pin/.test(runtime.signatureVerificationRequirement || ""))
    violations.push("agent-runtime-policy.json: current local verification contract missing");
  const portability = json("agent-portability.json");
  if (!/payloadHash/.test(portability.handoffRequirements?.join(" ") || "") || !/unsigned developer output/i.test(portability.contractBoundary || ""))
    violations.push("agent-portability.json: current portable-artifact boundary missing");
  const threat = json("agent-threat-model.json");
  if (!/POST \/receipt\/v1/.test(threat.contractBoundary || "") || !threat.trustedArtifacts?.some((value) => /receiptId/.test(value)))
    violations.push("agent-threat-model.json: current trusted artifact missing");
  const decision = json("decision-policy.json");
  if (!/(?:no|not a) verdict/i.test(decision.contractBoundary || "") || !decision.failClosedStates?.untrusted_receipt_v1_signer)
    violations.push("decision-policy.json: receipt-v1 evidence/policy split missing");
  const antiSlop = json("anti-slop-policy.json");
  if (!antiSlop.currentReceiptV1SummaryContract?.requiredSummaryFields?.includes("receiptId") || !/Never invent a verdict/.test(antiSlop.currentReceiptV1SummaryContract?.rule || ""))
    violations.push("anti-slop-policy.json: current summary contract missing");

  for (const name of ["receipt-schema.json", "receipt-wire-schema.json"])
    if (!/LEGACY V2/.test(json(name).title || "")) violations.push(name + ": legacy-v2 schema quarantine missing");
  if (!/ARCHIVED LEGACY V2/.test(json("examples.json").note || ""))
    violations.push("examples.json: archived-v2 quarantine missing");
  if (!/LEGACY V2 COMPATIBILITY eval archive/.test(json("evals.json").note || ""))
    violations.push("evals.json: legacy-v2 eval quarantine missing");
  if (!/receipt-v1-test-vector\.json/.test(json("failure-drills.json").fixtures || ""))
    violations.push("failure-drills.json: current drill vector missing");
  if (!/unsigned local developer output/.test(json("mcp-security-boundary-policy.json").currentRavenMcpBoundary || ""))
    violations.push("mcp-security-boundary-policy.json: local MCP boundary missing");

  // Exact generated twins: recompute build.js output without mutating files.
  const evidence = {};
  for (const name of ["usdc", "fresh-pump", "risk-pump"])
    evidence[name] = JSON.parse(read(`evidence/${name}.compact.json`));
  const blob = JSON.stringify(evidence).replace(/</g, "\\u003c");
  for (const name of ["index", "receipts"]) {
    const expected = read(`${name}.template.html`).replace("__EVIDENCE__", () => blob);
    if (read(`${name}.html`) !== expected) violations.push(`${name}.html: generated copy differs from ${name}.template.html + evidence`);
  }

  // Non-vacuity: legacy evidence is preserved, the v1 vector exists, and the
  // access path survives this truth-only correction.
  const legacy = JSON.parse(read("receipt-test-vector.json"));
  if (!legacy.receipt?.replayHash || !legacy.receipt?.officialAttestationHash)
    violations.push("legacy v2 test vector was removed or rewritten");
  const current = JSON.parse(read("receipt-v1-test-vector.json"));
  if (!current.receipt?.payloadHash || !current.receipt?.receiptId || !current.receipt?.signerPublicKey)
    violations.push("current receipt-v1 test vector is missing required verification fields");
  if (!/request-access\.html/.test(pages["index.template.html"] + pages["agents.html"]))
    violations.push("existing request-access path was removed");

  if (violations.length) throw new Error(violations.join(" | "));
});

t("T1 request-access describes receipt-v1 fields without a current outcome enum", () => {
  const read = (name) => readFileSync(join(dir, name), "utf8");

  // B1: the request-access customer path must describe the actual receipt-v1
  // evidence fields. It must never reinstate the legacy outcome enum as the
  // shape a customer receives.
  const access = read("request-access.html");
  const lead = access.match(/<p class="lead" id="lead">([\s\S]*?)<\/p>/i)?.[1] || "";
  const scout = access.match(/<div id="scout-basic">([\s\S]*?)<\/div>\s*<div id="scout-adv"/i)?.[1] || "";
  if (!scout) throw new Error("B1: current receipt-v1 explanation is missing");
  if (/engine\s+outcome|\bverdict\b|will be one of[\s\S]{0,200}\brisk\b/i.test(lead + "\n" + scout))
    throw new Error("B1: request-access presents a legacy verdict/outcome enum as current receipt-v1");
  for (const field of [
    "findings", "coverageGaps", "rulesVersion", "slot", "timestamp",
    "maxAgeSeconds", "payloadHash", "receiptId", "signerPublicKey", "signature",
  ]) if (!scout.includes(field)) throw new Error("B1: request-access receipt-v1 explanation missing " + field);
});

t("T2 homepage legacy-v2 evidence archive is explicitly quarantined", () => {
  const read = (name) => readFileSync(join(dir, name), "utf8");
  // B2: the evidence blob is intentionally preserved legacy data, but its
  // visible section must state that boundary before the v1 recipe begins.
  const homepage = read("index.template.html");
  const archive = homepage.match(/<section id="evidence">([\s\S]*?)<\/section>/i)?.[1] || "";
  if (!archive) throw new Error("B2: homepage evidence archive section is missing");
  if (!/legacy v2/i.test(archive)) throw new Error("B2: homepage evidence archive lacks the legacy-v2 label");
  if (!/not the current receipt-v1 contract/i.test(archive))
    throw new Error("B2: homepage evidence archive lacks the current-contract boundary");
  if (!/not a live trust\/status viewer/i.test(archive))
    throw new Error("B2: homepage evidence archive lacks the live-viewer boundary");
  if (!/new integrations use (?:<[^>]+>)*POST \/receipt\/v1/i.test(archive))
    throw new Error("B2: homepage evidence archive does not route new integrations to receipt-v1");
});

t("T3 eval expectations match their current machine-readable artifacts", () => {
  const read = (name) => readFileSync(join(dir, name), "utf8");
  // B3: these eval expectations are assertions about referenced artifacts.
  // Bind the assertions to the actual candidate structures so stale prose
  // cannot pass merely because evals.json still parses.
  const evals = JSON.parse(read("evals.json"));
  const keyPolicy = JSON.parse(read("key-policy.json"));
  const context = read("raven-agent-context.md");
  const findEval = (id) => evals.evals?.find((entry) => entry.id === id);
  const keyEval = findEval("key_policy_available");
  if (!keyEval) throw new Error("B3: key-policy eval is missing");
  if (/currentKeyId/.test(keyEval.expected_behavior || ""))
    throw new Error("B3: key-policy eval restored the removed top-level currentKeyId assertion");
  if (!/legacyV2\.keyId\s*===\s*rvk_c2997e90215279c2/.test(keyEval.expected_behavior || ""))
    throw new Error("B3: key-policy eval does not assert the actual legacy key path");
  if (keyPolicy.legacyV2?.keyId !== "rvk_c2997e90215279c2" || keyPolicy.currentReceipt?.endpoint !== "POST /receipt/v1")
    throw new Error("B3: key-policy artifact does not match the eval's current/legacy split");

  const contextEval = findEval("agent_context_pack_exists");
  if (!contextEval) throw new Error("B3: agent-context eval is missing");
  if (/contains keyId and verdict semantics/i.test(contextEval.expected_behavior || ""))
    throw new Error("B3: agent-context eval restored stale keyId/verdict semantics");
  for (const field of ["receipt-v1", "payloadHash", "receiptId", "signerPublicKey", "coverageGaps", "findings"]) {
    if (!new RegExp(field, "i").test(contextEval.expected_behavior || ""))
      throw new Error("B3: agent-context eval does not assert current field " + field);
    if (!new RegExp(field, "i").test(context))
      throw new Error("B3: referenced agent context is missing current field " + field);
  }
  if (!/signed evidence fields, not a verdict or permission/i.test(context))
    throw new Error("B3: referenced agent context lost the current evidence boundary");
});

t("T4 current receipt-v1 prompts never request a verdict or engineOutcome", () => {
  const read = (name) => readFileSync(join(dir, name), "utf8");
  // B4: every prompt in this explicitly current receipt-v1 pack must avoid
  // asking an agent to extract or invent a v2 verdict/outcome.
  const recipes = JSON.parse(read("prompt-recipes.json"));
  for (const recipe of recipes.recipes || []) {
    if (/\bverdict\b|engineOutcome/i.test(recipe.prompt_template || ""))
      throw new Error("B4: current receipt-v1 recipe asks for verdict/engineOutcome: " + recipe.name);
  }
  const escalation = recipes.recipes?.find((entry) => entry.name === "prepare_human_escalation");
  if (!escalation || !/rulesVersion/.test(escalation.prompt_template || "") || !/slot/.test(escalation.prompt_template || "") || !/timestamp/.test(escalation.prompt_template || "") || !/local verifier/i.test(escalation.prompt_template || ""))
    throw new Error("B4: human-escalation recipe lacks current receipt-v1 and local-verifier concepts");
});


t("Lane-5: plugin public-truth rows name 0.3.2 fail-closed, not 0.3.1 fallback", () => {
  for (const f of ["security.html", "integrate.html"]) {
    const s = readFileSync(join(dir, f), "utf8");
    if (!s.includes("plugin-raven-verify@0.3.2")) throw new Error(f + " does not name plugin-raven-verify@0.3.2");
    if (/plugin-raven-verify@0\.3\.1/.test(s) && !/0\.3\.1 was/.test(s))
      throw new Error(f + " still presents plugin-raven-verify@0.3.1 as current");
    if (/current fallback trusts same-host/.test(s))
      throw new Error(f + " still describes the removed /pubkey fallback as current");
    if (!/fails closed/.test(s)) throw new Error(f + " does not describe 0.3.2 fail-closed no-pin behavior");
  }
});

t("Lane-5: agents.json pricing_note does not claim ACP jobs available", () => {
  const j = JSON.parse(readFileSync(join(dir, "agents.json"), "utf8"));
  if (j.acp?.hireable_today !== false || j.acp?.publicly_listed !== false)
    throw new Error("agents.json lost the not-hireable / not-listed flags");
  const note = String(j.access?.pricing_note || "");
  if (/ACP jobs available/i.test(note)) throw new Error("agents.json pricing_note restored ACP-available wording");
  if (!/sandbox-only/i.test(note) || !/not hireable/i.test(note))
    throw new Error("agents.json pricing_note lost the sandbox / not-hireable qualifier");
});

t("Lane-5: homepage JSON-LD does not claim a public ACP listing", () => {
  const html = readFileSync(join(dir, "index.html"), "utf8");
  const tmpl = readFileSync(join(dir, "index.template.html"), "utf8");
  for (const [name, body] of [["index.html", html], ["index.template.html", tmpl]]) {
    if (/Listed on the Virtuals Agent Commerce Protocol/.test(body))
      throw new Error(name + " JSON-LD restored the Listed-on ACP claim");
    if (!/not publicly listed/.test(body) || !/not hireable/.test(body))
      throw new Error(name + " lost the sandbox / not-listed JSON-LD qualifier");
  }
});

console.log(fail === 0 ? "\nSITE TESTS OK" : "\nSITE TESTS FAILED: " + fail);
process.exit(fail === 0 ? 0 : 1);
