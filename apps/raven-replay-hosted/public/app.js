const $ = (id) => document.getElementById(id);
let source = null,
  savedCase = null,
  busy = false;
const errors = {
  UNSUPPORTED_DECODER_VERSION:
    "These v1 bytes were retained, but this decoder’s saved-case format supports legacy and v0 only. No baseline was created.",
  TRANSACTION_UNAVAILABLE:
    "The provider did not return a finalized transaction. Check the signature or try again later.",
  REFERENCE_MISMATCH:
    "The case differs from your retained digest. Nothing was replayed.",
  REFERENCE_REQUIRED: "Enter the 64-character digest you retained separately.",
  INVALID_SIGNATURE: "Enter a valid Solana transaction signature.",
  INVALID_CASE: "This file is not a supported saved case.",
  RPC_RATE_LIMITED:
    "The transaction provider is rate limiting requests. Try again later.",
  RATE_LIMITED: "Too many requests. Wait a minute and retry.",
  CLEANUP_UNCONFIRMED:
    "The execution environment’s shutdown was not confirmed. This attempt has no successful result.",
  HOST_NOT_CONFIGURED: "Hosted execution is not configured on this deployment.",
  EXECUTION_BROKEN:
    "The decoder run did not complete. This is not a match or a behavioral difference.",
  INVALID_TRANSACTION_BYTES:
    "Use raw transaction bytes or canonical base64 text, up to 16 KiB.",
};
function node(tag, text, className) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
}
function buttons() {
  for (const b of document.querySelectorAll("button,input,textarea,select"))
    b.disabled = busy;
  $("save").disabled = busy || !source;
  $("replay").disabled =
    busy || !savedCase || !/^[a-f0-9]{64}$/.test($("reference").value);
}
function show(title, text, kind = "") {
  const box = node("div", undefined, "outcome " + kind);
  box.append(node("h3", title), node("p", text));
  $("result").replaceChildren(box);
  $("downloads").replaceChildren();
  $("downloads").hidden = true;
  return box;
}
function fail(error) {
  const code =
    typeof error.code === "string" ? error.code : "SERVICE_UNAVAILABLE";
  show(
    "Not completed",
    errors[code] ||
      "This attempt could not be completed. No previous success is being shown.",
    "error",
  ).append(node("p", code, "status-label"));
}
async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(65000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw { code: "SERVICE_UNAVAILABLE" };
  }
  if (!response.ok || !data.ok)
    throw { code: data.error || "SERVICE_UNAVAILABLE" };
  return data;
}
async function attempt(title, fn) {
  if (busy) return;
  busy = true;
  show(title, "The latest attempt is in progress.");
  buttons();
  try {
    await fn();
  } catch (e) {
    fail(e);
  } finally {
    busy = false;
    buttons();
  }
}
function download(label, value, name, type = "application/json") {
  const button = node("button", label);
  button.type = "button";
  button.addEventListener("click", () => {
    const data =
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n";
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = node("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("downloads").append(button);
  $("downloads").hidden = false;
}
function facts(parent, entries) {
  const dl = node("dl");
  for (const [key, value] of entries) {
    dl.append(node("dt", key), node("dd", String(value)));
  }
  parent.append(dl);
}
function clearCase() {
  savedCase = null;
  $("reference").value = "";
  $("case-file").value = "";
}
$("signature").addEventListener("input", () => {
  if (busy) return;
  source = null;
  clearCase();
  showSource();
  show(
    "Signature changed",
    "Fetch this transaction before creating a baseline.",
  );
  buttons();
});
function showSource() {
  const box = $("source");
  box.hidden = !source;
  if (!source) {
    box.replaceChildren();
    return;
  }
  box.replaceChildren(node("p", source.label));
  if (source.intake) {
    const s = source.intake.source;
    facts(box, [
      ["Version", s.version],
      ["Slot (provider-reported)", s.slot],
      ["Byte digest", source.intake.input_sha256],
    ]);
  } else box.append(node("p", "Local input. No chain provenance asserted."));
}
$("fetch-form").addEventListener("submit", (event) => {
  event.preventDefault();
  attempt("Fetching transaction", async () => {
    source = null;
    clearCase();
    showSource();
    const r = await post("/api/transaction", {
      signature: $("signature").value.trim(),
    });
    source = {
      input_base64: r.intake.input_base64,
      intake: r.intake,
      intake_reference: r.reference,
      label: "Fetched transaction — provider-reported evidence",
    };
    showSource();
    const box = show(
      "Bytes retained",
      "Fetching succeeded. The decoder has not run yet.",
    );
    facts(box, [
      ["Signature", r.intake.source.signature],
      ["Provider", r.intake.source.provider],
      ["Fetched at", r.intake.source.fetched_at],
    ]);
    download(
      "Download transaction evidence",
      r.intake,
      "raven-transaction.json",
    );
    download(
      "Download intake reference",
      r.reference + "\n",
      "raven-transaction-reference.txt",
      "text/plain",
    );
  });
});
$("example").addEventListener("click", () =>
  attempt("Loading synthetic example", async () => {
    source = null;
    clearCase();
    showSource();
    const r = await fetch("/example.json");
    if (!r.ok) throw {};
    const e = await r.json();
    source = {
      input_base64: e.input_base64,
      intake: null,
      intake_reference: null,
      label: e.label,
    };
    showSource();
    show("Synthetic example loaded", e.source);
    $("case-name").value = "Synthetic legacy example";
  }),
);
$("wire-file").addEventListener("change", () =>
  attempt("Reading local file", async () => {
    source = null;
    clearCase();
    showSource();
    const file = $("wire-file").files[0];
    if (!file || file.size > 22000) throw { code: "INVALID_TRANSACTION_BYTES" };
    let input;
    if (/\.(txt|base64)$/i.test(file.name)) {
      input = (await file.text()).trim();
      let bytes;
      try {
        bytes = atob(input);
      } catch {
        throw { code: "INVALID_TRANSACTION_BYTES" };
      }
      if (!bytes.length || bytes.length > 16384 || btoa(bytes) !== input)
        throw { code: "INVALID_TRANSACTION_BYTES" };
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!bytes.length || bytes.length > 16384)
        throw { code: "INVALID_TRANSACTION_BYTES" };
      input = btoa(String.fromCharCode(...bytes));
    }
    source = {
      input_base64: input,
      intake: null,
      intake_reference: null,
      label: "Uploaded transaction bytes",
    };
    showSource();
    show("File loaded", "Local input only. The decoder has not run yet.");
  }),
);
$("save-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!source) return;
  attempt("Creating baseline", async () => {
    clearCase();
    const r = await post("/api/run", {
      op: "create",
      name: $("case-name").value,
      adapter_id: $("decoder").value,
      input_base64: source.input_base64,
      intake: source.intake,
      intake_reference: source.intake_reference,
    });
    savedCase = r.data.envelope;
    $("reference").value = r.data.reference;
    const parsed = savedCase.sdk_case.expected_execution.parsed;
    const box = show(
      "Baseline saved",
      "Keep the case and its reference digest separately. The initial decoder result is not an independent correctness check.",
    );
    facts(box, [
      ["Decoder result", parsed.decision],
      ["Version", parsed.version],
      ["Reason", parsed.reason],
      ["Reference digest", r.data.reference],
      ["Cloud environment", r.isolation.lifecycle],
    ]);
    download("Download case", savedCase, "raven-case.json");
    download(
      "Download reference",
      r.data.reference + "\n",
      "raven-case-reference.txt",
      "text/plain",
    );
  });
});
$("case-file").addEventListener("change", () =>
  attempt("Reading saved case", async () => {
    savedCase = null;
    $("reference").value = "";
    const file = $("case-file").files[0];
    if (!file || file.size > 320 * 1024) throw { code: "INVALID_CASE" };
    try {
      savedCase = JSON.parse(await file.text());
    } catch {
      throw { code: "INVALID_CASE" };
    }
    show(
      "Case loaded — not verified",
      "Enter the reference digest retained separately, then replay. No decoder has run.",
    );
  }),
);
$("reference").addEventListener("input", () => {
  if (!busy)
    show(
      "Reference changed",
      "Replay to check the case against this reference.",
    );
  buttons();
});
$("replay-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!savedCase) return;
  attempt("Replaying saved bytes", async () => {
    const request = { envelope: savedCase, reference: $("reference").value };
    await post("/api/run", { op: "import", ...request });
    const r = await post("/api/run", { op: "replay", ...request });
    const status = r.data.status;
    const descriptions = {
      MATCH:
        "The pinned decoder reproduced the saved result. No transaction was fetched again.",
      REGRESSION:
        "The decoder result differs from the saved expectation. This is not a safety verdict.",
      RUN_ERROR:
        "Execution did not complete. No behavioral match or change is established.",
      INVALID_CASE: "The case was refused before a comparison could complete.",
    };
    const box = show(
      status,
      descriptions[status] || "Inspect the report for the bounded result.",
      status === "MATCH" ? "match" : status === "REGRESSION" ? "" : "error",
    );
    facts(box, [
      ["Reference digest", r.data.reference],
      ["Cloud environment", r.isolation.lifecycle],
    ]);
    download("Download report", r.data.report, "raven-replay-report.json");
    const details = node("details");
    details.append(
      node("summary", "Inspect report"),
      node("pre", JSON.stringify(r.data.report, null, 2)),
    );
    box.append(details);
  });
});
buttons();
