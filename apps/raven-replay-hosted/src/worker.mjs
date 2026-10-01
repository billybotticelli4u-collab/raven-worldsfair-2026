// Fixed program executed inside a per-request sandbox. It accepts JSON data,
// never a command, registry, module path, endpoint, environment or package name.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  createCase,
  parseCase,
  caseDigest,
  runCases,
  compareVersionsAgainstBaseline,
} from "../engine/src/cases.mjs";
import {
  validateRequest,
  bindIntake,
  digest,
  MAX_REQUEST_BYTES,
} from "./envelope.mjs";

export function executeRequest(request) {
  validateRequest(request);
  if (request.op === "create") {
    const made = createCase(request.input_base64, {
      name: request.name,
      adapterId: request.adapter_id,
    });
    const envelope = bindIntake(
      made.case,
      request.intake,
      request.intake_reference,
    );
    return {
      status: "CREATED",
      envelope,
      reference: digest(envelope),
      case_reference: made.case_content_sha256,
    };
  }
  const sdkCase = parseCase(JSON.stringify(request.envelope.sdk_case));
  if (request.op === "import")
    return {
      status: "IMPORTED",
      reference: request.reference,
      case_reference: caseDigest(sdkCase),
    };
  if (request.op === "compare") {
    const report = compareVersionsAgainstBaseline({baselineCase: sdkCase, baselineCaseSha256: caseDigest(sdkCase), candidateAdapterId: request.candidate_adapter_id, label: "Retained baseline comparison", detailed: false});
    return {status: report.status, report, reference: request.reference};
  }
  const report = runCases([sdkCase], {
    expectedCaseSha256s: [caseDigest(sdkCase)],
  });
  return {
    status: report.results[0].status,
    report,
    reference: request.reference,
  };
}
// File arguments are fixed by the host wrapper, not supplied by a web request.
export function runWorkerFile() {
  let result;
  try {
    if (process.version !== "v22.18.0")
      throw Object.assign(new Error(), { code: "RUNTIME_MISMATCH" });
    const data = readFileSync("/vercel/sandbox/request.json");
    if (data.length > MAX_REQUEST_BYTES)
      throw Object.assign(new Error(), { code: "INVALID_REQUEST" });
    result = { ok: true, data: executeRequest(JSON.parse(data)) };
  } catch (error) {
    const codes = new Set([
      "INVALID_REQUEST",
      "INVALID_OPERATION",
      "UNKNOWN_ADAPTER",
      "INVALID_CASE_NAME",
      "INVALID_TRANSACTION_BYTES",
      "UNSUPPORTED_DECODER_VERSION",
      "INVALID_CASE",
      "REFERENCE_REQUIRED",
      "REFERENCE_MISMATCH",
      "INTAKE_INPUT_MISMATCH",
      "INVALID_INTAKE",
      "RUNTIME_MISMATCH",
    ]);
    result = {
      ok: false,
      error: codes.has(error.code)
        ? error.code
        : error.kind === "INVALID_CASE"
          ? "INVALID_CASE"
          : "EXECUTION_BROKEN",
    };
  }
  writeFileSync("/vercel/sandbox/result.json", JSON.stringify(result) + "\n", {
    flag: "wx",
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runWorkerFile();
