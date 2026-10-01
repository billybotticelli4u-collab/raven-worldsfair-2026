import { createHash, randomUUID } from "node:crypto";

export const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const MAX_WIRE_BYTES = 16384;
const MAX_RPC_BYTES = 512 * 1024;
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hex = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) =>
  object(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const int32 = (value) =>
  Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
export class IntakeError extends Error {
  constructor(code, rpcCode) {
    super(code);
    this.name = "IntakeError";
    this.code = code;
    if (int32(rpcCode)) this.rpcCode = rpcCode;
  }
}
const refuse = (code) => {
  throw new IntakeError(code);
};

export function decodeSignature(value) {
  if (
    typeof value !== "string" ||
    value.length < 64 ||
    value.length > 88 ||
    !/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)
  )
    refuse("INVALID_SIGNATURE");
  let n = 0n;
  for (const char of value) n = n * 58n + BigInt(alphabet.indexOf(char));
  const bytes = [];
  while (n) {
    bytes.push(Number(n & 255n));
    n >>= 8n;
  }
  bytes.reverse();
  let zeros = 0;
  while (value[zeros] === "1") zeros++;
  const decoded = Buffer.concat([Buffer.alloc(zeros), Buffer.from(bytes)]);
  if (decoded.length !== 64) refuse("INVALID_SIGNATURE");
  return decoded;
}

// Check that the requested transaction identifier is the first signature in the
// returned wire. This is not cryptographic signature verification or chain proof.
export function inspectWire(inputBase64, signature) {
  if (
    typeof inputBase64 !== "string" ||
    inputBase64.length > Math.ceil(MAX_WIRE_BYTES / 3) * 4
  )
    refuse("INVALID_TRANSACTION_BYTES");
  const bytes = Buffer.from(inputBase64, "base64");
  if (
    bytes.length === 0 ||
    bytes.length > MAX_WIRE_BYTES ||
    bytes.toString("base64") !== inputBase64
  )
    refuse("INVALID_TRANSACTION_BYTES");
  let first, version;
  if (bytes[0] === 0x81) {
    const count = bytes[1];
    if (!count || count > 12 || bytes.length < 42 + 64 * count)
      refuse("INVALID_TRANSACTION_BYTES");
    first = bytes.subarray(
      bytes.length - 64 * count,
      bytes.length - 64 * count + 64,
    );
    version = 1;
  } else {
    let count = 0,
      offset = 0,
      byte;
    do {
      if (offset >= 3 || offset >= bytes.length)
        refuse("INVALID_TRANSACTION_BYTES");
      byte = bytes[offset];
      count |= (byte & 127) << (7 * offset);
      offset++;
    } while (byte & 128);
    if (
      count < 1 ||
      count > 65535 ||
      (offset > 1 && byte === 0) ||
      offset + count * 64 >= bytes.length
    )
      refuse("INVALID_TRANSACTION_BYTES");
    first = bytes.subarray(offset, offset + 64);
    const prefix = bytes[offset + count * 64];
    version = prefix < 128 ? "legacy" : prefix === 128 ? 0 : undefined;
    if (version === undefined) refuse("UNSUPPORTED_TRANSACTION_VERSION");
  }
  if (!first.equals(decodeSignature(signature))) refuse("SIGNATURE_MISMATCH");
  return { bytes, version };
}

