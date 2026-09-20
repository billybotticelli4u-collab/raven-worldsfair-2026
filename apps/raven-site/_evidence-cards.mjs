const STORIES = Object.freeze({
  usdc: {
    title: "USDC — the honesty test",
    why: "At issuance, Circle's USDC mint and freeze authorities were active. Raven records the chain evidence without special-casing a blue chip; the card's age makes clear this is a historical snapshot.",
  },
  "risk-pump": {
    title: "Launch snapshot — freeze authority active at issuance",
    why: "At issuance, the issuer kept freeze authority on a pump.fun token: holders could be frozen at will. Raven recorded that evidence deterministically at scan time.",
  },
  "fresh-pump": {
    title: "pump.fun launch snapshot — gaps stated",
    why: "At issuance, Token-2022 metadata extensions decoded and the metadata pointer recorded no update authority. The receipt states both what was checked and what was not evaluated; liquidity, holders, and deployer history remain explicit gaps.",
  },
});

const ORDER = Object.freeze(["usdc", "risk-pump", "fresh-pump"]);
// Governance display rule (owner ruling 2026-08-18): the wire outcome enum is
// grade-shaped, so cards never render it. Outcomes are stated as evidence:
// what triggered, under which rules version, at which slot, and what was not
// evaluated. The signed artifacts (linked below each card) keep the wire values.
const OUTCOME_DISPLAY = Object.freeze({
  pass: { label: "no listed finding triggered", tone: "clear" },
  pass_with_info_finding: { label: "no listed finding triggered", tone: "clear" },
  warning: { label: "listed finding triggered", tone: "alert" },
  risk: { label: "listed finding triggered", tone: "alert" },
  unknowable: { label: "not enough evidence", tone: "unknown" },
});
const OUTCOME_FALLBACK = Object.freeze({ label: "outcome unavailable", tone: "unknown" });
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const parsedTime = (value) => {
  if (typeof value !== "string" || value.trim() === "") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

export const formatIssuedAt = (value) => {
  const timestamp = parsedTime(value);
  if (timestamp === null) return "issued date unavailable";
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ") + " UTC";
};

export const formatReceiptAge = (value, now = Date.now()) => {
  const timestamp = parsedTime(value);
  if (timestamp === null || !Number.isFinite(now)) return "age unavailable";
  const elapsed = now - timestamp;
  if (elapsed < -5 * 60 * 1000) return "clock mismatch";
  if (elapsed < HOUR_MS) return "under 1 hour old";
  if (elapsed < DAY_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    return `${hours} ${hours === 1 ? "hour" : "hours"} old`;
  }
  const days = Math.floor(elapsed / DAY_MS);
  return `${days} ${days === 1 ? "day" : "days"} old`;
};

const text = (documentRef, tagName, value, className) => {
  const node = documentRef.createElement(tagName);
  if (className) node.className = className;
  node.textContent = String(value);
  return node;
};

const addMetaField = (documentRef, parent, label, value, className, dateTime) => {
  const field = documentRef.createElement("div");
  field.className = `meta-field${className ? ` ${className}` : ""}`;
  field.appendChild(text(documentRef, "b", label));
  const valueNode = documentRef.createElement(dateTime ? "time" : "span");
  if (dateTime) valueNode.dateTime = dateTime;
  valueNode.textContent = String(value);
  field.appendChild(valueNode);
  parent.appendChild(field);
};

const cleanList = (value) => Array.isArray(value) ? value.map(String) : [];

const buildCard = (documentRef, key, evidence, now) => {
  const story = STORIES[key];
  const card = documentRef.createElement("article");
  card.className = "card";

  const top = documentRef.createElement("div");
  top.className = "top";
  top.appendChild(text(documentRef, "h3", story.title));
  const display = OUTCOME_DISPLAY[evidence.verdict] ?? OUTCOME_FALLBACK;
  const badge = text(documentRef, "span", display.label, `badge ${display.tone}`);
  top.appendChild(badge);
  card.appendChild(top);

  card.appendChild(text(documentRef, "div", evidence.mintAddress ?? "mint unavailable", "mint mono"));
  card.appendChild(text(documentRef, "p", story.why, "why"));

  const meta = documentRef.createElement("div");
  meta.className = "card-meta";
  const issuedAt = typeof evidence.issuedAt === "string" ? evidence.issuedAt : "";
  addMetaField(documentRef, meta, "Issued", formatIssuedAt(issuedAt), "", parsedTime(issuedAt) === null ? "" : issuedAt);
  addMetaField(documentRef, meta, "Current age", formatReceiptAge(issuedAt, now), "age");
  const slot = Number.isSafeInteger(evidence.observedSlot) && evidence.observedSlot > 0
    ? evidence.observedSlot
    : "slot unavailable";
  addMetaField(documentRef, meta, "Observed slot", slot);
  card.appendChild(meta);

  const codes = documentRef.createElement("div");
  codes.className = "codes";
  const findingCodes = cleanList(evidence.findingCodes);
  if (findingCodes.length === 0) {
    codes.appendChild(text(documentRef, "span", "no finding codes", "code"));
  } else {
    for (const findingCode of findingCodes) {
      const riskClass = findingCode.startsWith("issuer_control") ? " risk" : "";
      codes.appendChild(text(documentRef, "span", findingCode, `code${riskClass}`));
    }
  }
  card.appendChild(codes);

  const coverageGaps = cleanList(evidence.coverageGaps);
  const rulesVersion = typeof evidence.engineVersion === "string" && evidence.engineVersion !== ""
    ? evidence.engineVersion
    : "unknown rules version";
  const outcomeLine = documentRef.createElement("p");
  outcomeLine.className = "gaps";
  outcomeLine.appendChild(text(documentRef, "b", display.label + " "));
  outcomeLine.appendChild(documentRef.createTextNode(
    `under rules ${rulesVersion} at slot ${slot}; not evaluated: ${coverageGaps.join(", ") || "none declared"}`));
  card.appendChild(outcomeLine);

  const rawLinkLine = documentRef.createElement("p");
  rawLinkLine.className = "raw-link";
  const rawLink = documentRef.createElement("a");
  rawLink.href = `evidence/${key}.json`;
  rawLink.textContent = "Open captured hosted response JSON";
  rawLinkLine.appendChild(rawLink);
  card.appendChild(rawLinkLine);

  const details = documentRef.createElement("details");
  details.appendChild(text(documentRef, "summary", "Archived compact receipt view"));
  const signatureMeta = documentRef.createElement("div");
  signatureMeta.className = "sig";
  for (const [label, value] of [
    ["slot", slot],
    ["key", evidence.keyId ?? "unavailable"],
    ["alg", evidence.signatureAlg ?? "unavailable"],
  ]) {
    if (signatureMeta.childNodes.length > 0) signatureMeta.appendChild(documentRef.createTextNode(" · "));
    signatureMeta.appendChild(text(documentRef, "b", label + " "));
    signatureMeta.appendChild(documentRef.createTextNode(String(value)));
  }
  details.appendChild(signatureMeta);
  details.appendChild(text(documentRef, "pre", JSON.stringify(evidence, null, 1)));
  card.appendChild(details);

  return card;
};

export const renderEvidenceCards = (documentRef = document, now = Date.now()) => {
  const container = documentRef.getElementById("cards");
  const source = documentRef.getElementById("evidence-data");
  if (!container || !source) return;
  container.replaceChildren();

  let evidenceByKey;
  try {
    evidenceByKey = JSON.parse(source.textContent || "{}");
  } catch {
    container.appendChild(text(
      documentRef,
      "p",
      "Archived evidence is temporarily unavailable. No freshness claim is being made.",
      "evidence-empty",
    ));
    return;
  }

  let rendered = 0;
  for (const key of ORDER) {
    const evidence = evidenceByKey?.[key];
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) continue;
    container.appendChild(buildCard(documentRef, key, evidence, now));
    rendered += 1;
  }
  if (rendered === 0) {
    container.appendChild(text(
      documentRef,
      "p",
      "No archived evidence is available. Raven will not substitute decorative proof.",
      "evidence-empty",
    ));
  }
};

if (typeof document !== "undefined") renderEvidenceCards(document);
