import { createHash } from "node:crypto";
import {
  validateIntake,
  intakeDigest,
  MAX_WIRE_BYTES,
  IntakeError,
} from "./intake.mjs";
export const MAX_REQUEST_BYTES = 320 * 1024;
export const ALLOWED_ADAPTERS = Object.freeze(["solana-kit-tx-decode"]);
export const exact = (value, keys) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
export const digest = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
      .join(",") +
    "}"
  );
}
export const fail = (code) => {
  throw new IntakeError(code);
};
export function validateInput(input) {
  if (
    typeof input !== "string" ||
    input.length > Math.ceil(MAX_WIRE_BYTES / 3) * 4
  )
    fail("INVALID_TRANSACTION_BYTES");
  const bytes = Buffer.from(input, "base64");
  if (
    !bytes.length ||
    bytes.length > MAX_WIRE_BYTES ||
    bytes.toString("base64") !== input
  )
    fail("INVALID_TRANSACTION_BYTES");
  return bytes;
}
export function validateRequest(request) {
  if (
    !request ||
    typeof request !== "object" ||
    Buffer.byteLength(JSON.stringify(request)) > MAX_REQUEST_BYTES
  )
    fail("INVALID_REQUEST");
  if (request.op === "create") {
    if (
      !exact(request, [
        "op",
        "input_base64",
        "adapter_id",
        "name",
        "intake",
        "intake_reference",
      ])
    )
      fail("INVALID_REQUEST");
    if (!ALLOWED_ADAPTERS.includes(request.adapter_id)) fail("UNKNOWN_ADAPTER");
    if (
      typeof request.name !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,63}$/.test(request.name)
    )
      fail("INVALID_CASE_NAME");
    const bytes = validateInput(request.input_base64);
    if (request.intake !== null) {
      validateIntake(request.intake, request.intake_reference);
      if (request.intake.input_base64 !== request.input_base64)
        fail("INTAKE_INPUT_MISMATCH");
    } else if (request.intake_reference !== null) fail("INVALID_REQUEST");
    if (bytes[0] === 0x81) fail("UNSUPPORTED_DECODER_VERSION");
  } else if (request.op === "replay" || request.op === "import") {
    if (!exact(request, ["op", "envelope", "reference"]))
      fail("INVALID_REQUEST");
    validateEnvelope(request.envelope, request.reference);
  } else fail("INVALID_OPERATION");
  return request;
}
export function makeEnvelope(sdkCase) {
  return {
    schema: "raven-hosted-replay-case/1",
    sdk_case: sdkCase,
    intake: null,
    intake_reference: null,
  };
}
export function validateEnvelope(value, reference) {
  if (typeof reference !== "string" || !/^[a-f0-9]{64}$/.test(reference))
    fail("REFERENCE_REQUIRED");
  if (
    !exact(value, ["schema", "sdk_case", "intake", "intake_reference"]) ||
    value.schema !== "raven-hosted-replay-case/1" ||
    !value.sdk_case ||
    typeof value.sdk_case !== "object" ||
    !ALLOWED_ADAPTERS.includes(value.sdk_case.adapter_id)
  )
    fail("INVALID_CASE");
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_REQUEST_BYTES)
    fail("INVALID_CASE");
  if (value.intake !== null) {
    validateIntake(value.intake, value.intake_reference);
    if (value.intake.input_base64 !== value.sdk_case.input_base64)
      fail("INTAKE_INPUT_MISMATCH");
  } else if (value.intake_reference !== null) fail("INVALID_CASE");
  if (digest(value) !== reference) fail("REFERENCE_MISMATCH");
  return value;
}
export function bindIntake(sdkCase, intake, reference) {
  const value = makeEnvelope(sdkCase);
  if (intake !== null) {
    validateIntake(intake, reference);
    if (intake.input_base64 !== sdkCase.input_base64)
      fail("INTAKE_INPUT_MISMATCH");
    value.intake = intake;
    value.intake_reference = intakeDigest(intake);
  }
  return value;
}