function providerConfig(rpcUrl) {
  let url;
  try {
    url = new URL(rpcUrl);
  } catch {
    refuse("RPC_CONFIGURATION");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    refuse("RPC_CONFIGURATION");
  const providers = {
    "api.mainnet-beta.solana.com": "solana-public-mainnet",
    "mainnet.helius-rpc.com": "helius-mainnet",
  };
  const provider = providers[url.hostname];
  if (!provider) refuse("RPC_CONFIGURATION");
  return { url, provider };
}

async function rpc(url, method, params, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  let reader, timer;
  const operation = async () => {
    const id = randomUUID();
    const response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: controller.signal,
    });
    if (response.status === 429) refuse("RPC_RATE_LIMITED");
    if (!response.ok) refuse("RPC_UNAVAILABLE");
    const declared = response.headers.get("content-length");
    if (
      declared !== null &&
      (!/^\d+$/.test(declared) || Number(declared) > MAX_RPC_BYTES)
    )
      refuse("RPC_RESPONSE_TOO_LARGE");
    if (!response.body) refuse("RPC_INVALID_RESPONSE");
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RPC_BYTES) refuse("RPC_RESPONSE_TOO_LARGE");
      chunks.push(Buffer.from(value));
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      refuse("RPC_INVALID_RESPONSE");
    }
    if (
      !object(body) ||
      body.jsonrpc !== "2.0" ||
      body.id !== id ||
      "result" in body === "error" in body
    )
      refuse("RPC_INVALID_RESPONSE");
    if ("error" in body) {
      const code =
        object(body.error) && int32(body.error.code)
          ? body.error.code
          : undefined;
      throw new IntakeError(
        code === -32015 ? "UNSUPPORTED_TRANSACTION_VERSION" : "RPC_ERROR",
        code,
      );
    }
    return body.result;
  };
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new IntakeError("RPC_TIMEOUT"));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof IntakeError) throw error;
    throw new IntakeError("RPC_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}

export async function fetchTransaction(
  signature,
  {
    rpcUrl = "https://api.mainnet-beta.solana.com",
    fetchImpl = fetch,
    timeoutMs = 12000,
    now = () => new Date(),
  } = {},
) {
  decodeSignature(signature);
  const { url, provider } = providerConfig(rpcUrl);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    refuse("RPC_CONFIGURATION");
  const genesis = await rpc(url, "getGenesisHash", [], {
    fetchImpl,
    timeoutMs,
  });
  if (genesis !== MAINNET_GENESIS) refuse("NETWORK_MISMATCH");
  const value = await rpc(
    url,
    "getTransaction",
    [
      signature,
      {
        encoding: "base64",
        commitment: "finalized",
        maxSupportedTransactionVersion: 1,
      },
    ],
    { fetchImpl, timeoutMs },
  );
  if (value === null) refuse("TRANSACTION_UNAVAILABLE");
  if (
    !object(value) ||
    !Array.isArray(value.transaction) ||
    value.transaction.length !== 2 ||
    value.transaction[1] !== "base64"
  )
    refuse("RPC_INVALID_RESPONSE");
  const { bytes, version } = inspectWire(value.transaction[0], signature);
  if (value.version !== version) refuse("TRANSACTION_VERSION_MISMATCH");
  if (
    !Number.isSafeInteger(value.slot) ||
    value.slot < 0 ||
    !(
      value.blockTime === null ||
      (Number.isSafeInteger(value.blockTime) && value.blockTime >= 0)
    )
  )
    refuse("RPC_INVALID_RESPONSE");
  const record = {
    schema: "raven-transaction-intake/1",
    input_base64: bytes.toString("base64"),
    input_sha256: sha(bytes),
    source: {
      kind: "solana_rpc",
      provider,
      network: "mainnet-beta",
      genesis_hash: MAINNET_GENESIS,
      signature,
      commitment: "finalized",
      slot: value.slot,
      block_time: value.blockTime,
      version,
      fetched_at: now().toISOString(),
      assurance: "PROVIDER_REPORTED",
    },
  };
  // Self-validation applies the same bounded schema as later file imports.
  validateIntake(record, intakeDigest(record));
  return record;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
      .join(",") +
    "}"
  );
}
export const intakeDigest = (record) => sha(canonical(record));

export function validateIntake(record, retainedDigest) {
  if (!hex(retainedDigest)) refuse("REFERENCE_REQUIRED");
  if (
    !exact(record, ["schema", "input_base64", "input_sha256", "source"]) ||
    record.schema !== "raven-transaction-intake/1" ||
    !hex(record.input_sha256)
  )
    refuse("INVALID_INTAKE");
  const s = record.source;
  if (
    !exact(s, [
      "kind",
      "provider",
      "network",
      "genesis_hash",
      "signature",
      "commitment",
      "slot",
      "block_time",
      "version",
      "fetched_at",
      "assurance",
    ]) ||
    s.kind !== "solana_rpc" ||
    !["helius-mainnet", "solana-public-mainnet"].includes(s.provider) ||
    s.network !== "mainnet-beta" ||
    s.genesis_hash !== MAINNET_GENESIS ||
    s.commitment !== "finalized" ||
    s.assurance !== "PROVIDER_REPORTED"
  )
    refuse("INVALID_INTAKE");
  if (
    !Number.isSafeInteger(s.slot) ||
    s.slot < 0 ||
    !(
      s.block_time === null ||
      (Number.isSafeInteger(s.block_time) && s.block_time >= 0)
    ) ||
    typeof s.fetched_at !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s.fetched_at) ||
    !Number.isFinite(Date.parse(s.fetched_at))
  )
    refuse("INVALID_INTAKE");
  const { bytes, version } = inspectWire(record.input_base64, s.signature);
  if (sha(bytes) !== record.input_sha256 || version !== s.version)
    refuse("INVALID_INTAKE");
  if (intakeDigest(record) !== retainedDigest) refuse("REFERENCE_MISMATCH");
  return record;
}
